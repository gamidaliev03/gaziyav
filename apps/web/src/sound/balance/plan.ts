// «Balance the mix»: the arithmetic, apart from the editor (run.ts measures the timeline and applies this plan).
//
// What it decides, all as ordinary values on the clips' own faders:
//   · every VOICE clip gets the gain that puts its speech at the voice level (the loudness target) — the voice is
//     evened between clips, and stands where the programme should;
//   · every MUSIC clip gets a base gain that puts it a little under the voice where nobody speaks, and volume
//     keyframes that take it down by the chosen amount under each spoken phrase and bring it back after — one move
//     down and one up per phrase, never between words;
//   · an EFFECT louder than the voice comes down to it, one far too quiet comes up into hearing.
// Pure functions over numbers and ranges (seconds, dB, LUFS).

export type Role = "voice" | "music" | "effect";

export interface Range {
	start: number;
	end: number;
}

/** How deep the music goes under words, dB (the amounts offered; the app's old ducking was 12). */
export const DUCK_CHOICES = [6, 9, 12, 15, 18] as const;
export const DEFAULT_DUCK_DB = 12;
/** Where nobody speaks the music stands this far under the voice (LU): present, never over the talk. */
export const MUSIC_UNDER_VOICE_LU = 4;
/** An effect's loudest moment is kept between this far under the voice and this far under it (LU). */
export const EFFECT_NEAREST_LU = 1;
export const EFFECT_FARTHEST_LU = 12;

/**
 * The shape of a duck: the music starts down `attack` s before the first word and is fully down `lead` s before it;
 * it stays down `hold` s after the last word and takes `release` s to come back. A fall of a quarter second and a
 * rise of most of a second are heard as the music making room, not as a switch.
 */
export const DUCK_SHAPE = { attack: 0.25, lead: 0.06, hold: 0.25, release: 0.8 } as const;
/** Words closer than this are one phrase; phrases closer than a full fall and rise (plus a breath of music) are one duck. */
export const PHRASE_GAP_SECONDS = 0.45;
export const DUCK_MERGE_SECONDS = DUCK_SHAPE.hold + DUCK_SHAPE.release + DUCK_SHAPE.attack + DUCK_SHAPE.lead + 0.6;

/** Timed words (or speech stretches) as phrases: joined where the gap is under `gap`. */
export function phrasesOf(spans: readonly Range[], gap = PHRASE_GAP_SECONDS): Range[] {
	const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
	const out: Range[] = [];
	for (const s of sorted) {
		const last = out[out.length - 1];
		if (last && s.start - last.end < gap) last.end = Math.max(last.end, s.end);
		else out.push({ start: s.start, end: s.end });
	}
	return out;
}

/** Phrases as ducks: phrases too close for the music to come back in between are held as one. */
export function ducksOf(phrases: readonly Range[]): Range[] {
	return phrasesOf(phrases, DUCK_MERGE_SECONDS);
}

export interface DuckKey {
	/** Seconds from the clip's start. */
	time: number;
	/** The clip's volume there, dB. */
	db: number;
}

/**
 * The volume keyframes of a music clip that lies at [start, start + duration] on the timeline: `baseDb` where nobody
 * speaks, `baseDb − duckDb` under each duck. No ducks inside the clip: no keys (the base volume says it all).
 */
export function duckKeys({ start, duration, baseDb, duckDb, ducks }: { start: number; duration: number; baseDb: number; duckDb: number; ducks: readonly Range[] }): DuckKey[] {
	const end = start + duration;
	const low = baseDb - duckDb;
	const points: Array<{ t: number; db: number }> = [];
	const { attack, lead, hold, release } = DUCK_SHAPE;
	for (const d of ducks) {
		const down0 = d.start - lead - attack;
		const down1 = d.start - lead;
		const up0 = d.end + hold;
		const up1 = d.end + hold + release;
		if (up1 <= start || down0 >= end) continue;
		points.push({ t: down0, db: baseDb }, { t: down1, db: low }, { t: up0, db: low }, { t: up1, db: baseDb });
	}
	if (points.length === 0) return [];
	// the level the envelope has at any time (straight between its points, flat outside)
	const at = (t: number) => {
		if (t <= points[0].t) return points[0].db;
		for (let i = 1; i < points.length; i++) {
			if (t <= points[i].t) {
				const a = points[i - 1];
				const b = points[i];
				return b.t === a.t ? b.db : a.db + ((b.db - a.db) * (t - a.t)) / (b.t - a.t);
			}
		}
		return points[points.length - 1].db;
	};
	const keys: DuckKey[] = [];
	const push = (t: number, db: number) => {
		const time = Math.round((t - start) * 1000) / 1000;
		const value = Math.round(db * 100) / 100;
		const last = keys[keys.length - 1];
		if (last && Math.abs(last.time - time) < 0.002) last.db = value;
		else keys.push({ time, db: value });
	};
	// a duck that is under way at the clip's first or last moment starts or ends there, at the level it has there
	if (points[0].t < start) push(start, at(start));
	for (const p of points) if (p.t >= start && p.t <= end) push(p.t, p.db);
	if (points[points.length - 1].t > end) push(end, at(end));
	// points on the straight line between their neighbours say nothing
	return keys.filter((k, i) => {
		const a = keys[i - 1];
		const b = keys[i + 1];
		if (!a || !b) return true;
		const on = a.db + ((b.db - a.db) * (k.time - a.time)) / (b.time - a.time);
		return Math.abs(on - k.db) > 0.01;
	});
}

export interface Measured {
	id: string;
	role: Role;
	/** Clips that are one sound (the stems of one song): they move together. */
	group?: string;
	/** Integrated loudness of the clip as it sounds now (voice, effect) or at 0 dB without its keys (music), LUFS. */
	loudness: number;
	/** The loudest 400 ms, LUFS (effects are judged by it). */
	momentary: number;
	/** Seconds of sound the loudness was read from. */
	seconds: number;
}

export interface GainPlan {
	id: string;
	role: Role;
	/** dB to add to the clip's volume (voice, effect), or the base volume itself (music). */
	gainDb: number;
	/** False when the clip is left as it is (silent, or already in place). */
	changed: boolean;
	/** The loudness it will have. */
	willBe: number;
}

const MAX_BOOST_DB = 30;
const SILENT = -60;
/** A clip with less sound than this is too short to be judged alone: it takes its group's (or the voices') gain. */
const MIN_SECONDS = 1.5;
const round = (db: number) => Math.round(db * 10) / 10;
const median = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted.length ? (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2 : 0;
};

/**
 * The gain of every clip. `voiceLufs` is where speech should stand (the loudness target). With no voice on the
 * timeline the music is the programme and goes to that level itself.
 */
export function planGains(clips: readonly Measured[], voiceLufs: number): GainPlan[] {
	const heard = (c: Measured) => c.loudness > SILENT && Number.isFinite(c.loudness);
	const voices = clips.filter((c) => c.role === "voice" && heard(c));
	const hasVoice = voices.length > 0;
	const musicLevel = hasVoice ? voiceLufs - MUSIC_UNDER_VOICE_LU : voiceLufs;
	const sure = voices.filter((c) => c.seconds >= MIN_SECONDS);
	const voiceFallback = median((sure.length ? sure : voices).map((c) => voiceLufs - c.loudness));
	// stems of one song keep their balance: one gain for the group, read from the loudest of them
	const groupGain = new Map<string, number>();
	for (const c of clips) {
		if (c.role !== "music" || !c.group || !heard(c)) continue;
		const gain = musicLevel - c.loudness;
		const had = groupGain.get(c.group);
		if (had === undefined || gain < had) groupGain.set(c.group, gain);
	}
	return clips.map((c) => {
		if (!heard(c)) return { id: c.id, role: c.role, gainDb: 0, changed: false, willBe: c.loudness };
		if (c.role === "voice") {
			const gain = round(Math.min(MAX_BOOST_DB, c.seconds >= MIN_SECONDS ? voiceLufs - c.loudness : voiceFallback));
			return { id: c.id, role: c.role, gainDb: gain, changed: Math.abs(gain) >= 0.1, willBe: c.loudness + gain };
		}
		if (c.role === "music") {
			const gain = round(Math.min(MAX_BOOST_DB, c.group ? (groupGain.get(c.group) ?? musicLevel - c.loudness) : musicLevel - c.loudness));
			return { id: c.id, role: c.role, gainDb: gain, changed: true, willBe: c.loudness + gain };
		}
		// an effect: its loudest moment into the window under the voice (or under the music when nobody speaks)
		const anchor = hasVoice ? voiceLufs : musicLevel;
		const top = anchor - EFFECT_NEAREST_LU;
		const bottom = anchor - EFFECT_FARTHEST_LU;
		const peak = Number.isFinite(c.momentary) ? c.momentary : c.loudness;
		const gain = round(peak > top ? top - peak : peak < bottom ? Math.min(MAX_BOOST_DB, bottom - peak) : 0);
		return { id: c.id, role: c.role, gainDb: gain, changed: Math.abs(gain) >= 0.1, willBe: c.loudness + gain };
	});
}

export interface HeardFacts {
	/** The person said what it is (Inspector → Audio → Voice: yes / no). */
	said?: "yes" | "no";
	/** A sound of the built-in library: long ones are music, short ones effects. */
	library?: boolean;
	/** A stem of a separated song («voice» / «music»), or a part of one («vocals», «drums» …). */
	stem?: "voice" | "music" | "part" | null;
	/** The other stem of the same song is on the timeline too. */
	stemTogether?: boolean;
	/** The hearing's verdict (hear/song.ts isSong): it is music. */
	song?: boolean;
	/** Words the recogniser heard in the clip's range. */
	words?: number;
	/** Seconds of speech in it, and the clip's length. */
	speechSeconds?: number;
	seconds: number;
}

/** What a clip is in the mix, from what is known about it. */
export function roleOf(f: HeardFacts): Role {
	if (f.said === "yes") return "voice";
	if (f.stem === "part") return "music";
	if (f.stem === "music") return "music";
	// a song's vocal beside its own instrumental is the song as mixed; alone it is a voice
	if (f.stem === "voice") return f.stemTogether ? "music" : "voice";
	if (f.library) return f.seconds >= 10 ? "music" : "effect";
	if (f.song) return "music";
	const speech = f.speechSeconds ?? 0;
	if ((f.words ?? 0) >= 3 && speech >= Math.min(1, f.seconds * 0.15)) return f.said === "no" ? "effect" : "voice";
	// no words, not a song: a sound. A long one (room tone, a street, a drone) is a bed and is treated as music is —
	// kept under the voice, down under the words; a short one is an effect.
	return f.seconds >= 10 ? "music" : "effect";
}
