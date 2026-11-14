// Smooth slow motion (optical flow): how many in-between frames a clip needs, and which rendered file serves it.
import { getMinimumRate } from "@/retime/resolve";
import type { RetimeConfig } from "@/timeline";

export const MAX_SMOOTH_FACTOR = 20;

/** In-between frames per source frame for the clip's slowest speed (1 = no slow motion, nothing to render). */
export function smoothFactorFor(retime?: RetimeConfig): number {
	const min = getMinimumRate(retime);
	const slow = min < 0.99 ? 1 / min : 1;
	const factor = slow * Math.max(1, retime?.fpsBoost ?? 1);
	if (!(factor > 1.01)) return 1;
	return Math.min(MAX_SMOOTH_FACTOR, Math.round(factor * 1000) / 1000);
}

/**
 * Version of the smooth-motion files. 2: the made frames are tone-matched to the real ones (version 1 files flash
 * dark on every made frame); older files are ignored and rendered again.
 */
export const SMOOTH_VERSION = 2;

export interface SmoothProxyRef {
	mediaId: string;
	a: number;
	b: number;
	m: number;
}

/** A rendered file that covers source second `s` at the needed factor (±2 %). */
export function pickSmoothProxy<T extends SmoothProxyRef>(proxies: T[] | undefined, retime: RetimeConfig | undefined, s: number): T | null {
	if (!proxies?.length || !retime?.smooth) return null;
	const need = smoothFactorFor(retime);
	if (need <= 1) return null;
	return proxies.find((p) => s >= p.a - 0.02 && s <= p.b + 0.02 && Math.abs(p.m - need) / need < 0.02) ?? null;
}
