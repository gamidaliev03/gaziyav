// Beat Markers (Kadr: Assist → Mark Music Beats): the music clip's sound is analysed on this Mac and a marker is
// put on every beat inside the clip. Clips snap to markers while moving and trimming (snap-to-beat), so cuts
// land on the beat. One ⌘Z adds them all; "Remove beat markers" takes them away again.
import { EditorCore } from "@/core";
import type { Bookmark } from "@/timeline";
import { type BeatAnalysis, detectBeatsFromEnvelope, EnvelopeBuilder, hopFor } from "./beats";
import { SetBookmarksCommand } from "./commands";
import { runAssist, throwIfAborted } from "./run";
import { frameTime } from "./scenes";
import { type ClipRef, isSoundClip, pickClip, type ResolvedClip } from "./target";

/** Beat markers are told apart from the user's own markers by this colour. */
export const BEAT_MARKER_COLOR = "#C026D3";
/** Bar starts (downbeats, the «one»): the strong beats to land cuts and title hits on. */
export const BAR_MARKER_COLOR = "#7C3AED";

export const isBeatMarker = (b: Bookmark) => {
	const c = (b.color ?? "").toUpperCase();
	return (c === BEAT_MARKER_COLOR || c === BAR_MARKER_COLOR) && !b.note;
};

/**
 * Beats and bar starts from the app's server (hear/client.ts: the file listened to once, cached): nothing is decoded
 * in the window. Timeline seconds. Null when the server can't hear it (the window's own tracker decides then).
 */
async function heardBeats(clip: ResolvedClip, signal: AbortSignal): Promise<{ beats: number[]; bars: number[]; bpm: number } | null> {
	try {
		const { findSounding, mapClip } = await import("@/hear/client");
		const s = findSounding(clip.element.id);
		if (!s) return null;
		const m = await mapClip(s, undefined, { signal });
		const beats = m.grid?.beats.length ? m.grid.beats : m.beats;
		return beats.length ? { beats, bars: m.grid?.downbeats ?? [], bpm: m.grid?.bpm ?? m.bpm } : { beats: [], bars: [], bpm: 0 };
	} catch (error) {
		if ((error as Error)?.name === "AbortError") throw error;
		return null;
	}
}

async function clipBlob(clip: ResolvedClip): Promise<Blob> {
	if (clip.asset?.file) return clip.asset.file;
	const el = clip.element;
	if (el.type === "audio" && el.sourceType === "library") {
		const res = await fetch(el.sourceUrl).catch(() => null);
		if (!res?.ok) throw new Error("Couldn't open this music file. Re-add it from Audio.");
		return res.blob();
	}
	throw new Error("This clip has no sound file.");
}

/** Beats of the clip's piece of its file, in seconds from the piece's start. Streams the audio (bounded memory). */
async function analyse(clip: ResolvedClip, signal: AbortSignal, onProgress: (p: number) => void): Promise<BeatAnalysis> {
	const blob = await clipBlob(clip);
	const from = clip.sourceStart;
	const to = clip.sourceStart + clip.sourceLength;
	const { ALL_FORMATS, AudioBufferSink, Input } = await import("mediabunny");
	const { fileSource } = await import("@/media/file-source");
	const input = new Input({ source: fileSource(blob), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryAudioTrack().catch(() => null);
		if (track) {
			const rate = track.sampleRate;
			const builder = new EnvelopeBuilder(hopFor(rate));
			const first = await track.getFirstTimestamp();
			for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers(first + from, first + to)) {
				throwIfAborted(signal);
				const mono = new Float32Array(buffer.length);
				for (let c = 0; c < buffer.numberOfChannels; c++) {
					const d = buffer.getChannelData(c);
					for (let i = 0; i < d.length; i++) mono[i] += d[i] / buffer.numberOfChannels;
				}
				// The first buffer may start before the clip's piece: skip what's before it.
				const skip = Math.max(0, Math.round((first + from - timestamp) * buffer.sampleRate));
				builder.push(skip ? mono.subarray(skip) : mono);
				onProgress(Math.min(0.99, (timestamp - first - from) / Math.max(0.1, to - from)));
			}
			return detectBeatsFromEnvelope(builder.env, rate / builder.hop);
		}
	} finally {
		input.dispose?.();
	}
	// Formats mediabunny can't read (rare): the browser's decoder.
	const ctx = new OfflineAudioContext(1, 1, 22050);
	const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
	throwIfAborted(signal);
	const rate = decoded.sampleRate;
	const a = Math.floor(from * rate);
	const b = Math.min(decoded.length, Math.ceil(to * rate));
	const mono = new Float32Array(Math.max(0, b - a));
	for (let c = 0; c < decoded.numberOfChannels; c++) {
		const d = decoded.getChannelData(c).subarray(a, b);
		for (let i = 0; i < d.length; i++) mono[i] += d[i] / decoded.numberOfChannels;
	}
	const builder = new EnvelopeBuilder(hopFor(rate));
	builder.push(mono);
	return detectBeatsFromEnvelope(builder.env, rate / builder.hop);
}

export function markBeats(ref?: ClipRef) {
	const editor = EditorCore.getInstance();
	// A music clip first (Kadr: audio clips), else a video with sound.
	const clip = ref ? pickClip(editor, ref, isSoundClip) : (pickClip(editor, undefined, (c) => c.element.type === "audio" && isSoundClip(c)) ?? pickClip(editor, undefined, isSoundClip));
	return runAssist("Beat markers", async (ctl) => {
		if (!clip) throw new Error("Select a music clip on the timeline first.");
		ctl.stage("Listening for the beat", 0);
		const lo = clip.element.startTime as number;
		const hi = lo + (clip.element.duration as number);
		const heard = await heardBeats(clip, ctl.signal);
		let times: number[];
		let bars = new Set<number>();
		let bpm: number;
		if (heard) {
			times = [...new Set(heard.beats.map((b) => frameTime(editor, b) as number))].filter((t) => t >= lo && t < hi);
			bars = new Set(heard.bars.map((b) => frameTime(editor, b) as number));
			bpm = heard.bpm;
		} else {
			const r = await analyse(clip, ctl.signal, (p) => ctl.stage("Listening for the beat", p));
			times = [...new Set(r.beats.map((b) => frameTime(editor, clip.timeAt(b)) as number))].filter((t) => t >= lo && t < hi);
			bpm = r.bpm;
		}
		throwIfAborted(ctl.signal);
		if (!times.length || !(bpm > 0)) return { message: "No clear beat found in this clip" };
		editor.command.execute({
			command: new SetBookmarksCommand((current) => {
				// Earlier beat markers inside this clip are replaced; the user's own markers stay.
				const kept = current.filter((b) => {
					const t = b.time as number;
					return !(isBeatMarker(b) && t >= lo && t < hi);
				});
				const keptTimes = new Set(kept.map((b) => b.time as number));
				const added = times.filter((t) => !keptTimes.has(t)).map((t) => ({ time: t, color: bars.has(t) ? BAR_MARKER_COLOR : BEAT_MARKER_COLOR }) as Bookmark);
				return [...kept, ...added];
			}),
		});
		const after = editor.scenes.getActiveScene().bookmarks;
		return {
			message: `${times.length} beat markers${bars.size ? ` (${times.filter((t) => bars.has(t)).length} bar starts, darker)` : ""} · ${Math.round(bpm)} BPM — clips snap to them`,
			undo: () => {
				if (editor.scenes.getActiveScene().bookmarks === after) editor.command.undo();
			},
		};
	});
}

export function removeBeatMarkers() {
	const editor = EditorCore.getInstance();
	const n = (editor.scenes.getActiveSceneOrNull()?.bookmarks ?? []).filter(isBeatMarker).length;
	if (!n) return;
	editor.command.execute({ command: new SetBookmarksCommand((current) => current.filter((b) => !isBeatMarker(b))) });
	return n;
}
