// The material brief: what an editor knows about a clip after watching it once — shot, faces, motion, cuts, exposure,
// the beauty of its frames, the sound, and for speech the sentences ranked as hooks, the retakes and the dead air.
// Computed on the server (production/server/analyze.ts) from ffmpeg, claude-hear's audio map, whisper and Apple Vision;
// these are the pure parts (types, judgement, ranking, the compact text Claude reads) so they are unit-tested.

export interface Word {
	text: string;
	start: number;
	end: number;
	p?: number;
}

/** One frame as Apple Vision and the pixel statistics see it (native/framejudge.swift). */
export interface JudgedFrame {
	t: number;
	aesthetic: number | null;
	utility?: boolean;
	sharp: number;
	luma: number;
	lumaStd: number;
	clipHi: number;
	clipLo: number;
	castR: number;
	castB: number;
	colorful: number;
	edges: number;
	horizon: number | null;
	/** How straight a line runs across the frame at the horizon's angle (0…1) and how much straighter than a level line:
	 *  a real tilted horizon (sea, roofs, a table edge) gains; Vision's horizon on a face, a crowd or a pattern doesn't. */
	horizonLine?: number;
	horizonGain?: number;
	salient: [number, number, number, number] | null;
	/** Exposure of the main face and of the salient subject (mean luma, blown share). */
	faceLuma?: number;
	faceClip?: number;
	salientLuma?: number;
	salientClip?: number;
	faces: Array<{ box: [number, number, number, number]; quality?: number; eyes?: number; roll?: number; yaw?: number }>;
	/** Lines of text Vision read, and how many sit in a corner (a watermark or a channel logo). */
	text?: number;
	cornerText?: number;
	/** Letterbox / pillarbox bars (top, bottom, left, right shares): the statistics are of the picture inside them. */
	bars?: number[];
}

export interface FrameVerdict {
	t: number;
	/** 0–100: Apple's aesthetics score with the editor's rules on top. */
	score: number;
	/** Named problems: blurry, soft, overexposed, dark, flat, cast, tilted, eyes-closed, face-cut, no-headroom, busy, off-balance. */
	flags: string[];
	/** One line of reasons, good and bad. */
	why: string;
}

export interface Sentence {
	i: number;
	from: number;
	to: number;
	text: string;
	words: number;
	/** 0–1: complete, quotable, emphatic, with hook words. */
	hook: number;
	complete: boolean;
	retake?: boolean;
	filler?: boolean;
}

/** A pause between two words with the cut points claude-hear's ears chose in it (end a piece / start a piece). */
export interface PauseCut {
	lo: number;
	hi: number;
	/** Where to cut when the piece before ends here (the word's release and some room kept). */
	end: number;
	/** Where to cut when the piece after starts here. */
	start: number;
	kind?: string;
}

export interface SpeechBrief {
	language: string;
	words: Word[];
	sentences: Sentence[];
	/** Best quotes first: sentence indices. */
	quotes: number[];
	retakes: Array<{ from: number; to: number; redoAt: number }>;
	fillers: Array<{ from: number; to: number; text: string }>;
	/** Share of the clip that is silence over 1 s, and filler words per word. */
	deadAir: number;
	fillerShare: number;
	/** The speaker's natural pause, seconds (claude-hear's rhythm). */
	pause: number;
	cuts: PauseCut[];
}

export interface MaterialBrief {
	key: string;
	name: string;
	kind: "video" | "image" | "audio";
	seconds: number;
	width?: number;
	height?: number;
	fps?: number;
	hasAudio: boolean;
	shot: "close" | "medium" | "wide" | "no-face";
	/** Share of sampled frames with a face, and the median face box (0…1, top-left origin). */
	faces: number;
	faceBox?: [number, number, number, number];
	/** The median salient subject box (0…1, top-left): where a detail shot of a picture looks. */
	salientBox?: [number, number, number, number];
	motion: "static" | "low" | "medium" | "high";
	motionScore: number;
	scenes: number[];
	exposure: { luma: number; clipHi: number; clipLo: number; verdict: "ok" | "dark" | "bright" | "flat" };
	cast: { r: number; b: number; verdict: "neutral" | "warm" | "cool" | "magenta" | "green" };
	frames: FrameVerdict[];
	/** Frame statistics per sampled time (for matching shots and protecting skin): luma and cast. */
	looks: Array<[t: number, luma: number, castR: number, castB: number]>;
	audio?: { lufs: number | null; truePeak: number | null; lra: number | null; noiseDb: number | null; clipping: boolean; speechShare: number };
	music?: { bpm: number; beats: number[]; downbeats: number[]; bar: number };
	speech?: SpeechBrief;
	/** Labels a person would give it (file name words, shot, motion) for matching B-roll to words. */
	tags: string[];
	analysedAt: number;
	version: number;
}

export const BRIEF_VERSION = 4;

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// ───────────────────────── frames ─────────────────────────

/** Judges one frame: Apple's score as the base, the editor's rules on top. `ref` = the clip's median sharpness. */
export function judgeFrame(f: JudgedFrame, ref?: { sharp?: number }): FrameVerdict {
	const flags: string[] = [];
	const good: string[] = [];
	let score = f.aesthetic === null || f.aesthetic === undefined ? 60 : 50 + 40 * Math.max(-1, Math.min(1, f.aesthetic));
	// A plain graphic (a gradient, a colour field, no faces): sharpness, cast and horizon mean nothing there.
	const plain = !(f.faces ?? []).length && f.edges < 0.03 && f.sharp < 15;
	if (f.aesthetic !== null && f.aesthetic !== undefined && f.aesthetic > 0.6) good.push("pleasing");
	if (plain) {
		good.push("plain");
	} else if (f.sharp < 15) {
		flags.push("blurry");
		score -= 35;
	} else if (f.sharp < 40 || (ref?.sharp && f.sharp < ref.sharp * 0.25)) {
		flags.push("soft");
		score -= 15;
	} else good.push("sharp");
	const exposure = exposureFlag(f);
	if (exposure === "overexposed") {
		flags.push("overexposed");
		score -= 25;
	} else if (exposure === "dark") {
		flags.push("dark");
		score -= 20;
	} else if (f.lumaStd < 0.07) {
		flags.push("flat");
		score -= 10;
	}
	const main = [...(f.faces ?? [])].sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3])[0];
	if (!plain && main && (Math.abs(f.castR) > 0.09 || Math.abs(f.castB) > 0.09)) {
		flags.push("cast");
		score -= 8;
	}
	const line = f.horizonGain === undefined ? !(main && main.box[3] > 0.3) : f.horizonGain >= 0.15 && (f.horizonLine ?? 0) >= 0.65;
	if (!plain && line && f.horizon !== null && f.horizon !== undefined && Math.abs(f.horizon) > 3 && Math.abs(f.horizon) < 30) {
		flags.push("tilted");
		score -= 15;
	}
	if (main) {
		const [x, y, w, h] = main.box;
		if (main.eyes !== undefined && main.eyes < 0.5) {
			flags.push("eyes-closed");
			score -= 30;
		} else if (main.eyes !== undefined) good.push("eyes open");
		if (w > 0.12 && (x < 0.005 || x + w > 0.995 || y + h > 0.995)) {
			flags.push("face-cut");
			score -= 12;
		}
		if (y < 0.02 && h < 0.8) {
			flags.push("no-headroom");
			score -= 8;
		}
		const cx = x + w / 2;
		const cy = y + h / 2;
		const spots = [[0.5, 0.45], [1 / 3, 0.4], [2 / 3, 0.4]];
		const off = Math.min(...spots.map(([sx, sy]) => Math.hypot(cx - sx, cy - sy)));
		if (off > 0.28) {
			flags.push("off-balance");
			score -= 6;
		} else good.push("face well placed");
	} else if (f.salient) {
		const [x, y, w, h] = f.salient;
		const cx = x + w / 2;
		const cy = y + h / 2;
		const off = Math.min(...[[0.5, 0.5], [1 / 3, 1 / 3], [2 / 3, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 2 / 3]].map(([sx, sy]) => Math.hypot(cx - sx, cy - sy)));
		if (off > 0.3) {
			flags.push("off-balance");
			score -= 5;
		}
	}
	if (f.edges > 0.38) {
		flags.push("busy");
		score -= 6;
	}
	if ((f.cornerText ?? 0) > 0) {
		flags.push("watermark");
		score -= 15;
	}
	score = Math.max(0, Math.min(100, Math.round(score)));
	const why = [...flags.map((x) => x.replace("-", " ")), ...good.slice(0, 2)].join(", ") || "plain";
	return { t: round(f.t, 2), score, flags, why };
}

/**
 * Blown or murky as an editor sees it: the face and the subject first (a white product backdrop is high-key, a lit
 * window is a light source, stage lights are meant to burn), the whole frame only when much of it is gone.
 */
export function exposureFlag(f: Pick<JudgedFrame, "luma" | "clipHi" | "clipLo" | "faceLuma" | "faceClip" | "salientLuma" | "salientClip">): "overexposed" | "dark" | null {
	const faceHot = f.faceLuma !== undefined && f.faceLuma > 0.75 && (f.faceClip ?? 0) > 0.02;
	const subjectHot = f.salientLuma !== undefined && f.salientLuma > 0.85 && (f.salientClip ?? 0) > 0.04;
	if (f.clipHi > 0.15 || (f.luma > 0.7 && f.clipHi > 0.02) || faceHot || subjectHot) return "overexposed";
	const subject = f.faceLuma ?? f.salientLuma ?? f.luma;
	if ((f.faceLuma !== undefined && f.faceLuma < 0.12) || (f.luma < 0.12 && subject < 0.18) || (f.clipLo > 0.3 && subject < 0.2)) return "dark";
	return null;
}

export function exposureOf(frames: JudgedFrame[]): MaterialBrief["exposure"] {
	if (!frames.length) return { luma: 0.5, clipHi: 0, clipLo: 0, verdict: "ok" };
	const med = (k: keyof JudgedFrame) => median(frames.map((f) => Number(f[k]) || 0));
	const luma = med("luma");
	const clipHi = med("clipHi");
	const clipLo = med("clipLo");
	const std = med("lumaStd");
	// the clip's verdict = what most of its frames are
	const flags = frames.map(exposureFlag);
	const share = (x: "overexposed" | "dark") => flags.filter((y) => y === x).length / frames.length;
	const verdict = share("overexposed") >= 0.5 ? "bright" : share("dark") >= 0.5 ? "dark" : std < 0.07 ? "flat" : "ok";
	return { luma: round(luma), clipHi: round(clipHi, 3), clipLo: round(clipLo, 3), verdict };
}

/** The median salient subject box over the frames (where a detail shot of the picture looks). */
export function salientOf(frames: JudgedFrame[]): [number, number, number, number] | undefined {
	const boxes = frames.map((f) => f.salient).filter((b): b is [number, number, number, number] => !!b && b.length === 4);
	if (!boxes.length) return undefined;
	return [0, 1, 2, 3].map((k) => round(median(boxes.map((b) => b[k])), 3)) as [number, number, number, number];
}

export function castOf(frames: JudgedFrame[]): MaterialBrief["cast"] {
	const r = median(frames.map((f) => f.castR));
	const b = median(frames.map((f) => f.castB));
	const verdict = r > 0.06 && b < 0 ? "warm" : b > 0.06 ? "cool" : r > 0.05 && b > 0.03 ? "magenta" : r < -0.05 && b < -0.03 ? "green" : "neutral";
	return { r: round(r, 3), b: round(b, 3), verdict };
}

export function median(values: number[]): number {
	const v = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (!v.length) return 0;
	const m = Math.floor(v.length / 2);
	return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Shot size from the faces: a face over 40 % of the frame height is a close-up. */
export function shotOf(frames: JudgedFrame[]): { shot: MaterialBrief["shot"]; faces: number; faceBox?: [number, number, number, number] } {
	if (!frames.length) return { shot: "no-face", faces: 0 };
	const withFace = frames.filter((f) => f.faces?.length);
	const share = withFace.length / frames.length;
	if (share < 0.3) return { shot: "no-face", faces: round(share) };
	const boxes = withFace.map((f) => [...f.faces].sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3])[0].box);
	const box = [0, 1, 2, 3].map((k) => round(median(boxes.map((b) => b[k])), 3)) as [number, number, number, number];
	const h = box[3];
	return { shot: h > 0.4 ? "close" : h > 0.18 ? "medium" : "wide", faces: round(share), faceBox: box };
}

// ───────────────────────── speech ─────────────────────────

const FILLER_WORDS = new Set(["э", "ээ", "эээ", "эм", "мм", "ну", "типа", "короче", "как бы", "вот", "значит", "um", "uh", "erm", "uhm", "hmm", "like", "basically", "actually"]);
const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}' -]/gu, "").trim();
export const isFillerWord = (w: string) => FILLER_WORDS.has(bare(w));
const GREETING = /^(привет|всем привет|здравствуй|меня зовут|добро пожаловать|в этом видео|сегодня я|hi\b|hello|hey guys|welcome|my name is|in this video|today i)/i;
const HOOK_WORDS = /(\$?\d[\d.,]*%?|секрет|ошибк|никогда|всегда|главн|почему|как |зачем|правд|миф|лучш|худш|деньг|бесплатн|быстр|stop|never|always|secret|mistake|why|how|truth|myth|best|worst|money|free|fast|nobody|everyone|\bвы\b|\bты\b|\byou\b)/gi;

/** Sentences from timed words: a sentence ends at . ! ? … or at a pause over 0.7 s (at most 30 words). */
export function sentencesOf(words: Word[]): Sentence[] {
	const out: Sentence[] = [];
	let cur: Word[] = [];
	const flush = () => {
		if (!cur.length) return;
		const text = cur.map((w) => w.text.trim()).join(" ").replace(/\s+([,.!?…])/g, "$1");
		out.push({ i: out.length, from: cur[0].start, to: cur[cur.length - 1].end, text, words: cur.length, hook: 0, complete: /[.!?…]["»”)]*$/.test(text) });
		cur = [];
	};
	for (const w of words) {
		const prev = cur[cur.length - 1];
		if (prev && (w.start - prev.end > 0.7 || cur.length >= 30)) flush();
		cur.push(w);
		if (/[.!?…]["»”)]*$/.test(w.text.trim())) flush();
	}
	flush();
	return out;
}

const tokens = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);

/**
 * Retakes and false starts: a sentence whose opening (its first 4 words, or the whole of a short one) is said again
 * within 25 s is an earlier try; the last complete one stays.
 */
export function findRetakes(sentences: Sentence[]): Array<{ from: number; to: number; redoAt: number; i: number }> {
	const out: Array<{ from: number; to: number; redoAt: number; i: number }> = [];
	for (let i = 0; i < sentences.length; i++) {
		const a = tokens(sentences[i].text);
		if (!a.length) continue;
		const head = a.slice(0, Math.min(4, a.length));
		for (let j = i + 1; j < sentences.length && sentences[j].from - sentences[i].to < 25; j++) {
			const b = tokens(sentences[j].text);
			const same = head.filter((w, k) => b[k] === w).length;
			const overlap = a.filter((w) => b.includes(w)).length / Math.max(a.length, 1);
			if ((head.length >= 2 && same >= Math.min(3, head.length)) || (a.length >= 3 && overlap >= 0.8 && b.length >= a.length)) {
				out.push({ from: sentences[i].from, to: sentences[i].to, redoAt: sentences[j].from, i });
				break;
			}
		}
	}
	return out;
}

/** Hook score 0–1 of each sentence: complete, a quotable length, hook words, emphasis (dB over the clip), no fluff. */
export function rankSentences(sentences: Sentence[], emphasisDb: (from: number, to: number) => number = () => 0): Sentence[] {
	const retaken = new Set(findRetakes(sentences).map((r) => r.i));
	return sentences.map((s) => {
		let hook = 0.2;
		if (s.complete) hook += 0.2;
		if (s.words >= 6 && s.words <= 22) hook += 0.2;
		else if (s.words < 4 || s.words > 32) hook -= 0.15;
		const hits = (s.text.match(HOOK_WORDS) ?? []).length;
		hook += Math.min(0.25, hits * 0.1);
		if (/[?!]["»”)]*$/.test(s.text)) hook += 0.1;
		hook += Math.max(-0.1, Math.min(0.2, emphasisDb(s.from, s.to) / 15));
		if (GREETING.test(s.text)) hook -= 0.25;
		// A sentence that leans on the one before ("And…", "But…", "И…") doesn't stand alone as a hook.
		if (/^(and|but|so|or|because|и|а|но|или|потому)\b/iu.test(s.text.trim()) || /^(и|а|но|или)\s/iu.test(s.text.trim())) hook -= 0.15;
		const filler = s.text.split(/\s+/).some((w) => isFillerWord(w));
		if (filler) hook -= 0.1;
		const retake = retaken.has(s.i);
		if (retake) hook -= 0.4;
		return { ...s, hook: round(Math.max(0, Math.min(1, hook)), 2), ...(retake ? { retake: true } : {}), ...(filler ? { filler: true } : {}) };
	});
}

/** Speech facts without the cut points (those come from claude-hear's ears on the server). */
export function speechFacts(words: Word[], seconds: number, emphasisDb?: (from: number, to: number) => number) {
	const sentences = rankSentences(sentencesOf(words), emphasisDb);
	const quotes = sentences
		.filter((s) => !s.retake && s.words >= 4)
		.sort((a, b) => b.hook - a.hook)
		.slice(0, 12)
		.map((s) => s.i);
	const retakes = findRetakes(sentences).map(({ from, to, redoAt }) => ({ from: round(from), to: round(to), redoAt: round(redoAt) }));
	const fillers = words.filter((w) => isFillerWord(w.text)).map((w) => ({ from: round(w.start), to: round(w.end), text: w.text }));
	let dead = 0;
	for (let i = 1; i < words.length; i++) {
		const g = words[i].start - words[i - 1].end;
		if (g > 1) dead += g;
	}
	if (words.length) dead += Math.max(0, words[0].start - 1) + Math.max(0, seconds - words[words.length - 1].end - 1);
	return {
		sentences,
		quotes,
		retakes,
		fillers,
		deadAir: round(seconds > 0 ? dead / seconds : 0, 3),
		fillerShare: round(words.length ? fillers.length / words.length : 0, 3),
	};
}

// ───────────────────────── what Claude reads ─────────────────────────

const clock = (s: number) => {
	const m = Math.floor(s / 60);
	const r = s - m * 60;
	return m ? `${m}:${r.toFixed(1).padStart(4, "0")}` : `${r.toFixed(1)}`;
};

/** The brief as a few lines (ids and times first). `short` = the media id Claude uses. */
export function compactBrief(b: MaterialBrief, short: string, { quotes = 5 }: { quotes?: number } = {}): string {
	const head = [
		`${short} ${b.name} · ${b.kind} ${b.seconds.toFixed(1)} s${b.width ? ` ${b.width}×${b.height}` : ""}${b.fps ? ` ${Math.round(b.fps)}fps` : ""}`,
		b.kind !== "audio" ? `${b.shot}${b.faces ? ` face ${Math.round(b.faces * 100)}%` : ""} · motion ${b.motion} · cuts ${b.scenes.length} · exposure ${b.exposure.verdict} · cast ${b.cast.verdict}` : "",
		b.audio ? `audio ${b.audio.lufs ?? "?"} LUFS${b.audio.noiseDb !== null ? `, noise ${b.audio.noiseDb} dB` : ""}${b.audio.clipping ? ", CLIPPING" : ""}` : b.hasAudio ? "" : "no sound",
		b.music ? `music ${Math.round(b.music.bpm)} bpm, bar ${b.music.bar.toFixed(2)} s` : "",
	].filter(Boolean);
	const lines = [head.join(" · ")];
	const s = b.speech;
	if (s) {
		lines.push(`  speech ${s.language}, ${s.words.length} words, ${s.sentences.length} sentences, filler ${Math.round(s.fillerShare * 100)}%, dead air ${Math.round(s.deadAir * 100)}%, pause ${s.pause.toFixed(2)} s`);
		const best = s.quotes.slice(0, quotes).map((i) => s.sentences[i]).filter(Boolean);
		if (best.length) lines.push(`  best lines: ${best.map((q) => `#${q.i} [${clock(q.from)}–${clock(q.to)}] «${q.text.slice(0, 90)}» ${q.hook}`).join(" · ")}`);
		if (s.retakes.length) lines.push(`  retakes (cut): ${s.retakes.slice(0, 6).map((r) => `${clock(r.from)}–${clock(r.to)}`).join(", ")}`);
	}
	if (b.kind !== "audio" && b.frames.length) {
		const sorted = [...b.frames].sort((a, c) => c.score - a.score);
		const top = sorted.slice(0, 2).map((f) => `${clock(f.t)} ${f.score} (${f.why})`);
		const bad = sorted.filter((f) => f.flags.length && f.score < 50).slice(-2).map((f) => `${clock(f.t)} ${f.score} (${f.why})`);
		lines.push(`  beauty: best ${top.join("; ")}${bad.length ? ` · weak ${bad.join("; ")}` : ""}`);
	}
	return lines.join("\n");
}
