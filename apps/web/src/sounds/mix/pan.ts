// A clip's Pan (Inspector → Audio, −100 = left … 0 = centre … 100 = right, keyframe-able like the volume). Preview
// (core/managers/audio-manager.ts) and export (media/audio.ts) read the same matrix, so what you hear is what you export.
//
// The law: the side it moves to keeps its own channel and takes in up to half of the other one, the far side fades
// out. Centre is the clip as it is (no −3 dB dip), nothing is ever louder than the source (no clipping), and a mono
// source — played as L = R — moves as a whole: hard left is the whole sound on the left only.
import { hasKeyframesForPath } from "@/animation/keyframe-query";
import { resolveAnimationPathValueAtTime } from "@/animation/resolve";
import type { AudioCapableElement } from "@/timeline/audio-state";
import { TICKS_PER_SECOND } from "@/wasm";

export const PAN_PATH = "pan";
export const PAN_MIN = -100;
export const PAN_MAX = 100;

/** Output = matrix × input: left out = ll·L + lr·R, right out = rl·L + rr·R. */
export interface PanMatrix {
	ll: number;
	lr: number;
	rl: number;
	rr: number;
}

export const CENTRE: PanMatrix = { ll: 1, lr: 0, rl: 0, rr: 1 };

export function clampPan(value: unknown): number {
	const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
	return Math.max(PAN_MIN, Math.min(PAN_MAX, n));
}

/** The pan as stored (−100…100), before keyframes. */
export function readPan(element: Pick<AudioCapableElement, "params">): number {
	return clampPan((element.params as Record<string, unknown>).pan);
}

export function hasAnimatedPan(element: Pick<AudioCapableElement, "animations">): boolean {
	return hasKeyframesForPath({ animations: element.animations, propertyPath: PAN_PATH });
}

/** Is the clip anywhere off centre (the mix can skip the matrix otherwise)? */
export function isPanned(element: Pick<AudioCapableElement, "params" | "animations">): boolean {
	return hasAnimatedPan(element) || readPan(element) !== 0;
}

/** The pan (−100…100) at a clip-local time in seconds, keyframes included. */
export function panAt(element: Pick<AudioCapableElement, "params" | "animations">, localTime: number): number {
	const base = readPan(element);
	if (!hasAnimatedPan(element)) return base;
	return clampPan(
		resolveAnimationPathValueAtTime({
			animations: element.animations,
			propertyPath: PAN_PATH,
			localTime: Math.max(0, Math.round(localTime * TICKS_PER_SECOND)),
			fallbackValue: base,
		}),
	);
}

/** The 2×2 mix for a pan of −100…100. */
export function panMatrix(pan: number): PanMatrix {
	return clampPan(pan) === 0 ? CENTRE : writePanMatrix(pan, { ...CENTRE });
}

/** panMatrix into `out` (no allocation: the export runs it per sample of a keyframed pan). */
export function writePanMatrix(pan: number, out: PanMatrix): PanMatrix {
	const p = clampPan(pan) / 100;
	const a = Math.abs(p);
	out.ll = p < 0 ? 1 - a / 2 : 1 - a;
	out.lr = p < 0 ? a / 2 : 0;
	out.rl = p > 0 ? a / 2 : 0;
	out.rr = p > 0 ? 1 - a / 2 : 1 - a;
	return out;
}

/**
 * Break-points of the pan between two clip-local times (seconds): every `step` where it moves, points on the line
 * between their neighbours dropped (a constant stretch is two points).
 */
export function buildPanAutomation(
	element: Pick<AudioCapableElement, "params" | "animations">,
	fromLocal: number,
	toLocal: number,
	step = 1 / 30,
): Array<{ localTime: number; pan: number }> {
	const from = Math.max(0, fromLocal);
	const to = Math.max(from, toLocal);
	const points: Array<{ localTime: number; pan: number }> = [];
	if (!hasAnimatedPan(element)) {
		const pan = readPan(element);
		return [{ localTime: from, pan }];
	}
	for (let t = from; t < to; t += step) points.push({ localTime: t, pan: panAt(element, t) });
	points.push({ localTime: to, pan: panAt(element, to) });
	const pruned: typeof points = [];
	for (let i = 0; i < points.length; i++) {
		const prev = pruned[pruned.length - 1];
		const cur = points[i];
		const next = points[i + 1];
		if (prev && next) {
			const k = (cur.localTime - prev.localTime) / (next.localTime - prev.localTime);
			if (Math.abs(prev.pan + (next.pan - prev.pan) * k - cur.pan) < 0.05) continue;
		}
		pruned.push(cur);
	}
	return pruned;
}

/**
 * Export: the pan (−100…100) for `length` samples of the clip (sample 0 = clip-local time 0), evaluated every `step`
 * samples and interpolated, as the gain envelope is; null when it never moves (one matrix for the whole clip).
 */
export function renderPanValues(
	element: Pick<AudioCapableElement, "params" | "animations">,
	length: number,
	sampleRate: number,
	step = 128,
): Float32Array | null {
	if (!hasAnimatedPan(element) || length <= 0) return null;
	const out = new Float32Array(length);
	let prev = panAt(element, 0);
	for (let start = 0; start < length; start += step) {
		const end = Math.min(length, start + step);
		const next = panAt(element, end / sampleRate);
		const span = end - start;
		for (let i = start; i < end; i++) out[i] = prev + ((next - prev) * (i - start)) / span;
		prev = next;
	}
	return out;
}
