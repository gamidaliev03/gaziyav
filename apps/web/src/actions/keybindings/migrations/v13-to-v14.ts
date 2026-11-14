import { getPersistedKeybindingsState } from "../persisted-state";
import { DEFAULT_KEYMAP_PRESET, getPresetBindings, isKeymapPresetId } from "../presets";

/** The edits to the frame from the keyboard: ⌥← / ⌥→ nudge in the CapCut keymaps, ⌥⌘ / ⌥⇧⌘ arrows trim, E extend edit. */
const FRAME_EDIT_COMMANDS: ReadonlySet<string> = new Set([
	"nudge-left",
	"nudge-right",
	"nudge-left-large",
	"nudge-right-large",
	"trim-end-earlier",
	"trim-end-later",
	"trim-start-earlier",
	"trim-start-later",
	"extend-edit",
]);

/**
 * v13 → v14: a customized keymap gets the frame edits on its preset's keys when those are free and the command has
 * none (an unchanged keymap is its preset's table anyway).
 */
export function v13ToV14({ state }: { state: unknown }): unknown {
	const persisted = getPersistedKeybindingsState({ state });
	if (!persisted) return state;
	const preset = isKeymapPresetId(persisted.preset) ? persisted.preset : DEFAULT_KEYMAP_PRESET;
	const keybindings: Record<string, string | undefined> = { ...persisted.keybindings };
	const bound = new Set(Object.values(keybindings));
	for (const [key, action] of getPresetBindings({ preset })) {
		if (FRAME_EDIT_COMMANDS.has(action) && !bound.has(action) && !(key in keybindings)) keybindings[key] = action;
	}
	return { ...persisted, keybindings };
}
