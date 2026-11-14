// Read-only handles for the proofs on the built app (GaziyavShell/test/ideal-sound-*.mjs): what the player's meter
// reads, the player's own samples, and the export's mix of the open timeline — so a test can hold the two against
// each other and against ffmpeg. Nothing here is used by the interface.
import { EditorCore } from "@/core";
import { createTimelineAudioBuffer } from "@/media/audio";
import { playbackTracks } from "@/montage/compositions";
import { measureProgramme } from "./dsp/offline";
import { workletSource } from "./dsp/worklet";
import { liveLoudness } from "./live";
import { masterOf } from "./master";
import { freshMeasure, measureTimeline, mixKey } from "./measure";

const editor = () => EditorCore.getInstance();

/** Interleaved 32-bit float samples as base64 (CDP returns values, not buffers). */
function base64(samples: Float32Array): string {
	const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
	let text = "";
	for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(text);
}

function interleave(channels: Float32Array[]): Float32Array {
	const n = channels[0]?.length ?? 0;
	const out = new Float32Array(n * 2);
	const right = channels[1] ?? channels[0];
	for (let i = 0; i < n; i++) {
		out[2 * i] = channels[0][i];
		out[2 * i + 1] = right[i];
	}
	return out;
}

let keepLive: (() => void) | null = null;

if (typeof window !== "undefined") {
	(window as unknown as { __gzSound?: unknown }).__gzSound = {
		/** The live meter's numbers now. */
		live: () => {
			keepLive ??= liveLoudness(editor()).want();
			const r = liveLoudness(editor()).reading();
			const n = (v: number) => (Number.isFinite(v) ? v : null);
			return { momentary: n(r.momentary), shortTerm: n(r.shortTerm), integrated: n(r.integrated), truePeakDb: n(r.truePeakDb), range: r.range, seconds: r.seconds, running: r.running, available: r.available };
		},
		liveReset: () => liveLoudness(editor()).reset(),
		/** The next `seconds` of what the player sends to the master's output: { sampleRate, f32: base64 interleaved }. */
		capture: async (seconds: number) => {
			keepLive ??= liveLoudness(editor()).want();
			const got = await liveLoudness(editor()).capture(seconds);
			return { sampleRate: got.sampleRate, f32: base64(interleave(got.channels)) };
		},
		/** The export's mix of the open timeline at 48 kHz ("mix": before the master): { sampleRate, f32 }. */
		exportMix: async (stage: "mix" | "master" = "master") => {
			const ed = editor();
			const tracks = playbackTracks(ed);
			const mediaAssets = await ed.media.withExportOriginals(ed.media.getAssets());
			const context = new OfflineAudioContext(2, 1, 48000) as unknown as AudioContext;
			const buffer = await createTimelineAudioBuffer({ tracks, mediaAssets, duration: ed.timeline.getTotalDuration(), audioContext: context, sampleRate: 48000, stage });
			if (!buffer) return null;
			return { sampleRate: buffer.sampleRate, f32: base64(interleave([buffer.getChannelData(0), buffer.getChannelData(1)])) };
		},
		/** The page's measure of the export's mix (after the master). */
		measureExport: async () => {
			const ed = editor();
			const tracks = playbackTracks(ed);
			const mediaAssets = await ed.media.withExportOriginals(ed.media.getAssets());
			const context = new OfflineAudioContext(2, 1, 48000) as unknown as AudioContext;
			const buffer = await createTimelineAudioBuffer({ tracks, mediaAssets, duration: ed.timeline.getTotalDuration(), audioContext: context, sampleRate: 48000 });
			if (!buffer) return null;
			return measureProgramme({ channels: [buffer.getChannelData(0), buffer.getChannelData(1)], sampleRate: buffer.sampleRate });
		},
		measure: async (force = true) => {
			const fresh = await measureTimeline(editor(), { force });
			return fresh ? { dry: fresh.measure.dry, now: fresh.now, master: fresh.measure.master } : null;
		},
		fresh: () => {
			const fresh = freshMeasure(editor());
			return fresh ? { now: fresh.now, master: fresh.measure.master } : null;
		},
		master: () => masterOf(editor().scenes.getActiveSceneOrNull()?.tracks),
		mixKey: () => mixKey(playbackTracks(editor())),
		limiterReduction: () => editor().audio.takeLimiterReduction(),
		/** The last «Sync by waveform» (what was found: lag in samples, drift). */
		lastSync: async () => (await import("./sync/run")).lastSync(),
		/** The text the audio thread loads, as this build made it. */
		workletSource,
	};
}
