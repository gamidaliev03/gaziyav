// maths, banding, the texture budget and the document shape an older build reads.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATOR_PRESETS, GENERATORS, generatorSpec, presetParams } from "../catalog";
import {
	buildGeneratorParams,
	CARRIER_DEFINITION,
	effectiveGraphicDefinitionId,
	fullFrameScale,
	GEN_ID_PARAM,
	generatorOf,
	withCarrierSynced,
} from "../document";
import { drawGradient, gradientSpec, solidSpec } from "../engine/gradient";
import { generatorTextureSize, generatorValuesKey } from "../source";
import type { GeneratorPreset, PixelBuffer } from "../types";

const FRAMES = [0, 15, 47];
const buffer = (width: number, height: number): PixelBuffer => ({ data: new Uint8ClampedArray(width * height * 4), width, height });

function hashOf(preset: GeneratorPreset, frame: number, w = 64, h = 36): string {
	const spec = generatorSpec(preset.generator);
	if (!spec) throw new Error(preset.generator);
	const out = buffer(w, h);
	spec.pixels(out, presetParams(preset), { frame, fps: 30 });
	return createHash("sha256").update(out.data).digest("hex").slice(0, 16);
}

const px = (b: PixelBuffer, x: number, y: number) => Array.from(b.data.slice((y * b.width + x) * 4, (y * b.width + x) * 4 + 4));

describe("determinism", () => {
	test("every preset: the same frame gives the same pixels, twice in a run and against the recorded run", () => {
		const golden = JSON.parse(readFileSync(join(import.meta.dir, "golden.json"), "utf8")) as Record<string, string[]>;
		const now: Record<string, string[]> = {};
		for (const preset of GENERATOR_PRESETS) {
			const a = FRAMES.map((f) => hashOf(preset, f));
			const b = FRAMES.map((f) => hashOf(preset, f));
			expect(b).toEqual(a);
			now[preset.id] = a;
		}
		if (process.env.GEN_WRITE_GOLDEN) console.log(JSON.stringify(now, null, "\t"));
		expect(now).toEqual(golden);
	});

	test("a still preset is the same at every frame; an animated one changes with the frame", () => {
		for (const preset of GENERATOR_PRESETS) {
			const spec = generatorSpec(preset.generator);
			const hashes = new Set(FRAMES.map((f) => hashOf(preset, f)));
			if (spec?.animated(presetParams(preset))) expect(hashes.size).toBe(FRAMES.length);
			else expect(hashes.size).toBe(1);
		}
	});

	test("time is the frame number over the rate: frame 30 at 30 fps = frame 60 at 60 fps", () => {
		const params = presetParams(GENERATOR_PRESETS.find((p) => p.id === "gradient.aurora") as GeneratorPreset);
		const a = buffer(48, 27);
		const b = buffer(48, 27);
		drawGradient(a, params, { frame: 30, fps: 30 });
		drawGradient(b, params, { frame: 60, fps: 60 });
		expect(Array.from(b.data)).toEqual(Array.from(a.data));
	});
});

describe("ramp", () => {
	const base = { ...presetParams({ id: "t", generator: "gradient", name: "t", params: {} }), "gen.dither": false };
	test("linear 0°: left is the first colour, right the second, the middle a perceptual mid-grey", () => {
		const b = buffer(256, 4);
		drawGradient(b, { ...base, "gen.c1": "#000000", "gen.c2": "#ffffff" }, { frame: 0, fps: 30 });
		expect(px(b, 0, 1)[0]).toBeLessThan(3);
		expect(px(b, 255, 1)[0]).toBeGreaterThan(252);
		// OKLab L = 0.5 is about sRGB 99 — an sRGB blend would give 128
		expect(Math.abs(px(b, 128, 1)[0] - 99)).toBeLessThan(6);
	});
	test("angle 90°: top → bottom", () => {
		const b = buffer(8, 64);
		drawGradient(b, { ...base, "gen.angle": 90, "gen.c1": "#ff0000", "gen.c2": "#0000ff" }, { frame: 0, fps: 30 });
		expect(px(b, 4, 0)[0]).toBeGreaterThan(240);
		expect(px(b, 4, 63)[2]).toBeGreaterThan(240);
	});
	test("radial: the centre is the first colour and moves with Center X", () => {
		const b = buffer(101, 51);
		drawGradient(b, { ...base, "gen.shape": "radial", "gen.c1": "#ffffff", "gen.c2": "#000000" }, { frame: 0, fps: 30 });
		expect(px(b, 50, 25)[0]).toBeGreaterThan(245);
		drawGradient(b, { ...base, "gen.shape": "radial", "gen.c1": "#ffffff", "gen.c2": "#000000", "gen.cx": 50 }, { frame: 0, fps: 30 });
		expect(px(b, 75, 25)[0]).toBeGreaterThan(245);
		expect(px(b, 50, 25)[0]).toBeLessThan(245);
	});
	test("angular and diamond draw their own shapes (left ≠ right for angular, symmetric for diamond)", () => {
		const b = buffer(64, 64);
		drawGradient(b, { ...base, "gen.shape": "angular", "gen.c1": "#000000", "gen.c2": "#ffffff" }, { frame: 0, fps: 30 });
		expect(px(b, 32, 60)[0]).not.toBe(px(b, 32, 3)[0]);
		drawGradient(b, { ...base, "gen.shape": "diamond", "gen.c1": "#000000", "gen.c2": "#ffffff" }, { frame: 0, fps: 30 });
		expect(px(b, 10, 32)).toEqual(px(b, 53, 32));
		expect(px(b, 32, 10)).toEqual(px(b, 32, 53));
		expect(px(b, 32, 32)[0]).toBeLessThan(10);
	});
	test("2–5 stops: a stop beyond the count is ignored; 5 stops are all drawn", () => {
		const a = buffer(64, 2);
		const b = buffer(64, 2);
		drawGradient(a, { ...base, "gen.stops": 2, "gen.c3": "#00ff00" }, { frame: 0, fps: 30 });
		drawGradient(b, { ...base, "gen.stops": 2, "gen.c3": "#0000ff" }, { frame: 0, fps: 30 });
		expect(Array.from(a.data)).toEqual(Array.from(b.data));
		const c = buffer(500, 2);
		const stops = { "gen.stops": 5, "gen.c1": "#ff0000", "gen.p1": 0, "gen.c2": "#00ff00", "gen.p2": 25, "gen.c3": "#0000ff", "gen.p3": 50, "gen.c4": "#ffff00", "gen.p4": 75, "gen.c5": "#ffffff", "gen.p5": 100 };
		drawGradient(c, { ...base, ...stops }, { frame: 0, fps: 30 });
		expect(px(c, 125, 0)[1]).toBeGreaterThan(240); // green at 25 %
		expect(px(c, 250, 0)[2]).toBeGreaterThan(240); // blue at 50 %
		expect(px(c, 375, 0).slice(0, 2).every((v) => v > 240)).toBe(true); // yellow at 75 %
	});
	test("a transparent stop fades only the alpha (no dark fringe)", () => {
		const b = buffer(100, 1);
		drawGradient(b, { ...base, "gen.c1": "#ff000000", "gen.c2": "#ff0000" }, { frame: 0, fps: 30 });
		const mid = px(b, 50, 0);
		expect(mid[0]).toBeGreaterThan(250);
		expect(mid[3]).toBeGreaterThan(100);
		expect(mid[3]).toBeLessThan(155);
	});
});

describe("banding", () => {
	// a dark ramp over 1920 px: 32 levels, so undithered each level is a 60-px band
	const ramp = { ...presetParams({ id: "t", generator: "gradient", name: "t", params: {} }), "gen.c1": "#000000", "gen.c2": "#202020" };
	const longestRun = (b: PixelBuffer, y: number) => {
		let best = 0;
		let run = 0;
		for (let x = 1; x < b.width; x++) {
			run = px(b, x, y)[0] === px(b, x - 1, y)[0] ? run + 1 : 0;
			best = Math.max(best, run);
		}
		return best + 1;
	};
	test("with «No banding» (default) the longest flat run is far shorter than a band", () => {
		const off = buffer(1920, 4);
		const on = buffer(1920, 4);
		drawGradient(off, { ...ramp, "gen.dither": false }, { frame: 0, fps: 30 });
		drawGradient(on, ramp, { frame: 0, fps: 30 });
		expect(longestRun(off, 2)).toBeGreaterThan(50);
		expect(longestRun(on, 2)).toBeLessThan(20);
	});
	test("the dither is static: frame 0 and frame 99 of a still ramp are the same pixels (no flicker, no bitrate)", () => {
		const a = buffer(256, 16);
		const b = buffer(256, 16);
		drawGradient(a, ramp, { frame: 0, fps: 30 });
		drawGradient(b, ramp, { frame: 99, fps: 30 });
		expect(Array.from(a.data)).toEqual(Array.from(b.data));
	});
});

describe("texture budget", () => {
	test("sized by the canvas's shape only (preview = export), 960 px long for a gradient, 8 px for a solid", () => {
		const full = fullFrameScale({ width: 1920, height: 1080 });
		expect(generatorTextureSize({ spec: gradientSpec, canvasSize: { width: 1920, height: 1080 }, ...full })).toEqual({ width: 960, height: 544 });
		const tall = fullFrameScale({ width: 2160, height: 3840 });
		const t = generatorTextureSize({ spec: gradientSpec, canvasSize: { width: 2160, height: 3840 }, ...tall });
		expect(Math.max(t.width, t.height)).toBe(960);
		expect(generatorTextureSize({ spec: solidSpec, canvasSize: { width: 3840, height: 2160 }, ...full })).toEqual({ width: 8, height: 8 });
		// the preview's smaller canvas of the same shape: the very same texture
		expect(generatorTextureSize({ spec: gradientSpec, canvasSize: { width: 800, height: 450 }, ...full })).toEqual({ width: 960, height: 544 });
	});
	test("a transform or opacity change never redraws: the cache key holds only the «gen.» values", () => {
		expect(generatorValuesKey({ "gen.c1": "#fff", "transform.scaleX": 2, opacity: 0.5 })).toBe(generatorValuesKey({ "gen.c1": "#fff", "transform.scaleX": 1 }));
	});
});

describe("document", () => {
	const canvas = { width: 1920, height: 1080 };
	test("a generator is stored as the rectangle every build knows, its own values under «gen.»", () => {
		for (const spec of GENERATORS) {
			const params = buildGeneratorParams({ spec, params: presetParams({ id: "x", generator: spec.id, name: "x", params: {} }), canvas });
			const element = { definitionId: CARRIER_DEFINITION, params };
			expect(params[GEN_ID_PARAM]).toBe(spec.id);
			expect(params["transform.scaleX"]).toBeCloseTo(1920 / 1080, 6);
			expect(params["transform.scaleY"]).toBeCloseTo(1, 6);
			expect(params.strokeWidth).toBe(0);
			expect(typeof params.fill).toBe("string");
			expect(generatorOf(element)?.id).toBe(spec.id);
			expect(effectiveGraphicDefinitionId(element)).toBe(`gen.${spec.id}`);
			// every own key is namespaced: nothing the rectangle reads is taken
			for (const p of spec.params) expect(p.key.startsWith("gen.")).toBe(true);
			// the document survives JSON (the project file)
			expect(JSON.parse(JSON.stringify(element))).toEqual(element);
		}
	});
	test("a vertical canvas is covered too", () => {
		const s = fullFrameScale({ width: 1080, height: 1920 });
		expect(s.scaleX).toBeCloseTo(1, 6);
		expect(s.scaleY).toBeCloseTo(1920 / 1080, 6);
	});
	test("an older build (rectangle definition) keeps every «gen.» value and keyframe", async () => {
		const { rectangleGraphicDefinition } = await import("@/graphics/definitions/rectangle");
		const params = buildGeneratorParams({ spec: gradientSpec, params: presetParams(GENERATOR_PRESETS.find((p) => p.id === "gradient.sunset") as GeneratorPreset), canvas });
		// rc41d's resolveGraphicParamsAtTime: a copy of the params, then only the definition's own keys are resolved
		const own = new Set(rectangleGraphicDefinition.params.map((p) => p.key));
		for (const spec of GENERATORS) for (const p of spec.params) expect(own.has(p.key)).toBe(false);
		expect(own.has(GEN_ID_PARAM)).toBe(false);
		// what it shows: one flat colour, the gradient's mean, square corners, no stroke
		expect(String(params.fill)).toMatch(/^#[0-9a-f]{6}$/);
		expect(params.cornerRadius).toBe(0);
	});
	test("an unknown generator (a newer build's) stays its carrier rectangle here", () => {
		const element = { definitionId: CARRIER_DEFINITION, params: { [GEN_ID_PARAM]: "mesh", fill: "#123456" } };
		expect(generatorOf(element)).toBeUndefined();
		expect(effectiveGraphicDefinitionId(element)).toBe(CARRIER_DEFINITION);
		expect(generatorOf({ definitionId: "ellipse", params: { [GEN_ID_PARAM]: "solid" } })).toBeUndefined();
	});
	test("a changed colour moves the carrier's fill (what an older build shows)", () => {
		const params = buildGeneratorParams({ spec: solidSpec, params: { "gen.color": "#ff0000", "gen.opacity": 100 }, canvas });
		expect(params.fill).toBe("#ff0000");
		expect(withCarrierSynced({ ...params, "gen.color": "#00ff00" }).fill).toBe("#00ff00");
		expect(withCarrierSynced({ ...params, "gen.opacity": 50 }).fill).toBe("#ff000080");
	});
});
