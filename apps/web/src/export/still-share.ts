/**
 * How much of the timeline is still pictures (no video clip under them): the encoder spends a fraction of its rate on
 * them, so the Export window's size estimate takes them at a quarter (final-A: «about 9.3 MB» for a 5.1 MB file of
 * an AI picture and a clip). The editor registers a reader of the active scene; the estimate asks it when the window
 * gives no share of its own.
 */
import type { SceneTracks } from "@/timeline/types";

/** Seconds per second of the timeline that only pictures (and titles) cover: 0 for footage, 1 for a slideshow. */
export function timelineStillShare(tracks: SceneTracks | null | undefined): number {
	if (!tracks) return 0;
	const spans = (type: string) =>
		[tracks.main, ...tracks.overlay].flatMap((track) => track.elements.filter((e) => e.type === type).map((e) => [e.startTime as number, (e.startTime as number) + (e.duration as number)] as const));
	const video = spans("video");
	const stills = spans("image");
	const end = Math.max(0, ...[...video, ...stills].map(([, b]) => b));
	if (!end) return 0;
	// Moments covered by a picture and by no video, measured on the union of edges.
	const edges = [...new Set([...video, ...stills].flat())].sort((a, b) => a - b);
	let still = 0;
	for (let i = 0; i + 1 < edges.length; i++) {
		const [a, b] = [edges[i], edges[i + 1]];
		if (b <= a) continue;
		const under = (list: readonly (readonly [number, number])[]) => list.some(([x, y]) => x <= a && y >= b);
		if (!under(video) && under(stills)) still += b - a;
	}
	return Math.max(0, Math.min(1, still / end));
}

let reader: (() => number) | null = null;
/** The editor's scene, for the estimate (set once by the editor provider). */
export function setStillShareReader(read: (() => number) | null): void {
	reader = read;
}
export function currentStillShare(): number {
	try {
		return reader?.() ?? 0;
	} catch {
		return 0;
	}
}
