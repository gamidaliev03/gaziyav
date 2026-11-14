import { effectsRegistry, resolveEffectPasses } from "@/effects";
import { buildDefaultParamValues } from "@/params/registry";
import { DEFAULT_TRANSITION_PARAMS, getTransitionDefinition } from "@/transitions/definitions";
import { timeAt, warmThumbnailShaders } from "./fx-thumbnail";

// The most-used tiles, warmed in idle time after the editor opens, so their
// first hover / first apply never waits for a shader compile.
const TOP_EFFECTS = [
	"studio.zoomPunch",
	"studio.shake",
	"studio.flash",
	"studio.zoomBlur",
	"studio.glitch",
	"studio.rgbSplit",
	"studio.grain",
	"studio.vhs",
	"studio.vignette",
	"studio.lightLeak",
	"studio.kenBurns",
	"kadr.effect.glow",
	"studio.color",
];
const TOP_TRANSITIONS = [
	"studio.transition.zoomThrough",
	"studio.transition.whip",
	"kadr.transition.flashZoom",
	"kadr.transition.shakeZoom",
	"studio.transition.spin",
	"studio.transition.glitch",
	"studio.transition.flash",
	"studio.transition.dissolve",
	"studio.transition.slide",
	"studio.transition.lightLeak",
	"kadr.transition.stretch",
];

let scheduled = false;
export function scheduleShaderWarmup() {
	if (scheduled || typeof window === "undefined") return;
	scheduled = true;
	const t = timeAt(0.2, 0.5);
	const effectJobs = TOP_EFFECTS.filter((type) => effectsRegistry.has(type)).map((type) => ({
		twoInputs: false,
		passes: () => {
			const definition = effectsRegistry.get(type);
			return resolveEffectPasses({ definition, effectParams: buildDefaultParamValues(definition.params), width: 16, height: 16, time: t });
		},
	}));
	const transitionJobs = TOP_TRANSITIONS.map((type) => getTransitionDefinition(type))
		.filter((d) => d !== undefined)
		.map((definition) => ({
			twoInputs: true,
			passes: () => [
				{
					shader: definition.type,
					uniforms: {
						u_time: t.time,
						u_progress: 0.5,
						u_frame: t.frame,
						u_params: (definition.pack?.(DEFAULT_TRANSITION_PARAMS(definition)) ?? [0]).slice(0, 32),
					},
				},
			],
		}));
	// let the editor finish opening first
	setTimeout(() => warmThumbnailShaders([...effectJobs, ...transitionJobs]), 1200);
}
