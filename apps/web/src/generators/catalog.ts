// The generators the product has, their presets (the tiles of the Generators tab) and the ones planned per round.
import type { ParamValues } from "@/params";
import { gradientSpec, solidSpec } from "./engine/gradient";
import type { GeneratorPreset, GeneratorSpec } from "./types";

export const GENERATORS: readonly GeneratorSpec[] = [solidSpec, gradientSpec];
const BY_ID = new Map(GENERATORS.map((spec) => [spec.id, spec]));

export function generatorSpec(id: string | undefined): GeneratorSpec | undefined {
	return id ? BY_ID.get(id) : undefined;
}

/** A generator's default values (no import of params/registry: graphics' registration imports this file). */
export function generatorDefaults(spec: GeneratorSpec): ParamValues {
	const values: ParamValues = {};
	for (const param of spec.params) values[param.key] = param.default;
	return values;
}

/** Defaults of the generator with the preset's values over them. */
export function presetParams(preset: GeneratorPreset): ParamValues {
	const spec = generatorSpec(preset.generator);
	return { ...(spec ? generatorDefaults(spec) : {}), ...preset.params };
}

const g = (id: string, name: string, params: ParamValues): GeneratorPreset => ({ id: `gradient.${id}`, generator: "gradient", name, params });
const s = (id: string, name: string, color: string, opacity = 100): GeneratorPreset => ({
	id: `solid.${id}`,
	generator: "solid",
	name,
	params: { "gen.color": color, "gen.opacity": opacity },
});

export const GENERATOR_PRESETS: readonly GeneratorPreset[] = [
	s("black", "Black", "#000000"),
	s("white", "White", "#ffffff"),
	s("blue", "Studio blue", "#2f6bff"),
	s("green", "Chroma green", "#00b140"),
	s("grey", "Warm grey", "#8a8580"),
	s("veil", "Dark veil", "#000000", 50),
	g("sunset", "Sunset", { "gen.shape": "linear", "gen.angle": 90, "gen.c1": "#ff5f6d", "gen.c2": "#ffc371" }),
	g("ocean", "Ocean", { "gen.shape": "linear", "gen.angle": 45, "gen.stops": 3, "gen.c1": "#0f2027", "gen.p1": 0, "gen.c2": "#00c6ff", "gen.p2": 100, "gen.c3": "#2c5364", "gen.p3": 45 }),
	g("spot", "Spotlight", { "gen.shape": "radial", "gen.c1": "#f5f0e8", "gen.c2": "#0d0d0f", "gen.scale": 80 }),
	g("vignette", "Soft vignette", { "gen.shape": "radial", "gen.c1": "#00000000", "gen.p1": 45, "gen.c2": "#000000cc", "gen.scale": 110 }),
	g("neon", "Neon ring", { "gen.shape": "angular", "gen.stops": 4, "gen.c1": "#ff00c8", "gen.p1": 0, "gen.c2": "#ff00c8", "gen.p2": 100, "gen.c3": "#00e5ff", "gen.p3": 33, "gen.c4": "#ffe600", "gen.p4": 66 }),
	g("diamond", "Diamond glow", { "gen.shape": "diamond", "gen.c1": "#ffe7a8", "gen.c2": "#3a1c71", "gen.scale": 90 }),
	g("fade", "Fade to black", { "gen.shape": "linear", "gen.angle": 90, "gen.c1": "#00000000", "gen.p1": 40, "gen.c2": "#000000" }),
	g("aurora", "Aurora drift", {
		"gen.shape": "linear",
		"gen.angle": 30,
		"gen.stops": 4,
		"gen.c1": "#0b1d3a",
		"gen.p1": 0,
		"gen.c2": "#140a2e",
		"gen.p2": 100,
		"gen.c3": "#18c29c",
		"gen.p3": 40,
		"gen.c4": "#7b4dff",
		"gen.p4": 70,
		"gen.motion": "drift",
	}),
	g("spin", "Spinning colours", { "gen.shape": "angular", "gen.stops": 3, "gen.c1": "#ff4d4d", "gen.p1": 0, "gen.c2": "#ff4d4d", "gen.p2": 100, "gen.c3": "#4d7bff", "gen.p3": 50, "gen.motion": "rotate" }),
	g("pulse", "Breathing light", { "gen.shape": "radial", "gen.c1": "#ffb36b", "gen.c2": "#1a0b05", "gen.motion": "breathe", "gen.scale": 70 }),
];

/**
 */
export const PLANNED_GENERATORS: Record<"R2" | "R3", { family: string; ids: string[] }[]> = {
	R2: [
		{ family: "Backgrounds", ids: ["mesh", "aurora", "flow-noise", "waves", "bokeh-bg", "grid", "dots", "stripes", "paper", "film-grain-bg"] },
		{ family: "Particles", ids: ["dust", "snow", "rain", "sparks", "confetti", "bokeh", "fireflies"] },
	],
	R3: [
		{ family: "Light", ids: ["light-leak", "film-burn", "flare-sweep", "flicker"] },
		{ family: "Camera", ids: ["rec", "camcorder-hud", "vhs-osd", "viewfinder", "phone-frame", "cctv"] },
		{
			family: "Overlays & grain",
			ids: ["grain", "dust-scratches", "hairs", "gate-weave", "scanlines", "halftone", "paper-texture", "lens-dirt", "vignette", "letterbox", "film-frame", "glitch-bars"],
		},
	],
};
