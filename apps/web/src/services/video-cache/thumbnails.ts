/**
 * Filmstrip thumbnails for the timeline: small frames of a video file at given source times.
 *
 * Decoding runs in a worker with decoders of its own (the preview's are never touched), and it is
 * paused while the preview plays or scrubs (setThumbnailsPaused), so thumbnails never take frames
 * away from playback. The cache is shared by every clip of the same file (LRU, about 64 MB of bitmaps).
 */
import type { ThumbnailWorkerRequest, ThumbnailWorkerResponse } from "./thumbnails.worker";
import { joinBudget, noteUse, type BudgetMember } from "@/platform/memory-budget";

export type ThumbnailRequest = {
	mediaId: string;
	file: File;
	/** Source times in seconds, in the order they should be produced (centre of the view first). */
	times: number[];
	/** Bitmap height in px; the width follows the source aspect (63×112 for 9:16, 199×112 for 16:9). */
	height: number;
	/** Aborted when the tiles scroll out of view: pending times are dropped. */
	signal?: AbortSignal;
	/** Called once per produced time; the bitmap stays owned by the cache (do not close it). */
	onFrame: (time: number, bitmap: ImageBitmap) => void;
};

/** Tiles at least this far apart show the key frame before their time: one packet each instead of a run. */
const KEY_FRAME_SPACING_S = 1;

type Entry = { bitmap: ImageBitmap; bytes: number; exact: boolean };
type Job = { mediaId: string; height: number; exact: boolean; onFrame: ThumbnailRequest["onFrame"]; finish: () => void };

/** Insertion order is the LRU order (a hit is re-inserted). */
const cache = new Map<string, Entry>();
let cacheBytes = 0;
// The budget (platform/memory-budget.ts «thumbnails»: 32 MB on an 8 GB Mac, 64 MB on 16 GB): the least recently used
// frames go first; at the floor (memory short) every frame goes and is closed at once. The timeline asks for them again
// as it draws.
const budget: BudgetMember = {
	name: "thumbnails",
	used: () => cacheBytes,
	shrink: (limit) => {
		for (const [key, entry] of cache) {
			if (cacheBytes <= limit) break;
			cache.delete(key);
			cacheBytes -= entry.bytes;
			if (limit === 0) entry.bitmap.close();
		}
	},
};
joinBudget(budget);
const jobs = new Map<number, Job>();
let nextJobId = 0;
let worker: Worker | null = null;
let paused = false;

const keyOf = (mediaId: string, time: number, height: number) =>
	`${mediaId}|${Math.round(height)}|${Math.round(time * 1000)}`;

/**
 * Produces thumbnails for `times`. Times of 1 s spacing or more may resolve to the key frame before
 * them; closer times are exact. Resolves when every time was produced or the signal aborted.
 */
export function getThumbnails({ mediaId, file, times, height, signal, onFrame }: ThumbnailRequest): Promise<void> {
	if (signal?.aborted || times.length === 0) return Promise.resolve();
	const exact = !spacedApart(times);
	const missing: number[] = [];
	for (const time of times) {
		const entry = touch(keyOf(mediaId, time, height));
		if (entry) onFrame(time, entry.bitmap);
		// A key-frame stand-in is shown until the exact frame replaces it.
		if (!entry || (exact && !entry.exact)) missing.push(time);
	}
	if (missing.length === 0) return Promise.resolve();
	const thread = getWorker();
	if (!thread) return Promise.resolve();

	const id = ++nextJobId;
	return new Promise<void>((resolve) => {
		const abort = () => {
			post({ type: "cancel", id });
			finish();
		};
		const finish = () => {
			jobs.delete(id);
			signal?.removeEventListener("abort", abort);
			resolve();
		};
		jobs.set(id, { mediaId, height, exact, onFrame, finish });
		signal?.addEventListener("abort", abort, { once: true });
		post({ type: "job", id, mediaId, file, times: missing, height, exact });
	});
}

/** A cached thumbnail for this exact time and height, or null (synchronous: no flicker on redraw). */
export function peekThumbnail(mediaId: string, time: number, height: number): ImageBitmap | null {
	return touch(keyOf(mediaId, time, height))?.bitmap ?? null;
}

/** Thumbnails wait while the preview plays or scrubs (the preview's decoding comes first). */
export function setThumbnailsPaused(next: boolean): void {
	if (paused === next) return;
	paused = next;
	if (worker) post({ type: "pause", paused });
}

function spacedApart(times: number[]): boolean {
	if (times.length < 2) return false;
	const sorted = [...times].sort((a, b) => a - b);
	for (let i = 1; i < sorted.length; i++) {
		const gap = sorted[i] - sorted[i - 1];
		if (gap > 1e-6 && gap < KEY_FRAME_SPACING_S - 1e-6) return false;
	}
	return true;
}

function touch(key: string): Entry | null {
	const entry = cache.get(key);
	if (!entry) return null;
	cache.delete(key);
	cache.set(key, entry);
	return entry;
}

function store(key: string, bitmap: ImageBitmap, exact: boolean) {
	const previous = cache.get(key);
	if (previous) {
		cacheBytes -= previous.bytes;
		cache.delete(key);
	}
	const bytes = bitmap.width * bitmap.height * 4;
	cache.set(key, { bitmap, bytes, exact });
	cacheBytes += bytes;
	// Over the budget: the least recently used go (left to the garbage collector: a tile may still be drawing one).
	noteUse(budget);
}

function post(message: ThumbnailWorkerRequest) {
	worker?.postMessage(message);
}

function getWorker(): Worker | null {
	if (worker) return worker;
	if (typeof window === "undefined" || typeof Worker === "undefined") return null;
	worker = new Worker(new URL("./thumbnails.worker.ts", import.meta.url), { type: "module" });
	worker.onmessage = (event: MessageEvent<ThumbnailWorkerResponse>) => {
		const message = event.data;
		const job = jobs.get(message.id);
		if (message.type === "frame") {
			const exact = job?.exact ?? false;
			store(keyOf(message.mediaId, message.time, message.height), message.bitmap, exact);
			job?.onFrame(message.time, message.bitmap);
		} else if (message.type === "error") {
			console.warn("Thumbnails failed:", message.message);
			job?.finish();
		} else {
			job?.finish();
		}
	};
	worker.onerror = (event) => {
		console.warn("Thumbnail worker failed:", event.message);
		for (const job of [...jobs.values()]) job.finish();
	};
	if (paused) post({ type: "pause", paused });
	return worker;
}

if (typeof window !== "undefined") {
	// The app's self-tests drive the filmstrip decoder directly.
	(window as unknown as { __studioThumbnails: object }).__studioThumbnails = { getThumbnails, peekThumbnail };
}
