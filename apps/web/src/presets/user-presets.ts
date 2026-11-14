// The user's own presets, newest first, kept in this app's profile:
//   - Text tab: AI layers Gaziyav AI designed (the same Remotion layers as an AI Composition) or that the user saved
//     from the timeline, and text clips saved with their look;
//   - Captions tab: caption styles Gaziyav AI made.
// Pure data and a store: no editor imports, so the caption styles and the tests can read it.
import { create } from "zustand";
import type { PropValue } from "@/montage/types";
import type { CaptionStyle } from "@/subtitles/styles";

/** One AI layer of a preset; seconds from the preset's start. */
export interface PresetLayer {
	kind: string;
	from: number;
	to: number;
	props: Record<string, PropValue>;
}

interface PresetBase {
	id: string;
	name: string;
	createdAt: number;
	/** Seconds. */
	duration: number;
}

export interface LayersPreset extends PresetBase {
	type: "layers";
	layers: PresetLayer[];
}

export interface TextStylePreset extends PresetBase {
	type: "text";
	content: string;
	/** Centre as a share of the frame from the middle (−0.5 … 0.5), as the built-in presets place theirs. */
	x: number;
	y: number;
	/** Frame height it was saved on: plate paddings are in canvas pixels and scale to the new frame. */
	canvasHeight: number;
	params: Record<string, PropValue>;
}

export type UserTextPreset = LayersPreset | TextStylePreset;
export type UserCaptionStyle = CaptionStyle & { createdAt: number };

export const USER_PREFIX = "user-" as const;
export const isUserPresetId = (id: string | null | undefined) => !!id?.startsWith(USER_PREFIX);

const KEY = "gaziyav.userPresets";
/** Newest first; older ones go past this many (a Custom layer carries its code, ~10–30 KB). */
const MAX_PER_LIST = 60;

interface Lists {
	text: UserTextPreset[];
	captions: UserCaptionStyle[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);

function isTextPreset(value: unknown): value is UserTextPreset {
	if (!isObject(value) || typeof value.id !== "string" || typeof value.name !== "string") return false;
	if (value.type === "layers") return Array.isArray(value.layers) && value.layers.every((l) => isObject(l) && typeof l.kind === "string" && isObject(l.props));
	return value.type === "text" && isObject(value.params) && typeof value.content === "string";
}

function isCaptionStyle(value: unknown): value is UserCaptionStyle {
	return isObject(value) && isUserPresetId(value.id as string) && typeof value.name === "string" && isObject(value.params) && isObject(value.limits);
}

/** What the profile holds; anything unreadable is left out rather than breaking the tab. */
export function parseStoredPresets(raw: string | null | undefined): Lists {
	try {
		const data = raw ? (JSON.parse(raw) as Partial<Lists>) : {};
		return {
			text: Array.isArray(data.text) ? data.text.filter(isTextPreset) : [],
			captions: Array.isArray(data.captions) ? data.captions.filter(isCaptionStyle) : [],
		};
	} catch {
		return { text: [], captions: [] };
	}
}

function read(): Lists {
	try {
		return parseStoredPresets(globalThis.localStorage?.getItem(KEY));
	} catch {
		return { text: [], captions: [] };
	}
}

function save(lists: Lists): void {
	try {
		globalThis.localStorage?.setItem(KEY, JSON.stringify(lists));
	} catch {}
}

interface Store extends Lists {
	addText: (preset: UserTextPreset) => void;
	addCaption: (style: UserCaptionStyle) => void;
	/** Removes one; returns what is needed to put it back (Undo in the toast). */
	remove: (list: keyof Lists, id: string) => { item: UserTextPreset | UserCaptionStyle; index: number } | null;
	restore: (list: keyof Lists, item: UserTextPreset | UserCaptionStyle, index: number) => void;
}

export const useUserPresets = create<Store>((set, get) => {
	const commit = (next: Lists) => {
		save(next);
		set(next);
	};
	const lists = (): Lists => ({ text: get().text, captions: get().captions });
	return {
		...read(),
		addText: (preset) => commit({ ...lists(), text: [preset, ...get().text.filter((p) => p.id !== preset.id)].slice(0, MAX_PER_LIST) }),
		addCaption: (style) =>
			commit({ ...lists(), captions: [style, ...get().captions.filter((s) => s.id !== style.id)].slice(0, MAX_PER_LIST) }),
		remove: (list, id) => {
			const items = get()[list] as Array<UserTextPreset | UserCaptionStyle>;
			const index = items.findIndex((item) => item.id === id);
			if (index < 0) return null;
			commit({ ...lists(), [list]: items.filter((item) => item.id !== id) });
			return { item: items[index], index };
		},
		restore: (list, item, index) => {
			const items = (get()[list] as Array<UserTextPreset | UserCaptionStyle>).filter((other) => other.id !== item.id);
			items.splice(Math.min(index, items.length), 0, item);
			commit({ ...lists(), [list]: items });
		},
	};
});

/** A user caption style by id (caption clips remember their style id). */
export function findUserCaptionStyle(id: string | null | undefined): UserCaptionStyle | undefined {
	if (!isUserPresetId(id)) return undefined;
	return useUserPresets.getState().captions.find((style) => style.id === id);
}
