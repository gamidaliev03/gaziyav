// ⌘B / ⇧⌘B (tlfix A2b, the lead 14.11): with a selection the selected clips under the playhead; with nothing selected the
// main track's clip only; ⇧⌘B every unlocked track; a locked track never; a playhead on an edge cuts nothing.
import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SceneTracks } from "@/timeline/types";

let splitTargets: typeof import("@/timeline/split-targets").splitTargets;
beforeAll(async () => {
	await installOpenCutWasm();
	splitTargets = (await import("@/timeline/split-targets")).splitTargets;
});

const S = 120000;
const el = (id: string, start: number, len: number) => ({ id, type: "video", startTime: start * S, duration: len * S, trimStart: 0, trimEnd: 0, params: {} });
const tracks = (lockAudio = false) =>
	({
		main: { id: "M", type: "video", elements: [el("m1", 0, 8), el("m2", 8, 6)] },
		overlay: [{ id: "O", type: "video", elements: [el("photo", 2, 5)] }],
		audio: [{ id: "A", type: "audio", locked: lockAudio, elements: [el("tone", 0, 5)] }],
	}) as unknown as SceneTracks;
const ids = (refs: { elementId: string }[]) => refs.map((r) => r.elementId).sort();

describe("what ⌘B and ⇧⌘B cut", () => {
	test("⌘B, nothing selected: the main track's clip only (the photo and the sound over it stay whole)", () => {
		expect(ids(splitTargets({ tracks: tracks(), time: 3 * S, selected: [], all: false }))).toEqual(["m1"]);
	});
	test("⌘B with a selection: the selected clips under the playhead, nothing else", () => {
		expect(ids(splitTargets({ tracks: tracks(), time: 3 * S, selected: [{ trackId: "O", elementId: "photo" }, { trackId: "M", elementId: "m2" }], all: false }))).toEqual(["photo"]);
	});
	test("⇧⌘B: every clip under the playhead on every unlocked track", () => {
		expect(ids(splitTargets({ tracks: tracks(), time: 3 * S, selected: [], all: true }))).toEqual(["m1", "photo", "tone"]);
		expect(ids(splitTargets({ tracks: tracks(true), time: 3 * S, selected: [], all: true }))).toEqual(["m1", "photo"]);
	});
	test("a playhead on a cut cuts nothing; a locked main track nothing", () => {
		expect(splitTargets({ tracks: tracks(), time: 8 * S, selected: [], all: false })).toEqual([]);
		const locked = { ...tracks(), main: { ...tracks().main, locked: true } } as unknown as SceneTracks;
		expect(splitTargets({ tracks: locked, time: 3 * S, selected: [], all: false })).toEqual([]);
	});
});
