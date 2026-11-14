// Solo. A track's `solo` flag is kept on the track itself (saved, one ⌘Z, like its mute). While any track of the open
// timeline is soloed, only the soloed tracks sound — in the player and in the export, which both ask here which
// tracks are silenced. A track's own Mute still wins: a muted track stays silent when soloed.
//
// No editor imports here: the mix (media/audio.ts) and its unit tests load this file. The editor tells it which
// timeline is open through `setSoloScope`.
import type { SceneTracks, TimelineElement, TimelineTrack, TScene } from "@/timeline/types";

/** A compound clip (montage/flatten.ts COMPOSITION_DEF; spelled here so this file stays free of the editor's engine). */
const COMPOUND = "ai.Composition";
const isComposition = (element: TimelineElement): element is TimelineElement & { type: "graphic"; params: { sceneId?: string } } =>
	element.type === "graphic" && element.definitionId === COMPOUND;

interface SoloScope {
	/** The open timeline's own tracks (what the mixer shows). */
	own: SceneTracks | null;
	scenes: readonly TScene[];
}

let scope: (() => SoloScope | null) | null = null;

/** Set once by the editor (core/managers/audio-manager.ts). */
export function setSoloScope(provider: (() => SoloScope | null) | null): void {
	scope = provider;
	lastPlayed = null;
}

const list = (tracks: SceneTracks): TimelineTrack[] => [...tracks.overlay, tracks.main, ...tracks.audio];
const hasSound = (track: TimelineTrack) => track.type === "audio" || track.type === "video";
export const isSoloed = (track: TimelineTrack) => hasSound(track) && (track as { solo?: boolean }).solo === true;

/** Ids of the soloed tracks of a timeline. */
export function soloedTracks(tracks: SceneTracks | null | undefined): Set<string> {
	const out = new Set<string>();
	if (!tracks) return out;
	for (const track of list(tracks)) if (isSoloed(track)) out.add(track.id);
	return out;
}

const NONE: ReadonlySet<string> = new Set<string>();
let lastPlayed: SceneTracks | null = null;
let lastOwn: SceneTracks | null = null;
let lastScenes: readonly TScene[] | null = null;
let lastResult: ReadonlySet<string> = NONE;

/**
 * The tracks of `played` that solo silences. `played` is what the player or the export mixes: the open timeline's
 * tracks, or those with compound clips expanded into extra tracks — an expanded track follows the track its compound
 * clip sits on, and a solo left on inside a compound clip does not reach out of it.
 */
export function silencedBySolo(played: SceneTracks): ReadonlySet<string> {
	const now = scope?.() ?? null;
	const own = now?.own ?? played;
	const scenes = now?.scenes ?? [];
	if (played === lastPlayed && own === lastOwn && scenes === lastScenes) return lastResult;
	lastPlayed = played;
	lastOwn = own;
	lastScenes = scenes;
	lastResult = resolve(played, own, scenes);
	return lastResult;
}

/**
 * For every track a compound clip of `own` expands into: the own track that clip sits on. Own tracks map to
 * themselves. (An expanded main track is renamed «<its id>~<the clip's id>»: ask with `ownerOf`.)
 */
export function trackOwners(own: SceneTracks, scenes: readonly TScene[]): Map<string, string> {
	const owners = new Map<string, string>();
	for (const track of list(own)) owners.set(track.id, track.id);
	const walk = (elements: readonly TimelineElement[], owner: string, depth: number) => {
		if (depth > 4) return;
		for (const element of elements) {
			if (!isComposition(element)) continue;
			const inner = scenes.find((scene) => scene.id === element.params.sceneId);
			if (!inner) continue;
			for (const track of list(inner.tracks)) {
				if (!owners.has(track.id)) owners.set(track.id, owner);
				walk(track.elements as TimelineElement[], owner, depth + 1);
			}
		}
	};
	for (const track of list(own)) walk(track.elements as TimelineElement[], track.id, 0);
	return owners;
}

export const ownerOf = (owners: ReadonlyMap<string, string>, trackId: string) => owners.get(trackId) ?? owners.get(trackId.split("~")[0]) ?? null;

let ownersFor: SceneTracks | null = null;
let ownersScenes: readonly TScene[] | null = null;
let ownersNow: Map<string, string> = new Map();

/** The open timeline's track that a played track belongs to (itself, or the track of its compound clip). */
export function ownTrackOf(trackId: string): string {
	const now = scope?.() ?? null;
	if (!now?.own) return trackId;
	if (now.own !== ownersFor || now.scenes !== ownersScenes) {
		ownersFor = now.own;
		ownersScenes = now.scenes;
		ownersNow = trackOwners(now.own, now.scenes);
	}
	return ownerOf(ownersNow, trackId) ?? trackId;
}

/** The same, for given timelines (no editor): `own` is the open timeline, `played` what is mixed. */
export function resolve(played: SceneTracks, own: SceneTracks, scenes: readonly TScene[]): ReadonlySet<string> {
	const solo = soloedTracks(own);
	if (solo.size === 0) return NONE;
	const owners = trackOwners(own, scenes);
	const silenced = new Set<string>();
	for (const track of list(played)) {
		if (!hasSound(track)) continue;
		const owner = ownerOf(owners, track.id);
		if (!owner || !solo.has(owner)) silenced.add(track.id);
	}
	return silenced;
}

/** Not heard: muted itself, or silenced by another track's solo. */
export function isTrackSilent(track: TimelineTrack, silenced: ReadonlySet<string>): boolean {
	return (hasSound(track) && (track as { muted?: boolean }).muted === true) || silenced.has(track.id);
}

/** The tracks with `trackId`'s solo flipped; `only` leaves it the one soloed track (or clears every solo if it was). */
export function withSoloToggled(tracks: SceneTracks, trackId: string, only = false): SceneTracks {
	const target = list(tracks).find((track) => track.id === trackId);
	if (!target || !hasSound(target)) return tracks;
	const solo = soloedTracks(tracks);
	const next = new Set(only ? (solo.has(trackId) && solo.size === 1 ? [] : [trackId]) : solo);
	if (!only) {
		if (next.has(trackId)) next.delete(trackId);
		else next.add(trackId);
	}
	const apply = <T extends TimelineTrack>(track: T): T => {
		if (!hasSound(track)) return track;
		const was = isSoloed(track);
		const now = next.has(track.id);
		if (was === now) return track;
		const { solo: _solo, ...rest } = track as T & { solo?: boolean };
		return (now ? { ...rest, solo: true } : rest) as T;
	};
	return { ...tracks, overlay: tracks.overlay.map(apply), main: apply(tracks.main), audio: tracks.audio.map(apply) };
}
