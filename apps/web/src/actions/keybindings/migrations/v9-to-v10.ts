import { getPersistedKeybindingsState } from "../persisted-state";
import { KEYFRAME_KEYS } from "../presets";

/**
 * v9 → v10: the keyframe shortcuts (⌥K, ⌥; / ⌥', F9 family, ⌃⌥H) join every saved keymap, customized or not.
 * A key the user already uses for something else keeps it; an action the user already bound keeps its keys.
 */
export function v9ToV10({ state }: { state: unknown }): unknown {
	const persisted = getPersistedKeybindingsState({ state });
	if (!persisted) return state;
	const keybindings: Record<string, string | undefined> = { ...persisted.keybindings };
	const bound = new Set(Object.values(keybindings));
	for (const [action, keys] of KEYFRAME_KEYS) {
		if (bound.has(action)) continue;
		for (const key of keys) if (!(key in keybindings)) keybindings[key] = action;
	}
	return { ...persisted, keybindings };
}
