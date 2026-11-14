// overlays, overlays and grain. A generator is a pure function of (its parameters, the frame number): the same frame
// gives the same pixels in the player, in the export and after ⌘Z. Never Math.random or the clock at draw time.
import type { ParamDefinition, ParamValues } from "@/params";
import type { BlendMode } from "@/rendering";

/** The side list of the Generators tab, in this order. */
export const GEN_FAMILIES = ["Solids", "Gradients", "Backgrounds", "Particles", "Light", "Camera", "Overlays & grain"] as const;
export type GenFamily = (typeof GEN_FAMILIES)[number];

/**
 * ground: fills the frame on its own (a solid, a gradient, a background) — into an empty film it lands in the row.
 * overlay: sits over the film on a transparent ground (particles, light, camera marks, grain) — always a layer above.
 */
export type GenRole = "ground" | "overlay";

/** An RGBA buffer, not premultiplied (ImageData's layout). */
export interface PixelBuffer {
	data: Uint8ClampedArray;
	width: number;
	height: number;
}

/** Where on the clip's own time the frame is: frame = round(seconds from the clip start × fps). */
export interface GenTime {
	frame: number;
	fps: number;
}

export interface GeneratorSpec {
	/** Stored in the clip as params["gen.id"]. Never renamed: projects keep it. */
	id: string;
	family: GenFamily;
	/** English source text; the Russian line is in i18n/ru-gen.ts. */
	name: string;
	keywords: string[];
	role: GenRole;
	/** The blend mode a new clip gets (overlays: screen / add). */
	blend?: BlendMode;
	params: ParamDefinition[];
	/** A row of the inspector shown for these values (e.g. stop 4 only with 4+ stops). Default: all shown. */
	shows?: (key: string, params: ParamValues) => boolean;
	/** True when the picture changes with the frame for these values (a still gradient is drawn once). */
	animated: (params: ParamValues) => boolean;
	/** 0: a fixed `maxSide` square (one colour); otherwise the texture takes the layer box's shape. */
	resolution: number;
	/** Longest side of the source texture, px — the same in the player and the export (the memory budget, gen.md §6). */
	maxSide: number;
	/** Draws one frame. Pure: depends only on the buffer size, the params and `time`. */
	pixels: (out: PixelBuffer, params: ParamValues, time: GenTime) => void;
	/** The one colour an older build shows for this clip (the carrier rectangle's fill, §2). */
	representative: (params: ParamValues) => string;
}

export interface GeneratorPreset {
	/** Unique across the catalog: the tile's key. */
	id: string;
	generator: string;
	/** English source text (i18n/ru-gen.ts). */
	name: string;
	params: ParamValues;
}
