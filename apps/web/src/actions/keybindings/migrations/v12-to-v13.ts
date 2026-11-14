import { getPersistedKeybindingsState } from "../persisted-state";
import { getCapCutParityKeys, getPresetBindings, isKeymapPresetId } from "../presets";

/**
 * v12 → v13: CapCut keys are the default. A keymap nobody changed and that used the old default («kadr», now
 * «Legacy») switches to «CapCut»; an unchanged CapCut / Final Cut one gets its preset's new table. A customized
 * keymap keeps every key of the user's and only gets the new commands (player, markers, volume, keyframe panel) on
 * their CapCut keys when those are free.
 */
export function v12ToV13({ state }: { state: unknown }): unknown {
	const persisted = getPersistedKeybindingsState({ state });
	if (!persisted) return state;
	if (!persisted.isCustomized) {
		const preset = isKeymapPresetId(persisted.preset) ? persisted.preset : "capcut";
		return { keybindings: Object.fromEntries(getPresetBindings({ preset })), isCustomized: false, preset };
	}
	const keybindings: Record<string, string | undefined> = { ...persisted.keybindings };
	const bound = new Set(Object.values(keybindings));
	for (const [action, keys] of getCapCutParityKeys()) {
		if (bound.has(action)) continue;
		for (const key of keys) if (!(key in keybindings)) keybindings[key] = action;
	}
	return { ...persisted, keybindings };
}
