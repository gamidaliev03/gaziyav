// «Find scenes», the pure part: where the film's scenes most likely begin, from what the timeline already has.
// Candidates (seconds) each carry a score:
// - a picture cut between two different files on the main track: 3;
// - a shot change inside a clip without much speech (the split-scenes detector): 1.5;
// - a long pause in the speech: up to 3, by how much longer it is than the usual pause; a pause around a picture cut adds to the cut;
// - a turn of topic in the captions' words (the words before and after share little): up to 1.5, added to the pause or
//   cut it falls on, or a candidate of its own when it is a strong turn.
// The strongest candidates are taken first; no two scenes closer than `minScene` (the film's length / 30, between 10 s
// and 90 s), none closer than that to the start or the end. The first scene always starts at 0.

export interface Candidate {
	time: number;
	score: number;
	why: "cut" | "shot" | "pause" | "topic";
	title?: string;
}

export interface Proposal {
	time: number;
	why: Candidate["why"];
	title?: string;
}

export interface ProposeInput {
	/** Film length, seconds. */
	total: number;
	/** Main-track cuts between different files: time and the name of the file after the cut. */
	cuts: { time: number; title?: string }[];
	/** Shot changes found inside clips. */
	shots?: number[];
	/** Stretches of speech, seconds (timeline). */
	speech?: { start: number; end: number }[];
	/** Words (captions), timeline seconds. */
	words?: { text: string; start: number; end: number }[];
}

export const minSceneFor = (total: number) => Math.min(90, Math.max(10, total / 30));
const MIN_PAUSE = 1.2;
const NEAR = 2.5;

const STOP = new Set(
	"the a an and or but of to in on at for with is are was were be been it this that i you he she we they my your our его её их и в во на с со к по за из у о об а но не что это как же то так я ты он она мы вы они мой твой наш".split(" "),
);
const stems = (text: string) =>
	text
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w.length > 2 && !STOP.has(w))
		.map((w) => w.slice(0, 5));

function cosine(a: Map<string, number>, b: Map<string, number>): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (const [k, v] of a) {
		na += v * v;
		dot += v * (b.get(k) ?? 0);
	}
	for (const v of b.values()) nb += v * v;
	return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
const bag = (words: string[]) => {
	const m = new Map<string, number>();
	for (const w of words) m.set(w, (m.get(w) ?? 0) + 1);
	return m;
};

/** The first few words after `time`: a title for the scene that starts there. */
function firstWords(words: ProposeInput["words"], time: number, until: number): string | undefined {
	const said = (words ?? []).filter((w) => w.start >= time - 0.3 && w.start < until).slice(0, 5);
	if (said.length < 2) return undefined;
	const text = said.map((w) => w.text).join(" ").replace(/[.,!?;:…]+$/u, "").trim();
	return text ? text.charAt(0).toUpperCase() + text.slice(1) : undefined;
}

export function proposeMarks(input: ProposeInput): Proposal[] {
	const { total } = input;
	if (total <= 0) return [];
	const minScene = minSceneFor(total);
	const candidates: Candidate[] = [];
	const near = (t: number) => candidates.find((c) => Math.abs(c.time - t) <= NEAR);
	for (const cut of input.cuts) candidates.push({ time: cut.time, score: 3, why: "cut", title: cut.title });
	for (const shot of input.shots ?? []) if (!near(shot)) candidates.push({ time: shot, score: 1.5, why: "shot" });
	const speech = [...(input.speech ?? [])].sort((a, b) => a.start - b.start);
	// A pause counts by how much longer it is than this speaker's usual pause (slow talkers pause longer).
	const gaps = speech.slice(1).map((s, i) => s.start - speech[i].end).filter((g) => g > 0).sort((a, b) => a - b);
	const usual = Math.max(1, gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1);
	for (let i = 1; i < speech.length; i++) {
		const from = speech[i - 1].end;
		const to = speech[i].start;
		const gap = to - from;
		if (gap < MIN_PAUSE) continue;
		const score = Math.min(3, (gap - usual) / 1.5);
		if (score <= 0) continue;
		// A cut inside the pause is where the scene changes; else just before the speech comes back.
		const inside = candidates.find((c) => c.why !== "pause" && c.time >= from - 0.2 && c.time <= to + 0.2);
		if (inside) inside.score += score;
		else candidates.push({ time: Math.max(from + gap / 2, to - 0.4), score, why: "pause" });
	}
	// Topic turns: words of the 40 before vs the 40 after each gap between captions.
	const words = [...(input.words ?? [])].sort((a, b) => a.start - b.start);
	if (words.length >= 60) {
		const tokens = words.map((w) => stems(w.text));
		for (let i = 20; i < words.length - 20; i++) {
			const gap = words[i].start - words[i - 1].end;
			if (gap < 0.25) continue;
			const before = bag(tokens.slice(Math.max(0, i - 40), i).flat());
			const after = bag(tokens.slice(i, i + 40).flat());
			const turn = 1 - cosine(before, after);
			if (turn < 0.85) continue;
			const t = words[i].start - 0.2;
			const score = (turn - 0.85) * 10; // 0 … 1.5
			const at = near(t);
			if (at) at.score += score;
			else if (score >= 1) candidates.push({ time: t, score, why: "topic" });
		}
	}
	const chosen: Candidate[] = [];
	for (const c of [...candidates].sort((a, b) => b.score - a.score || a.time - b.time)) {
		if (c.score < 1) break;
		if (c.time < minScene || c.time > total - minScene) continue;
		if (chosen.some((x) => Math.abs(x.time - c.time) < minScene)) continue;
		chosen.push(c);
	}
	chosen.sort((a, b) => a.time - b.time);
	const starts = [0, ...chosen.map((c) => c.time)];
	return starts.map((time, i) => {
		const c = chosen[i - 1];
		const until = starts[i + 1] ?? total;
		const title = firstWords(words, time, until) ?? (i === 0 ? input.cuts.find((x) => x.time === 0)?.title : c?.title);
		return { time, why: c?.why ?? "cut", ...(title ? { title } : {}) };
	});
}
