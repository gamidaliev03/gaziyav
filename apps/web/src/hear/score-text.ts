// The score by parts in words Claude can plan a music video from (analyze {what:"music"}): tempo and bars, sections,
// which parts sound in every run of bars, the sung phrases with their words, where the voice is silent, where the
// drums stop, the strongest hits. Short by default (a few dozen lines); a narrow from..to gives every bar, hit and
// word there. Pure: times in, text out (timeline seconds through `toT`).
import { PARTS, type PartName, type SongScore, type Span } from "./score-types";

export interface ScoreView {
	/** File seconds → timeline seconds. */
	toT: (s: number) => number;
	/** The visible piece of the file (file seconds). */
	s0: number;
	s1: number;
	/** The range asked (file seconds); detail when it is short. */
	from: number;
	to: number;
	/** Per-bar detail (default: when the range is under 40 s and narrower than the song). */
	detail?: boolean;
}

export const PART_WORD: Record<PartName, string> = { vocals: "vocals", drums: "drums", bass: "bass", other: "other" };
const f2 = (v: number) => v.toFixed(2);
const overlap = (spans: Span[], a: number, b: number) => spans.reduce((s, [x, y]) => s + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);

/** The parts sounding in [a, b): the band when it plays half of it, the voice a quarter (phrases breathe). */
export function partsIn(score: SongScore, a: number, b: number): PartName[] {
	const len = Math.max(0.01, b - a);
	return PARTS.filter((p) => overlap(score.parts[p].active, a, b) / len >= (p === "vocals" ? 0.25 : 0.5));
}

/** Bar number (1-based) at file second t. */
export function barAt(score: SongScore, t: number): number {
	let i = 0;
	while (i + 1 < score.bars.length && score.bars[i + 1] <= t + 1e-6) i++;
	return i + 1;
}

const listParts = (ps: PartName[]) => (ps.length ? ps.map((p) => PART_WORD[p]).join(", ") : "nothing (silence)");

/** Spans clipped to [a, b) and mapped. */
const clip = (spans: Span[], a: number, b: number): Span[] => spans.filter(([x, y]) => y > a && x < b).map(([x, y]) => [Math.max(a, x), Math.min(b, y)] as Span);

export function scoreText(score: SongScore, v: ScoreView): string[] {
	const T = (s: number) => f2(v.toT(s));
	const a = Math.max(v.s0, v.from);
	const b = Math.min(v.s1, v.to);
	const whole = a <= v.s0 + 0.5 && b >= v.s1 - 0.5;
	const detail = v.detail ?? (!whole && b - a <= 40);
	const out: string[] = [];
	const edges = [...score.bars, score.duration];
	const barsIn = score.bars.map((t, i) => ({ n: i + 1, t, e: edges[i + 1] })).filter((x) => x.e > a + 0.05 && x.t < b - 0.05);
	// tempo
	const tempo = score.tempo.filter((x) => x.end > a && x.start < b);
	if (tempo.length) out.push(`Tempo (on the drum stem): ${tempo.map((x) => `${x.bpm} BPM ${T(Math.max(a, x.start))}–${T(Math.min(b, x.end))}`).join(" · ")} · ${score.meter === 3 ? "3/4 heard" : "4/4 assumed"}${score.downbeatConfidence < 0.3 ? `, bar 1 placed by where the parts come in and the snare's 2 and 4 (sure ${Math.round(score.downbeatConfidence * 100)}%)` : ""}`);
	else out.push("Tempo: no steady beat heard (no drums, no regular attacks) — bars below are 2 s steps, not the song's.");
	if (barsIn.length) {
		const len = barsIn.length > 1 ? (barsIn[barsIn.length - 1].t - barsIn[0].t) / (barsIn.length - 1) : barsIn[0].e - barsIn[0].t;
		out.push(`Bars ${barsIn[0].n}–${barsIn[barsIn.length - 1].n} here, ≈${f2(len)} s a bar (beats as timeline markers: analyze {what:"beats"})`);
		// every bar line with its time (every 2nd / 4th on a long song): cuts on the downbeat take these times as they are
		const step = barsIn.length <= 72 ? 1 : barsIn.length <= 144 ? 2 : 4;
		const shown = barsIn.filter((x, i) => i % step === 0 || i === barsIn.length - 1);
		out.push(`Bar starts${step > 1 ? ` (every ${step === 2 ? "2nd" : "4th"})` : ""}: ${shown.map((x) => `${x.n}@${T(Math.max(a, x.t))}`).join(" ")}`);
	}
	// sections
	const secs = score.sections.filter((x) => x.end > a && x.start < b);
	if (secs.length) {
		const named = secs.some((x) => x.name);
		out.push(`Sections${named ? "" : " (no names: the shape doesn't say which is verse or chorus)"}: ${secs.map((x) => `bars ${x.bar0}–${x.bar1} ${T(Math.max(a, x.start))}–${T(Math.min(b, x.end))} ${x.name ? `${x.name} (part ${x.letter})` : `part ${x.letter}`}: ${listParts(x.parts)}`).join(" · ")}`);
	}
	// which parts sound, bar runs (or every bar in detail)
	out.push(detail ? "Every bar (parts sounding; level dBFS on its stem):" : "What sounds, by bars (other = guitars, keys, synths):");
	if (detail) {
		for (const x of barsIn) {
			const ps = partsIn(score, x.t, x.e);
			const lv = ps.map((p) => `${PART_WORD[p]} ${score.parts[p].bars[x.n - 1] ?? ""}`).join(", ");
			// a hit up to 30 ms before the bar line is the bar's downbeat
			const hits = score.hits.filter((h) => h[0] >= x.t - 0.03 && h[0] < x.e - 0.03);
			const kinds = (k: string) => hits.filter((h) => h[1] === k).map((h) => T(h[0]));
			const hk = kinds("k");
			const hs = kinds("s");
			const hh = kinds("h");
			const at = score.attacks.filter((t) => t >= x.t - 0.03 && t < x.e - 0.03).map(T);
			out.push(`  bar ${x.n} ${T(x.t)}: ${ps.length ? lv : "silence"}${hk.length ? ` · kick ${hk.join(" ")}` : ""}${hs.length ? ` · snare ${hs.join(" ")}` : ""}${hh.length ? ` · hats/cymbals ${hh.length > 8 ? `${hh.length}×` : hh.join(" ")}` : ""}${at.length ? ` · other attacks ${at.join(" ")}` : ""}`);
		}
	} else {
		const runs: Array<{ n0: number; n1: number; t: number; e: number; ps: string }> = [];
		for (const x of barsIn) {
			const ps = partsIn(score, x.t, x.e).filter((p) => p !== "vocals").join(",");
			const last = runs[runs.length - 1];
			if (last && last.ps === ps) {
				last.n1 = x.n;
				last.e = x.e;
			} else runs.push({ n0: x.n, n1: x.n, t: x.t, e: x.e, ps });
		}
		for (const r of runs.slice(0, 24)) {
			const ps = r.ps ? (r.ps.split(",") as PartName[]) : [];
			const sung = clip(score.phrases.map((p) => [p.start, p.end] as Span), Math.max(a, r.t), Math.min(b, r.e));
			const voice = sung.length ? ` · vocals ${sung.slice(0, 6).map(([x, y]) => `${T(x)}–${T(y)}`).join(", ")}${sung.length > 6 ? ` +${sung.length - 6}` : ""}` : " · no vocals";
			out.push(`  bars ${r.n0}${r.n1 > r.n0 ? `–${r.n1}` : ""} (${T(Math.max(a, r.t))}–${T(Math.min(b, r.e))}): ${ps.length ? listParts(ps) : "no band"}${voice}`);
		}
		if (runs.length > 24) out.push(`  … ${runs.length - 24} more runs: analyze {what:"music", from:${T(runs[24].t)}}`);
	}
	// sung phrases with words
	const phrases = score.phrases.filter((p) => p.end > a && p.start < b);
	if (phrases.length) {
		out.push(`Vocals (phrases on the voice stem${score.language ? `, words heard there (${score.language})` : ""}):`);
		const max = detail ? 60 : 16;
		for (const p of phrases.slice(0, max)) {
			const words = detail && p.words?.length ? ` [${p.words.map(([w, s]) => `${w}@${T(s)}`).join(" ")}]` : "";
			out.push(`  ${T(p.start)}–${T(p.end)} bar ${barAt(score, p.start)}: ${p.text ? `“${p.text}”` : "(no clear words)"}${words}`);
		}
		if (phrases.length > max) out.push(`  … ${phrases.length - max} more phrases: analyze {what:"music", from:${T(phrases[max].start)}}`);
	} else out.push("Vocals: no voice on the vocal stem here.");
	// where the voice is silent (≥ 2 s), where the drums stop, silence
	const quiet: Span[] = [];
	let t = a;
	for (const p of phrases) {
		if (p.start - t >= 2) quiet.push([t, p.start]);
		t = Math.max(t, p.end);
	}
	if (b - t >= 2) quiet.push([t, b]);
	if (quiet.length && phrases.length) out.push(`No voice (≥ 2 s): ${quiet.slice(0, 12).map(([x, y]) => `${T(x)}–${T(y)}`).join(", ")}${quiet.length > 12 ? ` +${quiet.length - 12}` : ""}`);
	const drums = clip(score.parts.drums.active, a, b);
	if (score.parts.drums.active.length) {
		const stops = drums.map(([, y]) => y).filter((y) => y < b - 0.5);
		const starts = drums.map(([x]) => x).filter((x) => x > a + 0.5);
		out.push(`Drums play ${drums.map(([x, y]) => `${T(x)}–${T(y)}`).join(", ") || "nowhere here"}${starts.length ? ` · come in at ${starts.map(T).join(", ")}` : ""}${stops.length ? ` · stop at ${stops.map(T).join(", ")}` : ""}`);
	} else out.push("Drums: none in this song.");
	const breaks = clip(score.breaks, a, b);
	if (breaks.length) out.push(`Breaks (drums out, the song goes on): ${breaks.map(([x, y]) => `${T(x)}–${T(y)}`).join(", ")}`);
	const silent = clip(score.silences, a, b);
	if (silent.length) out.push(`Silence (every part): ${silent.map(([x, y]) => `${T(x)}–${T(y)}`).join(", ")}`);
	for (const p of ["bass", "other"] as const) {
		const s = clip(score.parts[p].active, a, b);
		if (!detail) out.push(`${p === "bass" ? "Bass" : "Other (guitars, keys)"} plays: ${s.length ? `${s.slice(0, 10).map(([x, y]) => `${T(x)}–${T(y)}`).join(", ")}${s.length > 10 ? ` +${s.length - 10}` : ""}` : "nowhere here"}`);
	}
	// strongest hits
	const hits = score.hits.filter((h) => h[0] >= a && h[0] < b);
	if (hits.length) {
		const name = { k: "kick", s: "snare", h: "cymbal" } as const;
		const top = [...hits].sort((x, y) => y[2] - x[2]).slice(0, detail ? 12 : 8).sort((x, y) => x[0] - y[0]);
		out.push(`Strongest hits: ${top.map((h) => `${T(h[0])} ${name[h[1]]}`).join(", ")} (${hits.filter((h) => h[1] === "k").length} kicks, ${hits.filter((h) => h[1] === "s").length} snares, ${hits.filter((h) => h[1] === "h").length} hats/cymbals in all)`);
	}
	if (!detail) out.push(`More: analyze {what:"music", from, to} (≤ 40 s) gives every bar, hit and word there.`);
	return out;
}
