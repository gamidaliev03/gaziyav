import type { ParamValues } from "@/params";

/** A transition on an adjustment layer (`EffectElement.transition`): its span is the layer's span. */
export interface LayerTransition {
	id: string;
	type: string;
	params: ParamValues;
}

/** A transition on the cut between two adjacent clips of one video track. */
export interface TimelineTransition {
	id: string;
	/** Transition definition type, e.g. "studio.transition.whip". */
	type: string;
	fromElementId: string;
	toElementId: string;
	/** Total length in ticks, centered on the cut. */
	duration: number;
	params: ParamValues;
}

export interface TransitionDefinition {
	type: string;
	name: string;
	/** Default length in seconds. */
	defaultDuration: number;
	wgsl: string;
	/** Up to 32 floats (P0()..P7() in WGSL). */
	pack?: (params: ParamValues) => number[];
	params?: Array<{ key: string; label: string; options: Array<{ value: string; label: string }>; default: string }>;
	/** Numeric / toggle parameters (GL Transitions uniforms). */
	numberParams?: TransitionNumberParam[];
	/** Browser group, e.g. "Trending", "Zoom & Blur". */
	category: string;
	/** Credit line for packs (author · licence). */
	credit?: string;
	/**
	 * Not shown in the library (weak, or a duplicate of a better one). Still
	 * registered, so projects that already use it keep rendering.
	 */
	hidden?: boolean;
}

export interface TransitionNumberParam {
	key: string;
	label: string;
	type: "number" | "int" | "bool" | "vec2" | "color";
	default: number[];
	min: number;
	max: number;
	/** First float index in fx.params. */
	slot: number;
	size: number;
}
