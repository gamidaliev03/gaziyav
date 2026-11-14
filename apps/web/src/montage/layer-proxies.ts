// AI layers covered by clips ABOVE them: the layer is rendered once into a transparent video (HEVC with alpha) and
// placed at its own track position, so the clips above really cover it — in the preview and in the export. A layer
// with nothing above it keeps the live Remotion overlay (instant while editing). Renders run in the background.
import { create } from "zustand";
import { EditorCore } from "@/core";
import { processMediaAssets } from "@/media/processing";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { mediaTimeFromSeconds, TICKS_PER_SECOND } from "@/wasm";
import { type Flattened, flattenCompositions } from "./flatten";
import type { MontageInput, MontageItem } from "./types";

export interface LayerGroup {
	key: string;
	zTrack: string;
	items: MontageItem[];
}

interface Ready {
	assetId: string;
	offset: number;
}

interface ProxyState {
	ready: Record<string, Ready>;
	running: Record<string, true>;
	version: number;
}

export const useLayerProxies = create<ProxyState>(() => ({ ready: {}, running: {}, version: 0 }));

function hash(text: string): string {
	let h = 5381;
	for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
	return (h >>> 0).toString(36);
}

const isVisual = (e: TimelineElement) => e.type !== "audio" && !("hidden" in e && e.hidden);

/** Groups of AI layers (per track) that have visible clips above them at the same time. */
export function coveredGroups(flat: Flattened, canvas: { width: number; height: number }, fps: number): LayerGroup[] {
	if (!flat.items.length) return [];
	const order = [...flat.tracks.overlay.map((t) => t.id), flat.tracks.main.id];
	const byTrack = new Map<string, MontageItem[]>();
	for (const it of flat.items) {
		if (!it.zTrack) continue;
		byTrack.set(it.zTrack, [...(byTrack.get(it.zTrack) ?? []), it]);
	}
	const groups: LayerGroup[] = [];
	for (const [zTrack, items] of byTrack) {
		const index = order.indexOf(zTrack);
		if (index <= 0) continue; // top track (or unknown): the overlay is already right
		const above = flat.tracks.overlay.slice(0, index) as TimelineTrack[];
		const covered = items.some((it) =>
			above.some((t) =>
				!("hidden" in t && t.hidden) &&
				(t.elements as TimelineElement[]).some((e) => {
					if (!isVisual(e)) return false;
					const a = (e.startTime as number) / TICKS_PER_SECOND;
					const b = a + (e.duration as number) / TICKS_PER_SECOND;
					return a < it.from + it.dur && b > it.from;
				}),
			),
		);
		if (!covered) continue;
		groups.push({ zTrack, items, key: hash(JSON.stringify({ items, w: canvas.width, h: canvas.height, fps })) });
	}
	return groups;
}

/** Ids (with owner) of the items drawn by ready proxies — the live overlay and the export composite skip them. */
export function proxiedItemKeys(groups: LayerGroup[]): Set<string> {
	const ready = useLayerProxies.getState().ready;
	const keys = new Set<string>();
	for (const g of groups) if (ready[g.key]) for (const it of g.items) keys.add(`${it.owner ?? ""}:${it.id}`);
	return keys;
}

/** The flattened tracks with each ready proxy on its own track right above the AI layer's track. */
export function withProxies(tracks: SceneTracks, groups: LayerGroup[]): SceneTracks {
	const ready = useLayerProxies.getState().ready;
	const assets = EditorCore.getInstance().media.getAssets();
	let overlay = [...tracks.overlay];
	for (const g of groups) {
		const r = ready[g.key];
		const asset = r && assets.find((a) => a.id === r.assetId);
		if (!r || !asset) continue;
		const element = {
			...buildElementFromMedia({
				mediaId: asset.id,
				mediaType: "video",
				name: "AI layer",
				duration: mediaTimeFromSeconds({ seconds: asset.duration ?? 1 }),
				startTime: mediaTimeFromSeconds({ seconds: r.offset }),
			}),
			id: `ai-proxy~${g.key}`,
			isSourceAudioEnabled: false,
		} as TimelineElement;
		// Right above the AI layer's track (on the main track: just above it, i.e. the bottom of the overlays).
		const index = overlay.findIndex((t) => t.id === g.zTrack);
		const at = index === -1 ? overlay.length : index;
		const track = { id: `ai-proxy-track~${g.key}`, name: "AI layer", type: "video", elements: [element], hidden: false, muted: true } as unknown as (typeof overlay)[number];
		overlay = [...overlay.slice(0, at), track, ...overlay.slice(at)];
	}
	return overlay === tracks.overlay ? tracks : { ...tracks, overlay };
}

const headers = { "X-Studio": "1" };

async function renderGroup(group: LayerGroup, base: Omit<MontageInput, "items" | "durationInFrames">, signal?: AbortSignal): Promise<boolean> {
	const state = useLayerProxies.getState();
	if (state.ready[group.key]) return true;
	if (state.running[group.key]) {
		while (useLayerProxies.getState().running[group.key]) {
			if (signal?.aborted) return false;
			await new Promise((r) => setTimeout(r, 250));
		}
		return !!useLayerProxies.getState().ready[group.key];
	}
	useLayerProxies.setState((s) => ({ running: { ...s.running, [group.key]: true } }));
	try {
		const end = group.items.reduce((m, it) => Math.max(m, it.from + it.dur), 0);
		const input: MontageInput = { ...base, items: group.items, durationInFrames: Math.max(2, Math.ceil(end * base.fps) + 1) };
		const start = await fetch("/api/montage/layer-proxy", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ input }) });
		let job = (await start.json().catch(() => null)) as { id: string; status: string; error?: string; result?: { fileId: string; name: string; offset: number } } | null;
		if (!start.ok || !job?.id) return false;
		while (job.status === "running") {
			if (signal?.aborted) {
				await fetch(`/api/montage/jobs/${job.id}`, { method: "DELETE", headers }).catch(() => {});
				return false;
			}
			await new Promise((r) => setTimeout(r, 300));
			const poll: Response = await fetch(`/api/montage/jobs/${job.id}`);
			job = ((await poll.json().catch(() => null)) as typeof job) ?? job;
		}
		if (job.status !== "done" || !job.result) return false;
		const res = await fetch(`/api/studio/file/${job.result.fileId}`);
		if (!res.ok) return false;
		const webm = job.result.name?.endsWith(".webm");
		const file = new File([await res.blob()], webm ? "AI layer.webm" : "AI layer.mov", { type: webm ? "video/webm" : "video/quicktime" });
		void fetch(`/api/studio/file/${job.result.fileId}`, { method: "DELETE", headers }).catch(() => {});
		const editor = EditorCore.getInstance();
		const project = editor.project.getActiveOrNull();
		if (!project) return false;
		const [processed] = await processMediaAssets({ files: [file] });
		if (!processed) return false;
		const asset = await editor.media.addMediaAsset({ projectId: project.metadata.id, asset: { ...processed, ephemeral: true } });
		if (!asset) return false;
		useLayerProxies.setState((s) => ({ ready: { ...s.ready, [group.key]: { assetId: asset.id, offset: job!.result!.offset } }, version: s.version + 1 }));
		return true;
	} catch {
		return false;
	} finally {
		useLayerProxies.setState((s) => {
			const running = { ...s.running };
			delete running[group.key];
			return { running };
		});
	}
}

function baseInput(): Omit<MontageInput, "items" | "durationInFrames"> | null {
	const settings = EditorCore.getInstance().project.getActiveOrNull()?.settings;
	if (!settings) return null;
	const fps = settings.fps.denominator > 0 ? settings.fps.numerator / settings.fps.denominator : 30;
	return { words: [], origin: window.location.origin, width: settings.canvasSize.width, height: settings.canvasSize.height, fps };
}

let rendererAsked = false;
/**
 * The first AI layer of a session (a motion graphic added, a project with one opened) starts fetching the browser its
 * export renders with: once, in the background (studio/server/components.ts), so the export never waits for it.
 */
export function prefetchRenderer() {
	if (rendererAsked || typeof window === "undefined") return;
	rendererAsked = true;
	void fetch("/api/studio/components/chrome", { method: "POST", headers }).catch(() => {
		rendererAsked = false;
	});
}

let pending: number | null = null;
/** Called on every preview rebuild: renders the missing proxies a moment after the last edit. */
export function scheduleProxies(groups: LayerGroup[]) {
	const missing = groups.filter((g) => !useLayerProxies.getState().ready[g.key]);
	if (!missing.length) return;
	if (pending) window.clearTimeout(pending);
	pending = window.setTimeout(() => {
		pending = null;
		const base = baseInput();
		if (!base) return;
		void (async () => {
			for (const g of missing) await renderGroup(g, base);
		})();
	}, 1500);
}

/** Export: every covered AI layer is rendered first (the export then places it like any clip). */
export async function ensureProxies(groups: LayerGroup[], isCancelled: () => boolean): Promise<boolean> {
	const base = baseInput();
	if (!base) return false;
	const controller = new AbortController();
	const timer = window.setInterval(() => isCancelled() && controller.abort(), 200);
	try {
		for (const g of groups) if (!(await renderGroup(g, base, controller.signal))) return false;
		return true;
	} finally {
		window.clearInterval(timer);
	}
}

/** The covered AI-layer groups of what the export will render (the same tracks as the export's playbackTracks). */
export function exportGroups(base: SceneTracks): LayerGroup[] {
	const editor = EditorCore.getInstance();
	const settings = editor.project.getActiveOrNull()?.settings;
	if (!settings) return [];
	const fps = settings.fps.denominator > 0 ? settings.fps.numerator / settings.fps.denominator : 30;
	const flat = flattenCompositions({ tracks: base, scenes: editor.scenes.getScenes(), canvas: settings.canvasSize, fps });
	return coveredGroups(flat, settings.canvasSize, fps);
}
