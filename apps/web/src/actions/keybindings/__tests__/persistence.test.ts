import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import {
	decodePersistedKeybindingsState,
	migratePersistedKeybindingsState,
	parseImportedKeybindings,
	serializeKeybindingsState,
} from "../persistence";
import { v7ToV8 } from "../migrations/v7-to-v8";

describe("keybinding persistence", () => {
	let warnSpy: ReturnType<typeof mock>;
	let originalWarn: typeof console.warn;

	beforeEach(() => {
		originalWarn = console.warn;
		warnSpy = mock(() => {});
		console.warn = warnSpy;
	});

	afterEach(() => {
		console.warn = originalWarn;
	});

	test("migrates legacy persisted keybindings to the default (CapCut) preset", () => {
		const migrated = migratePersistedKeybindingsState({
			state: {
				keybindings: {
					s: "split-selected",
					"ctrl+v": "paste-selected",
				},
				isCustomized: true,
			},
			fromVersion: 2,
		});

		const decoded = decodePersistedKeybindingsState({ state: migrated });
		expect(decoded).not.toBeNull();
		if (!decoded) throw new Error("Expected migrated keybindings to decode");

		// v9 switched every existing keymap to «Kadr» once; v13 moves an unchanged «Kadr» (now «Legacy») to «CapCut».
		expect(decoded.isCustomized).toBe(false);
		expect(decoded.preset).toBe("capcut");
		expect(decoded.keybindings.get("cmd+b")).toBe("split");
		expect(decoded.keybindings.get("cmd+v")).toBe("paste-copied");
		expect(decoded.keybindings.get("n")).toBe("toggle-snapping");
		expect(decoded.keybindings.get("s")).toBe("toggle-preview-axis");
		expect(decoded.keybindings.get("escape")).toBe("cancel-interaction");
		expect(warnSpy).not.toHaveBeenCalled();
	});

	test("v7 legacy defaults flagged as customized get ⌘B = split", () => {
		const legacyDefaults = {
			space: "toggle-play",
			k: "toggle-play",
			l: "seek-forward",
			j: "seek-backward",
			right: "frame-step-forward",
			left: "frame-step-backward",
			"shift+right": "jump-forward",
			"shift+left": "jump-backward",
			home: "goto-start",
			enter: "goto-start",
			end: "goto-end",
			s: "split",
			q: "split-left",
			w: "split-right",
			backspace: "delete-selected",
			delete: "delete-selected",
			"ctrl+c": "copy-selected",
			"ctrl+v": "paste-copied",
			n: "toggle-snapping",
			"ctrl+a": "select-all",
			escape: "cancel-interaction",
			"ctrl+d": "duplicate-selected",
			"ctrl+z": "undo",
			"ctrl+shift+z": "redo",
			"ctrl+y": "redo",
		};
		for (const fromVersion of [7, 8]) {
			const migrated = migratePersistedKeybindingsState({
				state: { keybindings: legacyDefaults, isCustomized: true },
				fromVersion,
			});
			const decoded = decodePersistedKeybindingsState({ state: migrated });
			if (!decoded) throw new Error("Expected migrated keybindings to decode");
			expect(decoded.keybindings.get("cmd+b")).toBe("split");
			expect(decoded.keybindings.get("j")).toBe("shuttle-backward");
			expect(decoded.keybindings.get("n")).toBe("toggle-snapping");
			expect(decoded.isCustomized).toBe(false);
		}
	});

	test("v7→v8 alone keeps a really customized keymap", () => {
		const migrated = v7ToV8({
			state: { keybindings: { x: "split", space: "toggle-play" }, isCustomized: true },
		});
		const decoded = decodePersistedKeybindingsState({ state: migrated });
		if (!decoded) throw new Error("Expected decode");
		expect(decoded.keybindings.get("x")).toBe("split");
		expect(decoded.isCustomized).toBe(true);
	});

	test("filters invalid persisted entries at the boundary and warns", () => {
		const decoded = decodePersistedKeybindingsState({
			state: {
				keybindings: {
					space: "toggle-play",
					"shift+bogus": "toggle-play",
					"ctrl+v": "not-an-action",
				},
				isCustomized: false,
			},
		});

		expect(decoded).not.toBeNull();
		if (!decoded) throw new Error("Expected persisted keybindings to decode");

		expect(Array.from(decoded.keybindings.entries())).toEqual([
			["space", "toggle-play"],
		]);
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});

	test("returns null and warns when persisted shape is unrecognizable", () => {
		const decoded = decodePersistedKeybindingsState({ state: "garbage" });
		expect(decoded).toBeNull();
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});

	test("round-trips actions that have no default shortcut", () => {
		// `stop-playback` is a valid `TActionWithOptionalArgs` but is not in the
		// defaults table; the validator must still accept it.
		const serialized = serializeKeybindingsState({
			keybindings: new Map([
				["space", "toggle-play"],
				["x", "stop-playback"],
				["b", "toggle-bookmark"],
			]),
			isCustomized: true,
		});

		const decoded = decodePersistedKeybindingsState({ state: serialized });
		expect(decoded).not.toBeNull();
		if (!decoded) throw new Error("Expected round-tripped keybindings");

		expect(decoded.keybindings.get("space")).toBe("toggle-play");
		expect(decoded.keybindings.get("x")).toBe("stop-playback");
		expect(decoded.keybindings.get("b")).toBe("toggle-bookmark");
		expect(warnSpy).not.toHaveBeenCalled();
	});
});

describe("parseImportedKeybindings", () => {
	test("accepts a valid configuration", () => {
		const result = parseImportedKeybindings({
			config: {
				space: "toggle-play",
				x: "stop-playback",
			},
		});

		expect(result.get("space")).toBe("toggle-play");
		expect(result.get("x")).toBe("stop-playback");
	});

	test("throws on non-object input", () => {
		expect(() => parseImportedKeybindings({ config: null })).toThrow(
			/JSON object/,
		);
		expect(() => parseImportedKeybindings({ config: [] })).toThrow(
			/JSON object/,
		);
	});

	test("throws on non-string action values", () => {
		expect(() =>
			parseImportedKeybindings({ config: { space: 42 } }),
		).toThrow(/expected string/);
	});

	test("throws on invalid shortcut keys", () => {
		expect(() =>
			parseImportedKeybindings({
				config: { "shift+bogus": "toggle-play" },
			}),
		).toThrow(/shift\+bogus/);
	});

	test("throws on invalid actions", () => {
		expect(() =>
			parseImportedKeybindings({ config: { space: "not-an-action" } }),
		).toThrow(/not-an-action/);
	});
});

describe("new default keys reach a customized table (lipc, 14.11)", () => {
	const { withNewDefaults } = require("../persistence") as typeof import("../persistence");
	const { getPresetBindings } = require("../presets") as typeof import("../presets");
	const shipped = getPresetBindings({ preset: "capcut" });

	test("a table saved before the rule gets ⌥L (Lipsync) when the key is free", () => {
		const mine = new Map(shipped);
		mine.delete("alt+l" as never);
		mine.set("ctrl+shift+9" as never, "toggle-play" as never);
		const out = withNewDefaults({ keybindings: mine, shipped });
		expect(out.get("alt+l" as never)).toBe("lipsync-open" as never);
		expect(out.get("ctrl+shift+9" as never)).toBe("toggle-play" as never);
	});

	test("a key the user gave to something else stays theirs", () => {
		const mine = new Map(shipped);
		mine.set("alt+l" as never, "toggle-play" as never);
		const out = withNewDefaults({ keybindings: mine, shipped });
		expect(out.get("alt+l" as never)).toBe("toggle-play" as never);
		expect([...out.values()].includes("lipsync-open" as never)).toBe(false);
	});

	test("an action offered before and unbound by the user stays unbound; one never offered joins", () => {
		const mine = new Map(shipped);
		mine.delete("alt+l" as never);
		const offered = [...new Set(shipped.values())] as string[];
		expect(withNewDefaults({ keybindings: mine, shipped, offered }).has("alt+l" as never)).toBe(false);
		expect(withNewDefaults({ keybindings: mine, shipped, offered: offered.filter((a) => a !== "lipsync-open") }).get("alt+l" as never)).toBe("lipsync-open" as never);
	});

	test("the offered list survives decoding", () => {
		const decoded = decodePersistedKeybindingsState({ state: { keybindings: { space: "toggle-play" }, isCustomized: true, preset: "capcut", offered: ["toggle-play"] } });
		expect(decoded?.offered).toEqual(["toggle-play"]);
	});
});
