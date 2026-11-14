// The beat plan: the whole edit as data before anything lands on the timeline. `autoPlan` writes it from the material
// briefs, the recipe, the look and the user's taste (so «рилс из этого» needs nothing else); Claude may give beats,
// B-roll, titles and music itself and only the rest is filled in. Pure: compile.ts turns it into tracks.
import { CUT_RULES } from "@/hear/cuts";
import type { PlatformSpec } from "@/platforms/table";
import type { MaterialBrief, PauseCut, Sentence, Word } from "./material";
import type { Preset } from "./presets";
import type { Recipe } from "./recipes";

export interface MediaRef {
	id: string;
	name: string;
	type: "video" | "image" | "audio";
	duration?: number;
	width?: number;
	height?: number;
	brief?: MaterialBrief;
	/** A stem of a song separated in Gaziyav (separate_voice): which part, and the song's media id. */
	stem?: "voice" | "music";
	stemOf?: string;
}

/** What Claude may say in apply_plan (all optional). */
export interface PlanInput {
	brief?: string;
	recipe?: string;
	preset?: string;
	platform?: string;
	seconds?: number;
	topic?: string;
	title?: string;
	cta?: string;
	/** Pieces of the talking clip in order: {media?, from, to} in the clip's own seconds, or {quote: n} (a sentence #n). */
	beats?: Array<{ media?: string; from?: number; to?: number; quote?: number; exact?: boolean }>;
	/** Missing pictures: false = never look outside the project; default: web pictures for the strongest lines when
	 * the edit has too little B-roll (recipes that want it). */
	find?: boolean;
	/** Excerpts to fetch: only these seconds of each (marked in the project: may be claimed when posted). */
	youtube?: Array<{ url?: string; query?: string; from: number; to: number }>;
	/** Inserts over the speaker: {media, at? (timeline s), words? (the words they illustrate)}. */
	broll?: Array<{ media: string; at?: number; words?: string; seconds?: number }>;
	music?: { track?: string; mood?: string; off?: boolean };
	captions?: { style?: string; off?: boolean };
	/** The speaker's name for the lower third (YouTube). */
	speaker?: string;
}

export interface Piece {
	media: string;
	/** Source seconds. */
	from: number;
	to: number;
	/** Timeline seconds (filled by layout). */
	at: number;
	role: "hook" | "body" | "payoff" | "still";
	section: number;
	/** Scale of a punch-in (1 = none) and the point it zooms to (0…1 of the frame). */
	punch: number;
	focus?: [number, number];
	/** Sentences it carries (indices in the source's brief). */
	sentences: number[];
}

export interface Insert {
	media: string;
	at: number;
	seconds: number;
	from: number;
	words: string;
}

export interface TextHit {
	kind: "hook" | "title" | "chapter" | "lower-third" | "stat" | "cta" | "end-screen";
	at: number;
	seconds: number;
	text: string;
	sub?: string;
	value?: number;
}

export interface SoundPick {
	id: string;
	/** A Media file of the project instead of a library item (the user's song). */
	media?: string;
	url: string;
	name: string;
	dur: number;
	gain?: number;
	bpm?: number;
	downbeats?: number[];
}

export interface Plan {
	recipe: string;
	preset: string;
	platform: string;
	seconds: number;
	language: "ru" | "en";
	topic: string;
	pieces: Piece[];
	inserts: Insert[];
	texts: TextHit[];
	captions: { style: string; words: Word[] } | null;
	music: { pick: SoundPick; at: number; seconds: number; gainDb: number; fadeOut: number } | null;
	sfx: Array<{ pick: SoundPick; at: number; gainDb: number; why: string }>;
	chapters: Array<{ at: number; title: string }>;
	/** A voice-over (an audio file with speech) under pictures: its piece and where it starts. */
	voice?: { media: string; from: number; to: number; at: number };
	/** What the plan left out and why (shown to Claude). */
	notes: string[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

// ───────────────────────── cuts ─────────────────────────

/**
 * The cut where a piece starting at word time `t` begins (in the pause before it). With no pause cut point there (the
 * words run on, < 60 ms apart) it starts in the gap after the word before, never inside it (claude-hear, 09.11: «Add»
 * after «2.» 40 ms before it started 120 ms early, 70 ms into «2.»).
 */
export function startCut(cuts: PauseCut[], t: number, words: Word[] = []): number {
	let best: PauseCut | null = null;
	for (const c of cuts) if (Math.abs(c.hi - t) < 0.02 && (!best || Math.abs(c.hi - t) < Math.abs(best.hi - t))) best = c;
	if (best) return best.start;
	let prev: Word | null = null;
	for (const w of words) if (w.start < t - 1e-6 && w.end <= t + 1e-6 && (!prev || w.end > prev.end)) prev = w;
	return prev && prev.end > t - 0.24 ? Math.round(Math.max(prev.end, (prev.end + t) / 2) * 1000) / 1000 : Math.max(0, t - 0.12);
}

/** The cut where a piece whose last word ends at `t` stops (in the pause after it; never inside the next word). */
export function endCut(cuts: PauseCut[], t: number, words: Word[] = []): number {
	let best: PauseCut | null = null;
	for (const c of cuts) if (Math.abs(c.lo - t) < 0.02 && (!best || Math.abs(c.lo - t) < Math.abs(best.lo - t))) best = c;
	if (best) return best.end;
	let next: Word | null = null;
	for (const w of words) if (w.end > t + 1e-6 && w.start >= t - 1e-6 && (!next || w.start < next.start)) next = w;
	return next && next.start < t + 0.3 ? Math.round(Math.min(next.start, (t + next.start) / 2) * 1000) / 1000 : t + 0.15;
}

/** A free range snapped to the nearest pause cut points (within 0.6 s), else left as given. */
export function snapToCuts(cuts: PauseCut[], from: number, to: number): [number, number] {
	const near = (t: number, key: "start" | "end") => {
		let best: number | null = null;
		for (const c of cuts) {
			const v = c[key];
			if (Math.abs(v - t) <= 0.6 && (best === null || Math.abs(v - t) < Math.abs(best - t))) best = v;
		}
		return best ?? t;
	};
	const a = near(from, "start");
	const b = near(to, "end");
	return b - a > 0.3 ? [a, b] : [from, to];
}

/**
 * A sentence split where the speaker stalls: at a pause over `maxPause` or a filler word, so the piece plays tight
 * (the pause shortened to the natural one by the cut points).
 */
export function tightRanges(s: Sentence, words: Word[], cuts: PauseCut[], maxPause: number, isFiller: (w: string) => boolean): Array<[number, number]> {
	const own = words.filter((w) => w.start >= s.from - 0.01 && w.end <= s.to + 0.01);
	const out: Array<[number, number]> = [];
	let first: Word | null = null;
	let last: Word | null = null;
	for (const w of own) {
		if (isFiller(w.text)) {
			if (first && last) out.push([startCut(cuts, first.start, words), endCut(cuts, last.end, words)]);
			first = last = null;
			continue;
		}
		if (last && w.start - last.end > maxPause && first) {
			out.push([startCut(cuts, first.start, words), endCut(cuts, last.end, words)]);
			first = null;
		}
		if (!first) first = w;
		last = w;
	}
	if (first && last) out.push([startCut(cuts, first.start, words), endCut(cuts, last.end, words)]);
	return out.filter(([a, b]) => b - a > 0.25);
}

// ───────────────────────── choosing ─────────────────────────

const STOP = new Set("и в во не на я он она они мы вы ты что как это то так а но же ли бы по к с со у о об из за для от до the a an and or of to in on at is are was were be it this that with for as by you we they he she i my your our".split(" "));

export const wordsOf = (text: string) =>
	text
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w.length > 2 && !STOP.has(w));

/** How well an insert's tags fit the words said (shared stems of 4+ letters count). */
export function fitScore(tags: string[], words: string[]): number {
	let n = 0;
	for (const t of tags) {
		const stem = t.slice(0, Math.max(4, Math.min(6, t.length - 1)));
		if (words.some((w) => w.startsWith(stem) || t.startsWith(w.slice(0, Math.max(4, w.length - 2))))) n++;
	}
	return n;
}

/** The most beautiful stretch of an insert clip: around its best-scored frame not inside a stretch already used. */
export function bestWindow(b: MaterialBrief | undefined, seconds: number, duration: number, used: Array<[number, number]> = []): number {
	if (!b || !b.frames.length || duration <= seconds) return 0;
	const free = (a: number) => used.every(([x, y]) => a + seconds <= x || a >= y);
	for (const f of [...b.frames].sort((x, y) => y.score - x.score)) {
		const a = r2(Math.max(0, Math.min(duration - seconds, f.t - seconds / 2)));
		if (free(a)) return a;
	}
	return 0;
}

/** How many different stretches a long clip (a screen recording, a long B-roll) gives: one per ~3 inserts' length. */
export const usesOf = (m: MediaRef, len: number) => (m.type === "video" && (m.duration ?? 0) >= 30 ? Math.min(6, Math.floor((m.duration ?? 0) / (len * 3))) : 1);

export interface PlanContext {
	recipe: Recipe;
	preset: Preset;
	platform: PlatformSpec;
	seconds: number;
	topic: string;
	language: "ru" | "en";
	media: MediaRef[];
	input: PlanInput;
	music: SoundPick | null;
	sfx: Record<string, SoundPick | null>;
	cta: string;
	isFiller: (w: string) => boolean;
	/** The project's frames per second: every piece is a whole number of frames (default 30). */
	fps?: number;
}

/** The speaking clip: the one with the most words. */
export function pickSpeaker(media: MediaRef[]): MediaRef | null {
	const talking = media.filter((m) => (m.brief?.speech?.words.length ?? 0) >= 3).sort((a, b) => (b.brief?.speech?.words.length ?? 0) - (a.brief?.speech?.words.length ?? 0));
	return talking[0] ?? null;
}

const durOf = (s: Sentence) => s.to - s.from;
const maxScore = (m: MediaRef) => (m.brief?.frames.length ? Math.max(...m.brief.frames.map((f) => f.score)) : 50);

/** Sentences for a length: the best ones (hook first in a cold open), then in the order they were said. */
export function chooseSentences(sentences: Sentence[], seconds: number, coldOpen: boolean): { hook: Sentence | null; body: Sentence[] } {
	const usable = sentences.filter((s) => !s.retake && s.words >= 3);
	if (!usable.length) return { hook: null, body: [] };
	const hookPool = usable.filter((s) => durOf(s) <= Math.max(3, Math.min(12, seconds * 0.35)));
	const hook = coldOpen ? ([...(hookPool.length ? hookPool : usable)].sort((a, b) => b.hook - a.hook)[0] ?? null) : null;
	let left = seconds - (hook ? durOf(hook) + 0.3 : 0);
	const chosen = new Set<number>();
	// Best first until the length is filled; a sentence that doesn't fit is skipped for a shorter one.
	for (const s of [...usable].sort((a, b) => b.hook - a.hook)) {
		if (s === hook) continue;
		const d = durOf(s) + 0.3;
		if (d <= left + 1.5) {
			chosen.add(s.i);
			left -= d;
		}
		if (left <= 1) break;
	}
	const body = usable.filter((s) => chosen.has(s.i));
	return { hook, body };
}

/** One short line for a title from a sentence or the topic: the first 6 words, no trailing punctuation. */
export function headline(text: string, max = 6): string {
	const clean = text.replace(/[«»"“”]/g, "").trim();
	// A clause that ends within the limit is the headline ("Step two: add one lamp" → the whole; "Hi, I'm Sam, and…" → "Hi, I'm Sam").
	const words = clean.split(/\s+/).filter(Boolean);
	let cut = Math.min(max, words.length);
	const clause = words.findIndex((w, i) => i >= 2 && i < max && /[,;—–]$/.test(w));
	if (words.length > max && clause >= 0) cut = clause + 1;
	const out = words.slice(0, cut);
	// never end on a little word ("…cheap for", "…light in the")
	while (out.length > 2 && TAIL_STOP.has(out[out.length - 1].toLowerCase().replace(/[,.;:!?…]+$/, ""))) out.pop();
	return out.join(" ").replace(/[,.;:!?…—–-]+$/, "");
}

/** A sentence that names a part: "Step 2.", "Bonus step 5", "Часть третья", "Шаг 1". */
const MARKER = /^(bonus\s+)?(step|part|chapter|шаг|часть|глава|бонус)\b/iu;

const TAIL_STOP = new Set("a an the of for in on at to and or but with from by as is are was be that this your our my их и в во на с со к по для от из за а но или что это как".split(" "));

const NUMBER = /(\d+(?:[.,]\d+)?)\s*(%|процент|раз|x|×|тысяч|млн|million|thousand|percent)?/i;

/** The plan for a talking clip (reel, YouTube, podcast clip, promo with a speaker). */
export function autoPlan(ctx: PlanContext): Plan {
	const { recipe, preset, platform, seconds, input } = ctx;
	const notes: string[] = [];
	const speaker = pickSpeaker(ctx.media);
	const pieces: Piece[] = [];
	const long = platform.review.ending === "end-screen";
	let voice: Plan["voice"];
	if (speaker?.type === "audio" && speaker.brief?.speech) {
		// A voice-over: the pictures follow its sentences, one picture (or clip) per sentence, in order, the best fit first.
		const sp = speaker.brief.speech;
		const from = Math.max(0, (sp.words[0]?.start ?? 0) - 0.3);
		const to = Math.min(speaker.brief.seconds || Number.POSITIVE_INFINITY, (sp.words[sp.words.length - 1]?.end ?? 0) + 0.6);
		voice = { media: speaker.id, from, to, at: 0 };
		const pics = ctx.media.filter((m) => m.type !== "audio");
		const sentences = sp.sentences.filter((s) => !s.retake);
		let k = 0;
		sentences.forEach((s, i) => {
			if (!pics.length) return;
			const startAt = i === 0 ? 0 : s.from - from - 0.15;
			const endAt = i === sentences.length - 1 ? to - from : (sentences[i + 1].from - from - 0.15);
			const len = Math.max(0.8, endAt - startAt);
			const words = wordsOf(s.text);
			const fit = [...pics].sort((a, b) => fitScore(b.brief?.tags ?? wordsOf(b.name), words) - fitScore(a.brief?.tags ?? wordsOf(a.name), words))[0];
			const pic = fitScore(fit.brief?.tags ?? wordsOf(fit.name), words) > 0 ? fit : pics[k++ % pics.length];
			const src = bestWindow(pic.brief, len, pic.duration ?? len);
			pieces.push({ media: pic.id, from: src, to: src + len, at: 0, role: "still", section: long ? 1 + Math.floor((i * 3) / Math.max(1, sentences.length)) : 0, punch: 1.06, sentences: [s.i] });
		});
	} else if (speaker?.brief?.speech) {
		const sp = speaker.brief.speech;
		// claude-hear's shared rule: a silence of 400 ms and more is cut clean (the speaker's own slow pauses kept)
		const maxPause = Math.max(CUT_RULES.cleanSilence, sp.pause * 2.2);
		if (input.beats?.length) {
			for (const b of input.beats) {
				const media = b.media ? ctx.media.find((m) => m.id === b.media || m.id.startsWith(String(b.media))) ?? speaker : speaker;
				const cuts = media.brief?.speech?.cuts ?? [];
				if (typeof b.quote === "number") {
					const s = media.brief?.speech?.sentences[b.quote];
					const said = media.brief?.speech?.words ?? [];
					if (s) pieces.push({ media: media.id, from: startCut(cuts, s.from, said), to: endCut(cuts, s.to, said), at: 0, role: "body", section: 0, punch: 1, sentences: [s.i] });
				} else if (Number.isFinite(b.from) && Number.isFinite(b.to) && Number(b.to) > Number(b.from)) {
					// exact: the edges are already word edges (the Assemble button's cut): not moved to another pause
					const [a, z] = b.exact ? [Number(b.from), Number(b.to)] : snapToCuts(cuts, Number(b.from), Number(b.to));
					const said = (media.brief?.speech?.sentences ?? []).filter((s) => s.to > a && s.from < z).map((s) => s.i);
					pieces.push({ media: media.id, from: a, to: z, at: 0, role: "body", section: 0, punch: 1, sentences: said });
				}
			}
			if (pieces.length) pieces[0].role = "hook";
		} else {
			const { hook, body } = chooseSentences(sp.sentences, seconds, recipe.coldOpen);
			const add = (s: Sentence, role: Piece["role"], section: number) => {
				for (const [a, z] of tightRanges(s, sp.words, sp.cuts, maxPause, ctx.isFiller)) pieces.push({ media: speaker.id, from: a, to: z, at: 0, role, section, punch: 1, sentences: [s.i] });
			};
			if (hook) add(hook, "hook", 0);
			// Sections: YouTube chapters from the order of speech, 3–5 of them; one section in a reel.
			// Sections (YouTube chapters): where the speaker paused long before a new thought, 2–7 of them; else even parts.
			const gapBefore = (s: Sentence) => {
				const prev = sp.sentences[s.i - 1];
				return prev ? s.from - prev.to : 0;
			};
			// The speaker's own structure first ("Step 2.", "Часть третья"), then the longest pauses, then even parts.
			const markers = sp.sentences.filter((x) => MARKER.test(x.text.trim()));
			let breaks: number[] = [];
			if (long && markers.length >= 2) {
				for (const m of markers) {
					const first = body.find((x) => x.from >= m.from - 0.01);
					if (first && first !== body[0] && !breaks.includes(first.i)) breaks.push(first.i);
				}
			} else if (long) {
				const want = Math.max(2, Math.min(6, Math.round(seconds / 45)));
				breaks = body
					.slice(1)
					.filter((x) => gapBefore(x) >= Math.max(0.6, sp.pause * 2))
					.sort((a, b) => gapBefore(b) - gapBefore(a))
					.slice(0, want - 1)
					.map((x) => x.i);
				if (breaks.length < 1) {
					const n = Math.max(2, Math.min(5, Math.round(body.length / 4)));
					breaks = Array.from({ length: n - 1 }, (_, j) => body[Math.round(((j + 1) * body.length) / n)]?.i).filter((x): x is number => x !== undefined);
				}
			}
			let section = long ? 1 : 0;
			body.forEach((s, k) => {
				if (breaks.includes(s.i)) section++;
				add(s, k === body.length - 1 ? "payoff" : "body", section);
			});
			const dropped = sp.retakes.length;
			if (dropped) notes.push(`${dropped} retake${dropped === 1 ? "" : "s"} left out`);
		}
	}
	// Pictures and clips without speech carry a story without a speaker (photo story, promo shots).
	const inserts: Insert[] = [];
	const visuals = ctx.media.filter((m) => m.id !== speaker?.id && m.type !== "audio");
	if (!pieces.length) {
		// Pictures carry the video: the best ones first in a promo / trailer, in their order in a story; on the music's bars
		// when the recipe cuts on the beat (each shot 1–2 bars, the strong ones on a downbeat).
		const song = ctx.media.find((m) => m.type === "audio" && !!m.brief?.music);
		const grid = song?.brief?.music ?? (ctx.music?.bpm ? { bpm: ctx.music.bpm, downbeats: ctx.music.downbeats ?? [], beats: [], bar: 240 / ctx.music.bpm } : null);
		const ordered = recipe.id === "promo" || recipe.id === "trailer" ? [...visuals].sort((a, b) => maxScore(b) - maxScore(a)) : visuals;
		const want = Math.min(seconds, song?.brief?.seconds ?? seconds);
		// A shot holds as long as the format's pace allows (a reel's stills move on sooner than a film's); few pictures
		// for the length give two or three shots each — the whole picture, then a detail on its subject (two framings
		// of one picture are two shots; a clip gives another moment) — never one picture stretched past the pace.
		const longest = long ? preset.pace.long[1] : preset.pace.reel[1] * 1.5;
		const shortest = long ? preset.pace.long[0] : preset.pace.reel[0];
		const takes = ordered.length ? Math.max(1, Math.min(3, Math.ceil(want / (ordered.length * longest * 1.15)))) : 1;
		const per = Math.max(shortest, Math.min(longest, want / Math.max(1, ordered.length * takes)));
		const bar = grid?.bar ?? 0;
		// A whole number of bars each when the recipe cuts on the beat.
		const bars = recipe.onBeat && bar > 0 ? Math.max(1, Math.min(Math.floor((longest * 1.2) / bar), Math.round(per / bar))) : 0;
		const DETAIL: Array<{ punch: number; shift: number }> = [
			{ punch: 1, shift: 0 },
			{ punch: 1.3, shift: 0 },
			{ punch: 1.15, shift: 0.12 },
		];
		for (const v of ordered) {
			const d = bars ? bars * bar : v.type === "image" ? per : Math.min(per, v.duration ?? per);
			// a clip shorter than its bars keeps whole bars of what it has
			const len = v.type === "video" && (v.duration ?? d) < d ? (bars ? Math.max(1, Math.floor((v.duration ?? d) / bar)) * bar : (v.duration ?? d)) : d;
			const subject = v.brief?.faceBox ?? v.brief?.salientBox;
			const [cx, cy] = subject ? [subject[0] + subject[2] / 2, subject[1] + subject[3] / 2] : [0.5, 0.45];
			const used: Array<[number, number]> = [];
			const room = v.type === "video" ? Math.max(1, Math.floor((v.duration ?? len) / Math.max(0.1, len))) : takes;
			for (let k = 0; k < Math.min(takes, room); k++) {
				const from = bestWindow(v.brief, len, v.duration ?? len, used);
				used.push([from, from + len]);
				// a still's second and third shots are details; a clip's are other moments at the same framing
				const detail = v.type === "image" ? DETAIL[k] : DETAIL[0];
				const focus: [number, number] | undefined = detail.punch > 1 ? [Math.max(0.1, Math.min(0.9, cx + (k % 2 ? 1 : -1) * detail.shift)), cy] : undefined;
				pieces.push({ media: v.id, from, to: from + len, at: 0, role: "still", section: 0, punch: detail.punch, ...(focus ? { focus } : {}), sentences: [] });
			}
		}
		if (takes > 1) notes.push(`${ordered.length} picture(s) for ${Math.round(want)} s: ${takes} shots each (the whole, then a detail), ${r2(per)} s a shot`);
		if (song) notes.push(`cut on the bars of «${song.name}» (${Math.round(song.brief!.music!.bpm)} bpm)`);
		if (!pieces.length) notes.push("no media to build from: import clips or pictures first");
	}
	// Pace: a fragment under 0.9 s rejoins its neighbour of the same sentence (a flash of a shot is worse than a pause);
	// a long talking stretch gets a zoom cut at a word gap near its middle (no time removed, the scale changes).
	for (let i = 1; i < pieces.length; i++) {
		const a = pieces[i - 1];
		const b = pieces[i];
		const tiny = (p: Piece) => p.to - p.from < 0.9;
		if (!input.beats?.some((x) => x.exact) && a.media === b.media && a.sentences[0] === b.sentences[0] && (tiny(a) || tiny(b)) && b.from - a.to < 1.2) {
			a.to = b.to;
			pieces.splice(i, 1);
			i--;
		}
	}
	const sp0 = speaker?.brief?.speech;
	const maxShot = (long ? preset.pace.long[1] : preset.pace.reel[1]) * 1.4;
	if (sp0 && speaker?.type !== "audio") {
		for (let i = 0; i < pieces.length; i++) {
			const p = pieces[i];
			if (p.role === "still" || p.to - p.from <= maxShot) continue;
			const mid = (p.from + p.to) / 2;
			const gap = sp0.cuts.filter((c) => c.lo > p.from + 1.2 && c.hi < p.to - 1.2).sort((x, y) => Math.abs((x.lo + x.hi) / 2 - mid) - Math.abs((y.lo + y.hi) / 2 - mid))[0];
			if (!gap) continue;
			const at = r2((gap.lo + gap.hi) / 2);
			pieces.splice(i + 1, 0, { ...p, from: at, role: p.role === "hook" ? "body" : p.role });
			p.to = at;
			if (p.role === "payoff") p.role = "body";
		}
	}
	// Timeline layout, back to back; punch-ins alternate on a talking clip so every jump cut is covered.
	let t = 0;
	let zoomed = false;
	const face = speaker?.brief?.faceBox;
	const fps = ctx.fps || 30;
	for (let i = 0; i < pieces.length; i++) {
		const p = pieces[i];
		// Whole frames: the piece's length and the source edge it starts on.
		p.from = Math.round(p.from * fps) / fps;
		p.to = p.from + Math.max(3, Math.round((p.to - p.from) * fps)) / fps;
		p.at = t;
		const prev = pieces[i - 1];
		const jump = prev && prev.media === p.media && p.role !== "still";
		if (jump) zoomed = !zoomed;
		else zoomed = false;
		if (p.role === "still") {
			// room for the slow push's drift; a detail shot keeps its own closer framing
			p.punch = Math.max(1.06, p.punch);
		} else if (zoomed) {
			p.punch = preset.pace.punchIn;
		}
		if (face) p.focus = [r2(face[0] + face[2] / 2), r2(face[1] + face[3] * 0.4)];
		t += p.to - p.from;
	}
	const total = r2(t);
	// Inserts: Claude's first, then the clips whose tags fit the words said, each once, never over the hook's first
	// seconds or the ending; a cutaway at least every `coverEvery` seconds on a long talking stretch.
	const used = new Set<string>();
	const speakerPieces = pieces.filter((p) => p.role !== "still");
	const insertLen = long ? Math.min(6, Math.max(3, preset.pace.long[1] * 0.7)) : Math.min(3, Math.max(1.5, preset.pace.reel[1]));
	const windows = new Map<string, Array<[number, number]>>();
	const take = (m: MediaRef, len: number) => {
		const used = windows.get(m.id) ?? [];
		const from = bestWindow(m.brief, len, m.duration ?? len, used);
		used.push([from, from + len]);
		windows.set(m.id, used);
		return from;
	};
	/** An insert on a shot: in a beat after its cut, to the shot's end when the rest would flash (< 0.8 s). */
	const shotSpan = (p: Piece, v: MediaRef): [number, number] | null => {
		const dur = p.to - p.from;
		const lead = Math.min(0.8, Math.max(0.4, dur * 0.25));
		// Over a jump cut into the next shot of the same clip (the insert hides the cut): up to that shot's end − 0.8 s.
		const next = pieces[pieces.indexOf(p) + 1];
		const across = next && next.media === p.media && dur - lead < insertLen ? Math.max(0, next.to - next.from - 0.8) : 0;
		const room = dur - lead + across;
		const most = v.type === "video" ? (v.duration ?? insertLen) : insertLen * 1.5;
		let len = Math.min(insertLen, room, most);
		if (room - len < 0.8 && room <= most) len = room;
		if (len < 1) return null;
		return [r2(p.at + lead), r2(len)];
	};
	const freeAt = (at: number, len: number) => at >= platform.review.hookSeconds && at + len <= total - 2.5 && !inserts.some((x) => at < x.at + x.seconds + 0.5 && at + len > x.at - 0.5);
	for (const b of input.broll ?? []) {
		const m = ctx.media.find((x) => x.id === b.media || x.id.startsWith(String(b.media)));
		if (!m) continue;
		const len = Math.min(b.seconds ?? insertLen, m.type === "video" ? m.duration ?? insertLen : insertLen);
		let at = Number.isFinite(b.at) ? Number(b.at) : NaN;
		if (!Number.isFinite(at) && b.words && speaker?.brief?.speech) {
			const want = wordsOf(b.words);
			const hit = speakerPieces.find((p) => p.sentences.some((i) => fitScore(want, wordsOf(speaker.brief!.speech!.sentences[i]?.text ?? "")) > 0));
			if (hit) at = hit.at + 0.3;
		}
		if (!Number.isFinite(at)) continue;
		inserts.push({ media: m.id, at: r2(at), seconds: r2(len), from: take(m, len), words: b.words ?? "" });
		used.add(m.id);
	}
	if (speaker && speakerPieces.length) {
		const pool = visuals
			.filter((v) => !used.has(v.id) && (v.brief?.frames.length ? Math.max(...v.brief.frames.map((f) => f.score)) >= 35 : true))
			// no watermarked stock (a logo in a corner on most of its frames)
			.filter((v) => !(v.brief?.frames.length && v.brief.frames.filter((f) => f.flags.includes("watermark")).length >= v.brief.frames.length / 2))
			.flatMap((v) => Array.from({ length: usesOf(v, insertLen) }, () => v));
		// Words first: each sentence looks for an insert that shows what is said.
		for (const p of speakerPieces) {
			if (!pool.length) break;
			const said = p.sentences.map((i) => speaker.brief?.speech?.sentences[i]?.text ?? "").join(" ");
			const words = wordsOf(said);
			const scored = pool.map((v) => ({ v, fit: fitScore(v.brief?.tags ?? wordsOf(v.name), words) })).sort((a, b) => b.fit - a.fit);
			const top = scored[0];
			if (!top || top.fit < 1) continue;
			const span = shotSpan(p, top.v);
			if (!span) continue;
			const [at, len] = span;
			if (!freeAt(at, len)) continue;
			inserts.push({ media: top.v.id, at: r2(at), seconds: r2(len), from: take(top.v, len), words: headline(said, 8) });
			pool.splice(pool.indexOf(top.v), 1);
		}
		// Then coverage: the rest go on the shots that have been on screen longest without a cutaway, shot by shot.
		const target = platform.review.broll[0] + 0.05;
		const covered = () => inserts.reduce((s, x) => s + x.seconds, 0) / Math.max(1, total);
		const bare = speakerPieces
			.filter((p) => p.to - p.from >= 1.6 && !inserts.some((x) => x.at < p.at + (p.to - p.from) && x.at + x.seconds > p.at))
			.sort((a, b) => b.to - b.from - (a.to - a.from));
		for (const p of bare) {
			if (!pool.length || covered() >= target) break;
			const v = pool[0];
			const span = shotSpan(p, v);
			if (!span || !freeAt(span[0], span[1])) continue;
			pool.shift();
			inserts.push({ media: v.id, at: span[0], seconds: span[1], from: take(v, span[1]), words: "" });
		}
		inserts.sort((a, b) => a.at - b.at);
	}
	// Texts.
	const texts: TextHit[] = [];
	const sp = speaker?.brief?.speech;
	const hookPiece = pieces.find((p) => p.role === "hook");
	const hookLine = input.title || ctx.topic || (hookPiece && sp ? headline(sp.sentences[hookPiece.sentences[0]]?.text ?? "", 6) : "");
	if (hookLine && !long) texts.push({ kind: "hook", at: 0, seconds: Math.min(2.5, Math.max(1.6, total * 0.08)), text: hookLine });
	const chapters: Plan["chapters"] = [];
	if (long) {
		// Title card after the cold open, chapters at section starts, the speaker's name once.
		const afterHook = pieces.find((p) => p.role !== "hook")?.at ?? 0;
		if (recipe.titleCard && hookLine) texts.push({ kind: "title", at: r2(afterHook), seconds: 2.5, text: hookLine, sub: ctx.topic && ctx.topic !== hookLine ? ctx.topic : "" });
		let section = 0;
		for (const p of pieces) {
			if (p.section > section) {
				section = p.section;
				// The section's own name: a sentence of its first few with a colon ("Step two: add one lamp"), not a greeting.
				const own = pieces.filter((x) => x.section === section).flatMap((x) => x.sentences).slice(0, 4).map((i) => sp?.sentences[i]).filter((x): x is Sentence => !!x && !/^(hi|hello|привет|здравствуй|welcome)/i.test(x.text));
				// The speaker's own name for the part, even when that line was cut: "Step two: …", "Шаг второй: …" said
				// between the previous part and this one.
				const prevEnd = pieces.filter((x) => x.section === section - 1).flatMap((x) => x.sentences).map((i) => sp?.sentences[i]?.to ?? 0).reduce((m, v) => Math.max(m, v), 0);
				const firstFrom = own[0]?.from ?? 0;
				const said = (sp?.sentences ?? []).filter((x) => x.from >= prevEnd - 0.01 && x.from <= firstFrom + 0.01 && (MARKER.test(x.text.trim()) || /^[^.!?]{3,40}:/u.test(x.text)));
				const marker = said[said.length - 1];
				// "Step 2." alone names little: with the sentence after it, "Step 2: Add one lamp".
				const next = marker && marker.words <= 3 ? sp?.sentences[marker.i + 1] : undefined;
				const title = marker
					? headline(next ? `${marker.text.replace(/[.!?…]+$/, "")}: ${next.text.split(/[.!?]/)[0]}` : marker.text.split(/[.!?]/)[0], 7)
					: (() => {
							const named = own.find((x) => /:/.test(x.text.slice(0, 40))) ?? own[0];
							return named ? headline(named.text.split(/[.!?]/)[0], 6) : `Part ${section}`;
						})();
				chapters.push({ at: p.at, title });
				// The first section opens under the title card: its name is in the chapters list, not on screen twice.
				if (!(recipe.titleCard && Math.abs(p.at - afterHook) < 0.5)) texts.push({ kind: "chapter", at: r2(p.at + 0.2), seconds: 2.4, text: title });
			}
		}
		if (recipe.lowerThirds && input.speaker) texts.push({ kind: "lower-third", at: r2(afterHook + 3), seconds: 4, text: input.speaker });
	}
	if (recipe.stats && sp) {
		for (const p of pieces) {
			const s = sp.sentences[p.sentences[0]];
			const m = s ? NUMBER.exec(s.text) : null;
			if (m && texts.filter((x) => x.kind === "stat").length < (long ? 3 : 1) && p.at > platform.review.hookSeconds && p.at + 3 < total - 3) {
				// The number's own words: what follows it ("3 out of 4 creators" → "out of 4 creators").
				const after = s.text.slice((m.index ?? 0) + m[0].length).replace(/^[\s,]+/, "");
				texts.push({ kind: "stat", at: r2(p.at + 0.4), seconds: 3, text: headline(after || s.text, 4), value: Number(m[1].replace(",", ".")) });
			}
		}
	}
	if (recipe.ending === "end-screen") texts.push({ kind: "end-screen", at: r2(Math.max(0, total - Math.min(12, Math.max(6, total * 0.08)))), seconds: r2(Math.min(12, Math.max(6, total * 0.08))), text: ctx.cta || "Subscribe" });
	else texts.push({ kind: "cta", at: r2(Math.max(0, total - 2.5)), seconds: 2.5, text: ctx.cta });
	// Captions: every word said in the kept pieces, on the timeline's clock.
	let captions: Plan["captions"] = null;
	const wantCaptions = !input.captions?.off && (recipe.captions !== "off" || platform.captions.minCoverage > 0);
	if (wantCaptions && sp) {
		const words: Word[] = [];
		if (voice) {
			for (const w of sp.words) if (w.start >= voice.from && w.end <= voice.to) words.push({ text: w.text, start: r2(w.start - voice.from), end: r2(w.end - voice.from) });
		}
		for (const p of pieces) {
			if (p.media !== speaker?.id) continue;
			for (const w of sp.words) if (w.start >= p.from - 0.005 && w.end <= p.to + 0.005) words.push({ text: w.text, start: r2(p.at + w.start - p.from), end: r2(p.at + w.end - p.from) });
		}
		captions = { style: input.captions?.style || preset.captions.style, words };
	}
	// Music: a bed under the whole edit, ending on a bar with a one-bar fade.
	let music: Plan["music"] = null;
	// The user's own song is the music when there is one (a music video, a story on their track).
	const own = ctx.media.find((m) => m.type === "audio" && !!m.brief?.music && !m.brief.speech);
	if (own?.brief?.music && !input.music?.off) {
		const g = own.brief.music;
		const len = Math.min(own.brief.seconds, total);
		const lastBar = g.downbeats.filter((d) => d <= len - 0.5).pop() ?? len - g.bar;
		music = { pick: { id: own.id, url: "", name: own.name, dur: own.brief.seconds, bpm: g.bpm, downbeats: g.downbeats, gain: 0, media: own.id } as SoundPick, at: 0, seconds: r2(len), gainDb: -2, fadeOut: r2(Math.max(0.8, Math.min(g.bar * 1.01, len - lastBar))) };
	} else if (ctx.music && !input.music?.off && recipe.music !== "off") {
		// It plays to the last frame; the fade-out starts on the last bar line before the end (music "ends on a bar").
		const bar = ctx.music.bpm ? 240 / ctx.music.bpm : 2;
		const len = Math.min(ctx.music.dur, total);
		const lastBar = ctx.music.downbeats?.length ? (ctx.music.downbeats.filter((d) => d <= len - 0.5).pop() ?? len - bar) : len - Math.min(2, bar);
		music = { pick: ctx.music, at: 0, seconds: r2(len), gainDb: (ctx.music.gain ?? 0) + preset.music.levelDb, fadeOut: r2(Math.max(0.8, Math.min(bar * 1.01, len - lastBar))) };
	}
	// Sounds: a whoosh on the hook title, a soft hit at the payoff, a riser into the call to action; nothing else.
	const sfx: Plan["sfx"] = [];
	const hit = ctx.sfx.hit;
	const whoosh = ctx.sfx.whoosh;
	const riser = ctx.sfx.riser;
	const level = preset.sfx.levelDb;
	if (whoosh && texts.some((x) => x.kind === "hook" || x.kind === "title")) {
		const t0 = texts.find((x) => x.kind === "title")?.at ?? 0;
		sfx.push({ pick: whoosh, at: r2(Math.max(0, t0 - 0.05)), gainDb: (whoosh.gain ?? 0) + level, why: "title in" });
	}
	const payoff = pieces.find((p) => p.role === "payoff");
	if (hit && payoff) sfx.push({ pick: hit, at: payoff.at, gainDb: (hit.gain ?? 0) + level, why: "payoff" });
	const end = texts.find((x) => x.kind === "cta" || x.kind === "end-screen");
	if (riser && end && preset.energetic && end.at > riser.dur) sfx.push({ pick: riser, at: r2(end.at - Math.min(riser.dur, 2)), gainDb: (riser.gain ?? 0) + level - 2, why: "into the CTA" });
	return {
		recipe: recipe.id,
		preset: preset.id,
		platform: platform.id,
		seconds: total,
		language: ctx.language,
		topic: ctx.topic,
		pieces,
		inserts,
		texts,
		captions,
		music,
		sfx,
		chapters,
		...(voice ? { voice } : {}),
		notes,
	};
}
