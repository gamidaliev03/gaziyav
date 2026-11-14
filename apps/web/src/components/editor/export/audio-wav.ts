// Export → WAV: the timeline's sound alone, as 24-bit PCM (every editor and DAW opens it; no encoder involved). It was
// 16-bit: a 24-bit recording lost its last 8 bits, undithered, and a quiet room tone at −110 dBFS came out as digital
// silence; Final Cut writes 24-bit, as pro-heavy checks (09.11). FLAC is made from this file and keeps the 24 bits.
import type { EditorCore } from "@/core";
import { sliceActiveSceneToRange } from "@/in-out/slice";
import { createTimelineAudioBuffer } from "@/media/audio";
import { playbackTracks } from "@/montage/compositions";

interface PcmSource {
	numberOfChannels: number;
	sampleRate: number;
	length: number;
	getChannelData(channel: number): Float32Array<ArrayBufferLike>;
}

const BYTES_PER_SAMPLE = 3;
const FULL_SCALE = 0x800000;

/** A RIFF/WAVE file: interleaved 24-bit samples, clipped to ±1. */
export function encodeWav(audio: PcmSource): ArrayBuffer {
	const { numberOfChannels: channels, sampleRate, length } = audio;
	const dataBytes = length * channels * BYTES_PER_SAMPLE;
	const view = new DataView(new ArrayBuffer(44 + dataBytes));
	const text = (at: number, value: string) => {
		for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
	};
	text(0, "RIFF");
	view.setUint32(4, 36 + dataBytes, true);
	text(8, "WAVE");
	text(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, channels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * channels * BYTES_PER_SAMPLE, true);
	view.setUint16(32, channels * BYTES_PER_SAMPLE, true);
	view.setUint16(34, 8 * BYTES_PER_SAMPLE, true);
	text(36, "data");
	view.setUint32(40, dataBytes, true);
	const data = Array.from({ length: channels }, (_, channel) => audio.getChannelData(channel));
	let at = 44;
	for (let i = 0; i < length; i++) {
		for (let channel = 0; channel < channels; channel++) {
			const sample = Math.max(-1, Math.min(1, data[channel][i]));
			const value = Math.max(-FULL_SCALE, Math.min(FULL_SCALE - 1, Math.round(sample * FULL_SCALE)));
			view.setUint8(at, value & 0xff);
			view.setUint8(at + 1, (value >> 8) & 0xff);
			view.setUint8(at + 2, (value >> 16) & 0xff);
			at += BYTES_PER_SAMPLE;
		}
	}
	return view.buffer;
}

/** About how big the WAV gets: 48 kHz stereo, 24-bit (the export mix's rate). */
export function estimateWavBytes(seconds: number): number {
	return 44 + Math.round(Math.max(0, seconds) * 48_000) * 2 * BYTES_PER_SAMPLE;
}

/**
 * The same mix the video export uses (In→Out, AI compositions, −14 LUFS), from the same files: the user's originals,
 * not the H.264 editing copies (whose sound is a second AAC generation), or null when nothing on the timeline makes a
 * sound.
 */
export async function renderTimelineWav({
	editor,
	range,
	normalize,
	targetLufs,
}: {
	editor: EditorCore;
	range?: { start: number; end: number };
	normalize: boolean;
	targetLufs?: number;
}): Promise<ArrayBuffer | null> {
	const tracks = playbackTracks(editor, range ? sliceActiveSceneToRange({ editor, range }) : null);
	const duration = range ? range.end - range.start : editor.timeline.getTotalDuration();
	const mediaAssets = await editor.media.withExportOriginals(editor.media.getAssets());
	const mix = await createTimelineAudioBuffer({ tracks, mediaAssets, duration, normalize, targetLufs });
	return mix ? encodeWav(mix) : null;
}
