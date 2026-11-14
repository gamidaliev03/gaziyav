import { describe, expect, test } from "bun:test";
import { AUDIO_FX, compressorCurve, eqResponse, EQ_PRESETS, ffmpegFilterFor, fxGraph, fxSettingsKey, fxSettingsOf, fxSteps, parseFxSettings, readFxChain } from "../fx";
import { reverbIr } from "../reverb-ir";

// The graphs every project made before the settings renders (a switch, nothing else): byte for byte the old ones.
const OLD: Record<string, string> = {
	denoise: "afftdn=nr=12:nf=-40:tn=1",
	gate: "agate=threshold=0.0056:range=0.01:attack=2:release=150",
	voice: "highpass=f=80,lowshelf=f=120:g=-1.4,equalizer=f=3200:t=q:w=0.9:g=2.1,highshelf=f=8000:g=1.4,acompressor=threshold=0.0617:ratio=3.4:attack=8:release=140:makeup=1.38",
	deesser: "deesser=i=0.6:m=0.5:f=0.5:s=o",
	compressor: "acompressor=threshold=0.126:ratio=3:attack=10:release=120",
	reverb: "aecho=in_gain=1:out_gain=0.9:delays=23|31|41|53|67|83:decays=0.22|0.19|0.16|0.13|0.1|0.08",
	limiter: "alimiter=limit=0.891:release=80:latency=1:level=false",
};

describe("audio effects: old projects sound the same", () => {
	test("a switch with no settings renders the old fixed graph", () => {
		for (const [id, graph] of Object.entries(OLD)) expect(fxGraph(id as never)).toBe(graph);
		const element = { params: { "fx.denoise": true, "fx.compressor": true, "fx.limiter": true } };
		expect(fxSettingsOf(element)).toEqual({});
		expect(ffmpegFilterFor(readFxChain(element))).toBe([OLD.denoise, OLD.compressor, OLD.limiter].join(","));
		expect(fxSettingsKey(fxSettingsOf(element))).toBe("");
	});
	test("a setting set back (null, params merge) is no setting: the old graph again", () => {
		expect(fxSettingsOf({ params: { "fx.compressor": true, "fx.compressor.ratio": null, "fx.compressor.makeup": null } })).toEqual({});
	});
	test("settings of an effect that is off are not sent", () => {
		expect(fxSettingsOf({ params: { "fx.compressor": false, "fx.compressor.ratio": 8 } })).toEqual({});
	});
});

describe("audio effects: adjustable", () => {
	test("the compressor's settings make its graph (dB to linear, makeup)", () => {
		const element = { params: { "fx.compressor": true, "fx.compressor.threshold": -30, "fx.compressor.ratio": 6, "fx.compressor.makeup": 6 } };
		const settings = fxSettingsOf(element);
		const graph = ffmpegFilterFor(readFxChain(element), { settings });
		expect(graph).toContain("threshold=0.0316");
		expect(graph).toContain("ratio=6");
		expect(graph).toContain("makeup=1.9953");
		expect(fxSettingsKey(settings)).toContain("compressor");
	});
	test("every effect's settings at their defaults give its old values", () => {
		expect(fxGraph("deesser", { amount: 60, frequency: 50 })).toBe(OLD.deesser);
		expect(fxGraph("denoise", { amount: 12, floor: -40 })).toBe(OLD.denoise);
	});
	test("numbers are clamped to their range, unknown effects and keys dropped", () => {
		const s = parseFxSettings(JSON.stringify({ compressor: { ratio: 999, junk: 1 }, "rm -rf": {} }));
		expect(Object.keys(s)).toEqual(["compressor"]);
		expect(s.compressor?.ratio).toBe(20);
		expect(s.compressor && "junk" in s.compressor).toBe(false);
	});
	test("the EQ's bands make its graph; the Voice preset's curve has the presence boost", () => {
		const element = { params: { "fx.voice": true, "fx.voice.bands": JSON.stringify(EQ_PRESETS[0].bands) } };
		const graph = fxGraph("voice", fxSettingsOf(element).voice);
		expect(graph?.startsWith("highpass=f=80")).toBe(true);
		expect(graph).toContain("equalizer=f=3200");
		expect(graph).not.toContain("acompressor");
		expect(eqResponse(EQ_PRESETS[0].bands, 3200)).toBeGreaterThan(1.5);
		expect(eqResponse(EQ_PRESETS[0].bands, 30)).toBeLessThan(-3);
	});
	test("steps: the reverb with settings is a step of its own, normalize measured between", () => {
		const element = { params: { "fx.denoise": true, "fx.reverb": true, "fx.reverb.mix": 30, "fx.normalize": true, "fx.normalize.target": -16, "fx.limiter": true } };
		const steps = fxSteps(readFxChain(element), fxSettingsOf(element));
		expect(steps.map((s) => s.kind)).toEqual(["graph", "reverb", "normalize", "graph"]);
		expect(steps[2]).toEqual({ kind: "normalize", target: -16 });
		// without settings the reverb is the old echo graph
		expect(fxSteps(["reverb"]).map((s) => s.kind)).toEqual(["graph"]);
	});
	test("the compressor's curve: unity below the knee, the ratio above, makeup added", () => {
		const s = { threshold: -20, ratio: 4, knee: 0, makeup: 3 };
		expect(compressorCurve(-40, s)).toBeCloseTo(-37, 5);
		expect(compressorCurve(0, s)).toBeCloseTo(-20 + 20 / 4 + 3, 5);
	});
	test("the reverb's impulse response: seeded, unit energy, starts after the pre-delay", () => {
		const plan = { decay: 0.7, predelay: 20, damping: 40, size: 50, mix: 25 };
		const a = reverbIr(plan, 48000, 2);
		expect(a.equals(reverbIr(plan, 48000, 2))).toBe(true);
		const frames = (a.length - 44) / 8;
		let energy = 0;
		let first = -1;
		for (let n = 0; n < frames; n++) {
			const v = a.readFloatLE(44 + n * 8);
			energy += v * v;
			if (first < 0 && v !== 0) first = n;
		}
		expect(energy).toBeCloseTo(1, 1);
		expect(first).toBeGreaterThanOrEqual(Math.round(0.02 * 48000));
	});
	test("every effect with settings has a default for each", () => {
		for (const f of AUDIO_FX) for (const p of f.params) expect(p.default >= p.min && p.default <= p.max).toBe(true);
	});
});
