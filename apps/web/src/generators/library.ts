// READY generators (the owner, 14.11: «ты не пиши, а готовые возьми… со стоков… а те-то надо редачить — да, пиши…
// короче да, совмещай», «из вне тоже занеси крутых вещей — генераторов, градиентов — побольше разных»). Three sources,
// none of them new drawing code:
//   1. the editor's own effects over a plain ground — snow, rain, dust, bokeh, light leaks, grain, VHS noise as CLIPS
//      (an overlay on black lies over the film by «screen»: black adds nothing), and gradients moved by a distortion
//      as backgrounds. Each effect keeps its settings in the inspector's «Effects»: a ready generator stays editable;
//   2. the editor's own motion graphics (montage/mograph.ts: Camera REC, VHS play, the film countdown, the cinema matte,
//      confetti, sparks, hearts, the lens flare…) — listed here by family; they were three clicks deep in Text → Motion;
//   3. an outside palette: uiGradients (github.com/ghosh/uigradients, MIT © 2017 Indrashish Ghosh —
//      ./data/uigradients.json as it came, its licence beside it): 382 named gradients, every colour editable.
import type { ParamValues } from "@/params";
import type { BlendMode } from "@/rendering";
import UI_GRADIENTS from "./data/uigradients.json";
import { parseColor, rgbaToOklab } from "./engine/color";
import type { GenFamily, GeneratorPreset } from "./types";

const BLACK: ParamValues = { "gen.color": "#000000", "gen.opacity": 100 };
const WHITE: ParamValues = { "gen.color": "#ffffff", "gen.opacity": 100 };
const GREY: ParamValues = { "gen.color": "#808080", "gen.opacity": 100 };

type Fx = NonNullable<GeneratorPreset["effects"]>;

/** A ready overlay: effects over a plain ground, laid over the film (black + «screen» unless said otherwise). */
function over(id: string, name: string, family: GenFamily, effects: Fx, ground: ParamValues = BLACK, blend: BlendMode = "screen"): GeneratorPreset {
	return { id: `fx.${id}`, generator: "solid", name, params: ground, effects, blend, family, role: "overlay" };
}

/** A gradient's values from its colours, spread evenly (up to five). */
export function ramp(colors: readonly string[], extra: ParamValues = {}): ParamValues {
	const list = colors.length > 5 ? [0, 1, 2, 3, 4].map((i) => colors[Math.round((i * (colors.length - 1)) / 4)]) : [...colors];
	const params: ParamValues = { "gen.shape": "linear", "gen.angle": 0, "gen.stops": Math.max(2, list.length) };
	list.forEach((color, i) => {
		params[`gen.c${i + 1}`] = color;
		params[`gen.p${i + 1}`] = list.length > 1 ? Math.round((i * 100) / (list.length - 1)) : 0;
	});
	return { ...params, ...extra };
}

/** A ready background: a gradient with an effect of the editor over it (it fills the frame: into the row). */
function back(id: string, name: string, gradient: ParamValues, effects: Fx): GeneratorPreset {
	return { id: `bg.${id}`, generator: "gradient", name, params: gradient, effects, family: "Backgrounds" };
}

export const READY_PRESETS: readonly GeneratorPreset[] = [
	// ── Backgrounds: gradients that move ── (looked at one by one on the built app, 14.11: a distortion that does not show
	// on a smooth ramp — ripple, halftone, mosaic, prism — was left out)
	back("liquid", "Liquid", ramp(["#ff5f6d", "#ffc371", "#6a5cff"], { "gen.angle": 35, "gen.motion": "drift" }), ["pro.fx.water"]),
	back("silk", "Silk", ramp(["#0f2027", "#2c5364", "#00c6ff"], { "gen.angle": 20, "gen.motion": "drift" }), ["pro.fx.wave"]),
	back("swirl", "Swirl", ramp(["#8e2de2", "#4a00e0", "#ff6a88"], { "gen.shape": "radial" }), ["pro.fx.swirl"]),
	back("glass", "Glass blocks", ramp(["#fdfbfb", "#a1c4fd", "#c2e9fb"], { "gen.angle": 45, "gen.motion": "drift" }), ["pro.fx.glass"]),
	back("kaleido", "Kaleidoscope", ramp(["#ff0080", "#ff8c00", "#40e0d0", "#7b4dff"], { "gen.shape": "angular", "gen.motion": "rotate" }), ["kadr.effect.kaleidoscope"]),
	back("bokeh-night", "Bokeh night", ramp(["#0b0f1a", "#1b2440"], { "gen.angle": 90 }), ["pro.fx.bokehLights"]),
	back("stars", "Starry night", ramp(["#05060d", "#0b1030"], { "gen.angle": 90 }), ["pro.fx.sparkles"]),
	back("mist", "Mist", ramp(["#3a4a5a", "#6a7f93", "#c9d6df"], { "gen.angle": 90 }), ["pro.fx.fog"]),
	back("snowfall", "Snowfall", ramp(["#1e3c72", "#2a5298", "#b9d3f0"], { "gen.angle": 90 }), ["pro.fx.snow"]),
	back("rainy", "Rainy window", ramp(["#16222a", "#3a6073"], { "gen.angle": 90 }), ["pro.fx.rain"]),
	back("disco", "Disco", ramp(["#0a0a12", "#1a1030"], { "gen.angle": 90 }), ["pro.fx.disco"]),
	back("lasers", "Laser show", ramp(["#05050a", "#0d0d1a"], { "gen.angle": 90 }), ["pro.fx.lasers"]),
	back("tiles", "Tiles", ramp(["#fc466b", "#3f5efb"], { "gen.shape": "angular", "gen.motion": "rotate" }), ["pro.fx.tiles"]),
	back("mirror", "Mirror", ramp(["#f7971e", "#ffd200", "#21d4fd"], { "gen.shape": "diamond", "gen.motion": "breathe" }), ["pro.fx.mirrorQuad"]),
	back("dither", "1-bit", ramp(["#111111", "#eeeeee"], { "gen.angle": 45, "gen.motion": "drift" }), ["pro.fx.dither"]),
	back("scanlines", "Scanlines", ramp(["#0b2a1a", "#13a36b"], { "gen.angle": 90, "gen.motion": "drift" }), ["pro.fx.crt"]),
	back("grainy", "Grainy gradient", ramp(["#ff9966", "#ff5e62", "#6a11cb"], { "gen.angle": 60 }), ["studio.grain"]),

	// ── Particles: over the film ──
	over("snow", "Snow", "Particles", ["pro.fx.snow"]),
	over("rain", "Rain", "Particles", ["pro.fx.rain"]),
	over("dust", "Floating dust", "Particles", ["pro.fx.dust"]),
	over("sparkles", "Sparkles", "Particles", ["pro.fx.sparkles"]),
	over("bokeh", "Bokeh lights", "Particles", ["pro.fx.bokehLights"]),
	over("fog", "Fog", "Particles", ["pro.fx.fog"]),

	// ── Light ──
	over("leak", "Light leak", "Light", ["studio.lightLeak"]),
	over("leak-rainbow", "Rainbow leak", "Light", ["pro.fx.leakRainbow"]),
	over("corner-burn", "Corner burn", "Light", ["pro.fx.cornerBurn"]),
	over("sweep", "Light sweep", "Light", ["pro.fx.lightSweep"]),
	over("flicker", "Flicker", "Light", ["pro.fx.flickerLight"]),
	over("flash", "Camera flash", "Light", ["pro.fx.cameraFlash"]),
	over("disco", "Disco lights", "Light", ["pro.fx.disco"]),
	over("lasers", "Lasers", "Light", ["pro.fx.lasers"]),

	// ── Camera: tape and signal ──
	over("vhs-noise", "VHS noise", "Camera", ["pro.fx.vhsPro"]),
	over("vhs-tracking", "VHS tracking", "Camera", ["pro.fx.vhsTracking"]),
	over("no-signal", "No signal", "Camera", ["pro.fx.signalLoss"]),

	// ── Overlays and grain ──
	// grain is light AND dark specks: mid-grey laid by «overlay» (grey changes nothing, the specks do)
	over("grain", "Film grain", "Overlays & grain", ["studio.grain"], GREY, "overlay"),
	over("old-film", "Old film", "Overlays & grain", ["kadr.effect.oldFilm"], GREY, "overlay"),
	over("film-8", "8 mm scratches", "Overlays & grain", ["pro.fx.film8mm"], GREY, "overlay"),
	over("film-16", "16 mm dust", "Overlays & grain", ["pro.fx.film16mm"], GREY, "overlay"),
	over("lens-dirt", "Lens dirt", "Overlays & grain", ["pro.fx.lensDirt"]),
	over("burned-edges", "Burned edges", "Overlays & grain", ["pro.fx.burnedEdges"], GREY, "overlay"),
	// what darkens lies by «multiply» over white (white changes nothing)
	over("vignette", "Vignette", "Overlays & grain", ["pro.fx.vignetteOval"], WHITE, "multiply"),
	over("bars", "Cinema bars", "Overlays & grain", ["kadr.effect.letterbox"], WHITE, "multiply"),
];

/** The editor's motion graphics that are generators (montage/mograph.ts kinds), by the family they are shown in. */
export const GENERATOR_MOGRAPH: ReadonlyArray<{ kind: string; family: GenFamily }> = [
	...["MgConfetti", "MgPartyConfetti", "MgSparks", "MgSnow", "MgBokeh", "MgFireworks", "MgHearts", "MgBubbles", "MgMoneyRain", "MgRain"].map((kind) => ({ kind, family: "Particles" as const })),
	...["MgLightLeak", "MgFilmBurn", "MgLensFlare"].map((kind) => ({ kind, family: "Light" as const })),
	...["MgViewfinder", "MgVhs", "MgFilmLeader", "MgFilmMatte", "MgCrt", "MgHud", "MgPassePartout", "MgPolaroid", "MgFilmStrip", "MgPhoneFrame"].map((kind) => ({ kind, family: "Camera" as const })),
	...["MgGrain", "MgSpeedLines"].map((kind) => ({ kind, family: "Overlays & grain" as const })),
];
const MOGRAPH_FAMILY = new Map(GENERATOR_MOGRAPH.map((entry) => [entry.kind, entry.family]));
/** The family a motion graphic is listed under in Generators (undefined: it is not a generator). */
export const mographGeneratorFamily = (kind: string): GenFamily | undefined => MOGRAPH_FAMILY.get(kind);

/** uiGradients, in the order of the rainbow (by the hue of their colours; the greys last, light to dark). */
export const UI_GRADIENT_PRESETS: readonly GeneratorPreset[] = (UI_GRADIENTS as Array<{ name: string; colors: string[] }>)
	.map((entry) => {
		let a = 0;
		let b = 0;
		let light = 0;
		for (const color of entry.colors) {
			const lab = rgbaToOklab(parseColor(color));
			a += lab.A;
			b += lab.B;
			light += lab.L;
		}
		const n = Math.max(1, entry.colors.length);
		const chroma = Math.hypot(a / n, b / n);
		const hue = (Math.atan2(b, a) * 180) / Math.PI;
		return { entry, key: chroma < 0.03 ? 1000 - light / n : (hue + 360 + 330) % 360 };
	})
	.sort((x, y) => x.key - y.key)
	.map(({ entry }) => ({
		id: `ui.${entry.name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "")}`,
		generator: "gradient",
		name: entry.name,
		proper: true,
		params: ramp(entry.colors.map((color) => color.trim())),
	}));
