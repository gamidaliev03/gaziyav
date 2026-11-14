import type { TActionWithOptionalArgs } from "./types";

/** Focused controls that keep their own arrow / Home / End / Page keys (sliders, tabs, radios, lists…). */
export const OWN_ARROW_ROLES: ReadonlySet<string> = new Set(["slider", "spinbutton", "radio", "tab", "option", "menuitem", "listbox", "tree", "grid", "combobox"]);

/**
 * ⌘ commands that also work while typing in a field (Premiere / FCP do the same): they never edit text, so the field
 * loses nothing. ⌘Z, ⌘A, ⌘C/⌘V/⌘X and plain keys stay the field's.
 */
export const FIELD_SAFE_ACTIONS: ReadonlySet<TActionWithOptionalArgs> = new Set([
	"save-project",
	"export-project",
	"show-shortcuts",
	"new-project",
	"import-media",
	"show-projects",
]);
