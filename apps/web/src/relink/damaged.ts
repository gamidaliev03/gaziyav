// The project's own copy of a media file that is there but can't be read (cut short by a crash or a full disk, or
// overwritten): it played as black or hung the player, and the export rendered black. Such a file is checked when the
// project opens and left out of the project's media, so its clips go the «offline» way (relink/offline.ts: a mark on
// the clip, one notice, the export refuses, Relink…), and the words say «damaged», by name (polish, 11.11).
// Only definite evidence is damage: a size that differs from the size it was stored with (or none at all), or — for a
// format this reader knows — a header that names no format or no track. Anything else (a format kept on purpose that
// the reader doesn't know, like the user's AVI behind an editing copy; a failed import of the reader; a read error) is
// not called damaged: the file loads as before.
import type { MediaType } from "@/media/types";

/** Media ids of the open project whose stored file is damaged, with the file's name. */
const damaged = new Map<string, string>();
/** The user's originals behind editing copies that are damaged: the copy's media id → the original's name. */
const damagedOriginals = new Map<string, string>();

export function markDamaged(mediaId: string, name: string, { originalOf }: { originalOf?: string } = {}): void {
	if (originalOf) damagedOriginals.set(originalOf, name);
	else damaged.set(mediaId, name);
}

export function forgetDamaged(mediaId: string, { originalOf }: { originalOf?: string } = {}): void {
	if (originalOf) damagedOriginals.delete(originalOf);
	else damaged.delete(mediaId);
}

export function isDamaged(mediaId: string): boolean {
	return damaged.has(mediaId);
}

/** The original behind this editing copy is damaged (the export renders from the copy): its name, else null. */
export function damagedOriginalOf(copyId: string): string | null {
	return damagedOriginals.get(copyId) ?? null;
}

/** The containers mediabunny reads: only for these is «no format / no track» evidence of damage. */
const READABLE = /\.(mp4|m4v|mov|m4a|mp3|wav|ogg|oga|opus|flac|aac|webm|mkv|mka)$/i;

type Reader = (file: File) => Promise<number>;
/** How many tracks the file's header names (mediabunny, the header only); throws what the reader throws. */
const readTracks: Reader = async (file) => {
	const { Input, ALL_FORMATS } = await import("mediabunny");
	const { fileSource } = await import("@/media/file-source");
	const input = new Input({ source: fileSource(file), formats: ALL_FORMATS });
	try {
		return (await input.getTracks()).length;
	} finally {
		input.dispose();
	}
};

const FORMAT_ERROR = /unsupported or unrecognizable format/i;

export async function storedFileDamaged({ file, size, type, name, reader = readTracks }: { file: File; size?: number; type: MediaType; name?: string; reader?: Reader }): Promise<boolean> {
	if (file.size === 0) return true;
	if (typeof size === "number" && size > 0 && file.size !== size) return true;
	if (type !== "video" && type !== "audio") return false;
	if (!READABLE.test(name || file.name || "")) return false;
	let tracks: number;
	try {
		tracks = await reader(file);
	} catch (error) {
		// only the reader's own «this is no format I know» about a format it does know is evidence
		return FORMAT_ERROR.test(error instanceof Error ? error.message : String(error));
	}
	return tracks === 0;
}
