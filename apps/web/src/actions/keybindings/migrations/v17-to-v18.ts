import { getPersistedKeybindingsState } from "../persisted-state";
import { DEFAULT_KEYMAP_PRESET, getPresetBindings, isKeymapPresetId } from "../presets";

/** tlc2: select the previous / next clip (⌘← / ⌘→) and the daily keys (⌃T ⌥F ⌥W ⌥D ⇧V; Final Cut: ⌥F W ⇧V). */
const STEP_COMMANDS: ReadonlySet<string> = new Set([
	"select-previous-clip",
	"select-next-clip",
	"add-title",
	"freeze-frame",
	"insert-at-playhead",
	"duplicate-selected",
	"toggle-elements-muted-selected",
]);

/**
 * v17 → v18: an unchanged keymap gets its preset's table; a customized one gets those keys where they are still free
 * (a key the user gave to something else stays theirs).
 */
export function v17ToV18({ state }: { state: unknown }): unknown {
	const persisted = getPersistedKeybindingsState({ state });
	if (!persisted) return state;
	const preset = isKeymapPresetId(persisted.preset) ? persisted.preset : DEFAULT_KEYMAP_PRESET;
	const shipped = getPresetBindings({ preset });
	if (!persisted.isCustomized) return { ...persisted, keybindings: Object.fromEntries(shipped), preset };
	const keybindings: Record<string, string | undefined> = { ...persisted.keybindings };
	for (const [key, action] of shipped) {
		if (STEP_COMMANDS.has(action) && !(key in keybindings)) keybindings[key] = action;
	}
	return { ...persisted, keybindings };
}
