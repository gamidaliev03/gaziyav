// The logic of the trackpad's taps, without the Mac: a rate limit and the transitions that deserve a tap (a snap that
// engages, a limit that is reached, a detent that is crossed). Pure, so `bun test src/haptics` proves it.

export type HapticKind = "snap" | "align" | "limit" | "drop";

/** Never more than one tap per this many milliseconds (a hand feels two taps 80 ms apart as one buzz). */
export const MIN_GAP_MS = 80;

/** One tap per call at most, and none within MIN_GAP_MS of the last one. */
export function createLimiter(gapMs = MIN_GAP_MS) {
	let last = Number.NEGATIVE_INFINITY;
	return {
		allow(now: number): boolean {
			if (now - last < gapMs) return false;
			last = now;
			return true;
		},
		reset() {
			last = Number.NEGATIVE_INFINITY;
		},
	};
}

/**
 * A snap that is engaged or not, keyed by a value the caller already has (a time, a guide's position): true only on
 * the move that engages it or engages a different one — not while it stays engaged, not when it lets go.
 */
export function createEngageTracker<K>(same: (a: K, b: K) => boolean = Object.is) {
	let engaged: K | null = null;
	return {
		update(next: K | null): boolean {
			const prev = engaged;
			engaged = next;
			return next !== null && (prev === null || !same(prev, next));
		},
		release() {
			engaged = null;
		},
	};
}

/** A limit reached or not: true only on the move that reaches it. */
export function createLimitTracker() {
	let at = false;
	return {
		update(atLimit: boolean): boolean {
			const reached = atLimit && !at;
			at = atLimit;
			return reached;
		},
		release() {
			at = false;
		},
	};
}

/** True when a value moving from `prev` to `next` reaches or crosses one of the detents (not when it leaves one). */
export function crossesDetent(prev: number, next: number, detents: readonly number[]): boolean {
	if (prev === next) return false;
	for (const d of detents) {
		if (prev === d) continue;
		if ((prev < d && next >= d) || (prev > d && next <= d)) return true;
	}
	return false;
}

/** The detents of a slider: its ends, its centre value and 0 when 0 lies inside. */
export function sliderDetents(min: number, max: number, origin?: number): number[] {
	const out = [min, max];
	if (origin !== undefined) out.push(origin);
	if (min < 0 && max > 0) out.push(0);
	return out;
}

/** The guides (type + position) that are on now and were not before: a tap belongs to a guide that appears. */
export function guideAppeared(prev: readonly { type: string; position: number }[], next: readonly { type: string; position: number }[]): boolean {
	outer: for (const line of next) {
		for (const old of prev) if (old.type === line.type && Math.abs(old.position - line.position) < 0.5) continue outer;
		return true;
	}
	return false;
}
