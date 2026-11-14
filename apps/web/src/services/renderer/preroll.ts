import { TICKS_PER_SECOND } from "@/wasm";
import type { CanvasRenderer } from "./canvas-renderer";
import type { AnyBaseNode } from "./nodes/base-node";
import { VideoNode } from "./nodes/video-node";
import { decoderKeyOf, videoSourceSeconds } from "./resolve";

/** How far ahead of the playhead a clip's decoder is opened. */
const PREROLL_LEAD_TICKS = TICKS_PER_SECOND;
const PREROLL_CHECK_INTERVAL_MS = 250;
let lastCheck = 0;

function collectVideoNodes(node: AnyBaseNode, out: VideoNode[]): VideoNode[] {
	if (node instanceof VideoNode) out.push(node);
	for (const child of node.children) collectVideoNodes(child, out);
	return out;
}

/**
 * During playback: when a video clip starts within the next second and its
 * decoder isn't on screen right now, open that decoder and decode the clip's first frame
 * ahead of the cut (a cold decoder at a cut froze playback for ~250 ms).
 * Back-to-back pieces of one file have their own decoders (scene-builder decoder lanes), so the next
 * piece is pre-rolled too while the current one plays.
 */
export function prerollUpcomingClips({
	renderer,
	root,
	time,
	throttle = true,
}: {
	renderer: CanvasRenderer;
	root: AnyBaseNode;
	time: number;
	/** During playback (a check per frame) it runs every 250 ms; where the playhead rests, every time. */
	throttle?: boolean;
}): void {
	const now = performance.now();
	if (throttle && now - lastCheck < PREROLL_CHECK_INTERVAL_MS) return;
	lastCheck = now;

	const videos = collectVideoNodes(root, []);
	const activeKeys = new Set<string>();
	for (const node of videos) {
		const { timeOffset, duration } = node.params;
		if (time >= timeOffset && time < timeOffset + duration) {
			activeKeys.add(decoderKeyOf(node.params));
		}
	}
	// The earliest upcoming clip per decoder: two pre-rolls on one decoder would seek it back and forth.
	const upcoming = new Map<string, VideoNode>();
	for (const node of videos) {
		const { timeOffset, proxies } = node.params;
		if (timeOffset <= time || timeOffset > time + PREROLL_LEAD_TICKS) continue;
		// Smooth slow motion plays from its own file.
		if (proxies?.length) continue;
		const key = decoderKeyOf(node.params);
		// A decoder playing now: pre-rolling would seek it away.
		if (activeKeys.has(key)) continue;
		const seen = upcoming.get(key);
		if (!seen || timeOffset < seen.params.timeOffset) upcoming.set(key, node);
	}
	for (const [key, node] of upcoming) {
		renderer.videoCache.preroll({
			mediaId: key,
			file: node.params.file,
			time: videoSourceSeconds(node.params, 0),
		});
	}
}
