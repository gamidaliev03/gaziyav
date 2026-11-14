import { getPersistedKeybindingsState } from "../persisted-state";
import { DEFAULT_KEYMAP_PRESET, getPresetBindings, isKeymapPresetId } from "../presets";

/**
 * v15 → v16: ⌘S saves the project now (and keeps the moment as a version). An unchanged keymap gets its preset's
 * table; a customized one gets ⌘S only when the key is free and Save has no key of its own.
 */
export function v15ToV16({ state }: { state: unknown }): unknown {
	const persisted = getPersistedKeybindingsState({ state });
	if (!persisted) return state;
	const preset = isKeymapPresetId(persisted.preset) ? persisted.preset : DEFAULT_KEYMAP_PRESET;
	if (!persisted.isCustomized) return { ...persisted, keybindings: Object.fromEntries(getPresetBindings({ preset })), preset };
	const keybindings: Record<string, string | undefined> = { ...persisted.keybindings };
	if (!("cmd+s" in keybindings) && !Object.values(keybindings).includes("save-project")) keybindings["cmd+s"] = "save-project";
	return { ...persisted, keybindings };
}
