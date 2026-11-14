import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SceneTracks } from "../types";

// The module reads the tick rate from the wasm bindings: installed once, then imported.
let dropOrphanTransitions: typeof import("../orphan-transitions").dropOrphanTransitions;
let S = 0;
beforeAll(async () => {
	await installOpenCutWasm();
	({ dropOrphanTransitions } = await import("../orphan-transitions"));
	S = (await import("@/wasm")).TICKS_PER_SECOND;
});

const clip = (id: string, startTime: number, duration: number) =>
	({ id, type: "video", name: id, startTime, duration, trimStart: 0, trimEnd: 0, mediaId: "m" }) as unknown as SceneTracks["main"]["elements"][number];
const tracks = (elements: SceneTracks["main"]["elements"], transitions: { fromElementId: string; toElementId: string; duration?: number }[]): SceneTracks =>
	({ main: { id: "main", type: "video", elements, transitions: transitions.map((x) => ({ duration: S / 2, ...x })) } as unknown as SceneTracks["main"], overlay: [], audio: [] }) as SceneTracks;
const kept = (t: SceneTracks) => ((t.main as unknown as { transitions: { fromElementId: string }[] }).transitions ?? []).map((x) => x.fromElementId);
const durations = (t: SceneTracks) => ((t.main as unknown as { transitions: { duration: number }[] }).transitions ?? []).map((x) => x.duration);

describe("transitions live on a cut", () => {
	test("a transition between two touching clips stays", () => {
		const t = tracks([clip("a", 0, S), clip("b", S, S)], [{ fromElementId: "a", toElementId: "b" }]);
		expect(dropOrphanTransitions(t)).toBe(t);
	});

	test("a clip that left the track takes its transition with it", () => {
		const t = tracks([clip("a", 0, S)], [{ fromElementId: "a", toElementId: "b" }]);
		expect(kept(dropOrphanTransitions(t))).toEqual([]);
	});

	test("two clips that no longer touch (a split left half away from the cut, a gap) lose the transition", () => {
		// a was split: its left half keeps the id and ends at 0.5 s, b still starts at 1 s
		const t = tracks([clip("a", 0, S / 2), clip("b", S, S)], [{ fromElementId: "a", toElementId: "b" }]);
		expect(kept(dropOrphanTransitions(t))).toEqual([]);
	});

	test("clips within a frame of each other still count as touching", () => {
		const t = tracks([clip("a", 0, S), clip("b", S + S / 60, S)], [{ fromElementId: "a", toElementId: "b" }]);
		expect(dropOrphanTransitions(t)).toBe(t);
	});

	test("a transition never outlasts either clip: a trim that leaves a clip shorter shortens it, a clip too short loses it", () => {
		const trimmed = tracks([clip("a", 0, S / 4), clip("b", S / 4, S)], [{ fromElementId: "a", toElementId: "b", duration: S / 2 }]);
		expect(durations(dropOrphanTransitions(trimmed))).toEqual([S / 4]);
		const tiny = tracks([clip("a", 0, S / 50), clip("b", S / 50, S)], [{ fromElementId: "a", toElementId: "b", duration: S / 2 }]);
		expect(kept(dropOrphanTransitions(tiny))).toEqual([]);
	});
});
