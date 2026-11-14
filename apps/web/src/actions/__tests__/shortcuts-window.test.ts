import { beforeAll, describe, expect, test } from "bun:test";
import type { ShortcutKey } from "@/actions/keybinding";
import type { TActionWithOptionalArgs } from "@/actions/types";

// K2: the Shortcuts window as in CapCut — tabs Timeline / Player / Basic / Other, a preset list, click a row to rebind,
// «%1 shortcut already belongs to %2. Override it?», Reset, Save / Cancel.
let editor: typeof import("@/actions/keybindings/shortcuts-editor");
let presets: typeof import("@/actions/keybindings/presets");
let definitions: typeof import("@/actions/definitions");
let store: typeof import("@/actions/keybindings-store");

beforeAll(async () => {
	editor = await import("@/actions/keybindings/shortcuts-editor");
	presets = await import("@/actions/keybindings/presets");
	definitions = await import("@/actions/definitions");
	store = await import("@/actions/keybindings-store");
});

const keymap = (entries: Array<[string, string]>) => new Map(entries as Array<[ShortcutKey, TActionWithOptionalArgs]>);

describe("tabs", () => {
	test("every command is in exactly one of CapCut's four tabs", () => {
		const listed = definitions.getListedActions();
		const inTabs = editor.SHORTCUT_TABS.flatMap(({ id }) => editor.getTabActions(id));
		expect(inTabs.sort()).toEqual([...listed].sort());
		expect(editor.SHORTCUT_TABS.map((tab) => tab.label)).toEqual(["Timeline", "Player", "Basic", "Other"]);
	});

	test("the commands sit where CapCut has them", () => {
		const tabOf = (action: string) => editor.getShortcutTab(action as TActionWithOptionalArgs);
		for (const action of ["split", "split-all", "split-left", "shuttle-stop", "shuttle-forward", "toggle-ripple-editing", "toggle-snapping", "timeline-zoom-in", "toggle-keyframe-panel", "toggle-keyframe", "keyframe-ease"]) {
			expect([action, tabOf(action)]).toEqual([action, "timeline"]);
		}
		for (const action of ["toggle-play", "frame-step-forward", "goto-start", "player-zoom-in", "player-fullscreen", "toggle-guides", "toggle-rulers"]) {
			expect([action, tabOf(action)]).toEqual([action, "player"]);
		}
		for (const action of ["undo", "redo", "copy-selected", "paste-copied", "select-all", "delete-selected", "export-project", "import-media", "new-project"]) {
			expect([action, tabOf(action)]).toEqual([action, "basic"]);
		}
		for (const action of ["show-media", "focus-next-panel", "focus-search"]) expect([action, tabOf(action)]).toEqual([action, "other"]);
	});
});

describe("rebinding in the window", () => {
	test("a key of another command is a conflict; overriding moves it and the command's old key goes", () => {
		const draft = keymap([
			["cmd+b", "split"],
			["q", "split-left"],
			["w", "split-right"],
		]);
		expect(editor.findConflict({ keymap: draft, key: "q" as ShortcutKey, action: "split" })).toBe("split-left");
		expect(editor.findConflict({ keymap: draft, key: "cmd+b" as ShortcutKey, action: "split" })).toBeNull();
		expect(editor.findConflict({ keymap: draft, key: "x" as ShortcutKey, action: "split" })).toBeNull();
		const next = editor.assignInDraft({ keymap: draft, key: "q" as ShortcutKey, action: "split" });
		expect([...next]).toEqual([
			["w", "split-right"],
			["q", "split"],
		]);
		expect(draft.get("cmd+b" as ShortcutKey)).toBe("split");
		expect([...editor.clearInDraft({ keymap: next, action: "split" })]).toEqual([["w", "split-right"]]);
	});

	test("CapCut refuses a shortcut with every modifier at once", () => {
		expect(editor.validateShortcut("ctrl+alt+shift+cmd+x" as ShortcutKey)).toBe("Too many modifier keys");
		expect(editor.validateShortcut("alt+shift+cmd+x" as ShortcutKey)).toBeNull();
	});

	test("Save keeps the edits and the preset; the keymap is «customized» only when it differs from its preset", () => {
		const { useKeybindingsStore } = store;
		const capcut = presets.getPresetBindings({ preset: "capcut" });
		useKeybindingsStore.getState().saveKeymap({ preset: "capcut", keybindings: capcut });
		expect(useKeybindingsStore.getState().isCustomized).toBe(false);
		const edited = editor.assignInDraft({ keymap: capcut, key: "x" as ShortcutKey, action: "split" });
		useKeybindingsStore.getState().saveKeymap({ preset: "capcut", keybindings: edited });
		expect(useKeybindingsStore.getState().isCustomized).toBe(true);
		expect(useKeybindingsStore.getState().keybindings.get("x" as ShortcutKey)).toBe("split");
		expect(useKeybindingsStore.getState().keybindings.get("cmd+b" as ShortcutKey)).toBeUndefined();
		useKeybindingsStore.getState().saveKeymap({ preset: "finalcut", keybindings: presets.getPresetBindings({ preset: "finalcut" }) });
		expect(useKeybindingsStore.getState().preset).toBe("finalcut");
		expect(useKeybindingsStore.getState().isCustomized).toBe(false);
		expect(editor.isSameKeymap(capcut, presets.getPresetBindings({ preset: "capcut" }))).toBe(true);
		expect(editor.isSameKeymap(capcut, edited)).toBe(false);
	});
});
