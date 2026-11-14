// The waveform summaries of media files, kept between sessions (speed, 11.11). A summary is the peak of every 128
// samples of a source's sound: to make it the whole sound track is decoded, and until 11.11 that was done again each
// time a project opened — a project with four hours of sources kept the app at a full core for minutes after every
// open (ideal-longform: 100 % of a core 40 s after opening the 30-minute project, 41 833 decoder callbacks in 20 s).
// Kept in the origin's private file system, one small file per source file (2.7 MB per hour of sound), named by the
// source and the file's size and date, so a relinked or replaced file never gets another file's waveform.
//
// Every failure here is silent and means «not kept»: the summary is then made as before.

const DIRECTORY = "waveform-summaries";
/** "GZWF" */
const MAGIC = 0x46575a47;
const VERSION = 1;
const HEADER_BYTES = 32;
/** All kept summaries together stay under this (about 95 hours of sound); the oldest go first. */
const MAX_TOTAL_BYTES = 256 << 20;

export interface StoredSummary {
	sampleRate: number;
	totalSamples: number;
	bucketSize: number;
	amplitudes: Float32Array;
}

/** What the store did since the page loaded (read by tests: test/ideal-longform.mjs). */
export const waveformStoreStats = { read: 0, missed: 0, written: 0, failed: 0 };

async function directory(create: boolean): Promise<FileSystemDirectoryHandle | null> {
	try {
		if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return null;
		const root = await navigator.storage.getDirectory();
		return await root.getDirectoryHandle(DIRECTORY, { create });
	} catch {
		return null;
	}
}

/** A file-name-safe form of a source key; a long key is shortened to its start and two 32-bit hashes (FNV-1a). */
function safeKey(sourceKey: string): string {
	const plain = sourceKey.replace(/[^a-zA-Z0-9_-]/g, "_");
	if (plain.length <= 80) return plain;
	let a = 0x811c9dc5;
	let b = 0x01000193;
	for (let i = 0; i < sourceKey.length; i++) {
		a = Math.imul(a ^ sourceKey.charCodeAt(i), 0x01000193);
		b = Math.imul(b ^ sourceKey.charCodeAt(sourceKey.length - 1 - i), 0x811c9dc5);
	}
	return `${plain.slice(0, 40)}_${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}

/** The name of the file that keeps this source file's summary. */
export function storedSummaryName({ sourceKey, file }: { sourceKey: string; file: { size: number; lastModified?: number } }): string {
	return `${safeKey(sourceKey)}.${file.size}.${Math.round(file.lastModified ?? 0)}.v${VERSION}.f32`;
}

/** The bytes of a summary as kept: a 32-byte header, then the peaks (32-bit floats, little-endian). */
export function encodeStoredSummary(summary: StoredSummary): { header: ArrayBuffer; peaks: Float32Array } {
	const header = new ArrayBuffer(HEADER_BYTES);
	const view = new DataView(header);
	view.setUint32(0, MAGIC, true);
	view.setUint32(4, VERSION, true);
	view.setFloat64(8, summary.sampleRate, true);
	view.setFloat64(16, summary.totalSamples, true);
	view.setUint32(24, summary.bucketSize, true);
	view.setUint32(28, summary.amplitudes.length, true);
	return { header, peaks: summary.amplitudes };
}

/** The summary in these bytes, or null when they are not a whole summary of this bucket size. */
export function decodeStoredSummary({ bytes, bucketSize }: { bytes: ArrayBuffer; bucketSize: number }): StoredSummary | null {
	if (bytes.byteLength < HEADER_BYTES) return null;
	const view = new DataView(bytes);
	if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== VERSION) return null;
	const sampleRate = view.getFloat64(8, true);
	const totalSamples = view.getFloat64(16, true);
	const count = view.getUint32(28, true);
	if (view.getUint32(24, true) !== bucketSize || count === 0 || bytes.byteLength !== HEADER_BYTES + count * 4) return null;
	if (!(sampleRate > 0) || !(totalSamples > 0) || Math.ceil(totalSamples / bucketSize) !== count) return null;
	return { sampleRate, totalSamples, bucketSize, amplitudes: new Float32Array(bytes, HEADER_BYTES, count) };
}

export async function readStoredSummary({
	sourceKey,
	file,
	bucketSize,
}: {
	sourceKey: string;
	file: File;
	bucketSize: number;
}): Promise<StoredSummary | null> {
	try {
		const dir = await directory(false);
		if (!dir) return null;
		const name = storedSummaryName({ sourceKey, file });
		let handle: FileSystemFileHandle;
		try {
			handle = await dir.getFileHandle(name);
		} catch {
			waveformStoreStats.missed++;
			return null;
		}
		const summary = decodeStoredSummary({ bytes: await (await handle.getFile()).arrayBuffer(), bucketSize });
		if (!summary) {
			// half-written, or of an older layout: gone, and made again
			await dir.removeEntry(name).catch(() => {});
			waveformStoreStats.missed++;
			return null;
		}
		waveformStoreStats.read++;
		return summary;
	} catch {
		waveformStoreStats.failed++;
		return null;
	}
}

export async function writeStoredSummary({ sourceKey, file, summary }: { sourceKey: string; file: File; summary: StoredSummary }): Promise<void> {
	try {
		const dir = await directory(true);
		if (!dir) return;
		// an older summary of the same source (the file was replaced): gone first
		await removeStoredSummaries({ sourceKey });
		const handle = await dir.getFileHandle(storedSummaryName({ sourceKey, file }), { create: true });
		// createWritable writes to a swap file; close() swaps it in whole (a quit midway leaves no half summary)
		const writable = await handle.createWritable();
		try {
			const { header, peaks } = encodeStoredSummary(summary);
			await writable.write(header);
			await writable.write(peaks as unknown as BufferSource);
			await writable.close();
		} catch (error) {
			await writable.abort().catch(() => {});
			throw error;
		}
		waveformStoreStats.written++;
		await keepUnderLimit(dir);
	} catch {
		// no room, or no private file system: nothing kept
		waveformStoreStats.failed++;
	}
}

/** A source left the project (or its file was replaced): its kept summaries go. */
export async function removeStoredSummaries({ sourceKey }: { sourceKey: string }): Promise<void> {
	try {
		const dir = await directory(false);
		if (!dir) return;
		const prefix = `${safeKey(sourceKey)}.`;
		const gone: string[] = [];
		for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) if (name.startsWith(prefix)) gone.push(name);
		for (const name of gone) await dir.removeEntry(name).catch(() => {});
	} catch {}
}

async function keepUnderLimit(dir: FileSystemDirectoryHandle): Promise<void> {
	const files: Array<{ name: string; size: number; date: number }> = [];
	for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
		if (handle.kind !== "file") continue;
		const file = await (handle as FileSystemFileHandle).getFile();
		files.push({ name, size: file.size, date: file.lastModified });
	}
	let total = files.reduce((sum, file) => sum + file.size, 0);
	files.sort((a, b) => a.date - b.date);
	for (const file of files) {
		if (total <= MAX_TOTAL_BYTES) break;
		await dir.removeEntry(file.name).catch(() => {});
		total -= file.size;
	}
}
