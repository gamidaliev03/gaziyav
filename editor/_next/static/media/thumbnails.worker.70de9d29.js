/// <reference lib="webworker" />
// Filmstrip thumbnails, decoded off the main thread with decoders of their own (the preview's are never touched).
import { EncodedPacketSink, type Input, type InputVideoTrack, VideoSampleSink } from "mediabunny";
import { openVideoForDecoding } from "./decoder-config";

export type ThumbnailWorkerRequest =
	| { type: "job"; id: number; mediaId: string; file: File; times: number[]; height: number; exact: boolean }
	| { type: "cancel"; id: number }
	| { type: "pause"; paused: boolean }
	| { type: "forget"; mediaId: string };

export type ThumbnailWorkerResponse =
	| { type: "frame"; id: number; mediaId: string; time: number; height: number; bitmap: ImageBitmap }
	| { type: "done"; id: number }
	| { type: "error"; id: number; message: string };

type Job = Extract<ThumbnailWorkerRequest, { type: "job" }> & { left: number[]; started: boolean };

type Source = {
	input: Input;
	track: InputVideoTrack;
	samples: VideoSampleSink;
	packets: EncodedPacketSink;
	lastUsed: number;
};

/**
 * Times decoded together: one decoder pass, in source order, over the next times by priority. The first pass of a
 * job is small (the tiles at the centre of the view show quickly), later ones big (fewer key frames decoded twice).
 */
const FIRST_BATCH = 8;
const BATCH = 32;
/** Files kept open between jobs (each holds a demuxer; decoders live only during a batch). */
const MAX_SOURCES = 4;

const scope = self as unknown as DedicatedWorkerGlobalScope;
const sources = new Map<string, Promise<Source>>();
const queue: Job[] = [];
const cancelled = new Set<number>();
let paused = false;
let running = false;

scope.onmessage = (event: MessageEvent<ThumbnailWorkerRequest>) => {
	const message = event.data;
	if (message.type === "job") {
		queue.push({ ...message, left: [...message.times], started: false });
		void pump();
	} else if (message.type === "cancel") {
		cancelled.add(message.id);
		const index = queue.findIndex((job) => job.id === message.id);
		if (index > 0) {
			queue.splice(index, 1);
			cancelled.delete(message.id);
			post({ type: "done", id: message.id });
		}
	} else if (message.type === "pause") {
		paused = message.paused;
		if (!paused) void pump();
	} else if (message.type === "forget") {
		void closeSource(message.mediaId);
	}
};

function post(message: ThumbnailWorkerResponse, transfer: Transferable[] = []) {
	scope.postMessage(message, transfer);
}

async function pump() {
	if (running) return;
	running = true;
	try {
		while (queue.length > 0 && !paused) {
			const job = queue[0];
			if (cancelled.has(job.id) || job.left.length === 0) {
				queue.shift();
				cancelled.delete(job.id);
				post({ type: "done", id: job.id });
				continue;
			}
			try {
				const size = job.started ? BATCH : FIRST_BATCH;
				job.started = true;
				await runBatch(job, job.left.splice(0, size));
			} catch (error) {
				queue.shift();
				post({ type: "error", id: job.id, message: error instanceof Error ? error.message : String(error) });
			}
		}
	} finally {
		running = false;
	}
}

async function runBatch(job: Job, times: number[]) {
	const source = await openSource(job.mediaId, job.file);
	source.lastUsed = performance.now();
	const { track } = source;
	const height = Math.max(2, Math.round(job.height));
	const width = Math.max(2, Math.round((height * track.displayWidth) / Math.max(1, track.displayHeight)));

	// Wide spacing: the key frame before each time (one packet to decode). Close spacing: the exact frame.
	const targets = new Map<number, number[]>();
	for (const time of times) {
		const at = job.exact
			? time
			: ((await source.packets.getKeyPacket(time, { metadataOnly: true }))?.timestamp ?? time);
		const list = targets.get(at);
		if (list) list.push(time);
		else targets.set(at, [time]);
	}
	const order = [...targets.keys()].sort((a, b) => a - b);

	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext("2d", { alpha: false });
	if (!context) throw new Error("Failed to get a 2D context for thumbnails");

	const iterator = source.samples.samplesAtTimestamps(order);
	let done = 0;
	try {
		for await (const sample of iterator) {
			const wanted = targets.get(order[done]) ?? [];
			if (!sample) {
				done++;
				continue;
			}
			try {
				if (cancelled.has(job.id)) break;
				for (const time of wanted) {
					// transferToImageBitmap empties the canvas: one draw per bitmap.
					sample.drawWithFit(context, { fit: "cover" });
					const bitmap = canvas.transferToImageBitmap();
					post({ type: "frame", id: job.id, mediaId: job.mediaId, time, height: job.height, bitmap }, [bitmap]);
				}
			} finally {
				sample.close();
			}
			done++;
			if (paused) break;
		}
	} finally {
		await iterator.return();
	}
	// Times not produced because of a pause go back to the front of the job.
	if (!cancelled.has(job.id) && done < order.length) {
		job.left.unshift(...order.slice(done).flatMap((at) => targets.get(at) ?? []));
	}
}

function openSource(mediaId: string, file: File): Promise<Source> {
	let source = sources.get(mediaId);
	if (!source) {
		source = (async () => {
			const { input, track } = await openVideoForDecoding(file);
			return { input, track, samples: new VideoSampleSink(track), packets: new EncodedPacketSink(track), lastUsed: performance.now() };
		})();
		sources.set(mediaId, source);
		source.catch(() => sources.delete(mediaId));
		void trimSources();
	}
	return source;
}

async function trimSources() {
	if (sources.size <= MAX_SOURCES) return;
	const open = await Promise.all(
		[...sources].map(async ([mediaId, promise]) => ({ mediaId, lastUsed: (await promise.catch(() => null))?.lastUsed ?? 0 })),
	);
	open.sort((a, b) => a.lastUsed - b.lastUsed);
	const busy = new Set(queue.map((job) => job.mediaId));
	for (const { mediaId } of open) {
		if (sources.size <= MAX_SOURCES) break;
		if (!busy.has(mediaId)) await closeSource(mediaId);
	}
}

async function closeSource(mediaId: string) {
	const promise = sources.get(mediaId);
	sources.delete(mediaId);
	const source = await promise?.catch(() => null);
	source?.input.dispose();
}
