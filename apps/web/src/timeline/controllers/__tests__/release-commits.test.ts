// tlc C1b, the lead's rule: a release always commits from the release event's own position, at once — it never depends
// on a move (or an animation frame) having run between the press and the release. A busy Mac reports moves and draws
// frames 200 ms apart; a short trim fits between two of them.
import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SceneTracks } from "@/timeline/types";

let ResizeController: typeof import("@/timeline/controllers/resize-controller").ResizeController;
beforeAll(async () => {
	await installOpenCutWasm();
	({ ResizeController } = await import("@/timeline/controllers/resize-controller"));
	const g = globalThis as { document?: { addEventListener?: unknown } };
	if (!g.document) g.document = fakeDocument as never;
	else Object.assign(g.document, fakeDocument);
});

const T = 120000;
const FPS = { numerator: 25, denominator: 1 };
const F = T / 25;
// a document of our own (installed after the imports): the controller listens there from the press on
const listeners = new Map<string, Set<(e: unknown) => void>>();
const fakeDocument = {
	addEventListener: (type: string, fn: (e: unknown) => void) => (listeners.get(type) ?? listeners.set(type, new Set()).get(type))?.add(fn),
	removeEventListener: (type: string, fn: (e: unknown) => void) => listeners.get(type)?.delete(fn),
};
const fire = (type: string, clientX: number, buttons = type === "mouseup" ? 0 : 1) => {
	for (const fn of [...(listeners.get(type) ?? [])]) fn({ clientX, clientY: 10, buttons, isTrusted: true });
};
const clip = (id: string, start: number, frames: number) =>
	({ id, type: "video", name: id, mediaId: "m", startTime: start * F, duration: frames * F, trimStart: 10 * F, trimEnd: 100 * F, sourceDuration: (110 + frames) * F, muted: false, hidden: false, transform: {}, opacity: 1 }) as never;
const tracks = (): SceneTracks =>
	({ overlay: [], audio: [], main: { id: "main", type: "video", name: "Main", elements: [clip("a", 0, 50), clip("b", 50, 50)], muted: false, hidden: false, isMain: true } }) as never;

function setup() {
	const committed: unknown[] = [];
	const config = {
		zoomLevel: 1, // 50 px a second: 2 px a frame at 25 fps
		snappingEnabled: false,
		isShiftHeld: () => false,
		getSceneTracks: tracks,
		getCurrentPlayheadTime: () => 0 as never,
		getActiveProjectFps: () => FPS,
		getScrollLeft: () => 0,
		getRippleTrackId: () => null,
		selectedElements: [],
		discardPreview: () => {},
		previewElements: () => {},
		commitElements: (updates: unknown[]) => committed.push(updates),
	};
	const controller = new ResizeController({ configRef: { current: config as never } });
	const press = (clientX: number, side: "left" | "right", id = "a") => {
		const t = tracks();
		const element = t.main.elements.find((e) => e.id === id) as never;
		controller.onResizeStart({ event: { clientX, metaKey: false, shiftKey: false, stopPropagation() {}, preventDefault() {} } as never, element, track: t.main, side });
	};
	return { controller, committed, press };
}
const durationOf = (committed: unknown[]) => {
	const updates = committed[0] as Array<{ elementId: string; patch: { duration?: number } }>;
	return updates.find((u) => u.elementId === "a")?.patch.duration;
};

describe("the edge trim (resize-controller) commits from the release", () => {
	test("press → release 20 px left with no move between: a's tail 10 frames shorter, at once", () => {
		const { committed, press } = setup();
		press(100, "right");
		fire("mouseup", 80);
		expect(committed.length).toBe(1);
		expect(durationOf(committed)).toBe(40 * F);
	});
	test("the last move short of the release: the release's position wins", () => {
		const { committed, press } = setup();
		press(100, "right");
		fire("mousemove", 90);
		fire("mouseup", 70);
		expect(durationOf(committed)).toBe(35 * F);
	});
	test("a press and a release on the same spot is a click: nothing committed", () => {
		const { committed, press } = setup();
		press(100, "right");
		fire("mouseup", 100);
		expect(committed.length).toBe(0);
	});
});
