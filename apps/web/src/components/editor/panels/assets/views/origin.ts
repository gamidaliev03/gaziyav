// One media pool, two sections: what the user brought (Sources) and what the app made (Results:
// lipsync, voice-overs, YouTube pieces, AI compositions). Producers can mark an asset explicitly
// with `origin: "result"`; older assets are recognised by the names the pipeline gives them.
import type { MediaAsset } from "@/media/types";

const RESULT_NAME = /^(Voice|Lipsync|Voice-over|AI|Голос|Липсинк|Озвучка|ИИ)\b/i;
/** YouTube pieces: "<title> 0:12-0:27.mp4". */
const FRAGMENT_NAME = /\s\d+:\d{2}(?:[.,]\d+)?-\d+:\d{2}(?:[.,]\d+)?(?:\.\w+)?$/;

export function isResultAsset(asset: MediaAsset): boolean {
	if (asset.origin) return asset.origin === "result";
	return RESULT_NAME.test(asset.name) || FRAGMENT_NAME.test(asset.name);
}

/**
 * A clip with one of the inspector's tools applied (remove background, auto colour, enhance, retouch, face swap…): the
 * tool's processed copy belongs to that CLIP — it is the clip's effect — and is not a file of its own in Media (the
 * stay in Media. The copies stay in the project while a clip may use them (switching the tool off and on again, ⌘Z).
 */
const OWN_MEDIA: ReadonlySet<string> = new Set(["ai.separate", "ai.parts"]);
export function isAppliedToolResult(asset: MediaAsset): boolean {
	return !!asset.neural && !OWN_MEDIA.has(asset.neural.effect);
}
