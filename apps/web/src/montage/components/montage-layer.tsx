"use client";
// The Remotion layer over the preview canvas: a transparent @remotion/player <Thumbnail> showing exactly the frame
// under the playhead (play, pause, seek, scrub). Mounted only while an AI layer is visible at the playhead.
import { coveredGroups, proxiedItemKeys, useLayerProxies } from "../layer-proxies";
import { Thumbnail } from "@remotion/player";
import { useEffect, useMemo, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import type { MediaAsset } from "@/media/types";
import { getVisibleElementsWithBounds } from "@/preview/element-bounds";
import type { SceneTracks } from "@/timeline";
import { TICKS_PER_SECOND } from "@/wasm";
import { flattenCompositions, projectFps } from "../compositions";
import { addFollowPaths } from "@/motion/follow";
import { MontageComposition } from "../remotion/composition";
import type { MontageInput, MontageItem } from "../types";
import { InlineEditor } from "./inline-edit";

const itemKey = (it: MontageItem) => `${it.owner ?? ""}:${it.id}`;

/**
 * A covered AI layer whose transparent render isn't ready yet is still drawn live, but with every clip above it cut
 * out of the overlay — an alpha mask in canvas pixels. The overlay is a DOM layer over the one compositor canvas, so
 * it cannot be drawn between two tracks: until the layer's own transparent render takes its place in the stack
 * (layer-proxies), a text, sticker or photo above it keeps its box, and the layer shows around it. Without this the
 * layer hid everything above it (the user: «шаблон перекрывает все слои, даже те, что поверх него»).
 */
function coverMask(tracks: SceneTracks, zTrack: string, time: number, canvas: { width: number; height: number }, assets: MediaAsset[]): string | null {
	const index = tracks.overlay.findIndex((t) => t.id === zTrack);
	const above = new Set((index < 0 ? tracks.overlay : tracks.overlay.slice(0, index)).map((t) => t.id));
	const holes: string[] = [];
	for (const { trackId, element, bounds } of getVisibleElementsWithBounds({ tracks, currentTime: Math.round(time * TICKS_PER_SECOND), canvasSize: canvas, mediaAssets: assets })) {
		if (!above.has(trackId)) continue;
		const params = (element as { params?: Record<string, unknown> }).params ?? {};
		// A blended or masked clip is drawn by the compositor in a way a box cannot stand in for: the layer stays under it.
		const masked = "masks" in element && (element.masks?.length ?? 0) > 0;
		if ((params.blendMode ?? "normal") !== "normal" || masked || Number(params.opacity ?? 1) <= 0.01) continue;
		const a = (bounds.rotation * Math.PI) / 180;
		const c = Math.cos(a), s = Math.sin(a);
		const w = bounds.width / 2, h = bounds.height / 2;
		const pts = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => `${(bounds.cx + x * c - y * s).toFixed(1)},${(bounds.cy + x * s + y * c).toFixed(1)}`);
		holes.push(`<polygon points='${pts.join(" ")}' fill='black'/>`);
	}
	if (!holes.length) return null;
	const { width: W, height: H } = canvas;
	const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}' preserveAspectRatio='none'><defs><mask id='m' maskUnits='userSpaceOnUse' x='0' y='0' width='${W}' height='${H}'><rect width='${W}' height='${H}' fill='white'/>${holes.join("")}</mask></defs><rect width='${W}' height='${H}' fill='white' mask='url(#m)'/></svg>`;
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export default function MontageLayer() {
	const editor = useEditor();
	// While a clip is dragged/scaled in the preview its live (uncommitted) transform is used, so the AI layers of a
	// composition follow the drag instead of jumping only on release.
	const tracks = useEditor((e) => e.timeline.getPreviewTracks() ?? e.scenes.getActiveSceneOrNull()?.tracks ?? null, ["scenes", "timeline"]);
	const scenes = useEditor((e) => e.scenes.getScenes(), ["scenes"]);
	const settings = useEditor((e) => e.project.getActiveOrNull()?.settings ?? null, ["project"]);

	const fps = projectFps(settings?.fps);
	const canvasW = settings?.canvasSize.width ?? 1080;
	const canvasH = settings?.canvasSize.height ?? 1920;
	const proxyVersion = useLayerProxies((s) => s.version);
	const assets = useEditor((e) => e.media.getAssets(), ["media"]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: proxyVersion re-reads the layer proxies when a render lands
	const { items, pending, flatTracks } = useMemo(() => {
		if (!tracks) return { items: [], pending: [], flatTracks: null };
		const flat = flattenCompositions({ tracks, scenes, fps });
		// Layers covered by clips above them are drawn from their transparent render inside the canvas instead.
		const groups = coveredGroups(flat, { width: canvasW, height: canvasH }, fps);
		const proxied = proxiedItemKeys(groups);
		const live = proxied.size ? flat.items.filter((it) => !proxied.has(itemKey(it))) : flat.items;
		const ready = useLayerProxies.getState().ready;
		const waiting = groups.filter((g) => !ready[g.key]).map((g) => ({ zTrack: g.zTrack, keys: new Set(g.items.map(itemKey)) }));
		return { items: addFollowPaths(live, flat.tracks, { width: canvasW, height: canvasH }), pending: waiting, flatTracks: flat.tracks };
	}, [tracks, scenes, canvasW, canvasH, fps, proxyVersion]);
	const width = settings?.canvasSize.width ?? 1080;
	const height = settings?.canvasSize.height ?? 1920;
	const end = items.reduce((m, it) => Math.max(m, it.from + it.dur), 0);
	const durationInFrames = Math.max(2, Math.ceil(end * fps) + 2);

	// Frame under the playhead, updated every animation frame but re-rendering only when it changes.
	const [frame, setFrame] = useState(-1);
	useEffect(() => {
		if (!items.length) return;
		let raf = 0;
		let last = -2;
		const tick = () => {
			const t = editor.playback.getCurrentTime() / TICKS_PER_SECOND;
			const visible = items.some((it) => t >= it.from && t < it.from + it.dur);
			const f = visible ? Math.floor(t * fps + 1e-6) : -1;
			if (f !== last) {
				last = f;
				setFrame(f);
			}
			raf = requestAnimationFrame(tick);
		};
		tick();
		return () => cancelAnimationFrame(raf);
	}, [editor, items, fps]);

	// One live layer for the uncovered items, one per covered group still rendering (each with its own cut-outs).
	const layers = useMemo(() => {
		const base = { words: [], origin: "", width, height, fps, durationInFrames };
		const rest = items.filter((it) => !pending.some((g) => g.keys.has(itemKey(it))));
		return [
			{ zTrack: null as string | null, input: { ...base, items: rest } as MontageInput },
			...pending.map((g) => ({ zTrack: g.zTrack as string | null, input: { ...base, items: items.filter((it) => g.keys.has(itemKey(it))) } as MontageInput })),
		].filter((l) => l.input.items.length);
	}, [items, pending, width, height, fps, durationInFrames]);

	if (!items.length || frame < 0) return null;
	return (
		<div data-montage-layer className="pointer-events-none absolute inset-0" data-frame={frame}>
			<InlineEditor items={items} />
			{layers.map((layer) => {
				const mask = layer.zTrack && flatTracks ? coverMask(flatTracks, layer.zTrack, frame / fps, { width, height }, assets) : null;
				return (
					<Thumbnail
						key={layer.zTrack ?? "live"}
						component={MontageComposition as unknown as React.FC<Record<string, unknown>>}
						inputProps={layer.input as unknown as Record<string, unknown>}
						compositionWidth={width}
						compositionHeight={height}
						durationInFrames={durationInFrames}
						fps={fps}
						frameToDisplay={Math.min(frame, durationInFrames - 1)}
						style={{
							position: "absolute",
							inset: 0,
							width: "100%",
							height: "100%",
							background: "transparent",
							...(mask ? { maskImage: mask, WebkitMaskImage: mask, maskSize: "100% 100%", WebkitMaskSize: "100% 100%" } : {}),
						}}
					/>
				);
			})}
		</div>
	);
}
