// A file's sound for sync by waveform, read in the window from the file itself (no copy to the server): its loudness
// outline in one pass over the whole file, and exact windows of samples wherever they are asked for. Only the
// outline is kept in memory: an hour of sound is a list of 720 000 numbers.
import { ALL_FORMATS, AudioBufferSink, Input } from "mediabunny";
import { trackBase } from "@/media/audio-gather";
import { fileSource } from "@/media/file-source";

export interface Sound {
	/** The file's own sample rate, and its length in seconds. */
	rate: number;
	duration: number;
	/** The mean square of every `hop` samples of the whole sound (both sides together). */
	energy(hop: number, onProgress?: (share: number) => void, signal?: AbortSignal): Promise<Float32Array>;
	/** Samples [from, from + count) as one channel; silence where the file has none. */
	samples(from: number, count: number): Promise<Float32Array>;
	dispose(): void;
}

const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function openSound(file: Blob): Promise<Sound | null> {
	const input = new Input({ source: fileSource(file), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) {
			input.dispose();
			return null;
		}
		const sink = new AudioBufferSink(track);
		const duration = await track.computeDuration();
		// the source's own zero, as the mix places it (media/audio-gather.ts)
		const base = await trackBase(sink.buffers(0, 0.001));
		let rate = track.sampleRate;
		const side = (buffer: AudioBuffer) => {
			const left = buffer.getChannelData(0);
			if (buffer.numberOfChannels < 2) return left;
			const right = buffer.getChannelData(1);
			const out = new Float32Array(left.length);
			for (let i = 0; i < out.length; i++) out[i] = (left[i] + right[i]) * 0.5;
			return out;
		};
		return {
			get rate() {
				return rate;
			},
			duration,
			async energy(hop, onProgress, signal) {
				const out = new Float32Array(Math.ceil((duration * rate) / hop) + 2);
				let since = performance.now();
				for await (const { buffer, timestamp } of sink.buffers(base)) {
					if (signal?.aborted) break;
					rate = buffer.sampleRate;
					const mono = side(buffer);
					const at = Math.round((timestamp - base) * rate);
					for (let i = 0; i < mono.length; i++) {
						const index = at + i;
						if (index < 0) continue;
						const k = (index / hop) | 0;
						if (k >= out.length) break;
						out[k] += mono[i] * mono[i];
					}
					if (performance.now() - since > 14) {
						onProgress?.(Math.min(1, (timestamp - base) / Math.max(0.01, duration)));
						await breathe();
						since = performance.now();
					}
				}
				for (let k = 0; k < out.length; k++) out[k] /= hop;
				return out;
			},
			async samples(from, count) {
				const out = new Float32Array(Math.max(0, count));
				if (count <= 0) return out;
				const start = Math.max(0, from / rate - 0.1);
				const end = (from + count) / rate + 0.1;
				for await (const { buffer, timestamp } of sink.buffers(base + start, base + end)) {
					const mono = side(buffer);
					const at = Math.round((timestamp - base) * buffer.sampleRate) - from;
					const lo = Math.max(0, -at);
					const hi = Math.min(mono.length, count - at);
					if (hi > lo) out.set(mono.subarray(lo, hi), at + lo);
					if (at + mono.length >= count) break;
				}
				return out;
			},
			dispose: () => input.dispose(),
		};
	} catch (error) {
		input.dispose();
		throw error;
	}
}

/** A window of samples at another rate (straight lines between samples: good for finding where it lies). */
export function atRate(samples: Float32Array, from: number, to: number): Float32Array {
	if (from === to) return samples;
	const out = new Float32Array(Math.floor((samples.length * to) / from));
	const step = from / to;
	for (let i = 0; i < out.length; i++) {
		const x = i * step;
		const k = Math.floor(x);
		const f = x - k;
		out[i] = k + 1 < samples.length ? samples[k] * (1 - f) + samples[k + 1] * f : (samples[k] ?? 0);
	}
	return out;
}
