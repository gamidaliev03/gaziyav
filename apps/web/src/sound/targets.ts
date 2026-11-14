// Loudness targets by destination: the pure part (numbers, names, how they are written). The chosen target itself is
// the app's «Target loudness» — see target-pref.ts.
import { TRUE_PEAK_CEILING_DB } from "./master";

export const TARGET_MIN = -36;
export const TARGET_MAX = -6;

/** The destinations offered where the meter is; anything else is «Custom». */
export const DESTINATIONS = [
	{ value: -14, label: "Web", hint: "YouTube, Reels, TikTok, Spotify: −14 LUFS" },
	{ value: -16, label: "Podcast", hint: "Apple Podcasts: −16 LUFS" },
	{ value: -23, label: "Broadcast", hint: "EBU R 128: −23 LUFS" },
] as const;

export const isDestination = (lufs: number) => DESTINATIONS.some((d) => d.value === lufs);

export function cleanTarget(value: unknown): number {
	const n = typeof value === "number" && Number.isFinite(value) ? value : -14;
	return Math.min(TARGET_MAX, Math.max(TARGET_MIN, Math.round(n * 2) / 2));
}

/** The true-peak ceiling that goes with a target: −1 dBTP; −2 for the ATSC level (A/85). */
export const ceilingFor = (targetLufs: number) => (targetLufs <= -24 ? -2 : TRUE_PEAK_CEILING_DB);

/** How far a loudness may sit from its target and still count as on it (EBU R 128: ±0.5 LU). */
export const ON_TARGET_LU = 0.5;
export const isOnTarget = (lufs: number, target: number) => Number.isFinite(lufs) && Math.abs(lufs - target) <= ON_TARGET_LU + 1e-9;

/** «−14.2», «−∞» for silence; a real minus sign, one decimal. */
export function formatLufs(value: number | null | undefined): string {
	if (value === null || value === undefined || Number.isNaN(value)) return "—";
	if (value === Number.NEGATIVE_INFINITY || value < -99) return "−∞";
	const rounded = Math.round(value * 10) / 10;
	if (rounded === 0) return "0.0";
	return `${rounded < 0 ? "−" : "+"}${Math.abs(rounded).toFixed(1)}`;
}

/** A difference or a gain: «+2.8», «−0.4», «0.0». */
export function formatDelta(value: number): string {
	const rounded = Math.round(value * 10) / 10;
	if (rounded === 0) return "0.0";
	return `${rounded < 0 ? "−" : "+"}${Math.abs(rounded).toFixed(1)}`;
}

/** A target as it is said: «−14» or «−14.5». */
export const formatTarget = (lufs: number) => `−${Math.abs(lufs) % 1 === 0 ? Math.abs(lufs).toFixed(0) : Math.abs(lufs).toFixed(1)}`;
