// Shared shapes of the AI montage (client, server, Remotion composition). No runtime imports.

export type PropValue = string | number | boolean;

export interface MontageWord {
	text: string;
	/** Timeline milliseconds. */
	startMs: number;
	endMs: number;
}

/** One «ИИ» element as the Remotion layer sees it. Times are timeline seconds. */
export interface MontageItem {
	id: string;
	/** The (flattened) track the AI layer sits on — clips on tracks above it must cover it. */
	zTrack?: string;
	/** The composition clip the layer belongs to, when it is shown flattened (shared scenes repeat ids). */
	owner?: string;
	kind: string;
	from: number;
	dur: number;
	/** Seconds cut from the layer's head (trimmed in the editor) and its untrimmed length. */
	skip?: number;
	len?: number;
	props: Record<string, PropValue>;
	/** The element's transform from the editor (move/scale/rotate/opacity in the preview or properties). */
	tf?: { x: number; y: number; sx: number; sy: number; rot: number; op: number };
	/** The transform over time when it is keyframed (the layer's own keys or its composition clip's): samples
	 * [x, y, sx, sy, rot, op] every 1/r s from content time t0 (s since the layer's untrimmed start). Wins over `tf`. */
	tfk?: { t0: number; r: number; v: number[] };
	/** Follows a tracker of a video clip (src/motion/follow.ts). */
	follow?: { clipId: string; trackerId: string; anchor: [number, number]; size0?: number };
	/** The follow offset at 30 Hz from `from`: [dx, dy, scale, dx, dy, scale, …] (canvas px). */
	fp?: number[];
}

export interface MontageInput {
	items: MontageItem[];
	words: MontageWord[];
	/** Prefix of image URLs: "" in the editor, "http://127.0.0.1:<port>" in the renderer. */
	origin: string;
	width: number;
	height: number;
	fps: number;
	durationInFrames: number;
}

/** What DeepSeek returns (after validation). */
export interface PlanItem {
	kind: string;
	from: number;
	to: number;
	props: Record<string, PropValue>;
}

export const imageUrl = (origin: string, id: string) => `${origin}/api/montage/image/${encodeURIComponent(id)}`;

/** Lists and objects in an AI layer's props are kept as `json:<JSON>` strings (editor params are flat). */
export const JSON_PREFIX = "json:";
