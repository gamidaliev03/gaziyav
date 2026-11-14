/** OpenCut's keymap before v8 (old "ctrl" = ⌘). Used to tell untouched keymaps from custom ones. */
export const LEGACY_DEFAULT_KEYBINDINGS: Readonly<Record<string, string>> = {
	space: "toggle-play",
	k: "toggle-play",
	l: "seek-forward",
	j: "seek-backward",
	right: "frame-step-forward",
	left: "frame-step-backward",
	"shift+right": "jump-forward",
	"shift+left": "jump-backward",
	home: "goto-start",
	enter: "goto-start",
	end: "goto-end",
	s: "split",
	q: "split-left",
	w: "split-right",
	backspace: "delete-selected",
	delete: "delete-selected",
	"ctrl+c": "copy-selected",
	"ctrl+v": "paste-copied",
	n: "toggle-snapping",
	"ctrl+a": "select-all",
	escape: "cancel-interaction",
	"ctrl+d": "duplicate-selected",
	"ctrl+z": "undo",
	"ctrl+shift+z": "redo",
	"ctrl+y": "redo",
};

/** True when every binding is one of the legacy defaults (nothing the user added or moved). */
export function isLegacyDefaultKeymap(
	keybindings: Record<string, string | undefined>,
): boolean {
	return Object.entries(keybindings).every(
		([key, action]) => action === undefined || LEGACY_DEFAULT_KEYBINDINGS[key] === action,
	);
}
