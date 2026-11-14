// What the speech detector found (Silero VAD inside whisper-cli, transcribe/server/whisper.ts): the stretches where
// someone really speaks. The loudness islands of align.ts cannot tell a voice from music or street noise — under a
// music bed the whole clip is one island and the words get spread over the intro and the outro. With the detector's
// stretches the islands are kept only where a voice is, so every pause between phrases is a pause again.
// Pure functions: shared by the server job, the benchmark and the unit tests.
import type { Span } from "./align";

/**
 * How far around a detected voice the engine listens (whisper-cli's --vad-speech-pad-ms, here in seconds): a soft
 * first consonant right after loud music is noticed up to 0.4 s late, and with the engine's own 30 ms the first word
 * of a phrase was lost. The stretches whisper-cli reports are the voice with this much around it; two voices closer
 * than twice the pad meet in the middle of the pause between them.
 */
export const VAD_PAD = 0.4;
/** How close around a voice sound still counts as that voice when the words are laid: the detector's edges are good to about a tenth of a second. */
export const VOICE_EDGE = 0.12;
/** A pause known only by its middle (two reported stretches meeting there) is taken to be at least this long. */
const PAUSE = 0.16;
const FRAME = 0.01;

/** One line of whisper-cli's log → the stretch it decodes (seconds), or null. */
export function vadSegmentOf(line: string): Span | null {
	const m = /VAD segment \d+: start = (\d+(?:\.\d+)?), end = (\d+(?:\.\d+)?)/.exec(line);
	if (!m) return null;
	const start = Number(m[1]);
	const end = Number(m[2]);
	return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

/** Sorted, each widened by `pad`, overlapping or touching ones joined. */
export function padded(spans: Span[], pad = 0): Span[] {
	const out: Span[] = [];
	for (const v of [...spans].sort((a, b) => a.start - b.start)) {
		const start = Math.max(0, v.start - pad);
		const end = v.end + pad;
		const last = out[out.length - 1];
		if (last && start <= last.end) last.end = Math.max(last.end, end);
		else out.push({ start, end });
	}
	return out;
}

/**
 * The pause two reported stretches meet in, found in the sound: around the meeting point the level drops (a voice
 * over a music bed leaves the bed alone for a moment). The dip that holds the meeting point — or the longest one
 * right beside it — is the pause; when the sound shows none (loud music), it is PAUSE long around the point.
 */
function pauseAt(t: number, levels: Float32Array | undefined, reach: number): Span {
	const fallback = { start: t - PAUSE / 2, end: t + PAUSE / 2 };
	if (!levels?.length) return fallback;
	const at = (sec: number) => Math.max(0, Math.min(levels.length, Math.round(sec / FRAME)));
	// the level of the voice around: the loud end of two and a half seconds of sound
	const around = Float32Array.from(levels.subarray(at(t - 1.25), at(t + 1.25))).sort();
	if (around.length < 20) return fallback;
	const threshold = around[Math.floor(around.length * 0.8)] - 8;
	const from = at(t - reach);
	const to = at(t + reach);
	let best: Span | null = null;
	let open = -1;
	for (let f = from; f <= to; f++) {
		const low = f < to && levels[f] < threshold;
		if (low && open < 0) open = f;
		if (!low && open >= 0) {
			const run = { start: open * FRAME, end: f * FRAME };
			open = -1;
			// a stop consonant is a dip too: only a real pause (80 ms or more) at the meeting point counts
			if (run.end - run.start < 0.08 || run.start > t + 0.15 || run.end < t - 0.15) continue;
			if (!best || run.end - run.start > best.end - best.start) best = run;
		}
	}
	return best ?? fallback;
}

/**
 * Where the voice is (± VOICE_EDGE), from the stretches whisper-cli reports (the voice with VAD_PAD around it).
 * `levels` (align.ts frameLevels) places the pauses the reported stretches only meet in.
 */
export function voiceZones(reported: Span[], levels?: Float32Array, { pad = VAD_PAD, edge = VOICE_EDGE }: { pad?: number; edge?: number } = {}): Span[] {
	const r = [...reported].sort((a, b) => a.start - b.start);
	const seconds = levels ? levels.length * FRAME : Number.POSITIVE_INFINITY;
	const shrink = Math.max(0, pad - edge);
	const touch = (i: number) => i >= 0 && i + 1 < r.length && r[i + 1].start - r[i].end < 0.03;
	const pauses = r.map((x, i) => (touch(i) ? pauseAt((x.end + r[i + 1].start) / 2, levels, pad) : null));
	const out: Span[] = [];
	r.forEach((x, i) => {
		const before = i > 0 ? pauses[i - 1] : null;
		const after = pauses[i];
		// (a stretch cut by the file's own start or end keeps that edge: the voice may begin right there)
		let start = before ? before.end : x.start <= 0.011 ? 0 : x.start + shrink;
		let end = after ? after.start : x.end >= seconds - 0.02 ? x.end : x.end - shrink;
		if (end - start < 0.06) {
			const mid = (x.start + x.end) / 2;
			start = mid - 0.03;
			end = mid + 0.03;
		}
		const last = out[out.length - 1];
		if (last && start <= last.end) last.end = Math.max(last.end, end);
		else out.push({ start: Math.max(0, start), end });
	});
	return out;
}

/**
 * The islands of sound (align.ts speechIslands) kept only where a voice is (`zones`: voiceZones).
 * - Clean speech: an island begins and ends with the voice (within `slack` of the zone) and stays as it is — its
 *   own edges are the exact ones.
 * - A voice over music: the island runs on before and after the voice; it is cut to the zones, so the pauses
 *   between phrases are pauses again.
 * - Music or noise alone: no island.
 */
export function voicedIslands(islands: Span[], zones: Span[], { slack = VAD_PAD - VOICE_EDGE, minIsland = 0.02 }: { slack?: number; minIsland?: number } = {}): Span[] {
	const tight = padded(zones);
	const wide = padded(zones, slack);
	const round = (t: number) => Math.round(t * 1000) / 1000;
	const out: Span[] = [];
	let t = 0;
	let w = 0;
	for (const island of islands) {
		while (t < tight.length && tight[t].end <= island.start) t++;
		const pieces: Span[] = [];
		for (let k = t; k < tight.length && tight[k].start < island.end; k++) {
			const start = Math.max(island.start, tight[k].start);
			const end = Math.min(island.end, tight[k].end);
			if (end - start >= minIsland) pieces.push({ start, end });
		}
		if (pieces.length) {
			// The island's own edge, when the sound begins (ends) with the voice rather than long before (after) it.
			if (pieces[0].start - island.start <= slack) pieces[0].start = island.start;
			const last = pieces[pieces.length - 1];
			if (island.end - last.end <= slack) last.end = island.end;
			for (const piece of pieces) out.push({ start: round(piece.start), end: round(piece.end) });
			continue;
		}
		// A short sound right beside a voice (a soft first consonant the detector noticed late): part of it.
		while (w < wide.length && wide[w].end < island.end) w++;
		if (w < wide.length && wide[w].start <= island.start && island.end <= wide[w].end) out.push({ start: round(island.start), end: round(island.end) });
	}
	return out;
}

/**
 * Below this share of a voice zone covered by islands of sound, the sound does not show the voice: under a bed as loud
 * as the voice or louder, the islands are the bed's beats and loud vowels, a tenth of a second each, and words laid on
 * them were crammed into the beats and then dropped as «in silence» (11.11, the captions stick: a voice at 0 dB under
 * music lost 18.9 % of its words that way, at −6 dB 41.5 %, while the engine had heard all but 2–15 %). There the
 * zone itself is the island. Measured on the stick: clean speech and a voice over a quieter bed cover 0.6–1 of their
 * zones, a voice at 0 / −6 dB under music 0.1–0.3.
 */
export const COVER = 0.35;

/** The voice zones (sorted, joined) the islands of sound cover less than `cover` of: there the zone is the island. */
export function blindZones(islands: Span[], zones: Span[], cover = COVER): Span[] {
	const out: Span[] = [];
	let i = 0;
	for (const z of padded(zones)) {
		while (i < islands.length && islands[i].end <= z.start) i++;
		let covered = 0;
		for (let k = i; k < islands.length && islands[k].start < z.end; k++) covered += Math.max(0, Math.min(z.end, islands[k].end) - Math.max(z.start, islands[k].start));
		if (covered < cover * (z.end - z.start)) out.push(z);
	}
	return out;
}

/** The islands with every blind zone (blindZones) made one island: what lay inside it goes, the zone comes in. */
export function withBlind(islands: Span[], blind: Span[]): Span[] {
	if (!blind.length) return islands;
	const inside = (s: Span) => blind.some((b) => s.start >= b.start - 1e-6 && s.end <= b.end + 1e-6);
	return padded([...islands.filter((s) => !inside(s)), ...blind]);
}

/**
 * Loud stretches the engine was not given (`reported`: what whisper-cli decoded with the detector): music alone — or
 * singing, a shout from afar, a voice through a megaphone, which the detector may not take for speech. They are not
 * thrown away: the plain engine listens to them again (transcribe/server/listen.ts) and is believed when it hears a
 * steady stream of words there. Sound up to `bridge` apart is one stretch (music breathes); stretches shorter than
 * `min` are left alone.
 */
export function unvoicedLoud(islands: Span[], reported: Span[], { bridge = 1, min = 2 }: { bridge?: number; min?: number } = {}): Span[] {
	const loud: Span[] = [];
	for (const s of islands) {
		const last = loud[loud.length - 1];
		if (last && s.start - last.end < bridge) last.end = Math.max(last.end, s.end);
		else loud.push({ ...s });
	}
	const zones = padded(reported);
	const out: Span[] = [];
	let z = 0;
	for (const stretch of loud) {
		let at = stretch.start;
		while (z < zones.length && zones[z].end <= at) z++;
		const take = (end: number) => {
			if (end - at >= min) out.push({ start: Math.round(at * 1000) / 1000, end: Math.round(end * 1000) / 1000 });
		};
		for (let k = z; k < zones.length && zones[k].start < stretch.end; k++) {
			take(zones[k].start);
			at = Math.max(at, zones[k].end);
		}
		take(stretch.end);
	}
	return out;
}

interface Heard {
	text: string;
	start: number;
	end: number;
	p?: number;
}

/**
 * What the engine says over music with nobody speaking, beyond the credit lines hear/hallucinations.ts knows: sign-offs
 * and notes of its training subtitles. Heard 11.11 over the built-in library's instrumental tracks.
 */
const OVER_MUSIC =
	/thank(?:s| you)(?: so much| very much)?(?: for (?:watching|listening))?|we'?ll be right back|(?:i'?ll )?see you (?:next time|later|soon)|for more information,? visit \S+|transcri(?:bed|ption) by \S+|\*[^*]*\*|спасибо(?: за (?:просмотр|внимание))?|до (?:новых встреч|свидания)|конец/giu;

/**
 * Whether the plain engine's words over a stretch the detector called voiceless are real — a steady stream of words
 * (lyrics, a whisper, a voice the detector missed) and not the engine inventing over music:
 * - at least `MIN_WORDS` words it is sure of, one every five seconds or more, once the sign-offs above are dropped
 *   (a lone «you», «Thank you.», «We'll be right back.»);
 * - not one phrase going round and round («I don't know what you're doing.» ten times: half of the sure words or
 *   more must differ);
 * - sure of most of what it says (the middle word at 0.5 or more).
 * Measured 11.11 (transcribe/__tests__/music-eval.ts): of 135 twenty-second pieces of instrumental music the rule
 * believed 3 (the cost: that file is heard the old way) and the one piece that turned out to have a singer; of 81
 * ten-second pieces of real speech with four words or more it believed 81.
 */
export const MIN_WORDS = 4;
export const MIN_RATE = 0.2;
export function believable(words: Heard[], seconds: number): boolean {
	// the sign-offs go by text, whatever words they are split into
	const spans: Array<[number, number]> = [];
	let text = "";
	for (const w of words) {
		spans.push([text.length, text.length + w.text.length]);
		text += `${w.text} `;
	}
	const dropped = new Set<number>();
	for (const m of text.matchAll(OVER_MUSIC)) {
		const from = m.index ?? 0;
		const to = from + m[0].length;
		spans.forEach(([a, b], i) => {
			if (b > from && a < to) dropped.add(i);
		});
	}
	const said = words.filter((w, i) => !dropped.has(i) && /[\p{L}\p{N}]/u.test(w.text));
	const sure = said.filter((w) => (w.p ?? 1) >= 0.5);
	if (sure.length < MIN_WORDS || sure.length / Math.max(1, seconds) < MIN_RATE) return false;
	const bare = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
	if (new Set(sure.map((w) => bare(w.text))).size < sure.length / 2) return false;
	const ps = said.map((w) => w.p ?? 1).sort((x, y) => x - y);
	return ps[Math.floor(ps.length / 2)] >= 0.5;
}

/** Where each stretch sits in the audio made of the stretches laid end to end with `gap` seconds of silence between. */
export function stitchPlan(stretches: Span[], gap = 1): Array<{ from: Span; at: number }> {
	let at = 0;
	return stretches.map((from) => {
		const placed = { from, at };
		at += from.end - from.start + gap;
		return placed;
	});
}

/**
 * Words heard in the stitched audio, per stretch and in the original's time. A word belongs to the stretch its middle
 * is in or nearest to (the engine's word edges run up to half a second off); words deep in the silence between
 * stretches are nobody's (dropped).
 */
export function unstitch<W extends Heard>(words: W[], plan: Array<{ from: Span; at: number }>, reach = 0.5): W[][] {
	const out: W[][] = plan.map(() => []);
	for (const w of words) {
		const mid = (w.start + w.end) / 2;
		let k = -1;
		let best = reach;
		plan.forEach((p, i) => {
			const end = p.at + (p.from.end - p.from.start);
			const away = mid < p.at ? p.at - mid : mid >= end ? mid - end : 0;
			if (away < best || (away === 0 && k < 0)) {
				best = away;
				k = i;
			}
		});
		if (k < 0) continue;
		const { from, at } = plan[k];
		const shift = from.start - at;
		const start = Math.min(from.end, Math.max(from.start, w.start + shift));
		out[k].push({ ...w, start, end: Math.max(start, Math.min(from.end, w.end + shift)) });
	}
	return out;
}
