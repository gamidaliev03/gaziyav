// What a mixer strip shows and writes. A strip is a VIEW of values the project already holds — the volume and pan
// of the track's clips (their keyframes included), the track's mute, its solo: nothing is kept in the mixer itself.
//
//   · The fader stands at the level of the clip under the playhead (the nearest clip when none is under it).
//   · Moving it moves EVERY clip of the track by the same amount, keyframes and all: what differed between the clips
//     keeps differing, a ducked stretch stays ducked — only the whole track is louder or quieter.
//   · When the playhead stands on a volume keyframe of that clip (its ◆ is lit), the fader moves that keyframe.
//
// Pure functions over tracks: the components preview and commit what they return through the timeline's own
// preview / commit (one ⌘Z a drag), exactly as the inspector does.
import { getKeyframeAtTime, hasKeyframesForPath, upsertPathKeyframe } from "@/animation";
import { resolveAnimationPathValueAtTime } from "@/animation/resolve";
import type { ElementAnimations, ScalarAnimationChannel } from "@/animation/types";
import type { MediaAsset } from "@/media/types";
import { coerceParamValue, getParamChannelLayout } from "@/params";
import { getElementParam } from "@/params/registry";
import { PAN_MAX, PAN_MIN, PAN_PATH } from "@/sounds/mix/pan";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline";
import { VOLUME_DB_MAX, VOLUME_DB_MIN } from "@/timeline/audio-constants";
import type { AudioCapableElement } from "@/timeline/audio-state";
import type { MediaTime } from "@/wasm";
import { isSoloed } from "../solo";

export const VOLUME_PATH = "volume";

export interface Strip {
	trackId: string;
	/** "main", or the track's kind. */
	kind: "main" | "video" | "audio";
	/** The track's own name when it was given one («· drums»), else null: the kind and number say it. */
	name: string | null;
	/** 1-based among tracks of its kind (0 when it is the only one, and for the main track). */
	number: number;
	muted: boolean;
	solo: boolean;
	/** The clips of the track that make a sound. */
	clips: AudioCapableElement[];
}

const DEFAULT_NAMES = new Set(["", "Main Track", "Video Track", "Audio Track", "Video track", "Audio track", "Video", "Audio"]);

const makesSound = (element: TimelineElement, assets: ReadonlyMap<string, MediaAsset>): element is AudioCapableElement => {
	if (element.type === "audio") return true;
	if (element.type !== "video") return false;
	const asset = assets.get(element.mediaId);
	return !!asset && asset.hasAudio !== false && element.isSourceAudioEnabled !== false;
};

/** One strip per track that has a clip with sound, in the timeline's order (top row first). */
export function stripsOf(tracks: SceneTracks, mediaAssets: readonly MediaAsset[]): Strip[] {
	const assets = new Map(mediaAssets.map((asset) => [asset.id, asset]));
	const rows: TimelineTrack[] = [...tracks.overlay, tracks.main, ...tracks.audio];
	const counted = rows
		.map((track) => ({ track, clips: (track.type === "audio" || track.type === "video" ? (track.elements as TimelineElement[]).filter((e) => makesSound(e, assets)) : []) as AudioCapableElement[] }))
		.filter((row) => row.clips.length > 0);
	const totals = new Map<string, number>();
	for (const { track } of counted) if (track.id !== tracks.main.id) totals.set(track.type, (totals.get(track.type) ?? 0) + 1);
	const seen = new Map<string, number>();
	return counted.map(({ track, clips }) => {
		const main = track.id === tracks.main.id;
		const n = main ? 0 : (seen.get(track.type) ?? 0) + 1;
		if (!main) seen.set(track.type, n);
		return {
			trackId: track.id,
			kind: main ? "main" : (track.type as "video" | "audio"),
			name: DEFAULT_NAMES.has(track.name ?? "") ? null : track.name,
			number: !main && (totals.get(track.type) ?? 0) > 1 ? n : 0,
			muted: (track as { muted?: boolean }).muted === true,
			solo: isSoloed(track),
			clips,
		};
	});
}

/** The clip a strip speaks for at `time` (ticks): the one under the playhead, else the next one, else the last. */
export function clipAt(clips: readonly AudioCapableElement[], time: number): { clip: AudioCapableElement; under: boolean } | null {
	if (clips.length === 0) return null;
	let next: AudioCapableElement | null = null;
	let last: AudioCapableElement = clips[0];
	for (const clip of clips) {
		if (time >= clip.startTime && time < clip.startTime + clip.duration) return { clip, under: true };
		if (clip.startTime > time && (!next || clip.startTime < next.startTime)) next = clip;
		if (clip.startTime > last.startTime) last = clip;
	}
	return { clip: next ?? last, under: false };
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const hundredth = (value: number) => Math.round(value * 100) / 100;
const baseVolume = (element: AudioCapableElement) => (typeof element.params.volume === "number" ? element.params.volume : 0);
const basePan = (element: AudioCapableElement) => (typeof element.params.pan === "number" ? element.params.pan : 0);
/** The playhead's time inside a clip (ticks from its start, kept inside it). */
export const localTime = (clip: AudioCapableElement, time: number) => clamp(Math.round(time - clip.startTime), 0, clip.duration) as MediaTime;

export interface StripReading {
	clipId: string;
	/** The playhead is over the clip (false: the fader shows the nearest clip). */
	under: boolean;
	volumeDb: number;
	pan: number;
	/** The clip's volume has keyframes; and one of them is under the playhead. */
	animated: boolean;
	keyed: boolean;
}

export function readStrip(strip: Strip, time: number): StripReading | null {
	const at = clipAt(strip.clips, time);
	if (!at) return null;
	const { clip, under } = at;
	const local = localTime(clip, time);
	const animated = hasKeyframesForPath({ animations: clip.animations, propertyPath: VOLUME_PATH });
	return {
		clipId: clip.id,
		under,
		volumeDb: resolveAnimationPathValueAtTime({ animations: clip.animations, propertyPath: VOLUME_PATH, localTime: local, fallbackValue: baseVolume(clip) }) as number,
		pan: resolveAnimationPathValueAtTime({ animations: clip.animations, propertyPath: PAN_PATH, localTime: local, fallbackValue: basePan(clip) }) as number,
		animated,
		keyed: under && animated && getKeyframeAtTime({ animations: clip.animations, propertyPath: VOLUME_PATH, time: local }) !== null,
	};
}

/** A scalar channel with every key moved by `delta` and kept inside [lo, hi]. */
function shiftChannel(animations: ElementAnimations | undefined, path: string, delta: number, lo: number, hi: number): ElementAnimations | undefined {
	const channel = animations?.[path] as ScalarAnimationChannel | undefined;
	if (!channel || !Array.isArray(channel.keys) || channel.keys.length === 0) return animations;
	return { ...animations, [path]: { ...channel, keys: channel.keys.map((key) => ({ ...key, value: hundredth(clamp(key.value + delta, lo, hi)) })) } };
}

export type ClipPatch = { elementId: string; updates: Partial<TimelineElement> };

/** Every clip of the strip louder or quieter by `deltaDb`: its volume and each of its volume keyframes. */
export function shiftVolumes(clips: readonly AudioCapableElement[], deltaDb: number): ClipPatch[] {
	return clips.map((clip) => {
		const animations = shiftChannel(clip.animations, VOLUME_PATH, deltaDb, VOLUME_DB_MIN, VOLUME_DB_MAX);
		return {
			elementId: clip.id,
			updates: { params: { volume: hundredth(clamp(baseVolume(clip) + deltaDb, VOLUME_DB_MIN, VOLUME_DB_MAX)) }, ...(animations !== clip.animations ? { animations } : {}) } as Partial<TimelineElement>,
		};
	});
}

/** Every clip of the strip moved left or right by `delta` (−100 … 100), keyframes too. */
export function shiftPans(clips: readonly AudioCapableElement[], delta: number): ClipPatch[] {
	return clips.map((clip) => {
		const animations = shiftChannel(clip.animations, PAN_PATH, delta, PAN_MIN, PAN_MAX);
		return {
			elementId: clip.id,
			updates: { params: { pan: Math.round(clamp(basePan(clip) + delta, PAN_MIN, PAN_MAX)) }, ...(animations !== clip.animations ? { animations } : {}) } as Partial<TimelineElement>,
		};
	});
}

/** The clip's volume keyframe at `local` set to `db` (made if there is none there). */
export function keyVolume(clip: AudioCapableElement, local: MediaTime, db: number): ClipPatch {
	const param = getElementParam({ element: clip, key: VOLUME_PATH });
	if (!param) return { elementId: clip.id, updates: {} };
	const animations = upsertPathKeyframe({
		animations: clip.animations,
		propertyPath: VOLUME_PATH,
		time: local,
		value: hundredth(clamp(db, VOLUME_DB_MIN, VOLUME_DB_MAX)),
		// a key that is already there keeps its own curve; a new one joins its neighbours by straight lines
		...(getKeyframeAtTime({ animations: clip.animations, propertyPath: VOLUME_PATH, time: local }) ? {} : { interpolation: "linear" as const }),
		channelLayout: getParamChannelLayout({ param }),
		coerceValue: ({ value }) => coerceParamValue({ param, value }),
	});
	return { elementId: clip.id, updates: { animations } as Partial<TimelineElement> };
}
