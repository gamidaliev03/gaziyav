// The master of a timeline: one fader and one true-peak limiter that the whole mix goes through last — in the
// player (core/managers/audio-manager.ts) and in the export (media/audio.ts) alike, by the same arithmetic
// (dsp/core.ts). It is kept on the timeline's main track (`tracks.main.master`): saved with the project, copied with
// the timeline, and changed like any other edit — one ⌘Z. No master = the mix as it is, exactly as before.
import type { MasterMix, SceneTracks } from "@/timeline";
import { applyMasterInPlace } from "./dsp/offline";

export type { MasterMix };

export const MASTER_DB_MIN = -60;
export const MASTER_DB_MAX = 24;
/** Where a limiter holds the peaks unless a target says otherwise: −1 dBTP (Spotify, Apple Podcasts, EBU R 128). */
export const TRUE_PEAK_CEILING_DB = -1;

export const NO_MASTER: MasterMix = Object.freeze({ gainDb: 0 });

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
const tenth = (value: number) => Math.round(value * 10) / 10;

/** A stored master made safe to use (old or hand-edited projects): numbers in range, one decimal for the fader. */
export function cleanMaster(raw: unknown): MasterMix {
	const m = (raw ?? {}) as Partial<MasterMix>;
	const gainDb = typeof m.gainDb === "number" && Number.isFinite(m.gainDb) ? clamp(Math.round(m.gainDb * 100) / 100, MASTER_DB_MIN, MASTER_DB_MAX) : 0;
	const ceilingDb = typeof m.ceilingDb === "number" && Number.isFinite(m.ceilingDb) ? clamp(tenth(m.ceilingDb), -12, 0) : undefined;
	return ceilingDb === undefined ? { gainDb } : { gainDb, ceilingDb };
}

/** The master of these tracks (the mix as it is when none was set). */
export function masterOf(tracks: SceneTracks | null | undefined): MasterMix {
	const stored = tracks?.main?.master;
	return stored ? cleanMaster(stored) : NO_MASTER;
}

export const isNoMaster = (m: MasterMix) => m.gainDb === 0 && m.ceilingDb === undefined;
export const sameMaster = (a: MasterMix, b: MasterMix) => a.gainDb === b.gainDb && a.ceilingDb === b.ceilingDb;

/** The tracks with this master (the field is taken away again when it says nothing). */
export function withMaster(tracks: SceneTracks, master: MasterMix): SceneTracks {
	const next = cleanMaster(master);
	if (sameMaster(next, masterOf(tracks))) return tracks;
	const { master: _old, ...main } = tracks.main;
	return { ...tracks, main: isNoMaster(next) ? (main as SceneTracks["main"]) : { ...main, master: next } };
}

/** The export's side: the master on the finished mix, in place. Nothing to do without one. */
export async function applyMasterToBuffer({ buffer, tracks }: { buffer: AudioBuffer; tracks: SceneTracks }): Promise<void> {
	const master = masterOf(tracks);
	if (isNoMaster(master)) return;
	const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
	await applyMasterInPlace({ channels, sampleRate: buffer.sampleRate, gainDb: master.gainDb, limiterCeilingDb: master.ceilingDb ?? null });
}
