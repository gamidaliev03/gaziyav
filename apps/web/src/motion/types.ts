// Motion data stored with the clips (saved with the project, every change is one ⌘Z):
// trackers on video clips, "follow a tracker" on any visual layer, speed curves and reverse.

export type TrackerKind = "face" | "object" | "subject";

/** What a tracker does to its own clip. */
export type TrackerFxKind = "none" | "blur" | "pixelate" | "spotlight" | "colorPop" | "glow" | "filter";

/** A colour look drawn only on the tracked thing (TrackerFx kind "filter"). */
export type TrackerLook = "bw" | "warm" | "cool" | "vivid" | "vintage";

export interface TrackerFx {
	kind: TrackerFxKind;
	/** 0..1 strength (blur radius, block size, darkness, desaturation). */
	amount: number;
	/** Region size × (1 = the tracked box). */
	expand: number;
	/** Edge softness, 0..1 of the region. */
	feather: number;
	shape: "ellipse" | "rect";
	/** Kind "filter": the look inside the region. */
	look?: TrackerLook;
}

/**
 * A tracked thing on a video clip. Samples are raw [t, x, y, w, h, angle, confidence]: t = seconds of the clip's
 * media file, box normalized (0..1, top-left origin) in the displayed frame. The smoothed path is derived
 * (One-Euro, `smoothing`), so edits and smoothing changes never lose the raw track.
 */
export interface Tracker {
	id: string;
	name: string;
	kind: TrackerKind;
	samples: number[][];
	/** Displayed frame size of the media when tracked (pixels). */
	frame: [number, number];
	/** 0 = raw … 1 = very steady. */
	smoothing: number;
	fx?: TrackerFx;
}

/** A layer (text, sticker, graphic, AI layer, video) that moves with a tracker of a video clip. */
export interface FollowLink {
	clipId: string;
	trackerId: string;
	/** Canvas point (px from the canvas centre) of the tracked centre when attached. */
	anchor: [number, number];
	/** Box height (normalized) when attached — set when the layer also scales with the object. */
	size0?: number;
	/** The object's angle (degrees) when attached — set when the layer also turns with it (around the object). */
	angle0?: number;
	/** false: the layer keeps its place (only scales / turns with the object). */
	move?: boolean;
}

/** The clip plays a reversed copy of its media; the original stays in the project. */
export interface ReversedLink {
	/** Original media id and the seconds [a, b] of it the reversed file covers. */
	mediaId: string;
	a: number;
	b: number;
	/** Original sourceDuration (ticks) of the element, to restore it exactly. */
	sourceDuration?: number;
}

export type SpeedCurvePresetId = "custom" | "montage" | "hero" | "bullet" | "jumpCut" | "flashIn" | "flashOut" | "velocity";

/** Speed ramp: speed (0.1–10×) over the clip's source span (x 0..1), smooth between points. */
export interface SpeedCurve {
	preset: SpeedCurvePresetId;
	points: Array<{ x: number; y: number }>;
}
