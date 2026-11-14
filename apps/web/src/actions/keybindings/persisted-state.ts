export type PersistedKeybindingConfig = Record<string, string | undefined>;

export interface PersistedKeybindingsState {
	keybindings: PersistedKeybindingConfig;
	isCustomized: boolean;
	/** Keymap preset id (v8+). */
	preset?: string;
	/** The preset's actions this table was offered (lipc, 14.11): a default born later joins a customized table. */
	offered?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getPersistedKeybindingsState({
	state,
}: {
	state: unknown;
}): PersistedKeybindingsState | null {
	if (!isRecord(state)) return null;

	const { keybindings, isCustomized, preset, offered } = state;
	if (!isRecord(keybindings) || typeof isCustomized !== "boolean") {
		return null;
	}

	const normalizedKeybindings: PersistedKeybindingConfig = {};
	for (const [key, action] of Object.entries(keybindings)) {
		if (action !== undefined && typeof action !== "string") {
			return null;
		}

		normalizedKeybindings[key] = action;
	}

	return {
		keybindings: normalizedKeybindings,
		isCustomized,
		...(typeof preset === "string" ? { preset } : {}),
		...(Array.isArray(offered) && offered.every((x) => typeof x === "string") ? { offered: offered as string[] } : {}),
	};
}
