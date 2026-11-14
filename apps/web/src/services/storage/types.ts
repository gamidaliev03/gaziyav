import type { MediaType } from "@/media/types";
import type {
	TProject,
	TProjectMetadata,
	TTimelineViewState,
} from "@/project/types";
import type { TScene } from "@/timeline";

export interface StorageAdapter<T> {
	get(key: string): Promise<T | null>;
	set(args: { key: string; value: T }): Promise<void>;
	remove(key: string): Promise<void>;
	list(): Promise<string[]>;
	clear(): Promise<void>;
}

export interface MediaAssetData {
	id: string;
	name: string;
	type: MediaType;
	size: number;
	lastModified: number;
	width?: number;
	height?: number;
	duration?: number;
	fps?: number;
	hasAudio?: boolean;
	ephemeral?: boolean;
	thumbnailUrl?: string;
	/** "result" = made by the app (lipsync, voice-over, YouTube piece, AI); shown under Media → Results. */
	origin?: "source" | "result";
	/** The library sound/music URL this file was copied from (a library clip on the timeline shows up in Media). */
	librarySourceUrl?: string;
	/** Where a web image came from (title, author, license, page) — kept for credits. */
	attribution?: { title: string; author: string; license: string; sourceUrl: string };
	/**
	 * A picture made by the app from another media file (src/motion): `of` = that file's media id, covering its
	 * seconds [a, b]; `m` = in-between frames per source frame (smooth slow motion; 1 = none), written at `fps`;
	 * `reverse` = played backwards. Hidden from the media pool; the original file is never changed.
	 */
	motionProxy?: { of: string; a: number; b: number; m: number; fps: number; reverse?: boolean; v?: number };
	/**
	 * The user's own file behind an editing copy (`of` = the asset whose `file` is the copy): the preview, scrubbing
	 * and thumbnails use the copy (smooth), the export renders from this one (no extra generation of compression, no
	 * 10 → 8 bits). Never in the media pool; removed with that asset.
	 */
	editingOriginalOf?: string;
	/** Made by an on-device AI effect (Effects → AI) from other media of the project. */
	neural?: NeuralAssetInfo;
	/**
	 * The user's own file this one was imported from (the Mac app only, GaziyavShell modules/originals.js): where it is,
	 * its size and date at the import, its number on its disk (found again after a rename or a move on that disk).
	 */
	source?: ImportSource;
	/**
	 * Used where it is (the owner, 11.11: no copy of the user's files in the project): only this line is stored, the
	 * file is handed to the window from `source` at each open. Without it the project holds its own copy (every project
	 * made before, files from removable media or a temporary folder, and files made by the app). A copy of a file with a
	 * `source` is listed BEFORE it is written: one a crash cut short is made again from the original at the next open.
	 */
	inPlace?: boolean;
}

export interface ImportSource {
	path: string;
	size: number;
	lastModified: number;
	dev?: number;
	ino?: number;
}

export interface NeuralAssetInfo {
	/** Catalog id, e.g. "ai.removeBackground". */
	effect: string;
	/** Cache key of the result (the same clip + settings give the same key). */
	key: string;
	/** "Remove Background · Transparent". */
	label: string;
	params: Record<string, string | number | boolean>;
	/** The media it was made from, and the user's own file at the start of the chain (never modified). */
	sourceId: string;
	originalId: string;
	/** Seconds into the source where this result starts (a clip's trims shift by it). */
	offset: number;
	/** Remove Background is made fast first (balanced); the accurate copy, when ready, is used at export. */
	quality?: "balanced" | "accurate";
	exportId?: string;
}

export type SerializedScene = Omit<TScene, "createdAt" | "updatedAt"> & {
	createdAt: string;
	updatedAt: string;
};

export type SerializedProjectMetadata = Omit<
	TProjectMetadata,
	"createdAt" | "updatedAt" | "trashedAt" | "thumbnailAt"
> & {
	createdAt: string;
	updatedAt: string;
	trashedAt?: string;
	thumbnailAt?: string;
	renamed?: boolean;
};

export type SerializedProject = Omit<TProject, "metadata" | "scenes"> & {
	metadata: SerializedProjectMetadata;
	scenes: SerializedScene[];
	timelineViewState?: TTimelineViewState;
};

export interface StorageConfig {
	projectsDb: string;
	mediaDb: string;
	savedSoundsDb: string;
	version: number;
}

// TypeScript type augmentation to add async iterator methods to FileSystemDirectoryHandle
// These methods are part of the File System Access API spec but may not be in all type definitions
declare global {
	interface FileSystemDirectoryHandle {
		keys(): AsyncIterableIterator<string>;
		values(): AsyncIterableIterator<FileSystemHandle>;
		entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
	}
}
