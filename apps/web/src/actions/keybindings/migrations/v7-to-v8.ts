import { buildShortcut, isKey, type Modifier } from "@/actions/keybinding";
import { getPersistedKeybindingsState } from "../persisted-state";
import { isLegacyDefaultKeymap } from "./legacy-defaults";
import { DEFAULT_KEYMAP_PRESET, getPresetBindings } from "../presets";

/**
 * v7 → v8: physical keys, distinct ⌘/⌃ and keymap presets.
 *
 * - Old "ctrl" meant ⌘ on Mac (the platform key) → "cmd". Modifiers are reordered ⌃⌥⇧⌘.
 * - "esc" → "escape", "?" → "shift+/".
 * - Untouched keymaps switch to the «Kadr» preset (the new default).
 * - Customized keymaps keep every binding; Kadr bindings are added only for actions
 *   that have no key yet and only on free keys.
 */
export function convertLegacyShortcut(key: string): string | null {
	if (key === "?") return "shift+/";
	const split = key.lastIndexOf("+");
	const rawKey = split >= 0 ? key.slice(split + 1) : key;
	const rawModifiers = split > 0 ? key.slice(0, split).split("+") : [];
	const normalizedKey = rawKey === "esc" ? "escape" : rawKey;
	if (!isKey(normalizedKey)) return null;
	const modifiers: Modifier[] = [];
	for (const modifier of rawModifiers) {
		if (modifier === "ctrl") modifiers.push("cmd");
		else if (modifier === "alt" || modifier === "shift") modifiers.push(modifier);
		else return null;
	}
	return buildShortcut({ modifiers, key: normalizedKey });
}

export function v7ToV8({ state }: { state: unknown }): unknown {
	const v7 = getPersistedKeybindingsState({ state });
	if (!v7) return state;

	const kadr = getPresetBindings({ preset: DEFAULT_KEYMAP_PRESET });
	// The old dialog set isCustomized without real changes: untouched defaults are not custom.
	if (!v7.isCustomized || isLegacyDefaultKeymap(v7.keybindings)) {
		return {
			keybindings: Object.fromEntries(kadr),
			isCustomized: false,
			preset: DEFAULT_KEYMAP_PRESET,
		};
	}

	const keybindings: Record<string, string> = {};
	for (const [key, action] of Object.entries(v7.keybindings)) {
		if (!action) continue;
		const converted = convertLegacyShortcut(key);
		if (converted) keybindings[converted] = action;
	}
	const boundActions = new Set(Object.values(keybindings));
	for (const [key, action] of kadr) {
		if (boundActions.has(action) || key in keybindings) continue;
		keybindings[key] = action;
	}
	return { keybindings, isCustomized: true, preset: DEFAULT_KEYMAP_PRESET };
}
