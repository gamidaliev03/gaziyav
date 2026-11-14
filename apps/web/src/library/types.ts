// Shared between the library server and the Sounds panel.
export type LibraryKind = "sfx" | "music";
export type LibrarySource = "bundled" | "kadr" | "lipsync";

export interface LibraryItem {
	/** Stable id; the file is served at /api/library/file/<id>. */
	id: string;
	kind: LibraryKind;
	name: string;
	/** Category key (see categoryLabel); folder name for local libraries. */
	cat: string;
	tags: string[];
	/** Seconds. */
	dur: number;
	src: LibrarySource;
	/** The file isn't on this Mac yet: it downloads when first played or added (then it is cached). */
	remote?: boolean;
	/** The preview wave: 48 heights 0–255, base64. */
	peaks?: string;
	/** 1–20 for the most used items (downloaded in the background when the Audio tab opens). */
	top?: number;
	/** Who made it (shown on the row: CC BY music names its author). */
	artist?: string;
	/** Its licence, in a line (shown on hover). */
	license?: string;
	/** dB that brings it to the library\'s level (library/gain.ts); played and placed with it. */
	gain?: number;
}

export interface LibraryIndex {
	items: LibraryItem[];
	/** Where items come from, for the empty-state hint. */
	sources: Array<{ src: LibrarySource; kind: LibraryKind; count: number }>;
}

export interface FavouriteEntry {
	id: string;
	kind: LibraryKind;
	name: string;
	cat: string;
	dur: number;
	/** Playable URL (the library's file address). */
	url: string;
	addedAt: number;
}

export interface LibraryUserState {
	favourites: FavouriteEntry[];
	recent: FavouriteEntry[];
}

export const libraryFileUrl = (id: string) => `/api/library/file/${encodeURIComponent(id)}`;
