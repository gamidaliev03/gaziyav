// Lipsync to audio that is already in the project:
//  "Audio under the clip" — the voice on the audio tracks during the selected video clip (a recording, a dub, a
//  voice-over) becomes the voice, mixed with each clip's volume (keyframes too) and at its place on the timeline: a
//  voice that starts 1 s into the clip starts 1 s into the lipsync too, so the mouth matches what is heard. Music is
//  left out (library sounds, and clips that duck under a voice): the mouth must not move to a beat. The result plays
//  silent over it (the timeline audio keeps playing, never doubled).
//  An audio file from the project's Media — the voice as is, like "Use an audio file…" without a Finder trip.
import type { EditorCore } from "@/core";
import type { MediaAsset } from "@/media/types";
import { resolveEffectiveAudioGain } from "@/timeline/audio-state";
import type { AudioElement, AudioTrack } from "@/timeline/types";
import { TICKS_PER_SECOND } from "@/wasm";
import { uploadOnce } from "./api";
import { useStudioStore } from "./studio-store";

const sec = (ticks: number) => ticks / TICKS_PER_SECOND;
const RATE = 44100;

/** Audio clips that play between `from` and `to` (timeline seconds), on audible tracks. */
export function audioUnder(editor: EditorCore, from: number, to: number): Array<{ element: AudioElement; track: AudioTrack }> {
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	if (!tracks) return [];
	const out: Array<{ element: AudioElement; track: AudioTrack }> = [];
	for (const track of tracks.audio) {
		for (const element of track.elements as AudioElement[]) {
			const start = sec(element.startTime);
			const end = start + sec(element.duration);
			// Not music: the library's sounds and music, or a clip set to duck under the voice.
			if (element.sourceType === "library" || element.params?.duckUnderVoice === true) continue;
			if (end > from + 0.05 && start < to - 0.05 && !track.muted) {
				out.push({ element, track });
			}
		}
	}
	return out;
}

async function sourceOf(editor: EditorCore, element: AudioElement): Promise<ArrayBuffer | null> {
	if (element.sourceType === "upload") {
		const asset = editor.media.getAssets().find((a) => a.id === element.mediaId);
		return asset?.file ? asset.file.arrayBuffer() : null;
	}
	const r = await fetch(element.sourceUrl).catch(() => null);
	return r?.ok ? r.arrayBuffer() : null;
}

/** The mix of the audio under `from…to` as a mono WAV file, aligned to `from` (silence where nothing plays). */
export async function renderAudioUnder(editor: EditorCore, from: number, to: number): Promise<File | null> {
	const parts = audioUnder(editor, from, to);
	if (!parts.length) return null;
	const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil((to - from) * RATE)), RATE);
	let placed = 0;
	for (const { element, track } of parts) {
		const data = await sourceOf(editor, element);
		if (!data) continue;
		const buffer = await ctx.decodeAudioData(data).catch(() => null);
		if (!buffer) continue;
		const rate = element.retime?.rate ?? 1;
		const start = sec(element.startTime);
		const a = Math.max(from, start);
		const b = Math.min(to, start + sec(element.duration));
		if (b <= a) continue;
		const node = ctx.createBufferSource();
		node.buffer = buffer;
		node.playbackRate.value = rate;
		// The clip's volume as it plays, keyframes included (sampled every 50 ms).
		const gain = ctx.createGain();
		for (let t = a; t <= b + 0.05; t += 0.05) {
			gain.gain.setValueAtTime(resolveEffectiveAudioGain({ element, trackMuted: !!track.muted, localTime: Math.min(t, b) - start }), t - from);
		}
		node.connect(gain).connect(ctx.destination);
		node.start(a - from, sec(element.trimStart) + (a - start) * rate, (b - a) * rate);
		placed++;
	}
	if (!placed) return null;
	const mix = await ctx.startRendering();
	return new File([wav(mix.getChannelData(0), RATE)], "Audio under the clip.wav", { type: "audio/wav" });
}

/** 16-bit PCM WAV of mono samples (clipped to ±1). */
function wav(samples: Float32Array, rate: number): ArrayBuffer {
	const out = new ArrayBuffer(44 + samples.length * 2);
	const v = new DataView(out);
	const text = (at: number, s: string) => {
		for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
	};
	text(0, "RIFF");
	v.setUint32(4, 36 + samples.length * 2, true);
	text(8, "WAVE");
	text(12, "fmt ");
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true);
	v.setUint16(22, 1, true);
	v.setUint32(24, rate, true);
	v.setUint32(28, rate * 2, true);
	v.setUint16(32, 2, true);
	v.setUint16(34, 16, true);
	text(36, "data");
	v.setUint32(40, samples.length * 2, true);
	for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
	return out;
}

const made = new Map<string, Promise<{ fileId: string; seconds: number }>>();

/** The audio under `from…to` on the pipeline side: rendered and sent once per timeline state. */
export function timelineVoiceFile(editor: EditorCore, from: number, to: number): Promise<{ fileId: string; seconds: number }> {
	const key = `${from.toFixed(3)}:${to.toFixed(3)}:${audioUnder(editor, from, to)
		.map(({ element, track }) => [element.id, element.startTime, element.duration, element.trimStart, track.muted, JSON.stringify(element.params ?? {})].join(","))
		.join("|")}`;
	let job = made.get(key);
	if (!job) {
		job = (async () => {
			const file = await renderAudioUnder(editor, from, to);
			if (!file) throw new Error("No audio under the clip on the timeline. Put the voice on an audio track under it, or pick another voice.");
			const up = await uploadOnce(`timeline-voice:${key}`, file);
			return { fileId: up.fileId, seconds: up.duration };
		})();
		made.set(key, job);
		job.catch(() => made.delete(key));
	}
	return job;
}

/** "Audio under the clip" as the voice of the selected clip (`from…to`: the clip on the timeline). */
export async function setVoiceFromTimeline(editor: EditorCore, projectId: string, from: number, to: number): Promise<void> {
	const { fileId, seconds } = await timelineVoiceFile(editor, from, to);
	useStudioStore.getState().patch(projectId, {
		voice: "timeline",
		voiceName: "Audio under the clip",
		speech: { fileId, name: "Audio under the clip", seconds, text: "", voiceId: "timeline" },
	});
}

/** An audio file of the project's Media as the voice. */
export async function setVoiceFromAsset(projectId: string, asset: MediaAsset): Promise<void> {
	if (!asset.file) throw new Error("This audio file is not available any more. Import it again.");
	const up = await uploadOnce(`media:${asset.id}`, asset.file);
	if (!up.hasAudio) throw new Error("This file has no sound");
	useStudioStore.getState().patch(projectId, {
		voice: "file",
		voiceName: asset.name,
		speech: { fileId: up.fileId, mediaId: asset.id, name: asset.name, seconds: up.duration, text: "", voiceId: "file" },
	});
}
