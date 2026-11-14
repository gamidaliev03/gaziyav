// The loudness of the WHOLE timeline: the export's own mix (media/audio.ts) made here without writing a file, then
// measured by BS.1770 before and after the timeline's master. Asked for, never run by itself: a mix of a long film
// takes a while, shows its percent and can be cancelled.
//
// A result knows which mix it was made of (`mixKey`): after any change that can be heard it is «changed since
// measured», not silently wrong. A master that is only a fader moves the numbers by exactly its dB, so those stay
// right without a new measure.
import { create } from "zustand";
import type { EditorCore } from "@/core";
import { createTimelineAudioBuffer } from "@/media/audio";
import { playbackTracks } from "@/montage/compositions";
import type { SceneTracks, TimelineElement } from "@/timeline";
import { MeasureCancelled, type MeasureResult, type ProgrammeLoudness, measureProgramme } from "./dsp/offline";
import { type MasterMix, isNoMaster, masterOf, sameMaster } from "./master";
import { isTrackSilent, silencedBySolo } from "./solo";

export { MeasureCancelled };

export interface TimelineMeasure {
	/** The mix it was made of (everything that can be heard, the master apart). */
	key: string;
	sceneId: string;
	/** The mix before the master. */
	dry: ProgrammeLoudness;
	/** The programme after the master it was measured with: what the export carries. */
	out: MeasureResult;
	master: MasterMix;
	at: number;
}

interface MeasureState {
	result: TimelineMeasure | null;
	/** 0…1 while a measure runs, else null. */
	progress: number | null;
	/** What it is doing, in words. */
	stage: string;
	error: string | null;
}

export const useTimelineLoudness = create<MeasureState>()(() => ({ result: null, progress: null, stage: "", error: null }));

const SOUND_PARAMS = /^(volume|pan|muted|fadeIn|fadeOut|duckUnderVoice|voiceRole|fx\..*)$/;

/** Everything about these tracks that can be heard, as a short key (the master is not part of it). */
export function mixKey(tracks: SceneTracks): string {
	const silenced = silencedBySolo(tracks);
	const parts: unknown[] = [];
	for (const track of [...tracks.overlay, tracks.main, ...tracks.audio]) {
		if (track.type !== "audio" && track.type !== "video") continue;
		if (isTrackSilent(track, silenced)) continue;
		for (const element of track.elements as TimelineElement[]) {
			if (element.type !== "audio" && element.type !== "video") continue;
			const params: Record<string, unknown> = {};
			for (const [name, value] of Object.entries(element.params ?? {})) if (SOUND_PARAMS.test(name)) params[name] = value;
			if (params.muted === true) continue;
			const animations = (element.animations ?? {}) as Record<string, unknown>;
			parts.push([
				element.type,
				"mediaId" in element ? element.mediaId : (element as { sourceUrl?: string }).sourceUrl,
				element.startTime,
				element.duration,
				element.trimStart,
				element.trimEnd,
				element.type === "video" ? element.isSourceAudioEnabled !== false : true,
				element.retime ?? null,
				params,
				animations.volume ?? null,
				animations.pan ?? null,
			]);
		}
	}
	// FNV-1a over the text: short, and equal only for an equal mix (in practice)
	const text = JSON.stringify(parts);
	let a = 0x811c9dc5;
	let b = 0x1000193;
	for (let i = 0; i < text.length; i++) {
		a = Math.imul(a ^ text.charCodeAt(i), 0x01000193);
		b = Math.imul(b + text.charCodeAt(i), 0x5bd1e995) ^ (b >>> 13);
	}
	return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}:${text.length}`;
}

/** The programme's numbers for another master of the same mix, when they follow without a new measure. */
export function throughMaster(measure: TimelineMeasure, master: MasterMix): MeasureResult | null {
	if (sameMaster(master, measure.master)) return measure.out;
	// a fader alone moves every level by its dB; a limiter has to be heard again
	if (master.ceilingDb !== undefined) return null;
	const shift = master.gainDb;
	const dry = measure.dry;
	return {
		...dry,
		integrated: dry.integrated + shift,
		shortTermMax: dry.shortTermMax + shift,
		momentaryMax: dry.momentaryMax + shift,
		truePeakDb: dry.truePeakDb + shift,
		samplePeakDb: dry.samplePeakDb + shift,
		limiterDb: 0,
		limiterShare: 0,
	};
}

export interface FreshMeasure {
	measure: TimelineMeasure;
	/** The programme as it is now (after the timeline's present master). */
	now: MeasureResult;
}

/** The last measure, if it still describes what is on the timeline. */
export function freshMeasure(editor: EditorCore, result = useTimelineLoudness.getState().result): FreshMeasure | null {
	const scene = editor.scenes.getActiveSceneOrNull();
	if (!scene || !result || result.sceneId !== scene.id) return null;
	const tracks = playbackTracks(editor);
	if (mixKey(tracks) !== result.key) return null;
	const now = throughMaster(result, masterOf(scene.tracks));
	return now ? { measure: result, now } : null;
}

/** The bare mix of the open timeline, as the export makes it (its own files, 48 kHz stereo); null when it has no sound. */
export async function renderDryMix(editor: EditorCore): Promise<{ buffer: AudioBuffer; tracks: SceneTracks; key: string } | null> {
	const tracks = playbackTracks(editor);
	const duration = editor.timeline.getTotalDuration();
	if (duration <= 0) return null;
	const mediaAssets = await editor.media.withExportOriginals(editor.media.getAssets());
	// An offline context decodes and holds buffers without opening the Mac's audio device.
	const context = new OfflineAudioContext(2, 1, 48000) as unknown as AudioContext;
	const buffer = await createTimelineAudioBuffer({ tracks, mediaAssets, duration, audioContext: context, sampleRate: 48000, stage: "mix" });
	return buffer ? { buffer, tracks, key: mixKey(tracks) } : null;
}

let running: AbortController | null = null;

/** Stops the measure that is running (nothing changes on the timeline). */
export function cancelMeasure(): void {
	running?.abort();
}

/**
 * Measures the whole timeline (or gives the last measure back when nothing audible changed). One at a time: a second
 * call while one runs waits for the same answer.
 */
let pending: Promise<FreshMeasure | null> | null = null;
export function measureTimeline(editor: EditorCore, { force = false }: { force?: boolean } = {}): Promise<FreshMeasure | null> {
	if (pending) return pending;
	if (!force) {
		const fresh = freshMeasure(editor);
		if (fresh) return Promise.resolve(fresh);
	}
	const controller = new AbortController();
	running = controller;
	const set = useTimelineLoudness.setState;
	set({ progress: 0, stage: "Mixing the timeline", error: null });
	pending = (async () => {
		try {
			const scene = editor.scenes.getActiveScene();
			const master = masterOf(scene.tracks);
			const mix = await renderDryMix(editor);
			if (controller.signal.aborted) throw new MeasureCancelled();
			if (!mix) {
				set({ result: null, progress: null, stage: "", error: "Nothing on the timeline makes a sound." });
				return null;
			}
			const channels = Array.from({ length: mix.buffer.numberOfChannels }, (_, c) => mix.buffer.getChannelData(c));
			const withMaster = !isNoMaster(master);
			set({ progress: 0.5, stage: "Measuring the loudness" });
			const dry = await measureProgramme({ channels, sampleRate: mix.buffer.sampleRate, signal: controller.signal, onProgress: (share) => set({ progress: 0.5 + share * (withMaster ? 0.25 : 0.5) }) });
			const out = withMaster
				? await measureProgramme({ channels, sampleRate: mix.buffer.sampleRate, gainDb: master.gainDb, limiterCeilingDb: master.ceilingDb ?? null, signal: controller.signal, onProgress: (share) => set({ progress: 0.75 + share * 0.25 }) })
				: dry;
			const result: TimelineMeasure = { key: mix.key, sceneId: scene.id, dry, out, master, at: Date.now() };
			set({ result, progress: null, stage: "", error: null });
			return freshMeasure(editor, result) ?? { measure: result, now: out };
		} catch (error) {
			if (error instanceof MeasureCancelled || controller.signal.aborted) {
				set({ progress: null, stage: "", error: null });
				return null;
			}
			const message = error instanceof Error ? error.message : String(error);
			set({ progress: null, stage: "", error: message });
			throw error;
		} finally {
			pending = null;
			if (running === controller) running = null;
		}
	})();
	return pending;
}
