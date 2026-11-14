// Export of Remotion AI Compositions. The AI layer render starts on the app's server the moment Export is pressed,
// in parallel with OpenCut's own export of the clips (compositions flattened); an unchanged layer is reused from
// the cache. Then the layer is laid over the exported video. Only ever runs from «Export».
import { sliceActiveSceneToRange } from "@/in-out/slice";
import { exportGroups, proxiedItemKeys } from "./layer-proxies";
import type { EditorCore } from "@/core";
import type { ExportOptions, ExportResult } from "@/export";
import { jobCenter } from "@/jobs/store";
import { TICKS_PER_SECOND } from "@/wasm";
import { flattenCompositions, projectFps } from "./compositions";
import { shiftToRange } from "./range";
import type { MontageInput } from "./types";
import { addFollowPaths } from "@/motion/follow";

const headers = { "X-Studio": "1" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ServerJob {
	id: string;
	status: "running" | "done" | "failed" | "cancelled";
	error?: string;
	result?: any;
	stages?: { id: string; title: string; status: string; progress?: number; startedAt?: number; endedAt?: number }[];
	startedAt?: number;
	endedAt?: number;
}

export interface AiLayerRender {
	jobId: string;
	cancel: () => void;
	poll: () => Promise<ServerJob | null>;
}

/** AI layers visible in the export of the active timeline, or null when there are none. */
export function exportLayers(editor: EditorCore, options: ExportOptions): MontageInput | null {
	if (options.mainTrackOnly) return null;
	const project = editor.project.getActiveOrNull();
	const scene = editor.scenes.getActiveSceneOrNull();
	if (!project || !scene) return null;
	// Same flattening (and the same keyframe samples, on the project's frame grid) as the preview.
	const flat = flattenCompositions({ tracks: scene.tracks, scenes: editor.scenes.getScenes(), fps: projectFps(project.settings.fps) });
	// Layers covered by clips above them are already in the export as transparent video (layer-proxies).
	const proxied = proxiedItemKeys(exportGroups(options.range ? sliceActiveSceneToRange({ editor, range: options.range }) : scene.tracks));
	const live = proxied.size ? flat.items.filter((it) => !proxied.has(`${it.owner ?? ""}:${it.id}`)) : flat.items;
	const items = addFollowPaths(live, flat.tracks, project.settings.canvasSize);
	if (!items.length) return null;
	const fps = projectFps(options.fps ?? project.settings.fps);
	// In→Out export: the layer starts at the In point and stops at the Out point, like the clips.
	const range = options.range ? { start: options.range.start / TICKS_PER_SECOND, end: options.range.end / TICKS_PER_SECOND } : null;
	const seconds = range ? range.end - range.start : editor.timeline.getTotalDuration() / TICKS_PER_SECOND;
	const placed = range ? shiftToRange(items, range.start, seconds) : items;
	if (!placed.length) return null;
	return {
		items: placed,
		words: [],
		origin: window.location.origin,
		width: project.settings.canvasSize.width,
		height: project.settings.canvasSize.height,
		fps,
		durationInFrames: Math.max(1, Math.ceil(seconds * fps)),
	};
}

/** Starts rendering the AI layer right away (runs while OpenCut exports the clips). */
export async function startAiLayers(input: MontageInput): Promise<AiLayerRender | { error: string }> {
	try {
		const res = await fetch("/api/montage/layers", {
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({ input }),
		});
		const job = (await res.json().catch(() => null)) as ServerJob | null;
		if (!res.ok || !job?.id) return { error: (job as any)?.error || "The AI layer renderer didn't start." };
		return {
			jobId: job.id,
			cancel: () => void fetch(`/api/montage/jobs/${job.id}`, { method: "DELETE", headers }).catch(() => {}),
			poll: async () => (await fetch(`/api/montage/jobs/${job.id}`).then((r) => r.json()).catch(() => null)) as ServerJob | null,
		};
	} catch {
		return { error: "Gaziyav's local server is not responding. Restart Gaziyav." };
	}
}

export async function compositeAiLayers({
	buffer,
	layers,
	format,
	onProgress,
	isCancelled,
}: {
	buffer: ArrayBuffer;
	layers: AiLayerRender;
	format: string;
	onProgress: (p: number) => void;
	isCancelled: () => boolean;
}): Promise<ExportResult> {
	const stage = (s: string) => jobCenter.update("export", { stage: s });
	const t0 = performance.now();
	const up = await fetch(`/api/studio/upload?name=${encodeURIComponent(`export.${format}`)}`, { method: "POST", headers, body: buffer });
	const upData = await up.json().catch(() => null);
	if (!up.ok || !upData?.fileId) return { success: false, error: upData?.error || "Couldn't hand the video to the AI layer renderer." };
	const fileId = upData.fileId as string;
	const cleanup = (id: string) => void fetch(`/api/studio/file/${id}`, { method: "DELETE", headers }).catch(() => {});
	try {
		const startRes = await fetch("/api/montage/composite", {
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({ fileId, layerJob: layers.jobId, format }),
		});
		let job = (await startRes.json().catch(() => null)) as ServerJob | null;
		if (!startRes.ok || !job?.id) return { success: false, error: (job as any)?.error || "Compositing the AI layers didn't start." };
		while (job.status === "running") {
			if (isCancelled()) {
				layers.cancel();
				await fetch(`/api/montage/jobs/${job.id}`, { method: "DELETE", headers }).catch(() => {});
				return { success: false, cancelled: true };
			}
			const layer = await layers.poll();
			const render = layer?.stages?.find((s) => s.id === "render");
			if (layer?.status === "running") {
				stage("Rendering AI layers");
				onProgress(0.85 * (render?.progress ?? 0));
			} else {
				stage("Compositing AI layers");
				onProgress(0.9);
			}
			await sleep(150);
			const current: ServerJob = job;
			const res: Response = await fetch(`/api/montage/jobs/${current.id}`);
			job = ((await res.json().catch(() => null)) as ServerJob | null) ?? current;
		}
		if (job.status !== "done") return { success: false, error: job.error || "Rendering the AI layers failed." };
		const outId = job.result?.fileId as string;
		const res = await fetch(`/api/studio/file/${outId}`);
		if (!res.ok) return { success: false, error: "Couldn't read the final video." };
		const out = await res.arrayBuffer();
		cleanup(outId);
		onProgress(1);
		const done = await layers.poll();
		const st = done?.stages?.find((x) => x.id === "render");
		const cj = job.stages?.find((x) => x.id === "composite");
		// Timings for diagnostics (read by the export test).
		(window as unknown as { __aiExportTimings?: unknown }).__aiExportTimings = {
			layer: st?.status === "skipped" ? "cached" : ((st?.endedAt ?? 0) - (st?.startedAt ?? 0)) / 1000,
			layerStartedBeforeComposite: ((cj?.startedAt ?? 0) - (done?.startedAt ?? 0)) / 1000,
			composite: ((cj?.endedAt ?? 0) - (cj?.startedAt ?? 0)) / 1000,
			afterClipsExport: (performance.now() - t0) / 1000,
		};
		return { success: true, buffer: out };
	} finally {
		cleanup(fileId);
	}
}
