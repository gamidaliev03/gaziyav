// The tile's hover line and the monitor's playhead are one playhead (source-store.ts): I / O mark at the line while the
// pointer moves over a tile, and at the playhead once a key moved it away from a pointer that only rests there.
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SourceControls } from "../source-store";

// (the marks' store builds timeline pieces with the engine: set up as every engine test does, the modules loaded after)
type Store = typeof import("../source-store");
type Marks = typeof import("@/media/source-marks");
let clearSkim: Store["clearSkim"];
let routeSourceAction: Store["routeSourceAction"];
let setSkim: Store["setSkim"];
let sourceControls: Store["sourceControls"];
let useSourceStore: Store["useSourceStore"];
let takeOpenAt: Store["takeOpenAt"];
let useSourceMarks: Marks["useSourceMarks"];
beforeAll(async () => {
	await installOpenCutWasm();
	({ clearSkim, routeSourceAction, setSkim, sourceControls, useSourceStore, takeOpenAt } = await import("../source-store"));
	({ useSourceMarks } = await import("@/media/source-marks"));
});

const calls: string[] = [];
const fake = (): SourceControls => ({
	toggle: () => calls.push("toggle"),
	shuttle: (d) => calls.push(`shuttle ${d}`),
	step: (n) => calls.push(`step ${n}`),
	markIn: () => calls.push("markIn"),
	markOut: () => calls.push("markOut"),
	clearMarks: () => calls.push("clearMarks"),
	clearIn: () => calls.push("clearIn"),
	clearOut: () => calls.push("clearOut"),
	gotoIn: () => calls.push("gotoIn"),
	gotoOut: () => calls.push("gotoOut"),
	gotoStart: () => calls.push("gotoStart"),
	gotoEnd: () => calls.push("gotoEnd"),
	seek: (s) => calls.push(`seek ${s}`),
	insert: () => calls.push("insert"),
});

beforeEach(() => {
	calls.length = 0;
	sourceControls.current = fake();
	useSourceStore.setState({ assetId: "a", time: 0, playing: false });
});
afterEach(() => {
	clearSkim("a");
	clearSkim("b");
	sourceControls.current = null;
	useSourceStore.setState({ assetId: null, time: 0, playing: false });
	useSourceMarks.getState().clear({ id: "b" });
});

describe("I / O with a tile's hover line", () => {
	test("the pointer over the open item's tile: I marks at the line", () => {
		setSkim({ assetId: "a", seconds: 3, duration: 6, fps: 25 });
		expect(routeSourceAction("mark-in")).toBe(true);
		expect(calls).toEqual(["seek 3", "markIn"]);
	});

	test("the pointer rests on the tile and the arrows step the playhead: I and O mark at the playhead", () => {
		setSkim({ assetId: "a", seconds: 3, duration: 6, fps: 25 });
		for (let i = 0; i < 12; i++) routeSourceAction("frame-step-forward");
		expect(routeSourceAction("mark-in")).toBe(true);
		for (let i = 0; i < 29; i++) routeSourceAction("frame-step-forward");
		expect(routeSourceAction("mark-out")).toBe(true);
		expect(calls.filter((c) => c.startsWith("seek"))).toEqual([]);
		expect(calls.filter((c) => c.startsWith("mark"))).toEqual(["markIn", "markOut"]);
		expect(calls.filter((c) => c === "step 1").length).toBe(41);
	});

	test("every key that moves the playhead lets go of the resting line", () => {
		for (const action of ["toggle-play", "shuttle-backward", "shuttle-stop", "shuttle-forward", "goto-in", "goto-out", "goto-start", "goto-end", "frame-step-backward", "frame-step-forward-large", "frame-step-backward-large"] as const) {
			calls.length = 0;
			setSkim({ assetId: "a", seconds: 3, duration: 6, fps: 25 });
			routeSourceAction(action);
			routeSourceAction("mark-in");
			expect(calls.includes("seek 3")).toBe(false);
			expect(calls[calls.length - 1]).toBe("markIn");
		}
	});

	test("the pointer moves over the tile again: its line is the playhead again", () => {
		setSkim({ assetId: "a", seconds: 3, duration: 6, fps: 25 });
		routeSourceAction("frame-step-forward");
		setSkim({ assetId: "a", seconds: 4, duration: 6, fps: 25 });
		routeSourceAction("mark-out");
		expect(calls).toEqual(["step 1", "seek 4", "markOut"]);
	});

	test("a mark does not let go of the line (I then O at the same hover spot keep working)", () => {
		setSkim({ assetId: "a", seconds: 2, duration: 6, fps: 25 });
		routeSourceAction("mark-in");
		routeSourceAction("mark-out");
		expect(calls).toEqual(["seek 2", "markIn", "seek 2", "markOut"]);
	});

	test("an item opened with the pointer over its tile opens at the line; opened any other way, at its start", () => {
		setSkim({ assetId: "b", seconds: 2.5, duration: 6, fps: 25 });
		useSourceStore.getState().open("b");
		expect(useSourceStore.getState().assetId).toBe("b");
		expect(takeOpenAt("b")).toBe(2.5);
		expect(takeOpenAt("b")).toBe(null);
		clearSkim("b");
		useSourceStore.getState().open("c");
		expect(takeOpenAt("c")).toBe(null);
	});

	test("the pointer over ANOTHER item's tile: keys step the open item, I still marks the hovered one at its line", () => {
		useSourceMarks.getState().clear({ id: "b" });
		setSkim({ assetId: "b", seconds: 1.5, duration: 6, fps: 25 });
		routeSourceAction("frame-step-forward");
		expect(routeSourceAction("mark-in")).toBe(true);
		expect(calls).toEqual(["step 1"]);
		expect(useSourceMarks.getState().marks.b?.in).toBe(1.5);
		expect(useSourceStore.getState().assetId).toBe("b");
	});
});
