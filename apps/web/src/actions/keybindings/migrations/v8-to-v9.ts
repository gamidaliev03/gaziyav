import { getPersistedKeybindingsState } from "../persisted-state";
import { DEFAULT_KEYMAP_PRESET, getPresetBindings } from "../presets";

/**
 * v8 → v9: one-time switch of every existing keymap to the «Kadr» preset.
 *
 * v7→v8 kept keymaps flagged `isCustomized` (the flag was set by the old dialog even
 * without real changes), so users kept "s" = split and never got ⌘B. From v9 on,
 * customizing happens in the new Keyboard Shortcuts dialog.
 */
export function v8ToV9({ state }: { state: unknown }): unknown {
	if (!getPersistedKeybindingsState({ state })) return state;
	return {
		keybindings: Object.fromEntries(getPresetBindings({ preset: DEFAULT_KEYMAP_PRESET })),
		isCustomized: false,
		preset: DEFAULT_KEYMAP_PRESET,
	};
}
