// One piece of a sound track out of its decoded chunks (mediabunny's AudioBufferSink), the same way for both readers in
// audio.ts: the whole-track decode (audio effects, pitch-kept speed) and the windowed one (the mixdown, a minute at a time).
// The first chunk lands where its timestamp says, counted from `base` — the source's own zero: the chunk that holds time 0
// (an AAC lead-in makes it slightly negative), or 0 when the sound starts later — and the rest follow it. So a source whose
// sound starts late keeps its silence in both, as the preview plays it; the whole-track decode used to pile the chunks up
// from sample 0, and a clip with effects or pitch-kept speed sounded that much early.

export interface DecodedChunk {
	buffer: AudioBuffer;
	/** Seconds, the chunk's first sample in the source's time. */
	timestamp: number;
}

export interface GatheredAudio {
	buffer: AudioBuffer;
	/** The source time of the buffer's first sample: `from`, or earlier when the first chunk began before it. */
	from: number;
	/** Samples written from the start of the buffer (what follows is silence). */
	written: number;
}

/**
 * `from`…`to`: the source seconds asked for (relative to `base`). The buffer takes its rate and channels (at most
 * `maxChannels`) from the first chunk and holds `to - from` seconds plus a second of room; null when nothing was decoded.
 */
export async function gatherChunks(chunks: AsyncIterable<DecodedChunk>, o: { context: BaseAudioContext; base: number; from: number; to: number; maxChannels: number }): Promise<GatheredAudio | null> {
	let output: AudioBuffer | null = null;
	let written = 0;
	let start = o.from;
	for await (const { buffer, timestamp } of chunks) {
		if (!output) {
			const rate = buffer.sampleRate;
			const first = Math.round((timestamp - o.base) * rate) / rate;
			start = Math.min(first, o.from);
			output = o.context.createBuffer(Math.min(o.maxChannels, buffer.numberOfChannels), Math.ceil((o.to - start + 1) * rate), rate);
			written = Math.round((first - start) * rate);
		}
		const room = Math.min(buffer.length, output.length - written);
		if (room <= 0) break;
		for (let channel = 0; channel < output.numberOfChannels; channel++) {
			const data = output.numberOfChannels === 2 && channel < 2 ? stereoChannel(buffer, channel as 0 | 1) : buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
			output.copyToChannel(data.subarray(0, room) as Float32Array<ArrayBuffer>, channel, written);
		}
		written += room;
	}
	return output ? { buffer: output, from: start, written } : null;
}

/** The source's zero: the timestamp of the chunk that holds time 0 (`sink.buffers(0, 0.001)`), or 0 when the sound starts later. */
export async function trackBase(chunks: AsyncIterable<{ timestamp: number }>): Promise<number> {
	for await (const { timestamp } of chunks) return timestamp;
	return 0;
}

const SURROUND_GAIN = Math.SQRT1_2;

/**
 * One side (0 = left, 1 = right) of a chunk heard in stereo. 5.1 (L R C LFE Ls Rs) is down-mixed as Web Audio's
 * "speakers" mix and Premiere play it: L + 0.7071·(C + Ls) and R + 0.7071·(C + Rs), the LFE dropped. Mono plays on both
 * sides; stereo and every other layout keep their first two channels (a camera's 4 discrete channels: 1 and 2, as
 * before). The mix took the first two channels of a 5.1 source too: its centre — the dialogue — was lost in the player
 * and the export (pro-heavy, 09.11).
 */
export function stereoChannel(buffer: { numberOfChannels: number; length: number; getChannelData(channel: number): Float32Array }, side: 0 | 1): Float32Array {
	const sources = stereoSources(buffer, side);
	if (sources.length === 1) return sources[0][0];
	const out = new Float32Array(buffer.length);
	for (const [data, gain] of sources) for (let i = 0; i < out.length; i++) out[i] += gain * data[i];
	return out;
}

/** The channels (and their gains) one stereo side is made of — stereoChannel without the copy (the mixdown reads them sample by sample). */
export function stereoSources(buffer: { numberOfChannels: number; getChannelData(channel: number): Float32Array }, side: 0 | 1): Array<[Float32Array, number]> {
	const n = buffer.numberOfChannels;
	if (n !== 6) return [[buffer.getChannelData(Math.min(side, n - 1)), 1]];
	return [
		[buffer.getChannelData(side), 1],
		[buffer.getChannelData(2), SURROUND_GAIN],
		[buffer.getChannelData(4 + side), SURROUND_GAIN],
	];
}
