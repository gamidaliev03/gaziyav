// Per-clip gain envelope shared by preview playback and export: volume (incl. keyframes) ×
// fade in/out × ducking under voice. Preview turns it into AudioParam ramps, export evaluates
// it per sample block — both read the same function, so what you hear is what you export.
import type { MediaAsset } from "@/media/types";
import type { SceneTracks, TimelineElement } from "@/timeline";
import { canTrackHaveAudio } from "@/timeline/track-capabilities";
import { canElementHaveAudio, hasMediaId } from "@/timeline/element-utils";
import { doesElementHaveEnabledAudio } from "@/timeline/audio-separation";
import {
	type AudioCapableElement,
	getElementVolume,
	hasAnimatedVolume,
	isElementMuted,
	resolveEffectiveAudioGain,
} from "@/timeline/audio-state";
import { TICKS_PER_SECOND } from "@/wasm";
import { getClipTimeAtSourceTime } from "@/retime/resolve";
import { FADE_MAX_SECONDS, type MixSettings, fadeGainAt, readMixSettings } from "./fades";
import { isTrackSilent, silencedBySolo } from "@/sound/solo";

export { FADE_MAX_SECONDS, fadeGainAt, readMixSettings, type MixSettings };

/** Music under voice: −12 dB, 50 ms down (finished as the voice starts), 400 ms back up. */
export const DUCK_DB = -12;
export const DUCK_ATTACK_SECONDS = 0.05;
export const DUCK_RELEASE_SECONDS = 0.4;
/** Voice clips closer than this are treated as one phrase (no pumping between them). */
const DUCK_MERGE_GAP_SECONDS = 0.5;

export type VoiceRole = "auto" | "yes" | "no";

export interface DuckRange {
	start: number;
	end: number;
}

const VOICE_NAME = /(голос|липсинк|озвуч|диктор|речь|voice|vocal|lipsync|lip-sync|narrat|speech|^vo[\s_.-])/i;

export function readVoiceRole(element: AudioCapableElement): VoiceRole {
	const v = (element.params as Record<string, unknown>).voiceRole;
	return v === "yes" || v === "no" ? v : "auto";
}

/**
 * Is this clip a voice that music should duck under?
 * «Это голос: Да/Нет» decides; on «Авто»: results of the lipsync/voice-over pipeline and
 * anything named like a voice, the sound of video clips (talking heads), and audio extracted
 * from a video. Library music/SFX and clips that duck themselves are never voices.
 */
export function isVoiceElement({
	element,
	mediaAsset,
}: {
	element: AudioCapableElement;
	mediaAsset: MediaAsset | null;
}): boolean {
	const role = readVoiceRole(element);
	if (role === "no") return false;
	if (readMixSettings(element).duck) return false;
	if (role === "yes") return true;
	if (VOICE_NAME.test(element.name)) return true;
	if (element.type === "video") return true;
	if (element.type === "audio" && element.sourceType === "upload") {
		return mediaAsset?.type === "video";
	}
	return false;
}

/** Where a voice clip's audio comes from (for voice-activity analysis). */
export interface VoiceSource {
	sourceKey: string;
	sourceFile?: File;
	audioUrl?: string;
}

export function voiceSourceOf({
	element,
	mediaAsset,
}: {
	element: AudioCapableElement;
	mediaAsset: MediaAsset | null;
}): VoiceSource | null {
	if (element.type === "audio" && element.sourceType === "library") {
		return { sourceKey: `library:${element.sourceUrl}`, audioUrl: element.sourceUrl };
	}
	if (!mediaAsset) return null;
	return { sourceKey: `media:${mediaAsset.id}`, sourceFile: mediaAsset.file };
}

/** Every audible voice clip on the timeline. */
export function collectVoiceElements({
	tracks,
	mediaAssets,
}: {
	tracks: SceneTracks;
	mediaAssets: MediaAsset[];
}): Array<{ element: AudioCapableElement; mediaAsset: MediaAsset | null }> {
	const mediaMap = new Map(mediaAssets.map((a) => [a.id, a]));
	const out: Array<{ element: AudioCapableElement; mediaAsset: MediaAsset | null }> = [];
	// a voice nobody hears (its track muted, or silenced by another track's Solo) ducks nothing
	const silenced = silencedBySolo(tracks);
	for (const track of [...tracks.overlay, tracks.main, ...tracks.audio]) {
		if (isTrackSilent(track, silenced)) continue;
		for (const element of track.elements as TimelineElement[]) {
			if (!canElementHaveAudio(element)) continue;
			if (element.duration <= 0 || isElementMuted({ element })) continue;
			if (getElementVolume({ element }) <= -40 && !hasAnimatedVolume({ element })) continue;
			const mediaAsset = hasMediaId(element) ? (mediaMap.get(element.mediaId) ?? null) : null;
			if (!doesElementHaveEnabledAudio({ element, mediaAsset })) continue;
			if (!isVoiceElement({ element, mediaAsset })) continue;
			out.push({ element, mediaAsset });
		}
	}
	return out;
}

/**
 * Timeline ranges (seconds) where voice is heard, merged. With `speech` (voice activity per
 * source, in source seconds) only the parts where someone speaks count; a clip whose
 * analysis is not available ducks for its whole length.
 */
export function collectVoiceRanges({
	tracks,
	mediaAssets,
	speech,
}: {
	tracks: SceneTracks;
	mediaAssets: MediaAsset[];
	speech?: (source: VoiceSource) => ReadonlyArray<{ start: number; end: number }> | null | undefined;
}): DuckRange[] {
	const ranges: DuckRange[] = [];
	for (const { element, mediaAsset } of collectVoiceElements({ tracks, mediaAssets })) {
		const start = element.startTime / TICKS_PER_SECOND;
		const duration = element.duration / TICKS_PER_SECOND;
		const source = voiceSourceOf({ element, mediaAsset });
		const active = source && speech ? speech(source) : null;
		const curve = (element.retime as { mode?: unknown } | undefined)?.mode === "curve";
		if (!active || curve) {
			ranges.push({ start, end: start + duration });
			continue;
		}
		const trim = element.trimStart / TICKS_PER_SECOND;
		for (const r of active) {
			const a = getClipTimeAtSourceTime({ sourceTime: r.start - trim, retime: element.retime });
			const b = getClipTimeAtSourceTime({ sourceTime: r.end - trim, retime: element.retime });
			const lo = Math.max(0, a);
			const hi = Math.min(duration, b);
			if (hi > lo) ranges.push({ start: start + lo, end: start + hi });
		}
	}
	return mergeRanges(ranges);
}

export function mergeRanges(ranges: DuckRange[]): DuckRange[] {
	const sorted = [...ranges].sort((a, b) => a.start - b.start);
	const out: DuckRange[] = [];
	for (const r of sorted) {
		const last = out[out.length - 1];
		if (last && r.start - last.end < DUCK_MERGE_GAP_SECONDS) {
			last.end = Math.max(last.end, r.end);
		} else {
			out.push({ ...r });
		}
	}
	return out;
}

/** Ducking in dB at a timeline time (0 = no ducking). */
export function duckDbAt(ranges: readonly DuckRange[], time: number): number {
	let db = 0;
	for (const r of ranges) {
		if (time < r.start - DUCK_ATTACK_SECONDS) break; // sorted: the rest start later
		let d = 0;
		if (time < r.start) {
			d = (DUCK_DB * (time - (r.start - DUCK_ATTACK_SECONDS))) / DUCK_ATTACK_SECONDS;
		} else if (time <= r.end) {
			d = DUCK_DB;
		} else if (time < r.end + DUCK_RELEASE_SECONDS) {
			d = DUCK_DB * (1 - (time - r.end) / DUCK_RELEASE_SECONDS);
		}
		if (d < db) db = d;
	}
	return db;
}

export interface ClipEnvelope {
	element: AudioCapableElement;
	/** Clip position on the timeline and its length, seconds. */
	startTime: number;
	duration: number;
	settings: MixSettings;
	/** Voice ranges; only used when the clip ducks. */
	duckRanges: readonly DuckRange[];
	trackMuted?: boolean;
}

export function makeClipEnvelope({
	element,
	startTime,
	duration,
	voiceRanges,
	trackMuted,
}: {
	element: AudioCapableElement;
	startTime: number;
	duration: number;
	voiceRanges: readonly DuckRange[];
	trackMuted?: boolean;
}): ClipEnvelope {
	const settings = readMixSettings(element);
	return {
		element,
		startTime,
		duration,
		settings,
		duckRanges: settings.duck ? voiceRanges : [],
		trackMuted,
	};
}

/** Does the envelope change over time (anything beyond a constant volume)? */
export function isEnvelopeDynamic(env: ClipEnvelope): boolean {
	const clipEnd = env.startTime + env.duration;
	return (
		env.settings.fadeIn > 0 ||
		env.settings.fadeOut > 0 ||
		hasAnimatedVolume({ element: env.element }) ||
		env.duckRanges.some(
			(r) => r.start - DUCK_ATTACK_SECONDS < clipEnd && r.end + DUCK_RELEASE_SECONDS > env.startTime,
		)
	);
}

/** Linear gain at a time inside the clip (seconds from the clip's start). */
export function envelopeGainAt(env: ClipEnvelope, localTime: number): number {
	const volume = resolveEffectiveAudioGain({
		element: env.element,
		trackMuted: env.trackMuted,
		localTime,
	});
	if (volume === 0) return 0;
	const fade = fadeGainAt(env.settings, localTime, env.duration);
	const duck = env.duckRanges.length ? 10 ** (duckDbAt(env.duckRanges, env.startTime + localTime) / 20) : 1;
	return volume * fade * duck;
}

/**
 * Break-points for AudioParam automation between two clip-local times: dense only where
 * the envelope moves (fades, duck ramps, keyframed volume), collinear points dropped.
 */
export function buildEnvelopeAutomation(
	env: ClipEnvelope,
	fromLocal: number,
	toLocal: number,
): Array<{ localTime: number; gain: number }> {
	const from = Math.max(0, fromLocal);
	const to = Math.max(from, Math.min(env.duration, toLocal));
	const times: number[] = [from, to];
	const span = (a: number, b: number, step: number) => {
		const lo = Math.max(from, a);
		const hi = Math.min(to, b);
		if (hi <= lo) return;
		for (let t = lo; t < hi; t += step) times.push(t);
		times.push(hi);
	};
	const { fadeIn, fadeOut } = env.settings;
	if (fadeIn > 0) span(0, fadeIn, Math.max(0.01, fadeIn / 40));
	if (fadeOut > 0) span(env.duration - fadeOut, env.duration, Math.max(0.01, fadeOut / 40));
	for (const r of env.duckRanges) {
		const s = r.start - env.startTime;
		const e = r.end - env.startTime;
		span(s - DUCK_ATTACK_SECONDS, s, 0.01);
		span(e, e + DUCK_RELEASE_SECONDS, 0.04);
	}
	if (hasAnimatedVolume({ element: env.element })) span(from, to, 1 / 60);

	times.sort((a, b) => a - b);
	const points: Array<{ localTime: number; gain: number }> = [];
	for (const t of times) {
		if (points.length && t - points[points.length - 1].localTime < 1e-4) continue;
		points.push({ localTime: t, gain: envelopeGainAt(env, t) });
	}
	// Drop points that sit on the line between their neighbours.
	const pruned: typeof points = [];
	for (let i = 0; i < points.length; i++) {
		const prev = pruned[pruned.length - 1];
		const cur = points[i];
		const nxt = points[i + 1];
		if (prev && nxt) {
			const k = (cur.localTime - prev.localTime) / (nxt.localTime - prev.localTime);
			if (Math.abs(prev.gain + (nxt.gain - prev.gain) * k - cur.gain) < 1e-4) continue;
		}
		pruned.push(cur);
	}
	return pruned;
}

/**
 * Export: per-sample gain for `length` samples of the clip (clip-local time 0 = sample 0).
 * The envelope is evaluated every `step` samples (~3 ms at 44.1 kHz) and interpolated, which
 * is inaudible for fades/ducking and ~100× cheaper than evaluating keyframes per sample.
 */
export function renderEnvelopeGains(
	env: ClipEnvelope,
	length: number,
	sampleRate: number,
	step = 128,
): Float32Array {
	const out = new Float32Array(Math.max(0, length));
	if (length <= 0) return out;
	let prev = envelopeGainAt(env, 0);
	for (let start = 0; start < length; start += step) {
		const end = Math.min(length, start + step);
		const next = envelopeGainAt(env, end / sampleRate);
		const span = end - start;
		for (let i = start; i < end; i++) out[i] = prev + ((next - prev) * (i - start)) / span;
		prev = next;
	}
	return out;
}

/**
 * Preview: schedule the clip envelope on a GainNode for a piece of the clip that starts
 * playing at `contextTime` from clip-local time `fromLocal` and lasts until `toLocal`.
 * Constant envelopes become one setValueAtTime (no automation cost).
 */
export function scheduleEnvelopeOnGain({
	gain,
	env,
	contextTime,
	fromLocal,
	toLocal,
	now,
}: {
	gain: AudioParam;
	env: ClipEnvelope;
	contextTime: number;
	fromLocal: number;
	toLocal: number;
	now: number;
}): void {
	const startAt = Math.max(now, contextTime);
	gain.cancelScheduledValues(0);
	if (!isEnvelopeDynamic(env)) {
		gain.setValueAtTime(envelopeGainAt(env, fromLocal), startAt);
		return;
	}
	const points = buildEnvelopeAutomation(env, fromLocal, toLocal);
	if (points.length === 0) return;
	const offset = startAt - contextTime; // late start: skip what already passed
	const first = envelopeGainAt(env, fromLocal + Math.max(0, offset));
	gain.setValueAtTime(first, startAt);
	for (const p of points) {
		const at = contextTime + (p.localTime - fromLocal);
		if (at <= startAt) continue;
		gain.linearRampToValueAtTime(p.gain, at);
	}
}
