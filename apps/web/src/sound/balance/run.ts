// «Balance the mix» on the open timeline: listen to what each clip is, measure it, and set the mix — as ordinary
// values on the clips' own faders and keyframes, in ONE undoable step (plan.ts holds the arithmetic).
//
//   1. What each clip is. What the person said (Inspector → Audio → Voice), a library sound, a stem of a separated
//      song — and for everything else the hearing (hear/client): the recogniser's words say where speech is, the
//      tagger and the measured stretches say what is music. Without the speech model on this Mac the speech is found
//      by level instead (the way ducking always found it), and the result says so.
//   2. How loud each clip is: the export's own mixer renders the voices, the music and the effects apart (so the
//      clips' audio effects are in the measure), and every clip is read from its stretch by BS.1770.
//   3. The plan → new volumes, ducking keyframes on the music, and the master's limiter only if the finished mix
//      would go over the true-peak ceiling. Nothing is rendered into the clips; every value can be moved by hand after.
import { create } from "zustand";
import { songView, stemOf } from "@/agent/hear-tools";
import { TracksSnapshotCommand } from "@/commands/timeline/tracks-snapshot";
import type { EditorCore } from "@/core";
import { findSounding, mapClip } from "@/hear/client";
import { createTimelineAudioBuffer } from "@/media/audio";
import type { MediaAsset } from "@/media/types";
import { collectVoiceRanges, isVoiceElement, readVoiceRole, voiceSourceOf } from "@/sounds/mix/envelope";
import { analyseSpeech, speechIfReady } from "@/sounds/mix/speech";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline";
import { VOLUME_DB_MAX, VOLUME_DB_MIN } from "@/timeline/audio-constants";
import type { AudioCapableElement } from "@/timeline/audio-state";
import { TICKS_PER_SECOND } from "@/wasm";
import { MeasureCancelled, energiesOf, measureProgramme, stretchLoudness } from "../dsp/offline";
import { withMaster } from "../master";
import { shiftVolumes } from "../mixer/levels";
import { isTrackSilent, silencedBySolo } from "../solo";
import { ceilingFor } from "../targets";
import { DEFAULT_DUCK_DB, type HeardFacts, type Measured, type Range, type Role, duckKeys, ducksOf, phrasesOf, planGains, roleOf } from "./plan";

export interface BalanceResult {
	/** Where the voice stands now (LUFS), and how many clips of each kind were set. */
	voiceLufs: number;
	voices: number;
	music: number;
	effects: number;
	/** Phrases the music goes down under, and by how much. */
	ducks: number;
	duckDb: number;
	limiter: boolean;
	/** The finished mix: integrated loudness and true peak (after the master). */
	mixLufs: number;
	truePeakDb: number;
	/** Speech was found by level, not by the recogniser (its model is not on this Mac, or it failed). */
	byLevel: boolean;
	/** False when everything already stood where it should: no step was made. */
	changed: boolean;
	roles: Record<string, Role>;
}

interface BalanceState {
	progress: number | null;
	stage: string;
}
export const useBalance = create<BalanceState>()(() => ({ progress: null, stage: "" }));

const sec = (ticks: number) => ticks / TICKS_PER_SECOND;
const DUCK_KEY = "gzduck-";

interface Heard {
	track: TimelineTrack;
	element: AudioCapableElement;
	asset: MediaAsset | null;
	start: number;
	end: number;
	facts: HeardFacts;
	/** Where it speaks, timeline seconds. */
	speech: Range[];
	role: Role;
	group?: string;
}

type Neural = { effect?: string; label?: string; originalId?: string; sourceId?: string } | undefined;

/** Every clip that is heard in the mix of the open timeline's own tracks. */
function soundingClips(tracks: SceneTracks, assets: readonly MediaAsset[]): Array<Pick<Heard, "track" | "element" | "asset" | "start" | "end">> {
	const byId = new Map(assets.map((a) => [a.id, a]));
	const silenced = silencedBySolo(tracks);
	const out: Array<Pick<Heard, "track" | "element" | "asset" | "start" | "end">> = [];
	for (const track of [...tracks.overlay, tracks.main, ...tracks.audio] as TimelineTrack[]) {
		if (isTrackSilent(track, silenced)) continue;
		for (const element of track.elements as TimelineElement[]) {
			if (element.type !== "audio" && element.type !== "video") continue;
			if (element.duration <= 0 || element.params.muted === true) continue;
			const asset = "mediaId" in element ? (byId.get(element.mediaId) ?? null) : null;
			if (element.type === "video" && (!asset || asset.hasAudio === false || element.isSourceAudioEnabled === false)) continue;
			if (element.type === "audio" && element.sourceType === "upload" && !asset) continue;
			out.push({ track, element, asset, start: sec(element.startTime), end: sec(element.startTime + element.duration) });
		}
	}
	return out;
}

/** The tracks with only these clips, each changed by `change` (the stems the measure is read from). */
function stemTracks(tracks: SceneTracks, keep: ReadonlySet<string>, change: (element: AudioCapableElement) => AudioCapableElement = (e) => e): SceneTracks {
	const pick = <T extends TimelineTrack>(track: T): T => ({ ...track, elements: (track.elements as TimelineElement[]).filter((e) => keep.has(e.id)).map((e) => change(e as AudioCapableElement)) }) as T;
	const { master: _master, ...main } = pick(tracks.main);
	return { overlay: tracks.overlay.map(pick), main: main as SceneTracks["main"], audio: tracks.audio.map(pick) };
}

/** A music clip as it is measured: at 0 dB, without its volume keys and without the old automatic ducking. */
function neutral(element: AudioCapableElement): AudioCapableElement {
	const { volume: _volume, ...animations } = (element.animations ?? {}) as Record<string, unknown>;
	return { ...element, params: { ...element.params, volume: 0, duckUnderVoice: false }, animations: Object.keys(animations).length ? animations : undefined } as AudioCapableElement;
}

const clampVolume = (db: number) => Math.round(Math.min(VOLUME_DB_MAX, Math.max(VOLUME_DB_MIN, db)) * 100) / 100;

let controller: AbortController | null = null;
export const cancelBalance = () => controller?.abort();

/**
 * Balances the open timeline's mix. One ⌘Z takes it back. Throws with a plain sentence when there is nothing to
 * balance; resolves null when cancelled.
 */
export async function balanceMix(editor: EditorCore, { target, duckDb = DEFAULT_DUCK_DB }: { target: number; duckDb?: number }): Promise<BalanceResult | null> {
	controller?.abort();
	const mine = new AbortController();
	controller = mine;
	const signal = mine.signal;
	const say = (stage: string, progress: number) => useBalance.setState({ stage, progress });
	const stop = () => {
		if (signal.aborted) throw new MeasureCancelled();
	};
	say("Listening to the clips", 0);
	try {
		const scene = editor.scenes.getActiveScene();
		const tracks = scene.tracks;
		const assets = editor.media.getAssets();
		const found = soundingClips(tracks, assets);
		if (found.length === 0) throw new Error("Nothing on the timeline makes a sound.");

		// ── 1. what each clip is, and where it speaks
		const stemsOnTimeline = new Map<string, Set<string>>();
		for (const c of found) {
			const n = (c.asset as { neural?: Neural } | null)?.neural;
			if (n?.effect === "ai.separate") {
				const song = n.originalId ?? n.sourceId ?? "";
				stemsOnTimeline.set(song, (stemsOnTimeline.get(song) ?? new Set()).add(n.label === "Music" ? "music" : "voice"));
			}
		}
		let byLevel = false;
		const heard: Heard[] = [];
		for (let i = 0; i < found.length; i++) {
			stop();
			const c = found[i];
			say("Listening to the clips", (0.4 * i) / found.length);
			const n = (c.asset as { neural?: Neural } | null)?.neural;
			const said = readVoiceRole(c.element);
			const library = c.element.type === "audio" && c.element.sourceType === "library";
			const facts: HeardFacts = { seconds: c.end - c.start, ...(said !== "auto" ? { said } : {}), library };
			let group: string | undefined;
			if (n?.effect === "ai.separate") {
				const song = n.originalId ?? n.sourceId ?? "";
				facts.stem = n.label === "Music" ? "music" : "voice";
				facts.stemTogether = (stemsOnTimeline.get(song)?.size ?? 0) > 1;
				if (facts.stemTogether) group = `song:${song}`;
			} else if (n?.effect === "ai.parts") {
				facts.stem = "part";
				group = `song:${n.originalId ?? n.sourceId ?? ""}`;
			}
			let speech: Range[] = [];
			// A library sound, a song's music stem and its parts are known; everything else is listened to.
			const known = library || facts.stem === "music" || facts.stem === "part" || (facts.stem === "voice" && facts.stemTogether);
			if (!known) {
				try {
					const sounding = findSounding(c.element.id);
					if (!sounding) throw new Error("not on the timeline");
					const map = await mapClip(sounding, undefined, { captions: true, signal });
					stop();
					const view = songView(sounding, map);
					facts.song = view.song && stemOf(sounding)?.kind !== "voice";
					facts.words = map.words.length;
					speech = phrasesOf(map.words.map((w) => ({ start: Math.max(c.start, w.start), end: Math.min(c.end, w.end) })));
					facts.speechSeconds = speech.reduce((sum, r) => sum + r.end - r.start, 0);
				} catch (error) {
					if (signal.aborted || (error as Error)?.name === "AbortError") throw new MeasureCancelled();
					// The hearing could not answer (no speech model here, the server busy): speech by level, as ducking finds it.
					byLevel = true;
					const source = voiceSourceOf({ element: c.element, mediaAsset: c.asset });
					const looksVoice = isVoiceElement({ element: c.element, mediaAsset: c.asset });
					if (source && looksVoice) {
						await analyseSpeech(source).catch(() => null);
						const one = stemTracks(tracks, new Set([c.element.id]));
						speech = collectVoiceRanges({ tracks: one, mediaAssets: [...assets], speech: speechIfReady }).map((r) => ({ start: Math.max(c.start, r.start), end: Math.min(c.end, r.end) })).filter((r) => r.end > r.start);
						facts.words = speech.length ? 3 : 0;
						facts.speechSeconds = speech.reduce((sum, r) => sum + r.end - r.start, 0);
					}
				}
			}
			heard.push({ ...c, facts, speech, role: roleOf(facts), group });
		}
		const roles: Record<string, Role> = {};
		for (const h of heard) roles[h.element.id] = h.role;
		const of = (role: Role) => heard.filter((h) => h.role === role);

		// ── 2. how loud each clip is, read from the export's own mix of each kind
		const duration = editor.timeline.getTotalDuration();
		const mediaAssets = await editor.media.withExportOriginals(assets);
		const render = async (stem: SceneTracks) => {
			const context = new OfflineAudioContext(2, 1, 48000) as unknown as AudioContext;
			return createTimelineAudioBuffer({ tracks: stem, mediaAssets, duration, audioContext: context, sampleRate: 48000, stage: "mix" });
		};
		const measured: Measured[] = [];
		const kinds: Array<[Role, string, (e: AudioCapableElement) => AudioCapableElement]> = [
			["voice", "Measuring the voice", (e) => e],
			["music", "Measuring the music", neutral],
			["effect", "Measuring the effects", (e) => e],
		];
		for (let k = 0; k < kinds.length; k++) {
			const [role, stage, change] = kinds[k];
			const clips = of(role);
			if (clips.length === 0) continue;
			stop();
			say(stage, 0.4 + 0.12 * k);
			const buffer = await render(stemTracks(tracks, new Set(clips.map((h) => h.element.id)), change));
			stop();
			if (!buffer) continue;
			const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
			const { energies } = await energiesOf({ channels, sampleRate: buffer.sampleRate, signal });
			for (const h of clips) {
				const m = stretchLoudness(energies, h.start * 10, h.end * 10);
				measured.push({ id: h.element.id, role, group: h.group, loudness: m.loudness, momentary: m.momentary, seconds: m.seconds });
			}
		}

		// ── 3. the plan, as values on the clips
		const gains = planGains(measured, target);
		const gainOf = new Map(gains.map((g) => [g.id, g]));
		const ducks = ducksOf(phrasesOf(of("voice").flatMap((h) => h.speech)));
		let ducked = 0;
		const patch = new Map<string, Partial<TimelineElement>>();
		for (const h of heard) {
			const g = gainOf.get(h.element.id);
			if (!g) continue;
			if (h.role === "music") {
				const baseDb = clampVolume(g.gainDb);
				const keys = duckKeys({ start: h.start, duration: h.end - h.start, baseDb, duckDb, ducks });
				if (keys.length) ducked++;
				const { volume: _old, ...rest } = (h.element.animations ?? {}) as Record<string, unknown>;
				const animations = keys.length
					? { ...rest, volume: { keys: keys.map((key, i) => ({ id: `${DUCK_KEY}${i}`, time: Math.min(h.element.duration, Math.max(0, Math.round(key.time * TICKS_PER_SECOND))), value: clampVolume(key.db), segmentToNext: "linear" as const, tangentMode: "flat" as const })) } }
					: Object.keys(rest).length
						? rest
						: undefined;
				patch.set(h.element.id, { params: { ...h.element.params, volume: baseDb, duckUnderVoice: false }, animations } as Partial<TimelineElement>);
			} else if (g.changed) {
				patch.set(h.element.id, shiftVolumes([h.element], g.gainDb)[0].updates);
			}
		}
		const apply = (base: SceneTracks): SceneTracks => {
			const one = <T extends TimelineTrack>(track: T): T => {
				if (!(track.elements as TimelineElement[]).some((e) => patch.has(e.id))) return track;
				return { ...track, elements: (track.elements as TimelineElement[]).map((e) => (patch.has(e.id) ? ({ ...e, ...patch.get(e.id), params: { ...e.params, ...(patch.get(e.id)?.params ?? {}) } } as TimelineElement) : e)) } as T;
			};
			return { ...base, overlay: base.overlay.map(one), main: one(base.main), audio: base.audio.map(one) };
		};

		// ── 4. the finished mix: does anything go over the ceiling? Then the master's limiter holds it.
		stop();
		say("Checking the peaks", 0.8);
		const ceilingDb = ceilingFor(target);
		const planned = withMaster(apply(tracks), { gainDb: 0 });
		const finished = await render(stemTracks(planned, new Set(heard.map((h) => h.element.id))));
		stop();
		let mixLufs = Number.NEGATIVE_INFINITY;
		let truePeakDb = Number.NEGATIVE_INFINITY;
		let limiter = false;
		if (finished) {
			const channels = Array.from({ length: finished.numberOfChannels }, (_, c) => finished.getChannelData(c));
			const dry = await measureProgramme({ channels, sampleRate: finished.sampleRate, signal, onProgress: (share) => say("Checking the peaks", 0.8 + share * 0.1) });
			mixLufs = dry.integrated;
			truePeakDb = dry.truePeakDb;
			if (dry.truePeakDb > ceilingDb) {
				limiter = true;
				const held = await measureProgramme({ channels, sampleRate: finished.sampleRate, limiterCeilingDb: ceilingDb, signal, onProgress: (share) => say("Holding the peaks", 0.9 + share * 0.1) });
				mixLufs = held.integrated;
				truePeakDb = held.truePeakDb;
			}
		}
		stop();

		// ── one step, made on the timeline as it is now (an edit made while it listened stays)
		const now = editor.scenes.getActiveScene().tracks;
		const next = withMaster(apply(now), limiter ? { gainDb: 0, ceilingDb } : { gainDb: 0 });
		const changed = JSON.stringify(next) !== JSON.stringify(now);
		if (changed) editor.command.execute({ command: new TracksSnapshotCommand({ before: now, after: next }) });
		return {
			voiceLufs: target,
			voices: of("voice").length,
			music: of("music").length,
			effects: of("effect").length,
			ducks: ducked ? ducks.length : 0,
			duckDb,
			limiter,
			mixLufs,
			truePeakDb,
			byLevel,
			changed,
			roles,
		};
	} catch (error) {
		if (error instanceof MeasureCancelled || signal.aborted) return null;
		throw error;
	} finally {
		useBalance.setState({ progress: null, stage: "" });
		if (controller === mine) controller = null;
	}
}
