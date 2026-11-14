import { ACTIONS, getListedActions, type TActionCategory } from "@/actions/definitions";
import { parseShortcut, type ShortcutKey } from "@/actions/keybinding";
import type { TActionWithOptionalArgs } from "@/actions/types";

/**
 * The Shortcuts window as in CapCut (docs/capcut/screens/shortcuts-window.jpg): tabs Timeline / Player / Basic /
 * Other, a preset list, rows you click to rebind, a conflict question, Reset, and edits that only count after Save.
 * Everything here is pure so the window stays thin and the rules are tested.
 */
export type ShortcutTab = "timeline" | "player" | "basic" | "other";

export const SHORTCUT_TABS: ReadonlyArray<{ id: ShortcutTab; label: string }> = [
	{ id: "timeline", label: "Timeline" },
	{ id: "player", label: "Player" },
	{ id: "basic", label: "Basic" },
	{ id: "other", label: "Other" },
];

/** CapCut's Basic tab: the commands every app has. */
const BASIC_ACTIONS: ReadonlySet<string> = new Set([
	"undo",
	"redo",
	"cut-selected",
	"copy-selected",
	"paste-copied",
	"paste-over",
	"select-all",
	"deselect-all",
	"delete-selected",
	"duplicate-selected",
	"cancel-interaction",
	"new-project",
	"import-media",
	"import-link",
	"export-project",
	"save-project",
	"close-project",
	"show-projects",
	"project-settings",
	"show-shortcuts",
	"volume-up",
	"volume-down",
]);

/** CapCut keeps the shuttle (J K L) in the Timeline tab with the edit tools. */
const TIMELINE_PLAYBACK: ReadonlySet<string> = new Set(["shuttle-backward", "shuttle-stop", "shuttle-forward"]);

export function getShortcutTab(action: TActionWithOptionalArgs): ShortcutTab {
	if (BASIC_ACTIONS.has(action)) return "basic";
	const category = ACTIONS[action].category as TActionCategory;
	if (category === "player" || (category === "playback" && !TIMELINE_PLAYBACK.has(action))) return "player";
	if (category === "view" || category === "assets") return "other";
	return "timeline";
}

/** CapCut's own order at the top of a tab (the rest follows in the order of the definitions). */
const TAB_ORDER: Partial<Record<ShortcutTab, readonly string[]>> = {
	timeline: [
		"split",
		"split-all",
		"select-backward",
		"select-forward",
		"toggle-ripple-editing",
		"toggle-snapping",
		"timeline-zoom-in",
		"timeline-zoom-out",
		"timeline-zoom-fit",
		"shuttle-stop",
		"shuttle-forward",
		"shuttle-backward",
		"split-left",
		"split-right",
		"toggle-keyframe-panel",
		"toggle-keyframe",
		"keyframe-ease-in",
		"keyframe-ease-out",
		"keyframe-ease",
		"keyframe-linear",
	],
	player: ["toggle-play", "frame-step-backward", "frame-step-forward", "frame-step-backward-large", "frame-step-forward-large", "previous-edit", "next-edit", "goto-start", "goto-end", "goto-timecode", "player-fullscreen", "player-zoom-in", "player-zoom-out", "player-zoom-fit", "toggle-guides", "toggle-rulers"],
	basic: ["undo", "redo", "copy-selected", "cut-selected", "paste-copied", "delete-selected", "select-all", "new-project", "import-media", "export-project"],
};

/** The commands of a tab: CapCut's order first (docs/capcut/screens/shortcuts-window.jpg), then the rest. */
export function getTabActions(tab: ShortcutTab): TActionWithOptionalArgs[] {
	const actions = getListedActions().filter((action) => getShortcutTab(action) === tab);
	const order = TAB_ORDER[tab] ?? [];
	const rank = (action: string) => {
		const index = order.indexOf(action);
		return index < 0 ? order.length : index;
	};
	return actions.map((action, index) => ({ action, index })).sort((a, b) => rank(a.action) - rank(b.action) || a.index - b.index).map(({ action }) => action);
}

export function keysByAction(keymap: ReadonlyMap<ShortcutKey, TActionWithOptionalArgs>): Map<TActionWithOptionalArgs, ShortcutKey[]> {
	const map = new Map<TActionWithOptionalArgs, ShortcutKey[]>();
	for (const [key, action] of keymap) map.set(action, [...(map.get(action) ?? []), key]);
	return map;
}

/** The command `key` already belongs to, when it is another one (CapCut: «%1 shortcut already belongs to %2»). */
export function findConflict({
	keymap,
	key,
	action,
}: {
	keymap: ReadonlyMap<ShortcutKey, TActionWithOptionalArgs>;
	key: ShortcutKey;
	action: TActionWithOptionalArgs;
}): TActionWithOptionalArgs | null {
	const owner = keymap.get(key);
	return owner && owner !== action ? owner : null;
}

/** A rebind in the draft: `key` becomes the command's only key and leaves the command that had it. */
export function assignInDraft({
	keymap,
	key,
	action,
}: {
	keymap: ReadonlyMap<ShortcutKey, TActionWithOptionalArgs>;
	key: ShortcutKey;
	action: TActionWithOptionalArgs;
}): Map<ShortcutKey, TActionWithOptionalArgs> {
	const next = new Map([...keymap].filter(([existingKey, existingAction]) => existingAction !== action && existingKey !== key));
	next.set(key, action);
	return next;
}

export function clearInDraft({
	keymap,
	action,
}: {
	keymap: ReadonlyMap<ShortcutKey, TActionWithOptionalArgs>;
	action: TActionWithOptionalArgs;
}): Map<ShortcutKey, TActionWithOptionalArgs> {
	return new Map([...keymap].filter(([, existingAction]) => existingAction !== action));
}

/** CapCut refuses a shortcut with every modifier at once («too many modifier keys»). Null when it is fine. */
export function validateShortcut(key: ShortcutKey): string | null {
	const parsed = parseShortcut(key);
	if (!parsed) return "Not a shortcut";
	if (parsed.modifiers.length > 3) return "Too many modifier keys";
	return null;
}

export function isSameKeymap(
	a: ReadonlyMap<ShortcutKey, TActionWithOptionalArgs>,
	b: ReadonlyMap<ShortcutKey, TActionWithOptionalArgs>,
): boolean {
	if (a.size !== b.size) return false;
	for (const [key, action] of a) if (b.get(key) !== action) return false;
	return true;
}
