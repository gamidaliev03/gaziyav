// An editing copy and the user's own file behind it (CapCut: proxies for the preview, the export from the original).
// The copy is the asset's `file` — everything that shows or edits media uses it; the original is a hidden record
// (`editingOriginalOf`) that only the export reads. Free of the editor: MediaManager and the tests use it.
import type { MediaAsset } from "./types";

/** Loaded media split into what the project shows and the originals behind editing copies (by the copy's id). */
export function splitEditingOriginals(loaded: MediaAsset[]): { assets: MediaAsset[]; originals: Map<string, MediaAsset> } {
	const originals = new Map<string, MediaAsset>();
	const assets: MediaAsset[] = [];
	for (const asset of loaded) {
		if (asset.editingOriginalOf) originals.set(asset.editingOriginalOf, asset);
		else assets.push(asset);
	}
	return { assets, originals };
}

/**
 * The assets as the export renders them: an editing copy gives way to its original when `canDecode` says this machine
 * reads it. No original (a project from before, or none kept), or one this machine can't decode: the copy — no error.
 */
export async function withExportOriginals({
	assets,
	originals,
	canDecode,
}: {
	assets: MediaAsset[];
	originals: ReadonlyMap<string, MediaAsset>;
	canDecode: (file: File) => Promise<boolean>;
}): Promise<MediaAsset[]> {
	return Promise.all(
		assets.map(async (asset) => {
			const original = originals.get(asset.id);
			if (!original || !(await canDecode(original.file).catch(() => false))) return asset;
			return { ...asset, file: original.file, url: original.url };
		}),
	);
}
