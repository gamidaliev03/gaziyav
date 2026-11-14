"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TActionWithOptionalArgs } from "@/actions";
import { isTypableDOMElement } from "@/utils/browser";
import { isAppleDevice } from "@/utils/platform";
import type { KeybindingConfig, ShortcutKey } from "@/actions/keybinding";
import { formatShortcut, getEventShortcut } from "@/actions/keybinding";
import { runMigrations, CURRENT_VERSION } from "./keybindings/migrations";
import { decodePersistedKeybindingsState, withNewDefaults } from "./keybindings/persistence";
import { isSameKeymap } from "./keybindings/shortcuts-editor";
import {
	DEFAULT_KEYMAP_PRESET,
	getPresetBindings,
	type KeymapPresetId,
} from "./keybindings/presets";

export interface KeybindingConflict {
	key: ShortcutKey;
	existingAction: TActionWithOptionalArgs;
	newAction: TActionWithOptionalArgs;
}

interface KeybindingsState {
	keybindings: Map<ShortcutKey, TActionWithOptionalArgs>;
	preset: KeymapPresetId;
	isCustomized: boolean;
	overlayDepth: number;
	openOverlayIds: string[];
	isLoadingProject: boolean;
	isRecording: boolean;

	updateKeybinding: (params: {
		key: ShortcutKey;
		action: TActionWithOptionalArgs;
	}) => void;
	/** Makes `key` the only shortcut of `action` (other actions lose that key). */
	assignKeybinding: (params: {
		key: ShortcutKey;
		action: TActionWithOptionalArgs;
	}) => void;
	clearKeybindingsForAction: (action: TActionWithOptionalArgs) => void;
	removeKeybinding: (key: ShortcutKey) => void;
	applyPreset: (preset: KeymapPresetId) => void;
	/** Save of the Shortcuts window: the edited keymap and its preset; customized when it differs from the preset. */
	saveKeymap: (params: { preset: KeymapPresetId; keybindings: Map<ShortcutKey, TActionWithOptionalArgs> }) => void;
	resetToDefaults: () => void;
	importKeybindings: (config: KeybindingConfig) => void;
	exportKeybindings: () => Record<string, TActionWithOptionalArgs>;
	openOverlay: (overlayId: string) => void;
	closeOverlay: (overlayId: string) => void;
	setLoadingProject: (loading: boolean) => void;
	setIsRecording: (isRecording: boolean) => void;
	validateKeybinding: (params: {
		key: ShortcutKey;
		action: TActionWithOptionalArgs;
	}) => KeybindingConflict | null;
	getKeybindingsForAction: (action: TActionWithOptionalArgs) => ShortcutKey[];
	getKeybindingString: (ev: KeyboardEvent) => ShortcutKey | null;
}

type PersistedState = {
	keybindings: Record<string, TActionWithOptionalArgs>;
	isCustomized: boolean;
	preset: KeymapPresetId;
	offered: string[];
};

function isDOMElement(element: EventTarget | null): element is HTMLElement {
	return element instanceof HTMLElement;
}

export const useKeybindingsStore = create<KeybindingsState>()(
	persist(
		(set, get) => ({
			keybindings: getPresetBindings({ preset: DEFAULT_KEYMAP_PRESET }),
			preset: DEFAULT_KEYMAP_PRESET,
			isCustomized: false,
			overlayDepth: 0,
			openOverlayIds: [],
			isLoadingProject: false,
			isRecording: false,

			openOverlay: (overlayId) =>
				set((s) => {
					const openOverlayIds = s.openOverlayIds.includes(overlayId)
						? s.openOverlayIds
						: [...s.openOverlayIds, overlayId];
					return {
						openOverlayIds,
						overlayDepth: openOverlayIds.length,
					};
				}),
			closeOverlay: (overlayId) =>
				set((s) => {
					const openOverlayIds = s.openOverlayIds.filter(
						(id) => id !== overlayId,
					);
					return {
						openOverlayIds,
						overlayDepth: openOverlayIds.length,
					};
				}),
			setLoadingProject: (loading) => {
				set({ isLoadingProject: loading });
			},

			updateKeybinding: ({ key, action }) => {
				set((state) => {
					const next = new Map(state.keybindings);
					next.set(key, action);
					return {
						keybindings: next,
						isCustomized: true,
					};
				});
			},

			assignKeybinding: ({ key, action }) => {
				set((state) => {
					const next = new Map(state.keybindings);
					for (const [existingKey, bound] of state.keybindings) {
						if (bound === action) next.delete(existingKey);
					}
					next.set(key, action);
					return { keybindings: next, isCustomized: true };
				});
			},

			clearKeybindingsForAction: (action) => {
				set((state) => {
					const next = new Map(state.keybindings);
					for (const [key, bound] of state.keybindings) {
						if (bound === action) next.delete(key);
					}
					return { keybindings: next, isCustomized: true };
				});
			},

			removeKeybinding: (key) => {
				set((state) => {
					const next = new Map(state.keybindings);
					next.delete(key);
					return {
						keybindings: next,
						isCustomized: true,
					};
				});
			},

			applyPreset: (preset) => {
				set({
					preset,
					keybindings: getPresetBindings({ preset }),
					isCustomized: false,
				});
			},

			saveKeymap: ({ preset, keybindings }) => {
				set({
					preset,
					keybindings: new Map(keybindings),
					isCustomized: !isSameKeymap(keybindings, getPresetBindings({ preset })),
				});
			},

			resetToDefaults: () => {
				set({
					keybindings: getPresetBindings({ preset: get().preset }),
					isCustomized: false,
				});
			},

			importKeybindings: (config) => {
				const next = new Map<ShortcutKey, TActionWithOptionalArgs>();
				for (const [key, action] of Object.entries(config)) {
					if (typeof key !== "string" || key.length === 0) {
						throw new Error(`Invalid key format: ${key}`);
					}
					if (action !== undefined) {
						// Public type's keys are `ShortcutKey`; trust the caller's typing.
						// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
						next.set(key as ShortcutKey, action);
					}
				}
				set({
					keybindings: next,
					isCustomized: true,
				});
			},

			exportKeybindings: () => {
				return Object.fromEntries(get().keybindings);
			},

			validateKeybinding: ({ key, action }) => {
				const existingAction = get().keybindings.get(key);
				if (existingAction && existingAction !== action) {
					return {
						key,
						existingAction,
						newAction: action,
					};
				}
				return null;
			},
			setIsRecording: (isRecording) => {
				set({ isRecording });
			},

			getKeybindingsForAction: (action) => {
				const result: ShortcutKey[] = [];
				for (const [key, mapped] of get().keybindings) {
					if (mapped === action) result.push(key);
				}
				return result;
			},

			getKeybindingString: (ev) => generateKeybindingString(ev),
		}),
		{
			name: "opencut-keybindings",
			version: CURRENT_VERSION,
			partialize: (state): PersistedState => ({
				keybindings: Object.fromEntries(state.keybindings),
				isCustomized: state.isCustomized,
				preset: state.preset,
				// every action of its preset has been offered to the table by now (merge adds the new ones)
				offered: [...new Set(getPresetBindings({ preset: state.preset }).values())],
			}),
			migrate: (persisted, version) =>
				runMigrations({ state: persisted, fromVersion: version }),
			merge: (persisted, current) => {
				if (persisted === undefined || persisted === null) return current;
				const decoded = decodePersistedKeybindingsState({ state: persisted });
				if (!decoded) return current;
				const preset = decoded.preset ?? DEFAULT_KEYMAP_PRESET;
				return {
					...current,
					// An untouched keymap always follows the preset as shipped, so new keys
					// in a preset reach existing users without another migration.
					keybindings: decoded.isCustomized
						? withNewDefaults({ keybindings: settingsKeyFree(decoded.keybindings), shipped: getPresetBindings({ preset }), offered: decoded.offered })
						: getPresetBindings({ preset }),
					isCustomized: decoded.isCustomized,
					preset,
				};
			},
		},
	),
);

/**
 * Shortcut for a key event, matched by physical key (event.code), so it is the same
 * on the Russian layout. Plain and ⇧ keys are ignored while typing in a field.
 */
export function generateKeybindingString(
	ev: KeyboardEvent,
	isMac: boolean = isAppleDevice(),
): ShortcutKey | null {
	const shortcut = getEventShortcut({ ev, isMac });
	if (!shortcut) return null;

	const target = ev.target;
	const isTyping = isDOMElement(target) && isTypableDOMElement({ element: target });
	const hasCommandModifier =
		shortcut.includes("cmd+") || shortcut.includes("ctrl+") || shortcut.includes("alt+");
	if (isTyping && !hasCommandModifier) return null;

	return shortcut;
}

/** ⌘, is the Mac's Settings key (the menu bar, register C3): a saved keymap's CapCut volume keys ⌘, / ⌘. move to
 * their new pair ⌥⌘, / ⌥⌘. (presets.ts) where those are free. */
function settingsKeyFree(keys: Map<ShortcutKey, TActionWithOptionalArgs>): Map<ShortcutKey, TActionWithOptionalArgs> {
	if (keys.get("cmd+," as ShortcutKey) !== "volume-down") return keys;
	const next = new Map(keys);
	next.delete("cmd+," as ShortcutKey);
	if (!next.has("alt+cmd+," as ShortcutKey)) next.set("alt+cmd+," as ShortcutKey, "volume-down");
	if (next.get("cmd+." as ShortcutKey) === "volume-up" && !next.has("alt+cmd+." as ShortcutKey)) {
		next.delete("cmd+." as ShortcutKey);
		next.set("alt+cmd+." as ShortcutKey, "volume-up");
	}
	return next;
}

/** First shortcut of `action` in the current keymap, formatted («⇧⌘B»), or "". For menus. */
export function getActionShortcutLabel({
	action,
}: {
	action: TActionWithOptionalArgs;
}): string {
	for (const [key, bound] of useKeybindingsStore.getState().keybindings) {
		if (bound === action) return formatShortcut({ shortcut: key, isMac: isAppleDevice() });
	}
	return "";
}
