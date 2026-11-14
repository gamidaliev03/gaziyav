"use client";

import { createAudioContext } from "@/media/audio";
import {
	buildSourceWaveformSummary,
	type SourceWaveformSummary,
} from "@/media/waveform-summary";
import { speedOff } from "@/timeline/speed-flags";
import type { SummaryWorkerRequest, SummaryWorkerResponse } from "./summary.worker";
import { readStoredSummary, removeStoredSummaries, waveformStoreStats, writeStoredSummary } from "./store";
import { LruBytes } from "@/platform/lru-bytes";
import { joinBudget, noteUse, type BudgetMember } from "@/platform/memory-budget";

interface GetSourceWaveformSummaryArgs {
	sourceKey: string;
	audioBuffer?: AudioBuffer;
	sourceFile?: File;
	audioUrl?: string;
}

export class WaveformCache {
	// The memory budget's «waveforms» (16 MB on an 8 GB Mac, 64 MB on 16 GB), least recently used first. A dropped one is
	// read again from its kept file (store.ts) the next time a clip of that source is drawn.
	private summaries = new LruBytes<string, Promise<SourceWaveformSummary>>();
	readonly budget: BudgetMember = { name: "waveforms", used: () => this.summaries.bytes, shrink: (limit) => void this.summaries.shrinkTo(limit) };

	getSourceSummary({
		sourceKey,
		audioBuffer,
		sourceFile,
		audioUrl,
	}: GetSourceWaveformSummaryArgs): Promise<SourceWaveformSummary> {
		const existing = this.summaries.get(sourceKey);
		if (existing) {
			return existing;
		}

		const promise = this.buildSummary({
			sourceKey,
			audioBuffer,
			sourceFile,
			audioUrl,
		}).catch((error) => {
			this.summaries.delete(sourceKey);
			throw error;
		});

		this.summaries.set(sourceKey, promise, 0);
		void promise.then(
			(summary) => {
				if (this.summaries.get(sourceKey) !== promise) return;
				this.summaries.resize(sourceKey, summary.amplitudes.byteLength);
				noteUse(this.budget);
			},
			() => {},
		);
		return promise;
	}

	clearSource({ sourceKey }: { sourceKey: string }): void {
		this.summaries.delete(sourceKey);
		// the source left the project: its kept summary goes too (store.ts)
		void removeStoredSummaries({ sourceKey });
	}

	clearAll(): void {
		this.summaries.clear();
	}

	private async buildSummary({
		sourceKey,
		audioBuffer,
		sourceFile,
		audioUrl,
	}: GetSourceWaveformSummaryArgs): Promise<SourceWaveformSummary> {
		if (audioBuffer) {
			return buildSourceWaveformSummary({ sourceKey, buffer: audioBuffer });
		}

		if (sourceFile) {
			// Stream the audio track and build peaks chunk by chunk: never load a
			// large file into memory or decode it into one huge PCM buffer
			// (1 h of stereo audio is ~1.4 GB as floats).
			try {
				return await summarizeMediaAudio({ sourceKey, file: sourceFile });
			} catch (error) {
				if (sourceFile.type.startsWith("video/")) throw error;
				// Audio formats mediabunny can't demux fall back to decodeAudioData.
			}
		}

		let arrayBuffer: ArrayBuffer | null = null;
		if (sourceFile) {
			arrayBuffer = await sourceFile.arrayBuffer();
		} else if (audioUrl) {
			const response = await fetch(audioUrl);
			if (!response.ok) {
				throw new Error(`Failed to fetch waveform source: ${response.status}`);
			}
			arrayBuffer = await response.arrayBuffer();
		}

		if (!arrayBuffer) {
			throw new Error(`No waveform source available for ${sourceKey}`);
		}

		const audioContext = createAudioContext();
		try {
			// decodeAudioData detaches the buffer; it isn't used afterwards, so no copy.
			const buffer = await audioContext.decodeAudioData(arrayBuffer);
			return buildSourceWaveformSummary({ sourceKey, buffer });
		} finally {
			void audioContext.close();
		}
	}
}

const MEDIA_BUCKET_SIZE = 128;

let summaryWorker: Worker | null = null;
let summaryWorkerBroken = false;
let nextSummaryId = 0;
const summaryJobs = new Map<number, (response: SummaryWorkerResponse | null) => void>();

/** The summary from the worker (summary.worker.ts), or null when there is no worker to ask. */
function summarizeInWorker(file: File): Promise<SummaryWorkerResponse | null> {
	if (summaryWorkerBroken || speedOff("waveWorker") || typeof window === "undefined" || typeof Worker === "undefined") return Promise.resolve(null);
	if (!summaryWorker) {
		try {
			summaryWorker = new Worker(new URL("./summary.worker.ts", import.meta.url), { type: "module" });
		} catch {
			summaryWorkerBroken = true;
			return Promise.resolve(null);
		}
		summaryWorker.onmessage = (event: MessageEvent<SummaryWorkerResponse>) => {
			const done = summaryJobs.get(event.data.id);
			summaryJobs.delete(event.data.id);
			done?.(event.data);
		};
		summaryWorker.onerror = () => {
			// a worker that cannot start: every waiting summary is made on the main thread, as before
			summaryWorkerBroken = true;
			summaryWorker = null;
			for (const done of summaryJobs.values()) done(null);
			summaryJobs.clear();
		};
	}
	const id = ++nextSummaryId;
	const worker = summaryWorker;
	return new Promise((resolve) => {
		summaryJobs.set(id, resolve);
		const request: SummaryWorkerRequest = { id, file, bucketSize: MEDIA_BUCKET_SIZE };
		worker.postMessage(request);
	});
}

/**
 * A media file's peaks, from the worker; on this thread only when the worker cannot start or fails (the path every
 * build before 11.11 took: a 40-minute source kept the main thread ~30 % busy for minutes after a long project
 * opened — 243 ms of sample loop and ~250 ms of decoder plumbing in the 2 s around a ⌫, ideal-longform).
 */
async function summarizeMediaAudio({
	sourceKey,
	file,
}: {
	sourceKey: string;
	file: File;
}): Promise<SourceWaveformSummary> {
	// Made once per source file and kept (store.ts): opening the project again reads 2.7 MB per hour of sound instead
	// of decoding the hour.
	const keep = !speedOff("waveStore");
	if (keep) {
		const kept = await readStoredSummary({ sourceKey, file, bucketSize: MEDIA_BUCKET_SIZE });
		if (kept) return { sourceKey, ...kept };
	}
	const fromWorker = await summarizeInWorker(file);
	const summary: SourceWaveformSummary = fromWorker?.ok
		? {
				sourceKey,
				sampleRate: fromWorker.sampleRate,
				totalSamples: fromWorker.totalSamples,
				bucketSize: MEDIA_BUCKET_SIZE,
				amplitudes: fromWorker.amplitudes,
			}
		: await summarizeOnMainThread({ sourceKey, file });
	if (keep) void writeStoredSummary({ sourceKey, file, summary });
	return summary;
}

// Tests read what the store did (test/ideal-longform.mjs).
if (typeof globalThis !== "undefined") (globalThis as { __gzWaveStore?: typeof waveformStoreStats }).__gzWaveStore = waveformStoreStats;

async function summarizeOnMainThread({
	sourceKey,
	file,
}: {
	sourceKey: string;
	file: File;
}): Promise<SourceWaveformSummary> {
	const { ALL_FORMATS, AudioBufferSink, Input } = await import("mediabunny");
	const { fileSource } = await import("@/media/file-source");
	const input = new Input({ source: fileSource(file), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error(`No audio track in ${sourceKey}`);
		const sink = new AudioBufferSink(track);
		const peaks: number[] = [];
		let sampleRate = 0;
		let totalSamples = 0;
		let bucketPeak = 0;
		let inBucket = 0;
		for await (const { buffer } of sink.buffers(0)) {
			sampleRate ||= buffer.sampleRate;
			const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
			for (let i = 0; i < buffer.length; i++) {
				for (const data of channels) {
					const a = data[i] < 0 ? -data[i] : data[i];
					if (a > bucketPeak) bucketPeak = a;
				}
				if (++inBucket === MEDIA_BUCKET_SIZE) {
					peaks.push(bucketPeak);
					bucketPeak = 0;
					inBucket = 0;
				}
			}
			totalSamples += buffer.length;
		}
		if (inBucket > 0) peaks.push(bucketPeak);
		if (!sampleRate || peaks.length === 0) throw new Error(`Empty audio in ${sourceKey}`);
		return {
			sourceKey,
			sampleRate,
			totalSamples,
			bucketSize: MEDIA_BUCKET_SIZE,
			amplitudes: Float32Array.from(peaks),
		};
	} finally {
		input.dispose();
	}
}

export const waveformCache = new WaveformCache();
joinBudget(waveformCache.budget);
