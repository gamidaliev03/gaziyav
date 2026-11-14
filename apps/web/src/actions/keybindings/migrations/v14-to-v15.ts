import { getPersistedKeybindingsState } from "../persisted-state";
import { DEFAULT_KEYMAP_PRESET, getPresetBindings, isKeymapPresetId } from "../presets";

/**
 * v14 → v15: the keymaps are CapCut and Final Cut Pro only («Legacy» and «Premiere Pro» were removed). An unchanged
 * keymap of a removed preset becomes CapCut's table; a customized one keeps every key of the user's under CapCut.
 */
export function v14ToV15({ state }: { state: unknown }): unknown {
	const persisted = getPersistedKeybindingsState({ state });
	if (!persisted || isKeymapPresetId(persisted.preset)) return state;
	const preset = DEFAULT_KEYMAP_PRESET;
	if (!persisted.isCustomized) return { keybindings: Object.fromEntries(getPresetBindings({ preset })), isCustomized: false, preset };
	return { ...persisted, preset };
}
