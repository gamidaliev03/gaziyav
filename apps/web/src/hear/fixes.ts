// Fixing the cuts check_cuts found, as a pure edit of the tracks (one ⌘Z in hear-tools.ts): later cuts first so the
// earlier times stay valid, moves rounded to whole frames, fades on both sides of every fixed cut.
import type { SeamReport } from "@/studio/server/hear";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline";
import { roundMediaTime, TICKS_PER_SECOND } from "@/wasm";

/** What planFixes needs of a cut (client.ts' TimelineSeam). */
export interface SeamAt {
	at: number;
	gap?: number;
}


const T = (seconds: number) => roundMediaTime({ time: seconds * TICKS_PER_SECOND }) as number;
const near = (a: number, b: number) => Math.abs(a - b) <= 1.5;

type Tracks = SceneTracks;

function mapTracks(tracks: Tracks, f: (el: TimelineElement, track: TimelineTrack) => TimelineElement | null): Tracks {
	const one = <K extends TimelineTrack>(t: K): K => ({ ...t, elements: (t.elements as TimelineElement[]).map((e) => f(e, t)).filter((e): e is TimelineElement => !!e) }) as K;
	return { overlay: tracks.overlay.map(one), main: one(tracks.main), audio: tracks.audio.map(one) };
}

const isPiece = (el: TimelineElement) => el.type === "video" || el.type === "audio";
const rateOf = (el: TimelineElement) => (("retime" in el && (el as { retime?: { rate?: number } }).retime?.rate) || 1);

/**
 * Inserts `d` seconds at timeline time `at` (ticks): the pieces meeting there get longer at `side` (their source
 * revealed), everything starting later moves right — or nothing moves (`shift` false: a gap is filled).
 */
function insertAt(tracks: Tracks, at: number, d: number, side: "tail" | "head", shift = true): Tracks {
	const dt = T(d);
	return mapTracks(tracks, (el) => {
		const start = el.startTime as number;
		const end = start + (el.duration as number);
		if (side === "tail" && isPiece(el) && near(end, at)) {
			const src = T(d * rateOf(el));
			if ((el.trimEnd as number) < src - 1) return el;
			return { ...el, duration: roundMediaTime({ time: (el.duration as number) + dt }), trimEnd: roundMediaTime({ time: (el.trimEnd as number) - src }) } as TimelineElement;
		}
		if (side === "head" && isPiece(el) && near(start, at)) {
			const src = T(d * rateOf(el));
			if ((el.trimStart as number) < src - 1) return el;
			return { ...el, duration: roundMediaTime({ time: (el.duration as number) + dt }), trimStart: roundMediaTime({ time: (el.trimStart as number) - src }) } as TimelineElement;
		}
		if (shift && start >= at - 1.5) return { ...el, startTime: roundMediaTime({ time: start + dt }) } as TimelineElement;
		return el;
	});
}

/** Moves the cut at `at` by `d` seconds (a roll): the left pieces end later, the right pieces start later in their source. */
function rollAt(tracks: Tracks, at: number, d: number): Tracks {
	const dt = T(d);
	return mapTracks(tracks, (el) => {
		if (!isPiece(el)) return el;
		const start = el.startTime as number;
		const end = start + (el.duration as number);
		const src = T(d * rateOf(el));
		if (near(end, at)) return { ...el, duration: roundMediaTime({ time: (el.duration as number) + dt }), trimEnd: roundMediaTime({ time: (el.trimEnd as number) - src }) } as TimelineElement;
		if (near(start, at)) return { ...el, startTime: roundMediaTime({ time: start + dt }), duration: roundMediaTime({ time: (el.duration as number) - dt }), trimStart: roundMediaTime({ time: (el.trimStart as number) + src }) } as TimelineElement;
		return el;
	});
}

/**
 * Fills the gap [at, at + gap] between two pieces on a track: the left piece runs on into it (its own room tone), else
 * the right one starts earlier, else — no sound left on either side — the right piece and what follows it on that
 * track close the gap.
 */
function fillGapAt(tracks: Tracks, at: number, gap: number): { tracks: Tracks; how: string } {
	const g = T(gap);
	const all = [tracks.main, ...tracks.overlay, ...tracks.audio] as TimelineTrack[];
	for (const track of all) {
		const els = track.elements as TimelineElement[];
		const left = els.find((e) => isPiece(e) && near((e.startTime as number) + (e.duration as number), at));
		const right = els.find((e) => isPiece(e) && near(e.startTime as number, at + g));
		if (!left || !right) continue;
		const one = (f: (e: TimelineElement) => TimelineElement) => mapTracks(tracks, (e, t) => (t.id === track.id ? f(e) : e));
		if ((left.trimEnd as number) >= T(gap * rateOf(left)) - 1) {
			return { tracks: one((e) => (e.id === left.id ? ({ ...e, duration: roundMediaTime({ time: (e.duration as number) + g }), trimEnd: roundMediaTime({ time: (e.trimEnd as number) - T(gap * rateOf(e)) }) } as TimelineElement) : e)), how: "the left clip runs on into the gap (its own sound)" };
		}
		if ((right.trimStart as number) >= T(gap * rateOf(right)) - 1) {
			return { tracks: one((e) => (e.id === right.id ? ({ ...e, startTime: roundMediaTime({ time: (e.startTime as number) - g }), duration: roundMediaTime({ time: (e.duration as number) + g }), trimStart: roundMediaTime({ time: (e.trimStart as number) - T(gap * rateOf(e)) }) } as TimelineElement) : e)), how: "the right clip starts earlier (its own sound)" };
		}
		return { tracks: one((e) => ((e.startTime as number) >= at + g - 1.5 ? ({ ...e, startTime: roundMediaTime({ time: (e.startTime as number) - g }) } as TimelineElement) : e)), how: "the gap closed on its track (no sound to fill it with)" };
	}
	return { tracks, how: "" };
}

function fadeAt(tracks: Tracks, at: number, seconds: number, gapEnd?: number): Tracks {
	return mapTracks(tracks, (el) => {
		if (!isPiece(el)) return el;
		const start = el.startTime as number;
		const end = start + (el.duration as number);
		const params = (el.params ?? {}) as Record<string, unknown>;
		if (near(end, at) && !(Number(params.fadeOut) >= seconds)) return { ...el, params: { ...params, fadeOut: seconds } } as TimelineElement;
		if ((near(start, at) || (gapEnd !== undefined && near(start, gapEnd))) && !(Number(params.fadeIn) >= seconds)) return { ...el, params: { ...params, fadeIn: seconds } } as TimelineElement;
		return el;
	});
}

function gainAt(tracks: Tracks, at: number, db: number): Tracks {
	return mapTracks(tracks, (el) => {
		if (!isPiece(el) || !near(el.startTime as number, at)) return el;
		const params = (el.params ?? {}) as Record<string, unknown>;
		const v = typeof params.volume === "number" ? params.volume : 0;
		return { ...el, params: { ...params, volume: Math.round(Math.max(-40, Math.min(12, v + db)) * 10) / 10 } } as TimelineElement;
	});
}

export interface AppliedFix {
	at: number;
	did: string;
}

/**
 * The fixes of the reports, applied to the tracks (later cuts first, so earlier times stay valid): frame-rounded moves,
 * fades on both sides of every fixed cut. Returns the new tracks and what was done. `removeRanges` is silence/remove.ts'.
 */
export function planFixes(
	tracks: Tracks,
	reports: SeamReport[],
	seams: SeamAt[],
	fps: number,
	removeRanges: (tracks: Tracks, ranges: Array<{ start: number; end: number }>, tps: number, fade: number) => Tracks,
): { tracks: Tracks; done: AppliedFix[]; skipped: string[] } {
	const done: AppliedFix[] = [];
	const skipped: string[] = [];
	let next = tracks;
	const frames = (s: number) => Math.max(1, Math.round(Math.abs(s) * fps));
	const order = [...reports].filter((r) => r.defects.length).sort((a, b) => b.at - a.at);
	for (const r of order) {
		const seam = seams.find((s) => Math.abs(s.at - r.at) < 1e-3);
		const at = T(r.at);
		// One move per side of the cut (the worst defect's on each side), then fades: the right side first, so the left
		// side's move still finds the cut where it was.
		const moves = r.defects.filter((d) => d.fix.op !== "fade" && d.fix.op !== "none" && d.fix.op !== "gain").sort((a, b) => b.severity - a.severity);
		const isRight = (op: string) => op === "extendRight" || op === "trimRight";
		const rightMove = moves.find((d) => isRight(d.fix.op))?.fix;
		const leftMove = moves.find((d) => !isRight(d.fix.op))?.fix;
		const what: string[] = [];
		let cutAt = r.at;
		for (const move of [rightMove, leftMove]) {
		if (move && "seconds" in move) {
			const n = frames(move.seconds);
			const d = n / fps;
			if (move.op === "extendLeft") {
				next = insertAt(next, at, d, "tail");
				what.push(`left clip extended ${n} frame${n > 1 ? "s" : ""}`);
				cutAt += d;
			} else if (move.op === "extendRight") {
				next = insertAt(next, at, d, "head");
				what.push(`right clip extended ${n} frame${n > 1 ? "s" : ""} at its start`);
			} else if (move.op === "trimLeft") {
				next = removeRanges(next, [{ start: r.at - d, end: r.at }], TICKS_PER_SECOND, 0.03);
				what.push(`${n} frame${n > 1 ? "s" : ""} trimmed off the left clip's end`);
				cutAt -= d;
			} else if (move.op === "trimRight") {
				next = removeRanges(next, [{ start: r.at, end: r.at + d }], TICKS_PER_SECOND, 0.03);
				what.push(`${n} frame${n > 1 ? "s" : ""} trimmed off the right clip's start`);
			} else if (move.op === "roll") {
				const signed = Math.sign(move.seconds) * d;
				next = rollAt(next, at, signed);
				what.push(`cut moved ${signed > 0 ? "+" : "−"}${n} frame${n > 1 ? "s" : ""} onto the beat`);
				cutAt += signed;
			}
		} else if (move?.op === "fillGap" && seam?.gap) {
			const filled = fillGapAt(next, at, seam.gap);
			next = filled.tracks;
			if (filled.how) what.push(`gap of ${Math.round(seam.gap * 1000)} ms filled: ${filled.how}`);
			if (filled.how.startsWith("the left")) cutAt += seam.gap;
		}
		}
		const move = leftMove ?? rightMove;
		const gain = r.defects.find((d) => d.fix.op === "gain")?.fix;
		if (gain && gain.op === "gain") {
			next = gainAt(next, T(cutAt), gain.db);
			what.push(`right clip ${gain.db > 0 ? "+" : ""}${gain.db} dB`);
		}
		const fadeS = Math.max(0.03, ...r.defects.map((d) => (d.fix.op === "fade" ? d.fix.seconds : 0)));
		next = fadeAt(next, T(cutAt), fadeS, seam?.gap && !move ? T(r.at + seam.gap) : undefined);
		what.push(`${Math.round(fadeS * 1000)} ms fades`);
		for (const d of r.defects) if (d.fix.op === "none") skipped.push(`${r.at.toFixed(2)} s: ${d.detail} — ${d.fix.why}`);
		done.push({ at: r.at, did: what.join(", ") });
	}
	return { tracks: next, done: done.reverse(), skipped };
}
