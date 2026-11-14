/// <reference lib="webworker" />
// A media file's waveform summary (peaks per bucket of samples), decoded and reduced off the main thread. On the main
// thread the sample loop of a 40-minute source (115 M samples) took ~0.4 s of every few seconds while a long project
// opened and zoomed (ideal-longform, 11.11), and a two-hour podcast three times that.
import { ALL_FORMATS, AudioSampleSink, Input } from "mediabunny";
import { fileSource } from "@/media/file-source";

export type SummaryWorkerRequest = { id: number; file: File; bucketSize: number };
export type SummaryWorkerResponse =
	| { id: number; ok: true; sampleRate: number; totalSamples: number; amplitudes: Float32Array }
	| { id: number; ok: false; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

async function summarize(file: File, bucketSize: number) {
	const input = new Input({ source: fileSource(file), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error("No audio track");
		const sink = new AudioSampleSink(track);
		// Peaks grow in blocks (a two-hour source is ~2.7 M buckets): no number[] of millions of boxed values.
		let peaks = new Float32Array(1 << 16);
		let count = 0;
		let sampleRate = 0;
		let totalSamples = 0;
		let bucketPeak = 0;
		let inBucket = 0;
		let plane = new Float32Array(0);
		const push = (value: number) => {
			if (count === peaks.length) {
				const grown = new Float32Array(peaks.length * 2);
				grown.set(peaks);
				peaks = grown;
			}
			peaks[count++] = value;
		};
		for await (const sample of sink.samples(0)) {
			try {
				sampleRate ||= sample.sampleRate;
				const frames = sample.numberOfFrames;
				const channels = sample.numberOfChannels;
				if (plane.length < frames * channels) plane = new Float32Array(frames * channels);
				for (let c = 0; c < channels; c++) {
					sample.copyTo(plane.subarray(c * frames, (c + 1) * frames), { planeIndex: c, format: "f32-planar" });
				}
				for (let i = 0; i < frames; i++) {
					for (let c = 0; c < channels; c++) {
						const v = plane[c * frames + i];
						const a = v < 0 ? -v : v;
						if (a > bucketPeak) bucketPeak = a;
					}
					if (++inBucket === bucketSize) {
						push(bucketPeak);
						bucketPeak = 0;
						inBucket = 0;
					}
				}
				totalSamples += frames;
			} finally {
				sample.close();
			}
		}
		if (inBucket > 0) push(bucketPeak);
		if (!sampleRate || count === 0) throw new Error("Empty audio");
		return { sampleRate, totalSamples, amplitudes: peaks.slice(0, count) };
	} finally {
		input.dispose();
	}
}

scope.onmessage = (event: MessageEvent<SummaryWorkerRequest>) => {
	const { id, file, bucketSize } = event.data;
	summarize(file, bucketSize).then(
		(result) => {
			const message: SummaryWorkerResponse = { id, ok: true, ...result };
			scope.postMessage(message, [result.amplitudes.buffer]);
		},
		(error: unknown) => {
			const message: SummaryWorkerResponse = { id, ok: false, message: error instanceof Error ? error.message : String(error) };
			scope.postMessage(message);
		},
	);
};
