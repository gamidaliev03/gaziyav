// What plays when in a song, from the AudioSet tagger (MIT AST, on this Mac) heard window by window on the FULL MIX:
// the instruments and voices of every stretch (drum kit, electric guitar, bass guitar, singing, keys… or silence),
// the genre and mood from AudioSet's own music-genre and mood classes, and the sung lines where a voice is heard.
// A stem (the voice or the music alone) is never judged for genre: the mix is. Pure: the server hears, this sums up.
import { dropHallucinations } from "./hallucinations";

/** One tagger window of the source (seconds) with its labels (probabilities 0–1) and its level. */
export interface MusicWin {
	t: number;
	len: number;
	tags: Array<[string, number]>;
	/** Mean level of the window, dBFS (digital silence ≈ −100). */
	db?: number;
}

/** A plain instrument name ← the AudioSet labels that say it, and the probability from which it counts as playing. */
export const INSTRUMENTS: Array<{ name: string; labels: string[]; min: number; unless?: string[] }> = [
	{ name: "drum kit", labels: ["Drum kit", "Drum", "Snare drum", "Bass drum", "Drum roll", "Hi-hat", "Cymbal", "Rimshot"], min: 0.12 },
	{ name: "drum machine", labels: ["Drum machine"], min: 0.15 },
	{ name: "percussion", labels: ["Percussion", "Tambourine", "Maraca", "Wood block", "Rattle (instrument)", "Gong", "Tabla", "Timpani", "Steelpan"], min: 0.18, unless: ["drum kit"] },
	{ name: "electric guitar", labels: ["Electric guitar"], min: 0.1 },
	{ name: "acoustic guitar", labels: ["Acoustic guitar", "Strum"], min: 0.12 },
	{ name: "guitar", labels: ["Guitar", "Plucked string instrument", "Steel guitar, slide guitar", "Tapping (guitar technique)"], min: 0.2, unless: ["electric guitar", "acoustic guitar"] },
	{ name: "bass guitar", labels: ["Bass guitar"], min: 0.08 },
	{ name: "banjo / mandolin / ukulele", labels: ["Banjo", "Mandolin", "Ukulele", "Zither", "Sitar"], min: 0.15 },
	{ name: "piano", labels: ["Piano", "Electric piano", "Harpsichord"], min: 0.12 },
	{ name: "organ", labels: ["Organ", "Electronic organ", "Hammond organ"], min: 0.12 },
	{ name: "synth", labels: ["Synthesizer", "Sampler"], min: 0.12 },
	{ name: "keyboard", labels: ["Keyboard (musical)"], min: 0.2, unless: ["piano", "organ", "synth"] },
	{ name: "strings", labels: ["String section", "Bowed string instrument", "Violin, fiddle", "Cello", "Double bass", "Pizzicato", "Orchestra", "Harp"], min: 0.12 },
	{ name: "brass", labels: ["Brass instrument", "Trumpet", "Trombone", "French horn"], min: 0.12 },
	{ name: "woodwind", labels: ["Wind instrument, woodwind instrument", "Flute", "Saxophone", "Clarinet"], min: 0.12 },
	{ name: "harmonica / accordion", labels: ["Harmonica", "Accordion", "Bagpipes"], min: 0.15 },
	{ name: "bells", labels: ["Bell", "Chime", "Wind chime", "Tubular bells", "Jingle bell", "Church bell", "Glockenspiel", "Vibraphone", "Marimba, xylophone", "Mallet percussion"], min: 0.18 },
	{ name: "turntable scratching", labels: ["Scratching (performance technique)"], min: 0.15 },
];

/** Voices in a song. */
export const VOICES: Array<{ name: string; labels: string[]; min: number }> = [
	{ name: "singing", labels: ["Singing", "Male singing", "Female singing", "Child singing", "Choir", "Vocal music", "A capella", "Yodeling", "Chant", "Humming", "Synthetic singing"], min: 0.15 },
	{ name: "rap", labels: ["Rapping", "Beatboxing"], min: 0.15 },
	{ name: "screaming", labels: ["Screaming", "Shout", "Yell", "Battle cry"], min: 0.2 },
	{ name: "speech", labels: ["Speech", "Male speech, man speaking", "Female speech, woman speaking", "Narration, monologue", "Conversation"], min: 0.35 },
];

/** AudioSet's music-genre classes (the tagger's own names). */
export const GENRES = new Set([
	"Pop music", "Hip hop music", "Rock music", "Heavy metal", "Punk rock", "Grunge", "Progressive rock", "Rock and roll", "Psychedelic rock", "Rhythm and blues", "Soul music", "Reggae", "Country", "Swing music",
	"Bluegrass", "Funk", "Folk music", "Middle Eastern music", "Jazz", "Disco", "Classical music", "Opera", "Electronic music", "House music", "Techno", "Dubstep", "Drum and bass", "Electronica",
	"Electronic dance music", "Ambient music", "Trance music", "Music of Latin America", "Salsa music", "Flamenco", "Blues", "Music for children", "New-age music", "Vocal music", "A capella", "Music of Africa",
	"Afrobeat", "Christian music", "Gospel music", "Music of Asia", "Carnatic music", "Music of Bollywood", "Ska", "Traditional music", "Independent music", "Dance music", "Christmas music",
]);
/** AudioSet's moods of music. */
export const MOODS = new Set(["Happy music", "Funny music", "Sad music", "Tender music", "Exciting music", "Angry music", "Scary music"]);

/** Genre families: the tagger spreads one style over its neighbours (punk, grunge, metal… are all rock). */
const FAMILIES: Array<[string, string[]]> = [
	["rock", ["Rock music", "Heavy metal", "Punk rock", "Grunge", "Progressive rock", "Rock and roll", "Psychedelic rock", "Independent music"]],
	["electronic", ["Electronic music", "House music", "Techno", "Dubstep", "Drum and bass", "Electronica", "Electronic dance music", "Trance music"]],
	["pop", ["Pop music", "Dance music", "Disco"]],
	["hip hop", ["Hip hop music"]],
	["r&b / soul", ["Rhythm and blues", "Soul music", "Funk", "Gospel music"]],
	["jazz / blues", ["Jazz", "Blues", "Swing music"]],
	["folk / country", ["Folk music", "Country", "Bluegrass", "Traditional music"]],
	["classical", ["Classical music", "Opera"]],
];

const SILENT_DB = -55;

const pOf = (tags: Array<[string, number]>, labels: string[]) => tags.reduce((m, [l, p]) => (labels.includes(l) && p > m ? p : m), 0);

/** What plays in one window: the instruments, the voice, or silence. */
export function playsIn(w: MusicWin): { plays: string[]; voice: string | null; silent: boolean; music: number } {
	const music = pOf(w.tags, ["Music", "Musical instrument", "Song"]);
	const silentTag = pOf(w.tags, ["Silence"]);
	if ((w.db !== undefined && w.db <= SILENT_DB) || (silentTag >= 0.4 && music < 0.2)) return { plays: [], voice: null, silent: true, music };
	const plays: string[] = [];
	for (const ins of INSTRUMENTS) {
		if (pOf(w.tags, ins.labels) < ins.min) continue;
		if (ins.unless?.some((n) => plays.includes(n))) continue;
		plays.push(ins.name);
	}
	let voice: string | null = null;
	for (const v of VOICES) {
		if (pOf(w.tags, v.labels) >= v.min) {
			voice = v.name;
			break;
		}
	}
	if (voice === "singing") {
		const male = pOf(w.tags, ["Male singing"]);
		const female = pOf(w.tags, ["Female singing"]);
		if (Math.max(male, female) >= 0.08) voice = female >= male ? "singing (female voice)" : "singing (male voice)";
	}
	return { plays, voice, silent: false, music };
}

export interface MusicStretch {
	start: number;
	end: number;
	plays: string[];
	voice: string | null;
	silent: boolean;
}

export interface MusicSummary {
	/** The genres and moods over the whole range (mean probability of the windows), strongest first. */
	genre: Array<[string, number]>;
	/** The genre family they add up to (rock, electronic, pop, hip hop…), or null. */
	family: string | null;
	mood: Array<[string, number]>;
	/** Shares of the windows: music heard, a voice singing / rapping, speech. */
	music: number;
	singing: number;
	speech: number;
	/** Timeline stretches with the same instruments and voice (a change of what plays starts a new one). */
	stretches: MusicStretch[];
	/** How often each instrument plays (share of the windows). */
	instruments: Array<[string, number]>;
}

const same = (a: { plays: string[]; voice: string | null; silent: boolean }, b: { plays: string[]; voice: string | null; silent: boolean }) =>
	a.silent === b.silent && (a.voice ?? "") === (b.voice ?? "") && a.plays.length === b.plays.length && a.plays.every((p) => b.plays.includes(p));

/**
 * The windows summed up, in timeline seconds (`toT` maps the source's seconds). `genreWins`: longer windows (10 s) the
 * genre and mood are judged on — the tagger is surer of a style over 10 s than over two bars.
 */
export function summarizeMusic(wins: MusicWin[], toT: (s: number) => number = (s) => s, genreWins?: MusicWin[]): MusicSummary {
	const heard = wins.filter((w) => w.tags.length || w.db !== undefined).sort((a, b) => a.t - b.t);
	const per = heard.map((w) => ({ w, ...playsIn(w) }));
	// Genre and mood over the windows where music sounds: the mean of each class there, the strongest few.
	const styled = (genreWins?.filter((w) => w.tags.length) ?? []).length ? (genreWins ?? []).filter((w) => w.tags.length) : heard;
	const musical = styled.filter((w) => pOf(w.tags, ["Music", "Musical instrument", "Song"]) >= 0.3);
	const pool = musical.length ? musical : styled;
	const mean = (set: Set<string>, min: number) => {
		const sum = new Map<string, number>();
		for (const w of pool) for (const [l, p] of w.tags) if (set.has(l)) sum.set(l, (sum.get(l) ?? 0) + p);
		return [...sum.entries()]
			.map(([l, s]) => [l, Math.round((s / Math.max(1, pool.length)) * 1000) / 1000] as [string, number])
			.filter(([, p]) => p >= min)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 4);
	};
	const genre = mean(GENRES, 0.015);
	const family = FAMILIES.map(([name, labels]) => [name, genre.filter(([l]) => labels.includes(l)).reduce((a, [, p]) => a + p, 0)] as [string, number]).sort((a, b) => b[1] - a[1])[0];
	const n = Math.max(1, per.length);
	const raw: MusicStretch[] = per.map((x) => ({ start: toT(x.w.t), end: toT(x.w.t + x.w.len), plays: x.plays, voice: x.voice, silent: x.silent }));
	// One window that differs between two that agree is the tagger wavering, not a change.
	for (let i = 1; i + 1 < raw.length; i++) if (!same(raw[i], raw[i - 1]) && same(raw[i - 1], raw[i + 1])) raw[i] = { ...raw[i], plays: raw[i - 1].plays, voice: raw[i - 1].voice, silent: raw[i - 1].silent };
	const stretches: MusicStretch[] = [];
	for (const s of raw) {
		const last = stretches[stretches.length - 1];
		if (last && same(last, s) && s.start - last.end < 0.05) last.end = Math.max(last.end, s.end);
		else stretches.push({ ...s, start: Math.max(s.start, last?.end ?? s.start) });
	}
	const count = new Map<string, number>();
	for (const x of per) for (const p of x.plays) count.set(p, (count.get(p) ?? 0) + 1);
	return {
		genre,
		family: family && family[1] > 0 ? family[0] : null,
		mood: mean(MOODS, 0.02),
		music: per.filter((x) => x.music >= 0.3).length / n,
		singing: per.filter((x) => !!x.voice && /singing|rap/.test(x.voice)).length / n,
		speech: per.filter((x) => x.voice === "speech").length / n,
		stretches: stretches.map((s) => ({ ...s, start: Math.round(s.start * 100) / 100, end: Math.round(s.end * 100) / 100 })),
		instruments: [...count.entries()].map(([k, c]) => [k, Math.round((c / n) * 100) / 100] as [string, number]).sort((a, b) => b[1] - a[1]),
	};
}

/** What plays in [start, end): the instruments heard in at least half of its windows, and whether a voice sings there. */
export function playsDuring(stretches: MusicStretch[], start: number, end: number): { plays: string[]; voice: string | null; silent: boolean } {
	const len = Math.max(0.01, end - start);
	const time = new Map<string, number>();
	const voices = new Map<string, number>();
	let silent = 0;
	for (const s of stretches) {
		const o = Math.max(0, Math.min(end, s.end) - Math.max(start, s.start));
		if (!o) continue;
		if (s.silent) silent += o;
		for (const p of s.plays) time.set(p, (time.get(p) ?? 0) + o);
		if (s.voice) voices.set(s.voice, (voices.get(s.voice) ?? 0) + o);
	}
	const plays = [...time.entries()].filter(([, t]) => t >= len * 0.5).sort((a, b) => b[1] - a[1]).map(([k]) => k);
	const voice = [...voices.entries()].filter(([, t]) => t >= len * 0.3).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
	return { plays, voice, silent: silent >= len * 0.6 };
}

/** Sung lines with times: words grouped at pauses ≥ 0.8 s (or 10 words), kept only where a voice is heard. */
export function sungLines(words: Array<{ text: string; start: number; end: number }>, stretches: MusicStretch[]): Array<{ start: number; end: number; text: string; first: number }> {
	const voiced = (a: number, b: number) => !stretches.length || stretches.some((s) => !!s.voice && s.start < b && s.end > a);
	const clean = dropHallucinations(words, (a, b) => !voiced(a, b));
	const out: Array<{ start: number; end: number; text: string; first: number }> = [];
	let cur: typeof clean = [];
	let firstIndex = 0;
	const flush = () => {
		if (!cur.length) return;
		const start = cur[0].start;
		const end = cur[cur.length - 1].end;
		if (voiced(start, end)) out.push({ start, end, text: cur.map((w) => w.text).join(" ").replace(/\s+([,.!?…])/g, "$1"), first: firstIndex });
		cur = [];
	};
	clean.forEach((w) => {
		const prev = cur[cur.length - 1];
		if (prev && (w.start - prev.end >= 0.8 || cur.length >= 10)) flush();
		if (!cur.length) firstIndex = words.indexOf(w);
		cur.push(w);
	});
	flush();
	return out;
}

/** «drum kit + electric guitar, singing (female voice)» / «silence». */
export function playsLine(s: { plays: string[]; voice: string | null; silent: boolean }): string {
	if (s.silent) return "silence";
	const what = s.plays.length ? s.plays.join(" + ") : s.voice ? "" : "music (no clear instrument)";
	return [what, s.voice].filter(Boolean).join(", ");
}

/** The tempo of beat markers already on the timeline (median gap between neighbours), 0 with fewer than 8. */
export function markersTempo(times: number[]): number {
	const t = [...times].sort((a, b) => a - b);
	const gaps = t.slice(1).map((x, i) => x - t[i]).filter((g) => g > 0.15 && g < 2).sort((a, b) => a - b);
	return t.length >= 8 && gaps.length ? 60 / gaps[Math.floor(gaps.length / 2)] : 0;
}

/** A new beat pass is another tempo than the grid already there (more than 5 % apart): the old grid stays. */
export const tempoDisagrees = (oldBpm: number, bpm: number) => oldBpm > 0 && bpm > 0 && Math.abs(bpm / oldBpm - 1) > 0.05;
