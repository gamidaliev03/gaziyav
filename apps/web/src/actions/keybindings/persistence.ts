import type { ShortcutKey } from "@/actions/keybinding";
import { isShortcutKey } from "@/actions/keybinding";
import type { TActionWithOptionalArgs } from "@/actions";
import { isActionWithOptionalArgs } from "@/actions";
import { runMigrations } from "./migrations";
import {
	DEFAULT_KEYMAP_PRESET,
	isKeymapPresetId,
	type KeymapPresetId,
} from "./presets";
import {
	getPersistedKeybindingsState,
	type PersistedKeybindingsState,
} from "./persisted-state";

export interface DecodedKeybindingsState {
	keybindings: Map<ShortcutKey, TActionWithOptionalArgs>;
	isCustomized: boolean;
	preset?: KeymapPresetId;
	/** The preset's actions the saved table was offered; absent for tables saved before the rule. */
	offered?: string[];
}

/** Defaults born after the last migration (v17) and before the rule below: tables saved before it never saw them. */
const BORN_BEFORE_THE_RULE: ReadonlySet<string> = new Set(["lipsync-open"]);

/**
 * New default keys reach a customized table (the general rule, lipc 14.11): a preset action the table was never offered
 * gets its preset keys that are free there. A key the user gave to something else stays theirs; an action they unbound
 * after it was offered stays unbound. `offered` absent (saved before the rule): every shipped action but the newest.
 */
export function withNewDefaults({
	keybindings,
	shipped,
	offered,
}: {
	keybindings: Map<ShortcutKey, TActionWithOptionalArgs>;
	shipped: Map<ShortcutKey, TActionWithOptionalArgs>;
	offered?: readonly string[];
}): Map<ShortcutKey, TActionWithOptionalArgs> {
	const seen = new Set(offered ?? [...shipped.values()].filter((a) => !BORN_BEFORE_THE_RULE.has(a)));
	const bound = new Set(keybindings.values());
	const out = new Map(keybindings);
	for (const [key, action] of shipped) {
		if (seen.has(action) || bound.has(action) || out.has(key)) continue;
		out.set(key, action);
	}
	return out;
}

export function serializeKeybindingsState({
	keybindings,
	isCustomized,
	preset = DEFAULT_KEYMAP_PRESET,
}: DecodedKeybindingsState): PersistedKeybindingsState {
	return {
		keybindings: Object.fromEntries(keybindings),
		isCustomized,
		preset,
	};
}

export function migratePersistedKeybindingsState({
	state,
	fromVersion,
}: {
	state: unknown;
	fromVersion: number;
}): unknown {
	return runMigrations({ state, fromVersion });
}

/**
 * Decode a persisted/migrated keybindings blob into the in-memory shape.
 *
 * Lossy by design: invalid entries are dropped and a warning is emitted, so the
 * user falls back to (mostly) sensible defaults instead of a broken store.
 * Returns `null` if the top-level shape is unrecognizable, in which case the
 * caller should keep its current state.
 */
export function decodePersistedKeybindingsState({
	state,
}: {
	state: unknown;
}): DecodedKeybindingsState | null {
	const persisted = getPersistedKeybindingsState({ state });
	if (!persisted) {
		console.warn(
			"[keybindings] Persisted state has unexpected shape; keeping current keybindings.",
			state,
		);
		return null;
	}

	const keybindings = new Map<ShortcutKey, TActionWithOptionalArgs>();
	const dropped: Array<{ key: string; action: string | undefined }> = [];
	for (const [key, action] of Object.entries(persisted.keybindings)) {
		if (action === undefined) continue;
		if (!isShortcutKey(key) || !isActionWithOptionalArgs(action)) {
			dropped.push({ key, action });
			continue;
		}

		keybindings.set(key, action);
	}

	if (dropped.length > 0) {
		console.warn(
			"[keybindings] Dropped invalid persisted entries:",
			dropped,
		);
	}

	return {
		keybindings,
		isCustomized: persisted.isCustomized,
		preset: isKeymapPresetId(persisted.preset)
			? persisted.preset
			: DEFAULT_KEYMAP_PRESET,
		...(persisted.offered ? { offered: persisted.offered } : {}),
	};
}

/**
 * Parse a user-supplied keybindings configuration (typically the output of
 * `JSON.parse` on an imported file).
 *
 * Strict by design: throws on the first invalid entry so the caller can surface
 * the failure to the user instead of silently producing a half-applied import.
 * Accepts `unknown` because the input has already crossed a trust boundary.
 */
export function parseImportedKeybindings({
	config,
}: {
	config: unknown;
}): Map<ShortcutKey, TActionWithOptionalArgs> {
	if (typeof config !== "object" || config === null || Array.isArray(config)) {
		throw new Error("Imported keybindings must be a JSON object");
	}

	const result = new Map<ShortcutKey, TActionWithOptionalArgs>();
	for (const [key, action] of Object.entries(config)) {
		if (action === undefined) continue;
		if (typeof action !== "string") {
			throw new Error(
				`Invalid action for "${key}": expected string, got ${typeof action}`,
			);
		}
		if (!isShortcutKey(key)) {
			throw new Error(`Invalid shortcut key: ${JSON.stringify(key)}`);
		}
		if (!isActionWithOptionalArgs(action)) {
			throw new Error(
				`Invalid action for "${key}": ${JSON.stringify(action)}`,
			);
		}
		result.set(key, action);
	}
	return result;
}
