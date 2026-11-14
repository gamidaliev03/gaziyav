import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { GroupResizeUpdate } from "@/timeline/group-resize";
import type { SceneTracks, TimelineElement } from "@/timeline/types";
import type { MediaTime } from "@/wasm";

let trims: typeof import("@/actions/keyboard-trim");
let presets: typeof import("@/actions/keybindings/presets");
let migrations: typeof import("@/actions/keybindings/migrations");

beforeAll(async () => {
	await installOpenCutWasm();
	trims = await import("@/actions/keyboard-trim");
	presets = await import("@/actions/keybindings/presets");
	migrations = await import("@/actions/keybindings/migrations");
});
const trimEdgeByFrames: typeof import("@/actions/keyboard-trim").trimEdgeByFrames = (args) => trims.trimEdgeByFrames(args);
const extendEditToPlayhead: typeof import("@/actions/keyboard-trim").extendEditToPlayhead = (args) => trims.extendEditToPlayhead(args);
const getPresetBindings: typeof import("@/actions/keybindings/presets").getPresetBindings = (args) => presets.getPresetBindings(args);
const runMigrations: typeof import("@/actions/keybindings/migrations").runMigrations = (args) => migrations.runMigrations(args);

const S = 120000;
const F = S / 30; // one frame at 30 fps
const fps = { numerator: 30, denominator: 1 };

/** A clip from `start` for `duration` seconds showing its media from `trimStart` (media `source` long; none: a title). */
function clip(id: string, start: number, duration: number, trimStart = 0, source: number | null = 10): TimelineElement {
	return {
		id,
		name: id,
		type: source === null ? "text" : "video",
		mediaId: "m",
		startTime: start * S,
		duration: duration * S,
		trimStart: trimStart * S,
		trimEnd: source === null ? 0 : (source - trimStart - duration) * S,
		...(source === null ? {} : { sourceDuration: source * S }),
		params: {},
	} as unknown as TimelineElement;
}

function scene({ main = [], overlay = [], locked = false }: { main?: TimelineElement[]; overlay?: TimelineElement[]; locked?: boolean }): SceneTracks {
	return {
		overlay: [{ id: "o", name: "Overlay", type: "video", elements: overlay, muted: false, hidden: false, ...(locked ? { locked: true } : {}) }],
		main: { id: "main", name: "Main", type: "video", elements: main, muted: false, hidden: false },
		audio: [],
	} as unknown as SceneTracks;
}

const sel = (trackId: string, ...ids: string[]) => ids.map((elementId) => ({ trackId, elementId }));
/** Each changed clip: [id, start, duration, trimStart] in frames. */
const frames = (updates: GroupResizeUpdate[] | null) =>
	updates?.map(({ elementId, patch }) => [elementId, patch.startTime / F, patch.duration / F, patch.trimStart / F]) ?? null;

describe("trims to the frame from the keyboard", () => {
	test("⌥⌘← / ⌥⌘→ move the end a frame; ⌥⇧⌘← / ⌥⇧⌘→ the start; the next clip and the media's length stop them", () => {
		const tracks = scene({ overlay: [clip("t", 1, 2, 3), clip("u", 3, 1, 0)] });
		const trim = (side: "left" | "right", n: number, ids = ["t"]) =>
			frames(trimEdgeByFrames({ tracks, selection: sel("o", ...ids), side, frames: n, fps, rippleTrackId: "main" }));
		expect(trim("right", -1)).toEqual([["t", 30, 59, 90]]);
		// u starts where t ends
		expect(trim("right", 1)).toEqual(null);
		expect(trim("left", 1)).toEqual([["t", 31, 59, 91]]);
		expect(trim("left", -1)).toEqual([["t", 29, 61, 89]]);
		// u shows its media from its first frame: nothing before it to show
		expect(trim("left", -1, ["u"])).toEqual(null);
		expect(trim("right", -1, ["u"])).toEqual([["u", 90, 29, 0]]);
	});

	test("on the magnet one clip keeps its place: a longer end or an earlier start pushes the clips after it", () => {
		const tracks = scene({ main: [clip("a", 0, 2, 1), clip("b", 2, 2, 2), clip("c", 4, 2)] });
		const trim = (id: string, side: "left" | "right", n: number, rippleTrackId: string | null = "main") =>
			frames(trimEdgeByFrames({ tracks, selection: sel("main", id), side, frames: n, fps, rippleTrackId }));
		expect(trim("a", "right", 1)).toEqual([
			["a", 0, 61, 30],
			["b", 61, 60, 60],
			["c", 121, 60, 0],
		]);
		expect(trim("b", "left", -1)).toEqual([
			["b", 60, 61, 59],
			["c", 121, 60, 0],
		]);
		// the first clip, at the timeline's start
		expect(trim("a", "left", -1)).toEqual([
			["a", 0, 61, 29],
			["b", 61, 60, 60],
			["c", 121, 60, 0],
		]);
		// shorter: the gap is closed when the edit is committed (the magnet), as after a trim by mouse
		expect(trim("b", "right", -1)).toEqual([["b", 60, 59, 60]]);
		// c shows its media from the first frame
		expect(trim("c", "left", -1)).toEqual(null);
		// magnet off: the clips touching it stop it
		expect(trim("a", "right", 1, null)).toEqual(null);
		expect(trim("b", "left", -1, null)).toEqual(null);
	});

	test("several clips take the same frame, each stopped by the others; a locked track and no selection do nothing", () => {
		const tracks = scene({ overlay: [clip("t", 0, 1, 1), clip("u", 2, 1, 1)] });
		const both = sel("o", "t", "u");
		expect(frames(trimEdgeByFrames({ tracks, selection: both, side: "right", frames: 1, fps, rippleTrackId: null }))).toEqual([
			["t", 0, 31, 30],
			["u", 60, 31, 30],
		]);
		const locked = scene({ overlay: [clip("t", 0, 1, 1)], locked: true });
		expect(trimEdgeByFrames({ tracks: locked, selection: sel("o", "t"), side: "right", frames: 1, fps, rippleTrackId: null })).toBeNull();
		expect(trimEdgeByFrames({ tracks, selection: [], side: "right", frames: 1, fps, rippleTrackId: null })).toBeNull();
	});
});

describe("E: extend edit to the playhead", () => {
	// b has 0.2 s (6 frames) of media before it
	const tracks = scene({ main: [clip("a", 0, 2, 1), clip("b", 2, 2, 0.2)], overlay: [clip("t", 1, 2, 0, null), clip("u", 4.5, 1, 0, null)] });
	const extend = (trackId: string, id: string, at: number) =>
		frames(extendEditToPlayhead({ tracks, selection: sel(trackId, id), time: (at * S) as MediaTime, fps }));

	test("the clip touching the edge rolls with it: the cut moves, nothing after it", () => {
		// the playhead past a's end, inside b
		expect(extend("main", "a", 3)).toEqual([
			["a", 0, 90, 30],
			["b", 90, 30, 36],
		]);
		// inside a, nearer its end
		expect(extend("main", "a", 1.9)).toEqual([
			["a", 0, 57, 30],
			["b", 57, 63, 3],
		]);
	});

	test("as far as both clips allow: b shows at most its 6 frames before", () => {
		expect(extend("main", "b", 1)).toEqual([
			["b", 54, 66, 0],
			["a", 0, 54, 30],
		]);
	});

	test("without a touching clip only the edge moves; on the edge nothing happens", () => {
		expect(extend("o", "t", 4)).toEqual([["t", 30, 90, 0]]);
		// u is in the way at 4.5 s
		expect(extend("o", "t", 5)).toEqual([["t", 30, 105, 0]]);
		// inside t, nearer its start
		expect(extend("o", "t", 1.5)).toEqual([["t", 45, 45, 15]]);
		expect(extend("o", "t", 3)).toBeNull();
	});
});

describe("keys", () => {
	test("CapCut keymap: ⌥← / ⌥→ nudge, ⌥⌘ / ⌥⇧⌘ arrows trim, E extend edit — keys CapCut leaves free", () => {
		const capcut = getPresetBindings({ preset: "capcut" });
		const expected: Array<[string, string]> = [
			["alt+left", "nudge-left"],
			["alt+shift+right", "nudge-right-large"],
			["alt+cmd+left", "trim-end-earlier"],
			["alt+cmd+right", "trim-end-later"],
			["alt+shift+cmd+left", "trim-start-earlier"],
			["alt+shift+cmd+right", "trim-start-later"],
			["e", "extend-edit"],
			// CapCut's own on the arrows stay
			["left", "frame-step-backward"],
			["shift+left", "frame-step-backward-large"],
		];
		for (const [key, action] of expected) expect([key, capcut.get(key as never)]).toEqual([key, action as never]);
		expect(getPresetBindings({ preset: "finalcut" }).get("shift+x")).toBe("extend-edit");
	});

	test("a customized keymap gets the new commands on free keys and keeps the user's", () => {
		const saved = { keybindings: { e: "split", "alt+left": "goto-start" }, isCustomized: true, preset: "capcut" };
		const next = runMigrations({ state: saved, fromVersion: 13 }) as { keybindings: Record<string, string> };
		expect(next.keybindings.e).toBe("split");
		expect(next.keybindings["alt+left"]).toBe("goto-start");
		expect(next.keybindings["alt+right"]).toBe("nudge-right");
		expect(next.keybindings["alt+cmd+left"]).toBe("trim-end-earlier");
		expect(next.keybindings["alt+shift+cmd+right"]).toBe("trim-start-later");
	});
});
