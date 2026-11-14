import { describe, expect, test } from "bun:test";
import {
	formatShortcut,
	getEventShortcut,
	isShortcutKey,
} from "@/actions/keybinding";
import {
	getPresetBindings,
	KEYMAP_PRESET_IDS,
	KEYMAP_PRESETS,
} from "@/actions/keybindings/presets";
import { isActionWithOptionalArgs } from "@/actions/definitions";
import { ShuttleController } from "@/actions/shuttle";
import {
	buildAttributesPatch,
	captureAttributes,
	findAdjacentEditPoint,
	getElementsUnderPlayhead,
	nudgeElements,
	rippleDeleteElements,
} from "@/actions/timeline-edits";
import { keepRange, removeRange } from "@/in-out/keep-range";
import { findNextTile } from "@/keyboard/navigation";
import { getRangeSelection } from "@/selection/range-select";
import { resolveInOutRange, useInOutStore } from "@/in-out/store";
import type { SceneTracks, TimelineElement } from "@/timeline/types";

function key(
	code: string,
	mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {},
	keyChar = "",
) {
	return {
		code,
		key: keyChar,
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		...mods,
	};
}

describe("physical keys (Russian layout)", () => {
	test("letters match by code, not by the typed character", () => {
		// ⌘ + the key labelled B/И on the Russian layout.
		expect(getEventShortcut({ ev: key("KeyB", { metaKey: true }, "и"), isMac: true })).toBe("cmd+b");
		for (const [code, ru, expected] of [
			["KeyQ", "й", "q"],
			["KeyW", "ц", "w"],
			["KeyI", "ш", "i"],
			["KeyO", "щ", "o"],
			["KeyM", "ь", "m"],
			["KeyJ", "о", "j"],
			["KeyK", "л", "k"],
			["KeyL", "д", "l"],
		] as const) {
			expect(String(getEventShortcut({ ev: key(code, {}, ru), isMac: true }))).toBe(expected);
		}
	});

	test("punctuation keys by code: , . [ ] ; ' = - \\ /", () => {
		const cases: Array<[string, string, string]> = [
			["Comma", "б", ","],
			["Period", "ю", "."],
			["BracketLeft", "х", "["],
			["BracketRight", "ъ", "]"],
			["Semicolon", "ж", ";"],
			["Quote", "э", "'"],
			["Equal", "=", "="],
			["Minus", "-", "-"],
			["Backslash", "ё", "\\"],
			["Slash", ".", "/"],
		];
		for (const [code, ru, expected] of cases) {
			expect(String(getEventShortcut({ ev: key(code, {}, ru), isMac: true }))).toBe(expected);
		}
		expect(getEventShortcut({ ev: key("Comma", { shiftKey: true }), isMac: true })).toBe("shift+,");
	});

	test("⌘ and ⌃ are distinct on Mac, modifiers in ⌃⌥⇧⌘ order", () => {
		expect(getEventShortcut({ ev: key("KeyS", { ctrlKey: true, shiftKey: true }), isMac: true })).toBe("ctrl+shift+s");
		expect(getEventShortcut({ ev: key("KeyS", { metaKey: true, shiftKey: true }), isMac: true })).toBe("shift+cmd+s");
		expect(getEventShortcut({ ev: key("KeyC", { metaKey: true, altKey: true }), isMac: true })).toBe("alt+cmd+c");
		// Elsewhere Ctrl is the primary modifier.
		expect(getEventShortcut({ ev: key("KeyB", { ctrlKey: true }), isMac: false })).toBe("cmd+b");
		expect(formatShortcut({ shortcut: "alt+shift+cmd+c" })).toBe("⌥⇧⌘C");
		expect(formatShortcut({ shortcut: "ctrl+shift+s" })).toBe("⌃⇧S");
	});

	test("lone modifiers are not shortcuts", () => {
		expect(getEventShortcut({ ev: key("MetaLeft", { metaKey: true }, "Meta"), isMac: true })).toBeNull();
	});
});

describe("presets", () => {
	test("every preset uses canonical keys, real actions and no duplicate keys", () => {
		for (const id of KEYMAP_PRESET_IDS) {
			const seen = new Set<string>();
			for (const [action, keys] of KEYMAP_PRESETS[id].table) {
				expect(isActionWithOptionalArgs(action)).toBe(true);
				for (const shortcut of keys) {
					expect(isShortcutKey(shortcut)).toBe(true);
					expect(seen.has(shortcut)).toBe(false);
					seen.add(shortcut);
				}
			}
		}
	});

});

// --- timeline edits ---------------------------------------------------------

function el(id: string, start: number, duration: number): TimelineElement {
	return {
		id,
		name: id,
		type: "video",
		mediaId: "m",
		startTime: start,
		duration,
		trimStart: 0,
		trimEnd: 0,
		params: { opacity: 1, "transform.scaleX": 1, volume: 1 },
	} as unknown as TimelineElement;
}

function scene(main: TimelineElement[], audio: TimelineElement[] = []): SceneTracks {
	return {
		overlay: [],
		main: { id: "main", name: "Main", type: "video", elements: main, muted: false, hidden: false },
		audio: [{ id: "a1", name: "Audio", type: "audio", elements: audio as never, muted: false }],
	} as unknown as SceneTracks;
}

describe("timeline edits", () => {
	test("ripple delete closes the gap on that track only", () => {
		const tracks = scene([el("a", 0, 100), el("b", 100, 50), el("c", 150, 50)], [el("s", 120, 50)]);
		const next = rippleDeleteElements({ tracks, elements: [{ trackId: "main", elementId: "b" }] });
		expect(next.main.elements.map((e) => [e.id, Number(e.startTime)])).toEqual([
			["a", 0],
			["c", 100],
		]);
		expect(Number(next.audio[0].elements[0].startTime)).toBe(120);
	});

	test("edit points and clip under playhead", () => {
		const tracks = scene([el("a", 0, 100), el("b", 100, 50)], [el("s", 30, 40)]);
		expect(findAdjacentEditPoint({ tracks, time: 50, direction: "next" })).toBe(70);
		expect(findAdjacentEditPoint({ tracks, time: 50, direction: "previous" })).toBe(30);
		expect(findAdjacentEditPoint({ tracks, time: 150, direction: "next" })).toBeNull();
		expect(getElementsUnderPlayhead({ tracks, time: 100 })).toEqual([
			{ trackId: "main", elementId: "b" },
		]);
	});

	test("nudge moves by frames, clamps at 0 and refuses overlaps", () => {
		const tracks = scene([el("a", 10, 50), el("b", 100, 50)]);
		const ref = [{ trackId: "main", elementId: "a" }];
		expect(Number(nudgeElements({ tracks, elements: ref, delta: 5 })?.main.elements[0].startTime)).toBe(15);
		expect(Number(nudgeElements({ tracks, elements: ref, delta: -30 })?.main.elements[0].startTime)).toBe(0);
		expect(nudgeElements({ tracks, elements: ref, delta: 45 })).toBeNull();
	});

	test("paste attributes copies the look, not the content", () => {
		const source = el("a", 0, 10);
		(source.params as Record<string, unknown>).opacity = 0.5;
		const target = el("b", 0, 10);
		const patch = buildAttributesPatch({ source: captureAttributes(source), target });
		expect(patch?.params?.opacity).toBe(0.5);
		expect(buildAttributesPatch({ source: captureAttributes(target), target })).toBeNull();
	});

	test("paste attributes brings the keyframes of what it pastes", () => {
		const fade = { keys: [{ id: "k1", time: 0, value: 1 }, { id: "k2", time: 50, value: 0.2 }] } as never;
		const source = el("a", 0, 100);
		(source.params as Record<string, unknown>).opacity = 1;
		const blur = { id: "fx1", type: "blur", enabled: true, params: { amount: 3 } } as never;
		Object.assign(source, { effects: [blur], animations: { opacity: fade, "effects.fx1.params.amount": fade } });
		const target = el("b", 0, 100);
		(target.params as Record<string, unknown>).opacity = 1;
		(target.params as Record<string, unknown>)["transform.rotate"] = 0;
		Object.assign(target, {
			type: "video",
			effects: [{ id: "fxT", type: "glow", enabled: true, params: { amount: 1 } }],
			animations: { "transform.rotate": fade, "effects.fxT.params.amount": fade },
		});
		Object.assign(source, { type: "video" });
		const patch = buildAttributesPatch({ source: captureAttributes(source), target, newId: () => "fx2" });
		// Same base opacity, but the fade comes along; the effect's keys follow it to its new id.
		expect(patch?.animations?.opacity).toEqual(fade);
		expect(patch?.animations?.["effects.fx2.params.amount"]).toEqual(fade);
		expect(patch?.animations?.["effects.fx1.params.amount"]).toBeUndefined();
		// The target's own effects are replaced, and their keys go with them.
		expect(patch?.animations?.["effects.fxT.params.amount"]).toBeUndefined();
		// Rotation isn't a param of the source: the target keeps its own keys.
		expect(patch?.animations?.["transform.rotate"]).toEqual(fade);

		// A source that holds opacity still removes the target's opacity keys.
		const still = el("c", 0, 100);
		(still.params as Record<string, unknown>).opacity = 1;
		const keyed = el("d", 0, 100);
		(keyed.params as Record<string, unknown>).opacity = 1;
		Object.assign(keyed, { animations: { opacity: fade } });
		const cleared = buildAttributesPatch({ source: captureAttributes(still), target: keyed });
		expect(cleared).not.toBeNull();
		expect(cleared?.animations).toBeUndefined();
		expect("animations" in (cleared ?? {})).toBe(true);

		// The same look pasted again, its channels listed in another order, changes nothing.
		const reordered = el("e", 0, 100);
		(reordered.params as Record<string, unknown>).opacity = 1;
		(reordered.params as Record<string, unknown>)["transform.rotate"] = 0;
		const twoChannels = { opacity: fade, "transform.rotate": fade };
		Object.assign(reordered, { animations: { "transform.rotate": fade, opacity: fade } });
		const look = el("f", 0, 100);
		Object.assign(look, { params: { ...reordered.params }, animations: twoChannels });
		expect(buildAttributesPatch({ source: captureAttributes(look), target: reordered })).toBeNull();
	});
});

describe("In / Out", () => {
	test("store keeps In before Out and resolves the range", () => {
		const store = useInOutStore.getState();
		store.clear();
		store.setIn({ time: 100, projectId: "p" });
		store.setOut({ time: 300, projectId: "p" });
		let { inPoint, outPoint } = useInOutStore.getState();
		expect(resolveInOutRange({ inPoint, outPoint, duration: 1000 })).toEqual({ start: 100, end: 300 });
		// Out before In drops In.
		useInOutStore.getState().setOut({ time: 50, projectId: "p" });
		({ inPoint, outPoint } = useInOutStore.getState());
		expect(inPoint).toBeNull();
		expect(resolveInOutRange({ inPoint, outPoint, duration: 1000 })).toEqual({ start: 0, end: 50 });
		// Another project clears the marks.
		useInOutStore.getState().setIn({ time: 10, projectId: "q" });
		expect(useInOutStore.getState().outPoint).toBeNull();
		useInOutStore.getState().clear();
		({ inPoint, outPoint } = useInOutStore.getState());
		expect(resolveInOutRange({ inPoint, outPoint, duration: 1000 })).toBeNull();
	});

	test("⌥I / ⌥O clear one mark, ⇧I / ⇧O go to it — the same keys in every preset", () => {
		const store = useInOutStore.getState();
		store.setRange({ start: 100, end: 300, projectId: "p" });
		useInOutStore.getState().clearIn();
		expect(useInOutStore.getState()).toMatchObject({ inPoint: null, outPoint: 300 });
		useInOutStore.getState().setIn({ time: 100, projectId: "p" });
		useInOutStore.getState().clearOut();
		expect(useInOutStore.getState()).toMatchObject({ inPoint: 100, outPoint: null });
		useInOutStore.getState().clear();
		for (const preset of KEYMAP_PRESET_IDS) {
			const keys = getPresetBindings({ preset });
			expect([keys.get("alt+i"), keys.get("alt+o"), keys.get("shift+i"), keys.get("shift+o")]).toEqual([
				"clear-in",
				"clear-out",
				"goto-in",
				"goto-out",
			]);
		}
	});

	test("Lift leaves a gap, Extract closes it on every track", () => {
		const tracks = scene([el("a", 0, 100), el("b", 100, 100), el("c", 200, 100)], [el("s", 250, 50)]);
		const lifted = removeRange({ tracks, range: { start: 100, end: 200 }, closeGap: false });
		expect(lifted.main.elements.map((e) => [e.id, Number(e.startTime)])).toEqual([["a", 0], ["c", 200]]);
		const extracted = removeRange({ tracks, range: { start: 100, end: 200 }, closeGap: true });
		expect(extracted.main.elements.map((e) => [e.id, Number(e.startTime)])).toEqual([["a", 0], ["c", 100]]);
		expect(Number(extracted.audio[0].elements[0].startTime)).toBe(150);
	});

	test("keepRange keeps clips inside In→Out and moves them to 0", () => {
		const tracks = scene([el("a", 0, 100), el("b", 100, 100), el("c", 200, 100)]);
		const kept = keepRange({ tracks, range: { start: 100, end: 200 } });
		expect(kept.main.elements.map((e) => [e.id, Number(e.startTime)])).toEqual([["b", 0]]);
	});
});

describe("J/K/L shuttle", () => {
	test("L doubles forward speed, J reverses, K stops; frame loop seeks", () => {
		let time = 1000;
		let playing = false;
		let now = 0;
		const frames: Array<() => void> = [];
		const shuttle = new ShuttleController(
			{
				isPlaying: () => playing,
				play: () => {
					playing = true;
				},
				pause: () => {
					playing = false;
				},
				getTime: () => time,
				seek: (ticks) => {
					time = ticks;
				},
				getDuration: () => 10_000,
				ticksPerSecond: 1000,
				ticksPerFrame: () => 33,
			},
			{
				now: () => now,
				requestFrame: (cb) => frames.push(cb),
				cancelFrame: () => {
					frames.length = 0;
				},
			},
		);
		shuttle.forward();
		expect(playing).toBe(true);
		expect(shuttle.getRate()).toBe(1);
		shuttle.forward();
		expect(shuttle.getRate()).toBe(2);
		expect(playing).toBe(false);
		now = 100;
		frames.shift()?.();
		expect(time).toBe(1200); // 2× for 0.1 s
		shuttle.backward();
		expect(shuttle.getRate()).toBe(-1);
		now = 200;
		frames.shift()?.();
		expect(time).toBe(1100);
		shuttle.backward();
		expect(shuttle.getRate()).toBe(-2);
		shuttle.stop();
		expect(shuttle.getRate()).toBe(0);
	});
});

describe("asset tile navigation", () => {
	test("arrows move by reading order and by rows", () => {
		// 3 columns × 2 rows of 100×60 tiles.
		const tiles = [0, 1, 2, 3, 4, 5].map((i) => ({
			rect: { left: (i % 3) * 110, top: Math.floor(i / 3) * 70, width: 100, height: 60 },
		}));
		expect(findNextTile({ tiles, from: 0, direction: "right" })).toBe(1);
		expect(findNextTile({ tiles, from: 0, direction: "left" })).toBe(0);
		expect(findNextTile({ tiles, from: 1, direction: "down" })).toBe(4);
		expect(findNextTile({ tiles, from: 5, direction: "up" })).toBe(2);
		expect(findNextTile({ tiles, from: 4, direction: "down" })).toBe(4);
		expect(findNextTile({ tiles, from: -1, direction: "down" })).toBe(0);
	});
});

describe("⇧-click range selection", () => {
	test("selects every clip between the anchor and the clicked clip", () => {
		const tracks = scene([el("a", 0, 10), el("b", 10, 10), el("c", 20, 10), el("d", 30, 10)], [el("s", 12, 5), el("t", 35, 10)]);
		const range = getRangeSelection({
			tracks,
			anchor: { trackId: "main", elementId: "b" },
			target: { trackId: "a1", elementId: "s" },
		});
		expect(range.map((r) => r.elementId)).toEqual(["b", "s"]);
		const along = getRangeSelection({
			tracks,
			anchor: { trackId: "main", elementId: "a" },
			target: { trackId: "main", elementId: "c" },
		});
		expect(along.map((r) => r.elementId)).toEqual(["a", "b", "c"]);
		expect(
			getRangeSelection({ tracks, anchor: null, target: { trackId: "main", elementId: "d" } }).map((r) => r.elementId),
		).toEqual(["d"]);
	});
});
