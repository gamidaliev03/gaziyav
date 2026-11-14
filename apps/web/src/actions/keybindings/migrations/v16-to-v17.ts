import { getPersistedKeybindingsState } from "../persisted-state";
import { DEFAULT_KEYMAP_PRESET, getPresetBindings, isKeymapPresetId } from "../presets";

/** The trim model's commands (src/timeline/trim): T, the edge keys, «,» «.», the slip keys, + and −. */
const TRIM_COMMANDS: ReadonlySet<string> = new Set([
	"tool-trim",
	// Final Cut's A and B (the Select tool, the Blade): the way back from T in that keymap
	"tool-select",
	"tool-split",
	"trim-select-out",
	"trim-select-in",
	"trim-select-roll",
	"slip-left",
	"slip-right",
	"slip-left-large",
	"slip-right-large",
	"trim-type-plus",
	"trim-type-minus",
	"slip-type-plus",
	"slip-type-minus",
	"trim-play-around",
	"nudge-left",
	"nudge-right",
	"nudge-left-large",
	"nudge-right-large",
]);

/**
 * v16 → v17: the trim model. An unchanged keymap gets its preset's table; a customized one gets each of the trim
 * keys of its preset that is still free (a key the user gave to something else stays theirs).
 */
export function v16ToV17({ state }: { state: unknown }): unknown {
	const persisted = getPersistedKeybindingsState({ state });
	if (!persisted) return state;
	const preset = isKeymapPresetId(persisted.preset) ? persisted.preset : DEFAULT_KEYMAP_PRESET;
	const shipped = getPresetBindings({ preset });
	if (!persisted.isCustomized) return { ...persisted, keybindings: Object.fromEntries(shipped), preset };
	const keybindings: Record<string, string | undefined> = { ...persisted.keybindings };
	for (const [key, action] of shipped) {
		if (TRIM_COMMANDS.has(action) && !(key in keybindings)) keybindings[key] = action;
	}
	return { ...persisted, keybindings };
}
