import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import { renderRetimedBuffer } from "@/retime/audio-stretch";
import { buildCurve, getCurveTable } from "@/retime/curve";
import type { RetimeConfig, SceneTracks } from "@/timeline";
import { correctTrack, smoothedTrack, trackBoxAt } from "../tracker";
import type { Tracker } from "../types";

// The follow resolver imports the wasm bindings (ticks): loaded after the shim.
let follow: typeof import("../follow");
let T = 0;
beforeAll(async () => {
	await installOpenCutWasm();
	follow = await import("../follow");
	T = (await import("@/wasm")).TICKS_PER_SECOND;
});

function linearTracker(): Tracker {
	// The object moves from x = 0.2 to x = 0.8 over 0..6 s (centre), y fixed at 0.5; 30 samples/s with noise.
	const samples: number[][] = [];
	for (let i = 0; i <= 180; i++) {
		const t = i / 30;
		const noise = Math.sin(i * 12.9898) * 0.004;
		samples.push([t, 0.2 + 0.1 * t - 0.05 + noise, 0.45, 0.1, 0.1, 0, 1]);
	}
	return { id: "trk", name: "Object 1", kind: "object", samples, frame: [1280, 720], smoothing: 0.5 };
}

function tracksWith(tracker: Tracker, follower: Record<string, unknown>): SceneTracks {
	const clip = { id: "clip", type: "video", name: "v", mediaId: "m", startTime: 0, duration: 6 * T, trimStart: 0, trimEnd: 0, params: {}, trackers: [tracker] };
	return {
		main: { id: "main", type: "video", name: "Main", elements: [clip], muted: false, hidden: false },
		overlay: [{ id: "ov", type: "graphic", name: "G", elements: [follower], hidden: false }],
		audio: [],
	} as unknown as SceneTracks;
}

describe("tracker", () => {
	test("an object turning across ±180° turns a few degrees, not the long way round", () => {
		// 170°, 175°, 180°, −175°, −170°: five steps of 5°.
		const samples = [170, 175, 180, -175, -170].map((a, i) => [i / 30, 0.45, 0.45, 0.1, 0.1, a, 1]);
		const tr: Tracker = { id: "trk", name: "Object 1", kind: "object", samples, frame: [1280, 720], smoothing: 0 };
		const s = smoothedTrack(tr);
		for (let i = 1; i < s.t.length; i++) expect(Math.abs(s.angle[i] - s.angle[i - 1])).toBeLessThan(10);
		expect(trackBoxAt(tr, 3.5 / 30)!.angle).toBeCloseTo(187.5, 0);
	});
	test("One-Euro smoothing removes jitter without lag", () => {
		const tr = linearTracker();
		const s = smoothedTrack(tr);
		let maxErr = 0;
		for (let i = 10; i < s.t.length - 10; i++) maxErr = Math.max(maxErr, Math.abs(s.cx[i] - (0.2 + 0.1 * s.t[i])));
		expect(maxErr).toBeLessThan(0.004);
		expect(trackBoxAt(tr, 3)!.cx).toBeCloseTo(0.5, 2);
	});

	test("a hand correction moves that moment and fades out", () => {
		const tr = linearTracker();
		const box = trackBoxAt(tr, 3)!;
		const samples = correctTrack(tr, 3, { x: box.cx - box.w / 2 + 0.05, y: box.cy - box.h / 2, w: box.w, h: box.h });
		const after = { ...tr, samples };
		expect(trackBoxAt(after, 3)!.cx - box.cx).toBeGreaterThan(0.03);
		expect(Math.abs(trackBoxAt(after, 1)!.cx - trackBoxAt(tr, 1)!.cx)).toBeLessThan(1e-4);
	});
});

describe("follow", () => {
	test("a layer keeps its distance to the tracked object", () => {
		const tr = linearTracker();
		const canvas = { width: 1280, height: 720 };
		const follower = { id: "g", type: "graphic", definitionId: "ai.Kicker", name: "AI", startTime: 0, duration: 6 * T, trimStart: 0, trimEnd: 0, params: {}, follow: { clipId: "clip", trackerId: "trk", anchor: [0, 0] } };
		const tracks = tracksWith(tr, follower);
		const resolve = follow.makeFollowResolver(tracks, canvas);
		// Anchor at the canvas centre: the offset is where the object is (canvas px from the centre).
		const at1 = resolve(follower.follow as never, 1 * T)!;
		const at5 = resolve(follower.follow as never, 5 * T)!;
		expect(at5.x - at1.x).toBeCloseTo(0.4 * 1280, -1);
		expect(Math.abs(at5.y - at1.y)).toBeLessThan(2);
		// AI layers (Remotion) get the same path at 30 Hz.
		const [item] = follow.addFollowPaths([{ from: 0, dur: 6, follow: follower.follow as never, fp: undefined as number[] | undefined }], tracks, canvas);
		expect(item.fp!.length).toBe(181 * 3);
		expect(item.fp![150 * 3]).toBeCloseTo(at5.x, 0);
	});
});

describe("speed ramp audio", () => {
	function fakeContext(sampleRate: number) {
		return {
			sampleRate,
			createBuffer(channels: number, length: number, sr: number) {
				const data = Array.from({ length: channels }, () => new Float32Array(length));
				return { sampleRate: sr, length, numberOfChannels: channels, duration: length / sr, getChannelData: (c: number) => data[c] } as unknown as AudioBuffer;
			},
		} as unknown as BaseAudioContext;
	}
	const zeroCrossHz = (d: Float32Array, sr: number, from: number, to: number) => {
		let n = 0;
		for (let i = Math.floor(from * sr) + 1; i < to * sr; i++) if (d[i - 1] < 0 && d[i] >= 0) n++;
		return n / (to - from);
	};

	test("keep pitch: a 440 Hz tone stays 440 Hz through the fast and the slow part", async () => {
		const sr = 48000;
		const ctx = fakeContext(sr);
		const src = ctx.createBuffer(1, sr * 6, sr);
		const d = src.getChannelData(0);
		for (let i = 0; i < d.length; i++) d[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr);
		const curve = buildCurve("hero");
		const table = getCurveTable(curve);
		const retime: RetimeConfig = { mode: "curve", curve, rate: table.rate, maintainPitch: true };
		const clipDuration = 6 * table.k;
		const out = await renderRetimedBuffer({ audioContext: ctx, sourceBuffer: src, trimStart: 0, clipDuration, retime, maintainPitch: true });
		expect(out.length).toBe(Math.ceil(clipDuration * sr));
		const o = out.getChannelData(0);
		// Fast start (2.5×) and the slow middle (0.3×): pitch unchanged.
		expect(zeroCrossHz(o, sr, 0.1, 0.5)).toBeCloseTo(440, -1);
		expect(zeroCrossHz(o, sr, clipDuration * 0.45, clipDuration * 0.55)).toBeCloseTo(440, -1);
		// Without keep pitch the fast part sounds higher (tape-like ramp).
		const tape = await renderRetimedBuffer({ audioContext: ctx, sourceBuffer: src, trimStart: 0, clipDuration, retime: { ...retime, maintainPitch: false }, maintainPitch: false });
		expect(zeroCrossHz(tape.getChannelData(0), sr, 0.1, 0.5)).toBeGreaterThan(900);
		// CPU-heavy (two stretches of 6 s of audio): give it room on a busy machine.
	}, 60000);
});

describe("follow across a split", () => {
	test("both halves carry the tracker: the layer follows the half on screen", () => {
		const tr = linearTracker();
		const canvas = { width: 1280, height: 720 };
		const link = { clipId: "left", trackerId: "trk", anchor: [0, 0] as [number, number] };
		const left = { id: "left", type: "video", name: "v", mediaId: "m", startTime: 0, duration: 2.5 * T, trimStart: 0, trimEnd: 3.5 * T, params: {}, trackers: [tr] };
		const right = { id: "right", type: "video", name: "v", mediaId: "m", startTime: 2.5 * T, duration: 3.5 * T, trimStart: 2.5 * T, trimEnd: 0, params: {}, trackers: [tr] };
		const follower = { id: "g", type: "text", name: "T", startTime: 0, duration: 6 * T, trimStart: 0, trimEnd: 0, params: {}, follow: link };
		const tracks = {
			main: { id: "main", type: "video", name: "Main", elements: [left, right], muted: false, hidden: false },
			overlay: [{ id: "ov", type: "text", name: "T", elements: [follower], hidden: false }],
			audio: [],
		} as unknown as SceneTracks;
		const resolve = follow.makeFollowResolver(tracks, canvas);
		const a = resolve(link, 2.6 * T)!;
		const b = resolve(link, 3.5 * T)!;
		// 0.1 px/s·1280 = 128 px per second of motion: the layer keeps moving after the cut.
		expect(b.x - a.x).toBeGreaterThan(100);
		// The right half lists the layer as attached, and the tracker is still carried after removing it from one half.
		expect(follow.followersOf(tracks, "right", "trk").length).toBe(1);
		expect(follow.trackerCarriedElsewhere(tracks, "trk", "left")).toBe(true);
	});
});

describe("trackers on a replacement file", () => {
	test("a trimmed clip's tracker is re-timed to the new file's seconds", () => {
		const tr = linearTracker();
		const clip = { id: "c", type: "video", name: "v", mediaId: "m", startTime: 10 * T, duration: 3 * T, trimStart: 2 * T, trimEnd: 1 * T, params: {}, trackers: [tr] };
		const [moved] = follow.trackersForResult(clip as never, 3)!;
		// Second 0 of the new file shows source second 2 of the old one.
		const raw = (k: Tracker, t: number) => k.samples.find((s) => Math.abs(s[0] - t) < 1e-3)![1];
		expect(raw(moved, 0)).toBeCloseTo(raw(tr, 2), 4);
		expect(raw(moved, 2)).toBeCloseTo(raw(tr, 4), 4);
		expect(moved.id).toBe(tr.id);
	});
});

describe("follow: a layer carried by a tracked object", () => {
	test("moves with it, keeps its distance; turns around it; its distance scales; Move off keeps its place", async () => {
		const { followPlace } = await import("../follow");
		const base = { x: 100, y: 0, scaleX: 1, scaleY: 1, rotate: 0 };
		// The object went from (0, 0) to (50, 20): the layer goes along.
		const moved = followPlace(base, { x: 50, y: 20, scale: 1, cx: 50, cy: 20, ax: 0, ay: 0 });
		expect([moved.x, moved.y, moved.rotate]).toEqual([150, 20, 0]);
		// The object turned 90° where it was: the layer goes a quarter round it and turns too.
		const turned = followPlace(base, { x: 0, y: 0, scale: 1, rotate: 90, cx: 0, cy: 0, ax: 0, ay: 0 });
		expect(turned.x).toBeCloseTo(0, 6);
		expect(turned.y).toBeCloseTo(100, 6);
		expect(turned.rotate).toBe(90);
		// The object doubled in size: so do the layer and its distance.
		const grown = followPlace(base, { x: 0, y: 0, scale: 2, cx: 0, cy: 0, ax: 0, ay: 0 });
		expect([grown.x, grown.scaleX]).toEqual([200, 2]);
		// Move off: the layer stays where it is, only scaled / turned.
		const still = followPlace(base, { x: 30, y: 30, scale: 1.5, rotate: 10, cx: 30, cy: 30, ax: 0, ay: 0, move: false });
		expect([still.x, still.y, still.scaleX, still.rotate]).toEqual([100, 0, 1.5, 10]);
	});
});
