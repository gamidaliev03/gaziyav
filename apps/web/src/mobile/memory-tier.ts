// The phone's memory column — PROPOSAL for platform/memory-budget.ts (mobile, 14.11; not wired: memory-budget.ts is
// perf's, the column goes in by its owner in round 2 as a fourth tier «phone» next to base / standard / pro).
//
// Why these numbers. A Safari tab on an iPhone is killed (the page reloads, «a problem repeatedly occurred») well
// before the phone's RAM is used: WebKit publishes no ceiling, so the column is sized for the worst case we must
// survive — a 4 GB iPhone (11 … 13, SE 3) with the decoders' frames, the WASM heap and the GPU textures together under
// ~1 GB — and measured on the owner's phone in round 3 (the /check/ page's memory probe gives the first number).
// Everything dropped is made again when shown, as on the desktop, so a smaller column costs speed, never content.
import { BUDGETS, type CacheName } from "@/platform/memory-budget";

const MB = 1 << 20;

export const PHONE_COLUMN: Record<CacheName, number> = {
	// two open decoders: the clip under the playhead and the next one (a cut plays without a stall); the desktop's
	// base Mac keeps 3
	"video.decoders": 2,
	// no backwards cache: a phone editor plays forwards; scrubbing back decodes from the keyframe
	"video.back": 0,
	thumbnails: 16 * MB,
	waveforms: 8 * MB,
	// a Reel's sound is ~10 MB decoded per minute of stereo 48 kHz float: 64 MB holds ~6 min
	"audio.decoded": 64 * MB,
	"audio.prepared": 32 * MB,
};

/** The column, never above the base Mac's (a test holds it). */
export function phoneBudget(): Record<CacheName, number> {
	const out = {} as Record<CacheName, number>;
	for (const name of Object.keys(PHONE_COLUMN) as CacheName[]) out[name] = Math.min(PHONE_COLUMN[name], BUDGETS[name].base);
	return out;
}

/** The phone's preview: the long side of the player's frame in px (the export keeps the project's size). */
export const PHONE_PREVIEW_LONG_SIDE = 960;
/** iOS refuses canvases over 16.7 M px (4096²); the editor's canvases stay far below with the preview at 960. */
export const IOS_CANVAS_MAX_PIXELS = 16_777_216;
