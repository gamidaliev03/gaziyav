// Captions from the voice-over's own word timings (MiniMax words[]): no speech recognition, no typos.
// Short ad-style cues: up to 3 words, split at pauses and punctuation, and a Russian preposition or
// conjunction never hangs at the end of a cue — it moves to the next one, with the word it belongs to.

export interface TimedWord {
	text: string;
	start: number;
	end: number;
}

export interface Cue {
	text: string;
	startTime: number;
	duration: number;
}

const MAX_WORDS = 3;
const PAUSE = 0.35;
const MAX_CUE = 2.6;

/** Words that must not end a line: prepositions, conjunctions, particles. */
const CLINGY = new Set(
	"в во на с со к ко у о об обо от до по за из изо без для при про через над под перед между и а но да или либо что чтобы как если не ни же ли бы то".split(" "),
);

const endsPhrase = (w: string) => /[.!?…;:,—–-]["»”)]*$/.test(w);
const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Glues stand-alone punctuation tokens to the previous word. */
function tidy(words: TimedWord[]): TimedWord[] {
	const out: TimedWord[] = [];
	for (const w of words) {
		const text = w.text.trim();
		if (!text) continue;
		if (!bare(text) && out.length) {
			out[out.length - 1] = { ...out[out.length - 1], text: out[out.length - 1].text + text, end: Math.max(out[out.length - 1].end, w.end) };
		} else {
			out.push({ ...w, text });
		}
	}
	return out;
}

export function wordsToCues(input: TimedWord[], offset = 0, maxWords = MAX_WORDS): Cue[] {
	const words = tidy(input);
	const groups: TimedWord[][] = [];
	let cur: TimedWord[] = [];
	for (let i = 0; i < words.length; i++) {
		const w = words[i];
		const prev = cur[cur.length - 1];
		const breakBefore =
			prev &&
			(cur.length >= maxWords || w.start - prev.end > PAUSE || endsPhrase(prev.text) || w.end - cur[0].start > MAX_CUE);
		if (breakBefore) {
			// Move trailing clingy words to the next cue (but never empty the current one).
			const carry: TimedWord[] = [];
			while (cur.length > 1 && CLINGY.has(bare(cur[cur.length - 1].text)) && !endsPhrase(cur[cur.length - 1].text)) {
				carry.unshift(cur.pop()!);
			}
			groups.push(cur);
			cur = carry;
		}
		cur.push(w);
	}
	if (cur.length) {
		// A lone clingy word at the very end joins the previous cue instead of hanging alone.
		groups.push(cur);
	}
	const cues: Cue[] = [];
	for (let i = 0; i < groups.length; i++) {
		const g = groups[i];
		const start = g[0].start;
		const next = groups[i + 1]?.[0].start;
		// Small gaps are bridged so captions don't flicker between cues.
		const end = next != null && next - g[g.length - 1].end < 0.25 ? next : g[g.length - 1].end;
		cues.push({
			text: g.map((w) => w.text).join(" "),
			startTime: offset + start,
			duration: Math.max(0.3, end - start),
		});
	}
	return cues;
}
