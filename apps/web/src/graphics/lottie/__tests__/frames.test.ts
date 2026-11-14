import { describe, expect, test } from "bun:test";
import { dropIdlePlayers, lottieFrameAt, lottieTexts, parseLottie } from "../player";

const data = { ip: 0, op: 60, fr: 30 };

describe("Lottie frame timing (same function for preview and export)", () => {
	test("loop wraps around the animation", () => {
		expect(lottieFrameAt({ data, time: 0.5, clipDuration: 5, timing: "loop", speed: 1 })).toBe(15);
		expect(lottieFrameAt({ data, time: 2.5, clipDuration: 5, timing: "loop", speed: 1 })).toBe(15);
	});
	test("once holds the last frame", () => {
		expect(lottieFrameAt({ data, time: 9, clipDuration: 10, timing: "once", speed: 1 })).toBe(59);
	});
	test("fit stretches the animation over the clip", () => {
		expect(lottieFrameAt({ data, time: 2, clipDuration: 4, timing: "fit", speed: 1 })).toBe(30);
	});
	test("speed scales playback", () => {
		expect(lottieFrameAt({ data, time: 0.5, clipDuration: 5, timing: "loop", speed: 2 })).toBe(30);
	});
	test("text layers are read in order, line breaks normalised", () => {
		const json = JSON.stringify({
			w: 100,
			h: 100,
			ip: 0,
			op: 10,
			fr: 30,
			layers: [{ ty: 5, t: { d: { k: [{ s: { t: "LIVE\rNOW" } }] } } }, { ty: 4 }],
		});
		expect(parseLottie(json)?.w).toBe(100);
		expect(lottieTexts(json)).toEqual(["LIVE\nNOW"]);
		expect(parseLottie("not json")).toBeNull();
	});
});

describe("Lottie player cache", () => {
	const make = (count: number, entry: (index: number) => { usedAt: number; task: number }) =>
		new Map(Array.from({ length: count }, (_, index) => [`p${index}`, entry(index)]));

	test("players on screen now are kept, however many there are", () => {
		// 20 animations drawn in the same frame: dropping some rebuilt them every frame (the app froze).
		const players = make(20, () => ({ usedAt: 1000, task: 7 }));
		const dropped: unknown[] = [];
		dropIdlePlayers({ players, now: 1500, task: 8, drop: (entry) => dropped.push(entry) });
		expect(players.size).toBe(20);
		expect(dropped.length).toBe(0);
	});

	test("a frame that takes longer than the time window keeps its own players", () => {
		const players = make(20, () => ({ usedAt: 0, task: 3 }));
		dropIdlePlayers({ players, now: 60_000, task: 3, drop: () => {} });
		expect(players.size).toBe(20);
	});

	test("idle players go first, down to the limit", () => {
		// 18 not drawn for a while, then 4 on screen.
		const players = make(22, (index) => (index < 18 ? { usedAt: 0, task: 1 } : { usedAt: 9000, task: 50 }));
		dropIdlePlayers({ players, now: 10_000, task: 51, drop: () => {} });
		expect(players.size).toBe(16);
		expect([...players.keys()].slice(-4)).toEqual(["p18", "p19", "p20", "p21"]);
	});
});
