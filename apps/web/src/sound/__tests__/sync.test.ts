import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { MATCH_SCORE, SHARP_ENOUGH, coarseLag, correlate, fineLag, fitDrift, outline } from "../sync/xcorr";

setDefaultTimeout(120000);
const RATE = 48000;

/** A sound with an outline: noise whose level steps every 80–400 ms (like words), deterministic. */
function event(seconds: number, seed = 3): Float32Array {
	let s = seed >>> 0;
	const rnd = () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
	const x = new Float32Array(Math.round(seconds * RATE));
	let level = 0.3;
	let until = 0;
	let low = 0;
	for (let i = 0; i < x.length; i++) {
		if (i >= until) {
			level = rnd() < 0.3 ? 0.01 : 0.1 + rnd() * 0.6;
			until = i + Math.round((0.08 + rnd() * 0.32) * RATE);
		}
		// a little low-passed, as recorded sound is
		low += 0.35 * ((rnd() * 2 - 1) * level - low);
		x[i] = low;
	}
	return x;
}
const energy = (x: Float32Array, hop: number) => {
	const out = new Float32Array(Math.floor(x.length / hop));
	for (let k = 0; k < out.length; k++) {
		let e = 0;
		for (let i = k * hop; i < (k + 1) * hop; i++) e += x[i] * x[i];
		out[k] = e / hop;
	}
	return out;
};
/** `x` as another recorder heard it: quieter, duller, with its own noise. */
function heard(x: Float32Array, seed = 77): Float32Array {
	let s = seed >>> 0;
	const out = new Float32Array(x.length);
	let low = 0;
	for (let i = 0; i < x.length; i++) {
		s = (s * 1664525 + 1013904223) >>> 0;
		low += 0.5 * (x[i] - low);
		out[i] = 0.4 * low + (s / 2 ** 32 - 0.5) * 0.02;
	}
	return out;
}

describe("correlation", () => {
	test("finds where a copy lies, forward and back", () => {
		const a = Float32Array.from({ length: 2000 }, (_, i) => Math.sin(i * 0.37) * Math.sin(i * 0.011));
		const b = new Float32Array(2000);
		b.set(a.subarray(0, 1700), 300); // b is a, 300 later
		const r = correlate(a, b);
		let best = 0;
		for (let k = -1999; k <= 1999; k++) if (r[(k + r.length) % r.length] > r[(best + r.length) % r.length]) best = k;
		expect(best).toBe(-300);
	});
});

describe("the rough lag, from the outlines", () => {
	test("a recording that starts 37.5 s into another is found within a point of the outline", () => {
		const hop = 240; // 5 ms
		const whole = event(120, 5);
		const part = heard(whole.subarray(Math.round(37.5 * RATE), Math.round(80 * RATE)));
		const found = coarseLag(outline(energy(whole, hop)), outline(energy(part, hop)), hop / RATE);
		expect(found).not.toBeNull();
		expect(Math.abs((found?.lag ?? 0) - 37.5)).toBeLessThanOrEqual(0.01);
		expect(found?.score ?? 0).toBeGreaterThan(MATCH_SCORE * 2);
		expect(found?.overlap ?? 0).toBeGreaterThan(40);
	});
	test("two different sounds: no lag stands out, and no window of samples matches", () => {
		const hop = 240;
		for (const seed of [91, 95, 97]) {
			const found = coarseLag(outline(energy(event(120, 5), hop)), outline(energy(event(40, seed), hop)), hop / RATE);
			expect(found?.score ?? 0).toBeLessThan(MATCH_SCORE);
			const window = fineLag(event(3, 5).subarray(24000, 96000), event(4, seed).subarray(0, 96000), 12000);
			expect(window?.sharpness ?? 0).toBeLessThan(SHARP_ENOUGH);
		}
	});
});

describe("the exact lag, from the samples", () => {
	test("to the sample: a window cut 12 345 samples away is placed exactly, through another microphone's tone and noise", () => {
		const x = event(8, 11);
		const other = heard(x);
		const reach = 4800;
		for (const off of [0, 1, -1, 37, -2222, 4000]) {
			const a = x.subarray(96000, 96000 + 72000);
			const b = other.subarray(96000 - reach + off, 96000 + 72000 + reach + off);
			const found = fineLag(a, b, reach);
			expect(found).not.toBeNull();
			// b's cut started `off` later: the sound is `off` samples earlier in it
			expect(Math.abs((found?.samples ?? 99) - off)).toBeLessThan(0.35);
			expect(found?.sharpness ?? 0).toBeGreaterThan(SHARP_ENOUGH * 3);
			expect(found?.inverted).toBe(false);
		}
	});
	test("a microphone wired the other way round is the same sound: found, and said to be turned", () => {
		const x = event(6, 23);
		const turned = heard(x).map((v) => -v);
		const reach = 2400;
		const found = fineLag(x.subarray(48000, 48000 + 72000), turned.subarray(48000 - reach + 5, 48000 + 72000 + reach + 5), reach);
		expect(Math.abs((found?.samples ?? 99) - 5)).toBeLessThan(0.35);
		expect(found?.inverted).toBe(true);
	});
});

describe("offset and drift along a recording", () => {
	test("a clock 0.01 % fast shows as a slope of 1e-4, the offset at the asked time, and one wrong window does not turn the line", () => {
		const points = [];
		for (let t = 10; t <= 590; t += 50) points.push({ t, lag: 3.25 + 1e-4 * (t - 300) + (t % 100 ? 2e-5 : -2e-5) });
		points[4] = { t: points[4].t, lag: 3.9 }; // a window that matched a repeat of the same phrase
		const fit = fitDrift(points, 300);
		expect(fit).not.toBeNull();
		expect(Math.abs((fit?.drift ?? 0) - 1e-4)).toBeLessThan(3e-6);
		expect(Math.abs((fit?.lag ?? 0) - 3.25)).toBeLessThan(1e-4);
		expect(fit?.used).toBe(points.length - 1);
		expect(fit?.residual ?? 1).toBeLessThan(1e-4);
	});
	test("no drift: the slope is nothing, the offset the windows' own", () => {
		const fit = fitDrift([10, 60, 110, 160].map((t) => ({ t, lag: -1.5 })), 85);
		expect(fit?.drift).toBe(0);
		expect(fit?.lag).toBe(-1.5);
	});
});

describe("where the clips go", () => {
	const T = 120000;
	const clip = (id: string, type: "video" | "audio", main = false, start = 0, duration = 10 * T) => ({ trackId: main ? "main" : `t-${id}`, elementId: id, type, main, startTime: start, duration });

	test("the clip that stays: the main track's; else the one sound among cameras; else the camera; else the earliest", async () => {
		const { pickReference } = await import("../sync/place");
		expect(pickReference([clip("cam", "video", true), clip("rec", "audio")])).toMatchObject({ elementId: "cam" });
		expect(pickReference([clip("rec", "audio"), clip("a", "video"), clip("b", "video")])).toMatchObject({ elementId: "rec" });
		expect(pickReference([clip("rec", "audio"), clip("cam", "video")])).toMatchObject({ elementId: "cam" });
		expect(pickReference([clip("late", "audio", false, 5 * T), clip("early", "audio", false, 1 * T)])).toMatchObject({ elementId: "early" });
		expect(pickReference([clip("a", "video", true), clip("b", "video", true)])).toHaveProperty("error");
	});

	test("a clip lands where its file's sound lies on the reference's, to the tick; before zero it is trimmed", async () => {
		const { placeSynced } = await import("../sync/place");
		// the reference shows its file from 2 s, at 10 s on the timeline; the same sound is 3.25 s later in the reference's file
		const reference = { startTime: 10 * T, trimStart: 2 * T };
		const lag = Math.round(3.25 * T);
		expect(placeSynced(reference, { startTime: 0, trimStart: 0, duration: 20 * T }, lag)).toEqual({ startTime: 11.25 * T, trimStart: 0, duration: 20 * T });
		// a clip that shows its file from 4 s keeps that piece
		expect(placeSynced(reference, { startTime: 0, trimStart: 4 * T, duration: 5 * T }, lag)).toEqual({ startTime: 15.25 * T, trimStart: 4 * T, duration: 5 * T });
		// the sound started 20 s before the reference's: what would lie before the timeline's zero is cut off
		expect(placeSynced(reference, { startTime: 0, trimStart: 0, duration: 30 * T }, -20 * T)).toEqual({ startTime: 0, trimStart: 12 * T, duration: 18 * T });
		expect(placeSynced(reference, { startTime: 0, trimStart: 0, duration: 5 * T }, -20 * T)).toBeNull();
	});

	test("moved clips keep their track when there is room, else take another of their kind, else a new one", async () => {
		const { moveClips } = await import("../sync/place");
		const el = (id: string, start: number, seconds: number) => ({ id, name: id, type: "audio", sourceType: "upload", mediaId: id, startTime: start * T, duration: seconds * T, trimStart: 0, trimEnd: 0, params: {} });
		const tracks = {
			overlay: [],
			main: { id: "main", name: "Main Track", type: "video", muted: false, hidden: false, elements: [] },
			audio: [
				{ id: "a1", name: "Audio", type: "audio", muted: false, elements: [el("rec", 0, 10), el("music", 20, 10)] },
				{ id: "a2", name: "Audio", type: "audio", muted: false, elements: [el("other", 0, 60)] },
			],
		} as never;
		let made = 0;
		const fresh = () => ({ id: `new-${++made}`, name: "Audio", type: "audio", muted: false, elements: [] }) as never;
		// room on its own track
		const stays = moveClips(tracks, [{ trackId: "a1", elementId: "rec", startTime: 5 * T, trimStart: 0, duration: 10 * T }], fresh);
		expect(stays.audio[0].elements.map((e) => [e.id, e.startTime / T])).toEqual([["rec", 5], ["music", 20]]);
		expect(made).toBe(0);
		// it would run into «music», and the other track is full: a new track
		const moved = moveClips(tracks, [{ trackId: "a1", elementId: "rec", startTime: 15 * T, trimStart: T, duration: 10 * T }], fresh);
		expect(moved.audio.map((t) => t.elements.map((e) => e.id))).toEqual([["music"], ["other"], ["rec"]]);
		expect(moved.audio[2].elements[0]).toMatchObject({ startTime: 15 * T, trimStart: T, duration: 10 * T });
		expect(made).toBe(1);
	});
});
