// Transitions on an adjustment layer (an `effect` element with `transition`, docs/LAYER-TRANSITIONS.md).
// The layer's span is the transition's span. When a cut (two touching clips of a video track below the layer) lies
// inside it, the transition's middle (progress 0.5) sits on the cut nearest to the layer's middle; otherwise the
// transition simply runs across the span. Only what is below the layer is transitioned; tracks above it are not.
//
// Two kinds (LAYER_TRANSITION_SINGLE below):
// - "single": the picture is one image warped (zoom, shake, spin, whip, flash, glitch, blur…) — the live composite
//   below the layer is both `src` and `orig` of the shader (one composite, no extra rendering);
// - "pair": the shader shows two pictures at once (dissolve, wipe, slide, push, doors, 3D…) — A = the composite below
//   as it is just before the cut, continued past it, B = the composite just after the cut, started early. The clips
//   at the cut play their real frames beyond it when the media has them (handles); otherwise the edge frame is held.
import { getSourceTimeAtClipTime } from "@/retime";
import type { RetimeConfig, SceneTracks, TimelineTrack } from "@/timeline";
import { TICKS_PER_SECOND } from "@/wasm";

/** Clips closer than this (ticks) count as touching / as being on the cut. */
export const LAYER_CUT_TOLERANCE = TICKS_PER_SECOND / 50;

export type LayerTransitionMode = "single" | "pair";

export interface LayerTransitionWindow {
	/** Ticks: the layer's start and end. */
	start: number;
	end: number;
	/** The cut the transition's middle sits on, or null (no cut inside the span). */
	cut: number | null;
}

type Span = { startTime: number; duration: number };

/** Cuts (one clip ends where the next starts) of the video tracks among `tracks`, strictly inside (start, end). */
export function cutsInside({ tracks, start, end }: { tracks: readonly TimelineTrack[]; start: number; end: number }): number[] {
	const out: number[] = [];
	for (const track of tracks) {
		if (track.type !== "video" || track.hidden) continue;
		const elements = (track.elements as Array<Span & { hidden?: boolean }>)
			.filter((e) => !e.hidden)
			.slice()
			.sort((a, b) => a.startTime - b.startTime);
		for (let i = 0; i + 1 < elements.length; i++) {
			const from = elements[i];
			const to = elements[i + 1];
			if (Math.abs(from.startTime + from.duration - to.startTime) > LAYER_CUT_TOLERANCE) continue;
			const cut = to.startTime;
			// At least two frames (60 fps) from either edge: a cut on the layer's edge is no cut inside it.
			const margin = TICKS_PER_SECOND / 30;
			if (cut <= start + margin || cut >= end - margin) continue;
			if (!out.some((c) => Math.abs(c - cut) <= LAYER_CUT_TOLERANCE)) out.push(cut);
		}
	}
	return out.sort((a, b) => a - b);
}

/** The visible tracks under the overlay track `trackId`, bottom to top (the order the scene is drawn in). */
export function tracksBelowLayer(tracks: SceneTracks, trackId: string): TimelineTrack[] {
	const index = tracks.overlay.findIndex((track) => track.id === trackId);
	if (index < 0) return [];
	const below: TimelineTrack[] = [...tracks.overlay.slice(index + 1), tracks.main];
	return below.filter((track) => !("hidden" in track && track.hidden)).reverse();
}

/** The transition window of a layer over `tracksBelow` (the visible tracks under it). */
export function layerTransitionWindow({
	layer,
	tracksBelow,
}: {
	layer: Span;
	tracksBelow: readonly TimelineTrack[];
}): LayerTransitionWindow {
	const start = layer.startTime;
	const end = layer.startTime + layer.duration;
	const middle = (start + end) / 2;
	let cut: number | null = null;
	for (const candidate of cutsInside({ tracks: tracksBelow, start, end })) {
		if (cut === null || Math.abs(candidate - middle) < Math.abs(cut - middle) - 1e-6) cut = candidate;
	}
	return { start, end, cut };
}

/**
 * Progress 0..1 of the transition at timeline time `time`: linear from the layer's start to the cut (0 → 0.5) and from
 * the cut to the layer's end (0.5 → 1), so the shader's middle is on the cut; linear over the span without a cut.
 * Easing is the shader's own, as on a clip transition.
 */
export function layerTransitionProgress(window: LayerTransitionWindow, time: number): number {
	const { start, end, cut } = window;
	if (end <= start) return 0;
	const t = Math.min(end, Math.max(start, time));
	if (cut === null || cut <= start || cut >= end) return (t - start) / (end - start);
	return t < cut ? (0.5 * (t - start)) / (cut - start) : 0.5 + (0.5 * (t - cut)) / (end - cut);
}

export type LayerSide = "A" | "B";

/**
 * How an element below the layer takes part in side A or B of a "pair" transition: null = left out; otherwise how
 * much longer it plays before its start / after its end (ticks). On A, what ends on the cut plays on to the layer's end
 * and what starts on it is left out; on B, what starts on the cut starts at the layer's start and what ends on it is
 * left out. Everything else is the same on both sides.
 */
export function sideExtension({
	element,
	window,
	side,
}: {
	element: Span;
	window: LayerTransitionWindow;
	side: LayerSide;
}): { before: number; after: number } | null {
	const none = { before: 0, after: 0 };
	const { cut } = window;
	if (cut === null) return none;
	const elementEnd = element.startTime + element.duration;
	const endsOnCut = Math.abs(elementEnd - cut) <= LAYER_CUT_TOLERANCE && element.startTime < cut;
	const startsOnCut = Math.abs(element.startTime - cut) <= LAYER_CUT_TOLERANCE && elementEnd > cut;
	if (side === "A") {
		if (startsOnCut) return null;
		if (endsOnCut) return { before: 0, after: Math.max(0, window.end - elementEnd) };
		return none;
	}
	if (endsOnCut) return null;
	if (startsOnCut) return { before: Math.max(0, element.startTime - window.start), after: 0 };
	return none;
}

/** A video clip's timing on a side: its new start/length/trim start and the source range it may read (ticks). */
export function sideVideoTiming({
	clip,
	extension,
	oneFrame = TICKS_PER_SECOND / 60,
}: {
	clip: { timeOffset: number; duration: number; trimStart: number; trimEnd: number; retime?: RetimeConfig };
	extension: { before: number; after: number };
	oneFrame?: number;
}): { timeOffset: number; duration: number; trimStart: number; sourceClamp: { min: number; max: number } } {
	const span = getSourceTimeAtClipTime({ clipTime: clip.duration, retime: clip.retime, duration: clip.duration });
	const mediaEnd = clip.trimStart + span + Math.max(0, clip.trimEnd);
	const lead = extension.before > 0 ? getSourceTimeAtClipTime({ clipTime: extension.before, retime: clip.retime }) : 0;
	return {
		timeOffset: clip.timeOffset - extension.before,
		duration: clip.duration + extension.before + extension.after,
		trimStart: clip.trimStart - lead,
		// Before the media's first frame / after its last one the edge frame is held.
		sourceClamp: { min: 0, max: Math.max(clip.trimStart, mediaEnd - oneFrame) },
	};
}

/** Source time (ticks) a video clip shows on a side at timeline time `time` (null: not shown then). Retime ignored. */
export function sideSourceTime({
	clip,
	window,
	side,
	time,
}: {
	clip: { startTime: number; duration: number; trimStart: number; trimEnd: number };
	window: LayerTransitionWindow;
	side: LayerSide;
	time: number;
}): number | null {
	const extension = sideExtension({ element: clip, window, side });
	if (!extension) return null;
	const timing = sideVideoTiming({
		clip: { timeOffset: clip.startTime, duration: clip.duration, trimStart: clip.trimStart, trimEnd: clip.trimEnd },
		extension,
	});
	const local = time - timing.timeOffset;
	if (local < 0 || local >= timing.duration) return null;
	return Math.min(timing.sourceClamp.max, Math.max(timing.sourceClamp.min, timing.trimStart + local));
}

/**
 * The single-image transitions (one picture warped, or a hard switch from A to B on the middle): on an adjustment
 * layer they warp the live composite below it. Every other transition is a "pair" (it shows A and B at once).
 * Decided per transition in docs/LAYER-TRANSITIONS.md: GaziyavShell/test/gaziyav-transition-kinds.mjs draws each one from
 * green A to blue B (a single one shows no B before 30 % and no A after 70 % of its length), then by reading the shader:
 * reveals and strips that show both pictures at the cut are pairs; switches through white / black / light are singles.
 */
export const LAYER_TRANSITION_SINGLE: ReadonlySet<string> = new Set([
	// ours
	"studio.transition.whip",
	"studio.transition.zoomThrough",
	"studio.transition.flash",
	"studio.transition.spin",
	"studio.transition.glitch",
	"studio.transition.dipBlack",
	"studio.transition.shake",
	"studio.transition.lightLeak",
	// Kadr's
	"kadr.transition.shakeZoom",
	"kadr.transition.flashZoom",
	"kadr.transition.stretch",
	"kadr.transition.pixelate",
	"kadr.transition.zoom",
	"kadr.transition.dipToWhite",
	// the pro pack
	"pro.transition.pullBack",
	"pro.transition.spinZoom",
	"pro.transition.cameraRoll",
	"pro.transition.rgbSplit",
	"pro.transition.lumaSmear",
	"pro.transition.glitchZoom",
	"pro.transition.liquid",
	"pro.transition.heatHaze",
	"pro.transition.lensWarp",
	"pro.transition.seamlessZoom",
	"pro.transition.seamlessSpin",
	"pro.transition.seamlessStretch",
	"pro.transition.frameStutter",
	// GL Transitions (every other one blends or reveals two pictures)
	"gl.transition.Revolve_Left",
	"gl.transition.zoomInOut",
]);

export function layerTransitionMode(type: string): LayerTransitionMode {
	return LAYER_TRANSITION_SINGLE.has(type) ? "single" : "pair";
}
