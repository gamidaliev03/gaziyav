// A tool applied from the inspector (remove background, auto colour, enhance…) keeps its processed copy in the project
// while a clip shows it. A copy NO clip uses any more (its clip was deleted, the tool was applied again or taken off)
// is only disk taken: it is not listed in Media and nothing can reach it. Such copies go when the project is next
// they are free, and applying one again makes its copy again.
import type { MediaAsset } from "@/media/types";

const REMAKEABLE: ReadonlySet<string> = new Set([
	"ai.removeBackground",
	"ai.blurBackground",
	"ai.colorBackground",
	"ai.enhance",
	"ai.denoise",
	"ai.upscale2x",
	"ai.upscale4x",
	"ai.retouch",
	"ai.voiceEnhance",
	"ai.voiceChange",
	"ai.deflicker",
	"ai.autoColor",
	"ai.colorMatch",
]);
/** A copy this fresh stays: the session that made it may still come back (a crash's recovery, an older save). */
const FRESH_MS = 3 * 24 * 3600 * 1000;

/**
 * The tool copies of `assets` that nothing in `project` (the whole saved project: every timeline, compound clip and
 * switched-off tool) names — neither directly nor as what a used copy was made from or is exported from.
 */
export function unusedToolCopies({ project, assets, now = Date.now() }: { project: unknown; assets: readonly MediaAsset[]; now?: number }): MediaAsset[] {
	const copies = assets.filter((asset) => !!asset.neural && REMAKEABLE.has(asset.neural.effect) && now - asset.file.lastModified > FRESH_MS);
	if (copies.length === 0) return [];
	let text = "";
	try {
		text = JSON.stringify(project) ?? "";
	} catch {
		return [];
	}
	if (!text) return [];
	const used = new Set<string>();
	for (const asset of assets) if (text.includes(asset.id)) used.add(asset.id);
	for (let more = true; more; ) {
		more = false;
		for (const asset of assets) {
			if (!asset.neural || !used.has(asset.id)) continue;
			for (const link of [asset.neural.sourceId, asset.neural.originalId, asset.neural.exportId]) {
				if (!link || used.has(link)) continue;
				used.add(link);
				more = true;
			}
		}
	}
	return copies.filter((asset) => !used.has(asset.id));
}
