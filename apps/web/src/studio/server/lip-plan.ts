// The lipsync plan (rule C, «only what is needed leaves the Mac»): where somebody speaks in the sound the lips follow,
// which pieces of the picture go to the model and how they are packed into requests so the price is the lowest the
// model's price shape allows. Pure: the job, the pre-flight's estimate and the unit tests read the same function, so
// the price on the button is the price of the plan that runs.
//
// Frames are the unit of every boundary (the piece's own frame grid, frame 0 = the piece's first frame): a piece is
// [a, b) — no frame is repeated or dropped at a join because joins are integers.
import { type FalModel, price } from "@/fal/models";

export interface Span {
	start: number;
	end: number;
}

/** How a model charges, as models.ts states it (only what the plan needs). */
export type PriceShape = Pick<FalModel, "unit" | "usd" | "included" | "extra" | "minSeconds" | "maxSeconds" | "task">;

export interface PlanRules {
	/** Seconds of picture kept around every voiced stretch (the lips start before the first sound). */
	handle: number;
	/** Two voiced stretches closer than this are one span (a breath, not a pause). */
	breath: number;
	/** The shortest piece worth sending (grown inside its shot when shorter). */
	minPiece: number;
	/** The longest piece of picture one request may carry (every service drifts on long takes; Sync chunks 30–40 s). */
	maxPiece: number;
	/** The same for a per-request-floor model (LatentSync works in 16-frame chunks: no drift to fear, only the wait). */
	maxPieceFloor: number;
	/** Seconds of held last frame + silence after every request (models drop the end of a take; cut back after). */
	tail: number;
	/** Packed requests: seconds of real picture sent before every piece after the first (the model settles after a join; not used). */
	lead: number;
	/** Several pieces may share one request (concatenated), when the price shape makes it cheaper. */
	pack: boolean;
}

export const PLAN_RULES: PlanRules = { handle: 0.25, breath: 0.6, minPiece: 1, maxPiece: 40, maxPieceFloor: 120, tail: 0.8, lead: 0.32, pack: true };

/** A piece of the picture that gets new lips: frames [a, b) of the piece, inside shot `shot`. */
export interface Unit {
	a: number;
	b: number;
	shot: number;
	/** Already made (a sample of the same model): taken from the cache, not sent again. */
	made?: boolean;
}

/** One segment of a request's picture: frames [from, to) of the piece; `use` = the unit whose frames come back from it. */
export interface Segment {
	from: number;
	to: number;
	unit: number;
}

export interface PlanRequest {
	/** Segments sent one after the other (one segment: a single contiguous range of the piece). */
	segments: Segment[];
	/** Frames sent before the tail. */
	frames: number;
	/** Seconds billed: the frames + the tail (and the model's minimum). */
	seconds: number;
	usd: number;
}

export type PlanMode = "spans" | "joined" | "packed" | "whole";

export interface Plan {
	fps: number;
	/** Frames of the whole piece (the result's length). */
	frames: number;
	units: Unit[];
	requests: PlanRequest[];
	mode: PlanMode;
	usd: number;
	/** Seconds of picture that leave the Mac (tails included). */
	secondsSent: number;
	/** Seconds where somebody speaks (the voiced stretches, before handles). */
	speechSeconds: number;
	/** The one-request plan of before (the whole piece + tail): what the pieces save against. */
	wholeSeconds: number;
	wholeUsd: number;
}

export interface PlanInput {
	duration: number;
	fps: number;
	/** Voiced stretches of the sound, seconds from the piece's start. */
	speech: Span[];
	/** Seconds where the picture cuts (the clip's own cuts and hard scene changes). */
	cuts?: number[];
	model: PriceShape;
	rules?: Partial<PlanRules>;
	/** Frame ranges already made with this model (a sample): carved out, never paid again. */
	made?: Array<{ a: number; b: number }>;
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const round4 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Billed seconds of a request of `frames` frames: the tail after it, at least the model's minimum. */
export function billedSeconds(frames: number, fps: number, model: PriceShape, rules: PlanRules): number {
	const s = frames / fps + rules.tail;
	return round4(Math.max(s, model.minSeconds ?? 0));
}

const priceOf = (model: PriceShape, seconds: number) => price(model as FalModel, seconds);

/** Sorted, padded by `pad`, joined when the gap is under `join`. */
export function spansOf(speech: Span[], pad: number, join: number, duration: number): Span[] {
	const sorted = speech.filter((s) => s.end > s.start).map((s) => ({ start: Math.max(0, s.start - pad), end: Math.min(duration, s.end + pad) })).sort((x, y) => x.start - y.start);
	const out: Span[] = [];
	for (const s of sorted) {
		const last = out[out.length - 1];
		if (last && s.start - last.end < join) last.end = Math.max(last.end, s.end);
		else if (s.end > s.start) out.push({ ...s });
	}
	return out;
}

/** The longest piece the model and the quality rule allow, in frames (before the tail). */
function maxFrames(model: PriceShape, rules: PlanRules, fps: number): number {
	const cap = Math.min(model.unit === "clip" ? rules.maxPieceFloor : rules.maxPiece, model.maxSeconds ? model.maxSeconds - rules.tail - 0.05 : Number.POSITIVE_INFINITY);
	return Math.max(1, Math.floor(cap * fps));
}

/** The pieces: voiced spans on the frame grid, never across a cut, short ones grown inside their shot, long ones split in a pause. */
export function unitsOf(input: PlanInput, rules: PlanRules): { units: Unit[]; shots: number[]; frames: number } {
	const { fps } = input;
	const frames = Math.max(1, Math.round(input.duration * fps));
	const cutF = [...new Set((input.cuts ?? []).map((c) => Math.round(c * fps)).filter((f) => f > 0 && f < frames))].sort((x, y) => x - y);
	const shots = [0, ...cutF, frames];
	const shotOf = (f: number) => {
		let i = 0;
		while (i < shots.length - 2 && f >= shots[i + 1]) i++;
		return i;
	};
	const spans = spansOf(input.speech, rules.handle, rules.breath, input.duration);
	let units: Unit[] = [];
	for (const s of spans) {
		let a = Math.max(0, Math.floor(s.start * fps + 1e-6));
		const b = Math.min(frames, Math.ceil(s.end * fps - 1e-6));
		while (a < b) {
			const shot = shotOf(a);
			const end = Math.min(b, shots[shot + 1]);
			if (end > a) units.push({ a, b: end, shot });
			a = end;
		}
	}
	// (frame rounding can make neighbours touch or overlap: one unit then)
	units = units.reduce<Unit[]>((out, u) => {
		const last = out[out.length - 1];
		if (last && last.shot === u.shot && u.a <= last.b) last.b = Math.max(last.b, u.b);
		else out.push({ ...u });
		return out;
	}, []);
	// Long: split in the widest pause inside, near where the cap falls.
	const maxF = maxFrames(input.model, rules, fps);
	const islands = input.speech.map((s) => ({ a: Math.round(s.start * fps), b: Math.round(s.end * fps) })).sort((x, y) => x.a - y.a);
	const split: Unit[] = [];
	for (const u of units) {
		let rest = { ...u };
		while (rest.b - rest.a > maxF) {
			const limit = rest.a + maxF;
			// the pauses between islands inside the unit, before the cap; the widest of the last half wins
			const gaps: Array<{ at: number; width: number }> = [];
			for (let i = 1; i < islands.length; i++) {
				const g0 = islands[i - 1].b;
				const g1 = islands[i].a;
				if (g1 > g0 && g0 > rest.a + maxF / 2 && g1 <= limit) gaps.push({ at: Math.round((g0 + g1) / 2), width: g1 - g0 });
			}
			const at = gaps.length ? gaps.sort((x, y) => y.width - x.width || y.at - x.at)[0].at : limit;
			split.push({ a: rest.a, b: at, shot: rest.shot });
			rest = { a: at, b: rest.b, shot: rest.shot };
		}
		split.push(rest);
	}
	units = split;
	// Short: grown on both sides inside the shot, never into a neighbour.
	const minF = Math.min(maxF, Math.ceil(Math.max(rules.minPiece, (input.model.minSeconds ?? 0) - rules.tail) * fps));
	for (let i = 0; i < units.length; i++) {
		const u = units[i];
		const lo = Math.max(shots[u.shot], i > 0 ? units[i - 1].b : 0);
		const hi = Math.min(shots[u.shot + 1], i + 1 < units.length ? units[i + 1].a : frames);
		while (u.b - u.a < minF && (u.a > lo || u.b < hi)) {
			if (u.a > lo) u.a--;
			if (u.b - u.a < minF && u.b < hi) u.b++;
		}
	}
	// Made before (a sample): those frames are carved out and kept as made units.
	for (const m of input.made ?? []) {
		const next: Unit[] = [];
		for (const u of units) {
			if (m.b <= u.a || m.a >= u.b) {
				next.push(u);
				continue;
			}
			if (u.a < m.a) next.push({ a: u.a, b: m.a, shot: u.shot });
			next.push({ a: Math.max(u.a, m.a), b: Math.min(u.b, m.b), shot: u.shot, made: true });
			if (m.b < u.b) next.push({ a: m.b, b: u.b, shot: u.shot });
		}
		units = next;
	}
	return { units, shots, frames };
}

function request(segments: Segment[], fps: number, model: PriceShape, rules: PlanRules): PlanRequest {
	const frames = sum(segments.map((s) => s.to - s.from));
	const seconds = billedSeconds(frames, fps, model, rules);
	return { segments, frames, seconds, usd: priceOf(model, seconds) };
}

/** Every piece its own request. */
function spansPlan(units: Unit[], todo: number[], fps: number, model: PriceShape, rules: PlanRules): PlanRequest[] {
	return todo.map((i) => request([{ from: units[i].a, to: units[i].b, unit: i }], fps, model, rules));
}

/** Neighbours in one shot sent as one stretch (the silence between them is sent too) where it is cheaper: the cheapest partition. */
function joinedPlan(units: Unit[], todo: number[], fps: number, model: PriceShape, rules: PlanRules): PlanRequest[] {
	const maxF = maxFrames(model, rules, fps);
	const n = todo.length;
	const best: number[] = new Array(n + 1).fill(Number.POSITIVE_INFINITY);
	const from: number[] = new Array(n + 1).fill(-1);
	best[0] = 0;
	for (let j = 1; j <= n; j++) {
		const last = units[todo[j - 1]];
		for (let i = j; i >= 1; i--) {
			const first = units[todo[i - 1]];
			if (first.shot !== last.shot || last.b - first.a > maxF) break;
			// (a made unit between them would be paid again: never joined over)
			if (i < j && todo[i] !== todo[i - 1] + 1) break;
			const cost = best[i - 1] + priceOf(model, billedSeconds(last.b - first.a, fps, model, rules)) + 1e-9 * (last.b - first.a);
			if (cost < best[j]) {
				best[j] = cost;
				from[j] = i - 1;
			}
		}
	}
	const out: PlanRequest[] = [];
	for (let j = n; j > 0; j = from[j]) {
		const i = from[j];
		const first = units[todo[i]];
		const last = units[todo[j - 1]];
		// one stretch; the units inside say which frames come back
		const segs: Segment[] = todo.slice(i, j).map((u, k, all) => ({ from: k === 0 ? first.a : units[all[k - 1]].b, to: units[u].b, unit: u }));
		out.unshift({ ...request(segs, fps, model, rules), segments: segs });
	}
	return out;
}

/**
 * Pieces from anywhere in the clip one after the other in one request, as many as fit (a per-request floor wants few,
 * full requests). Each piece after the first is sent with `lead` seconds of its own shot before it (not used).
 */
function packedPlan(units: Unit[], todo: number[], fps: number, model: PriceShape, rules: PlanRules, shots: number[]): PlanRequest[] {
	const maxF = maxFrames(model, rules, fps);
	const cap = model.unit === "clip" && model.included ? Math.min(maxF, Math.floor((model.included - rules.tail - 0.05) * fps)) : maxF;
	const leadF = Math.round(rules.lead * fps);
	const out: Segment[][] = [];
	let bin: Segment[] = [];
	let used = 0;
	for (const i of todo) {
		const u = units[i];
		const lead = bin.length ? Math.min(leadF, u.a - shots[u.shot]) : 0;
		const need = u.b - u.a + lead;
		if (bin.length && used + need > cap) {
			out.push(bin);
			bin = [];
			used = 0;
		}
		const l = bin.length ? lead : 0;
		bin.push({ from: u.a - l, to: u.b, unit: i });
		used += u.b - u.a + l;
	}
	if (bin.length) out.push(bin);
	return out.map((segs) => request(segs, fps, model, rules));
}

const total = (rs: PlanRequest[]) => ({ usd: round4(sum(rs.map((r) => r.usd))), frames: sum(rs.map((r) => r.frames)), seconds: round4(sum(rs.map((r) => r.seconds))) });

/** The plan with the lowest price under the rules; equal prices: fewer seconds sent, then fewer requests. */
export function planLipsync(input: PlanInput): Plan {
	const rules = { ...PLAN_RULES, ...input.rules };
	const { fps, model } = input;
	const { units, shots, frames } = unitsOf(input, rules);
	const wholeSeconds = billedSeconds(frames, fps, model, rules);
	const base = {
		fps,
		frames,
		units,
		speechSeconds: round4(sum(spansOf(input.speech, 0, 0, input.duration).map((s) => s.end - s.start))),
		wholeSeconds,
		wholeUsd: priceOf(model, wholeSeconds),
	};
	const todo = units.map((u, i) => (u.made ? -1 : i)).filter((i) => i >= 0);
	if (!todo.length) return { ...base, requests: [], mode: "spans", usd: 0, secondsSent: 0 };
	const candidates: Array<{ mode: PlanMode; requests: PlanRequest[] }> = [
		{ mode: "spans", requests: spansPlan(units, todo, fps, model, rules) },
		{ mode: "joined", requests: joinedPlan(units, todo, fps, model, rules) },
	];
	// (a per-second price gains only a tail per request from packing, and a join inside a take is a risk for the tracking:
	// only a per-request floor or a stepped price is packed)
	if (rules.pack && (model.unit === "clip" || model.unit === "5s")) candidates.push({ mode: "packed", requests: packedPlan(units, todo, fps, model, rules, shots) });
	const score = (c: { requests: PlanRequest[] }) => total(c.requests);
	candidates.sort((x, y) => {
		const a = score(x);
		const b = score(y);
		return a.usd - b.usd || a.seconds - b.seconds || x.requests.length - y.requests.length;
	});
	const pick = candidates[0];
	const t = score(pick);
	return { ...base, requests: pick.requests, mode: pick.mode, usd: t.usd, secondsSent: t.seconds };
}

/** The whole piece as one unit (no speech found, or the pieces are off): exactly the request of before. */
export function wholePlan(input: Omit<PlanInput, "speech">): Plan {
	const rules = { ...PLAN_RULES, ...input.rules };
	const frames = Math.max(1, Math.round(input.duration * input.fps));
	const seconds = billedSeconds(frames, input.fps, input.model, rules);
	const usd = priceOf(input.model, seconds);
	return {
		fps: input.fps,
		frames,
		units: [{ a: 0, b: frames, shot: 0 }],
		requests: [{ segments: [{ from: 0, to: frames, unit: 0 }], frames, seconds, usd }],
		mode: "whole",
		usd,
		secondsSent: seconds,
		speechSeconds: input.duration,
		wholeSeconds: seconds,
		wholeUsd: usd,
	};
}

/**
 * The sample (rule E): the ~3 s window with the most speech energy (or the one centred on `at`), inside one shot and
 * inside a voiced span, on the frame grid. `levels` = dB per `levelStep` seconds of the sound.
 */
export function sampleWindow(o: { duration: number; fps: number; speech: Span[]; cuts?: number[]; levels?: ArrayLike<number>; levelStep?: number; at?: number; seconds?: number }): { a: number; b: number } | null {
	const len = Math.max(1, o.seconds ?? 3);
	const frames = Math.max(1, Math.round(o.duration * o.fps));
	const want = Math.min(frames, Math.round(len * o.fps));
	const cutF = [0, ...(o.cuts ?? []).map((c) => Math.round(c * o.fps)).filter((f) => f > 0 && f < frames).sort((x, y) => x - y), frames];
	const inShot = (a: number) => {
		for (let i = 0; i + 1 < cutF.length; i++) if (a >= cutF[i] && a + want <= cutF[i + 1]) return true;
		return false;
	};
	const voiced = (t: number) => o.speech.some((s) => t >= s.start && t < s.end);
	const step = o.levelStep ?? 0.01;
	const energy = (a: number) => {
		if (!o.levels?.length) return sum(o.speech.map((s) => Math.max(0, Math.min(s.end, (a + want) / o.fps) - Math.max(s.start, a / o.fps))));
		let e = 0;
		const i0 = Math.floor(a / o.fps / step);
		const i1 = Math.min(o.levels.length, Math.floor((a + want) / o.fps / step));
		for (let i = i0; i < i1; i++) if (voiced(i * step)) e += 10 ** (Number(o.levels[i]) / 10);
		return e;
	};
	if (o.at != null && Number.isFinite(o.at)) {
		let a = Math.max(0, Math.min(frames - want, Math.round(o.at * o.fps - want / 2)));
		for (let d = 0; d < frames && !inShot(a); d++) a = Math.max(0, Math.min(frames - want, a + (d % 2 ? d : -d)));
		return inShot(a) ? { a, b: a + want } : null;
	}
	let best: { a: number; e: number } | null = null;
	const hop = Math.max(1, Math.round(o.fps / 4));
	for (let a = 0; a + want <= frames; a += hop) {
		if (!inShot(a)) continue;
		const e = energy(a);
		if (e > 0 && (!best || e > best.e)) best = { a, e };
	}
	return best ? { a: best.a, b: best.a + want } : null;
}
