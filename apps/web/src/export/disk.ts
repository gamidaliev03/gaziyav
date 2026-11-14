// A render written straight to a file of the Mac app, so a long video never has to fit in the page's memory. In a plain
// browser there is no such file: `openDiskExport` is null and the render stays in memory.
//
// The file is never written under its final name (GaziyavShell modules/export-save.js): with an «Export to» folder it
// grows beside its place under a hidden part name and gets its name by one rename; else it grows in the app's temp
// folder and is placed the same way once the user has chosen where. A disk that fills up in the middle does not end
// the export: the write waits and goes on when there is room again (export/space.ts).
import type { ExportFileWriter } from "@/export";
import { type Room, whileDiskIsFull } from "./space";

/** The Mac app's side (preload.js `studioApp.exportFile`); every method may be missing in an older shell. */
export interface AppExportFile {
	open: (where?: { folder: string; filename: string } | null) => Promise<string>;
	write: (id: string, position: number, data: Uint8Array) => Promise<void>;
	save: (id: string, filename: string, again?: boolean) => Promise<void>;
	path: (id: string) => Promise<string>;
	moveTo: (id: string, folder: string, filename: string) => Promise<string>;
	discard: (id: string) => Promise<void>;
	room: (bytes: number, folder: string | null, extra?: { masterBytes: number } | null) => Promise<Room>;
	space: (id: string) => Promise<{ freeBytes: number | null }>;
	reset: (id: string) => Promise<void>;
	saveFrom: (file: string, filename: string, again?: boolean) => Promise<void>;
	journal: (op: "begin" | "update" | "end" | "interrupted", a?: unknown, b?: unknown) => Promise<unknown>;
}

export const appExportFile = (): Partial<AppExportFile> | undefined => (globalThis as { studioApp?: { exportFile?: Partial<AppExportFile> } }).studioApp?.exportFile;

export interface DiskExport {
	writer: ExportFileWriter;
	path: () => Promise<string>;
	moveTo: (folder: string, filename: string) => Promise<string>;
	/** As a File the browser keeps on disk (for an upload that takes a File). */
	file: (name: string) => Promise<File>;
	discard: () => void;
}

/** What a waiting write tells its export: the free bytes where the file grows (null: not known), or null when the wait is over. */
export type DiskWaiting = { freeBytes: number | null; chunkBytes: number; writtenBytes: number } | null;

/**
 * The writer of an export's file: positions as the muxer asks for them; a full disk makes it wait (and say so through
 * `onWaiting`) until the write goes through or `isCancelled()`.
 */
export function diskWriter({
	id,
	app,
	onWaiting,
	isCancelled,
}: {
	id: string;
	app: Pick<AppExportFile, "write"> & Partial<Pick<AppExportFile, "space" | "reset">>;
	onWaiting?: (waiting: DiskWaiting) => void;
	isCancelled?: () => boolean;
}): ExportFileWriter {
	let written = 0;
	return {
		write: async (position, data) => {
			await whileDiskIsFull(() => app.write(id, position, data), {
				isCancelled,
				onWaiting: async (waiting) => {
					if (!waiting) return onWaiting?.(null);
					const freeBytes = (await app.space?.(id).catch(() => null))?.freeBytes ?? null;
					onWaiting?.({ freeBytes, chunkBytes: data.byteLength, writtenBytes: written });
				},
			});
			written = Math.max(written, position + data.byteLength);
		},
		...(app.reset ? { reset: () => (app.reset as AppExportFile["reset"])(id).then(() => void (written = 0)) } : {}),
	};
}

export async function openDiskExport(options: { where?: { folder: string; filename: string } | null; onWaiting?: (waiting: DiskWaiting) => void; isCancelled?: () => boolean } = {}): Promise<DiskExport | null> {
	const app = appExportFile();
	if (!app?.open || !app.write || !app.path || !app.moveTo || !app.discard) return null;
	const { open, write, path, moveTo, discard } = app as AppExportFile;
	const id = await open(options.where ?? null).catch(() => null);
	if (!id) return null;
	return {
		writer: diskWriter({ id, app: { write, space: app.space, reset: app.reset }, onWaiting: options.onWaiting, isCancelled: options.isCancelled }),
		path: () => path(id),
		moveTo: (folder, filename) => moveTo(id, folder, filename),
		file: async (name) => {
			const from = await path(id);
			const answer = await fetch(`/api/export/rendered?from=${encodeURIComponent(from)}`, { headers: { "X-Studio": "1" } });
			if (!answer.ok) throw new Error("The rendered file is gone. Export again.");
			return new File([await answer.blob()], name, { type: "video/mp4" });
		},
		discard: () => void discard(id).catch(() => {}),
	};
}
