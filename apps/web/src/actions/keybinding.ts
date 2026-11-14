import type { TActionWithOptionalArgs } from "./types";

/**
 * Shortcut strings are `[ctrl+][alt+][shift+][cmd+]<key>` (Apple order ⌃⌥⇧⌘).
 *
 * - `cmd`   ⌘ Command on macOS, Ctrl elsewhere (the platform's primary modifier).
 * - `ctrl`  ⌃ physical Control on macOS (FCP's ⌃⇧S, ⌃= …). Not produced on other platforms.
 * - `alt`   ⌥ Option / Alt.
 * - `shift` ⇧.
 *
 * Keys are physical (KeyboardEvent.code), so every shortcut works the same on the
 * Russian (ЙЦУКЕН) layout: ⌘B fires on ⌘И, «,» fires on «б», «[» on «х».
 */
const MODIFIER_ORDER = ["ctrl", "alt", "shift", "cmd"] as const;
export type Modifier = (typeof MODIFIER_ORDER)[number];

type ModifierPrefix =
	`${"" | "ctrl+"}${"" | "alt+"}${"" | "shift+"}${"" | "cmd+"}`;

type StripPlus<T> = T extends `${infer M}+` ? M : never;

/** Non-empty modifier combination in canonical order, e.g. "alt+shift+cmd". */
export type ModifierKeys = StripPlus<ModifierPrefix>;

const KEYS = [
	"a", "b", "c", "d", "e", "f", "g", "h", "i", "j",
	"k", "l", "m", "n", "o", "p", "q", "r", "s", "t",
	"u", "v", "w", "x", "y", "z",
	"0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
	"up", "down", "left", "right",
	",", ".", "/", ";", "'", "[", "]", "\\", "=", "-", "`",
	"enter", "tab", "space", "escape",
	"backspace", "delete", "home", "end", "pageup", "pagedown",
	"f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
] as const;

export type Key = (typeof KEYS)[number];

const KEY_SET: ReadonlySet<string> = new Set(KEYS);

export function isKey(value: string): value is Key {
	return KEY_SET.has(value);
}

export type ModifierBasedShortcutKey = `${ModifierKeys}+${Key}`;
// Singular keybindings (these will be disabled when an input-ish area has been focused)
export type SingleCharacterShortcutKey = `${Key}`;

export type ShortcutKey = ModifierBasedShortcutKey | SingleCharacterShortcutKey;

/** Splits "alt+shift+cmd+=" into modifiers and key ("+" itself is never a key). */
export function parseShortcut(
	value: string,
): { modifiers: Modifier[]; key: string } | null {
	if (value.length === 0) return null;
	const split = value.lastIndexOf("+");
	if (split === value.length - 1) return null;
	if (split < 0) return { modifiers: [], key: value };
	if (split === 0) return null;
	const modifiers = value.slice(0, split).split("+");
	if (!modifiers.every((m): m is Modifier => isModifier(m))) return null;
	return { modifiers, key: value.slice(split + 1) };
}

function isModifier(value: string): value is Modifier {
	return (MODIFIER_ORDER as readonly string[]).includes(value);
}

/** Builds a canonical shortcut string (modifiers sorted ⌃⌥⇧⌘, deduplicated). */
export function buildShortcut({
	modifiers,
	key,
}: {
	modifiers: Iterable<Modifier>;
	key: Key;
}): ShortcutKey {
	const set = new Set(modifiers);
	const prefix = MODIFIER_ORDER.filter((m) => set.has(m))
		.map((m) => `${m}+`)
		.join("");
	// The template literal type above is exactly this concatenation.
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
	return `${prefix}${key}` as ShortcutKey;
}

export function isShortcutKey(value: string): value is ShortcutKey {
	const parsed = parseShortcut(value);
	if (!parsed || !isKey(parsed.key)) return false;
	// Must be canonical: ordered, no duplicates.
	return buildShortcut({ modifiers: parsed.modifiers, key: parsed.key }) === value;
}

export type KeybindingConfig = {
	[key in ShortcutKey]?: TActionWithOptionalArgs;
};

const KEY_GLYPHS: Partial<Record<Key, string>> = {
	up: "↑",
	down: "↓",
	left: "←",
	right: "→",
	enter: "↩",
	tab: "⇥",
	space: "Space",
	escape: "Esc",
	backspace: "⌫",
	delete: "⌦",
	home: "Home",
	end: "End",
	pageup: "PgUp",
	pagedown: "PgDn",
};

const MAC_MODIFIER_GLYPHS: Record<Modifier, string> = {
	ctrl: "⌃",
	alt: "⌥",
	shift: "⇧",
	cmd: "⌘",
};

const PC_MODIFIER_GLYPHS: Record<Modifier, string> = {
	ctrl: "Win",
	alt: "Alt",
	shift: "Shift",
	cmd: "Ctrl",
};

/** Display parts for a shortcut: ["⇧", "⌘", "B"] on Mac, ["Shift", "Ctrl", "B"] elsewhere. */
export function getShortcutParts({
	shortcut,
	isMac = true,
}: {
	shortcut: string;
	isMac?: boolean;
}): string[] {
	const parsed = parseShortcut(shortcut);
	if (!parsed) return [shortcut];
	const glyphs = isMac ? MAC_MODIFIER_GLYPHS : PC_MODIFIER_GLYPHS;
	const key = isKey(parsed.key)
		? (KEY_GLYPHS[parsed.key] ?? parsed.key.toUpperCase())
		: parsed.key;
	return [...parsed.modifiers.map((m) => glyphs[m]), key];
}

/** "⇧⌘B" on Mac, "Shift+Ctrl+B" elsewhere. */
export function formatShortcut({
	shortcut,
	isMac = true,
}: {
	shortcut: string;
	isMac?: boolean;
}): string {
	return getShortcutParts({ shortcut, isMac }).join(isMac ? "" : "+");
}

const CODE_TO_KEY: Record<string, Key> = {
	Comma: ",",
	Period: ".",
	Slash: "/",
	Semicolon: ";",
	Quote: "'",
	BracketLeft: "[",
	BracketRight: "]",
	Backslash: "\\",
	Equal: "=",
	Minus: "-",
	Backquote: "`",
	NumpadAdd: "=",
	NumpadSubtract: "-",
	Space: "space",
	Enter: "enter",
	NumpadEnter: "enter",
	Tab: "tab",
	Escape: "escape",
	Backspace: "backspace",
	Delete: "delete",
	Home: "home",
	End: "end",
	PageUp: "pageup",
	PageDown: "pagedown",
	ArrowUp: "up",
	ArrowDown: "down",
	ArrowLeft: "left",
	ArrowRight: "right",
};

const KEY_NAME_TO_KEY: Record<string, Key> = {
	" ": "space",
	spacebar: "space",
	arrowup: "up",
	arrowdown: "down",
	arrowleft: "left",
	arrowright: "right",
	esc: "escape",
	return: "enter",
	"+": "=",
};

/**
 * The physical key of a keyboard event. Uses `code` (layout independent) and falls
 * back to `key` only for synthetic events without a code.
 */
export function getPhysicalKey(ev: {
	code?: string;
	key?: string;
}): Key | null {
	const code = ev.code ?? "";
	if (code.startsWith("Key") && code.length === 4) {
		const letter = code.slice(3).toLowerCase();
		if (isKey(letter)) return letter;
	}
	if (code.startsWith("Digit") && code.length === 6) {
		const digit = code.slice(5);
		if (isKey(digit)) return digit;
	}
	if (code.startsWith("Numpad") && code.length === 7) {
		const digit = code.slice(6);
		if (isKey(digit)) return digit;
	}
	if (/^F([1-9]|1[0-2])$/.test(code)) {
		const fn = code.toLowerCase();
		if (isKey(fn)) return fn;
	}
	const fromCode = CODE_TO_KEY[code];
	if (fromCode) return fromCode;
	if (code) return null;

	const raw = (ev.key ?? "").toLowerCase();
	const named = KEY_NAME_TO_KEY[raw];
	if (named) return named;
	return isKey(raw) ? raw : null;
}

/** Modifiers of an event. ⌘ and ⌃ are distinct on Mac; elsewhere Ctrl is `cmd`. */
export function getEventModifiers({
	ev,
	isMac,
}: {
	ev: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean };
	isMac: boolean;
}): Modifier[] {
	const modifiers: Modifier[] = [];
	if (isMac && ev.ctrlKey) modifiers.push("ctrl");
	if (ev.altKey) modifiers.push("alt");
	if (ev.shiftKey) modifiers.push("shift");
	if (isMac ? ev.metaKey : ev.ctrlKey) modifiers.push("cmd");
	return modifiers;
}

/** Canonical shortcut for an event, or null for a lone modifier / unknown key. */
export function getEventShortcut({
	ev,
	isMac,
}: {
	ev: {
		code?: string;
		key?: string;
		metaKey: boolean;
		ctrlKey: boolean;
		altKey: boolean;
		shiftKey: boolean;
	};
	isMac: boolean;
}): ShortcutKey | null {
	const key = getPhysicalKey(ev);
	if (!key) return null;
	return buildShortcut({ modifiers: getEventModifiers({ ev, isMac }), key });
}
