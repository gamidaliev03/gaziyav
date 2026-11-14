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
