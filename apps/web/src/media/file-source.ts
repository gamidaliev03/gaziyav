// The way every part of the editor reads a user's media file through mediabunny (decoders, sound, waveforms,
// thumbnails, the export). mediabunny's BlobSource keeps a `blob.stream()` reader per read worker and cancels one only
// while it is busy: a disposed Input left its idle readers open, and each is an open file in the app's main process —
// 65 on one clip after an hour of editing and ten exports (pro-reliable's soak, 09.11), walking towards the descriptor
// limit and keeping an external disk from ejecting. Here every read is `slice().arrayBuffer()`: the file is opened for
// that read and closed after it (mediabunny's own path for Safari). Reads go by aligned 1 MiB blocks, the missing ones
// of a request (and one ahead) in one call, the last few kept: a decoder's packet-by-packet reads became one call per
// packet otherwise, and seeks in a 4K original slowed down (p95 152 → 408 ms).
import { StreamSource } from "mediabunny";

const BLOCK = 1 << 20;
/** Blocks kept per file (the decoder's next packets, a seek's group of pictures). */
const KEPT_BLOCKS = 8;

export function fileSource(file: Blob): StreamSource {
	const size = file.size;
	const lastBlock = Math.max(0, Math.ceil(size / BLOCK) - 1);
	/** Block index → its bytes; Map order is the use order (oldest first). */
	const blocks = new Map<number, Promise<Uint8Array>>();

	const fetchRun = (first: number, last: number) => {
		const run = file.slice(first * BLOCK, Math.min(size, (last + 1) * BLOCK)).arrayBuffer().then((bytes) => new Uint8Array(bytes));
		for (let index = first; index <= last; index++) {
			const at = (index - first) * BLOCK;
			const piece = run.then((all) => all.subarray(at, Math.min(all.length, at + BLOCK)));
			// a read-ahead block nobody asks for must not surface as an unhandled rejection; a failed read is tried again
			piece.catch(() => {
				if (blocks.get(index) === piece) blocks.delete(index);
			});
			blocks.set(index, piece);
		}
	};

	return new StreamSource({
		getSize: () => size,
		read: async (start, end) => {
			const first = Math.floor(start / BLOCK);
			const last = Math.max(first, Math.floor((end - 1) / BLOCK));
			// the missing blocks of this request and the one after it, a run at a time
			let runStart = -1;
			const ahead = Math.min(lastBlock, last + 1);
			for (let index = first; index <= ahead; index++) {
				if (blocks.has(index)) {
					if (runStart >= 0) fetchRun(runStart, index - 1);
					runStart = -1;
				} else if (runStart < 0) runStart = index;
			}
			if (runStart >= 0) fetchRun(runStart, ahead);
			// taken now (before any await), so another read's eviction can't drop them meanwhile; moved to the newest end
			const wanted: Array<Promise<Uint8Array>> = [];
			for (let index = first; index <= last; index++) {
				const piece = blocks.get(index) as Promise<Uint8Array>;
				blocks.delete(index);
				blocks.set(index, piece);
				wanted.push(piece);
			}
			while (blocks.size > KEPT_BLOCKS) blocks.delete(blocks.keys().next().value as number);
			const out = new Uint8Array(end - start);
			const pieces = await Promise.all(wanted);
			pieces.forEach((bytes, k) => {
				const blockStart = (first + k) * BLOCK;
				const from = Math.max(start, blockStart);
				const to = Math.min(end, blockStart + bytes.length);
				if (to > from) out.set(bytes.subarray(from - blockStart, to - blockStart), from - start);
			});
			return out;
		},
		prefetchProfile: "fileSystem",
		// the blocks above hold the bytes; mediabunny's own cache only bridges a read in progress
		maxCacheSize: 2 << 20,
	});
}
