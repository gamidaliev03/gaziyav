/** What Media can tell about a picked file without reading it. */
interface FileLike {
	name: string;
	size: number;
}

interface AssetLike {
	id: string;
	/** The name the file was picked with (the stored copy is named after the asset id). */
	name: string;
	file: { size: number };
	ephemeral?: boolean;
}

/**
 * Splits picked files into new ones and ones already in Media (same name and size): picking a file twice used to
 * add it twice, two identical tiles nobody could tell apart. A known file maps to the asset already there.
 */
export function splitKnownFiles<F extends FileLike>({
	files,
	assets,
	originalSizeOf,
}: {
	files: readonly F[];
	assets: readonly AssetLike[];
	/** The size of the user's own file behind an asset's editing copy (4K HEVC): picked again, it is that asset. */
	originalSizeOf?: (assetId: string) => number | undefined;
}): { fresh: F[]; known: { file: F; assetId: string }[] } {
	const byKey = new Map<string, string>();
	for (const asset of assets) {
		if (asset.ephemeral) continue;
		byKey.set(`${asset.name}\u0000${asset.file.size}`, asset.id);
		const originalSize = originalSizeOf?.(asset.id);
		if (originalSize != null) byKey.set(`${asset.name}\u0000${originalSize}`, asset.id);
	}
	const fresh: F[] = [];
	const known: { file: F; assetId: string }[] = [];
	const seen = new Set<string>();
	for (const file of files) {
		const key = `${file.name}\u0000${file.size}`;
		const assetId = byKey.get(key);
		if (assetId) known.push({ file, assetId });
		// The same file picked twice in one go is added once.
		else if (!seen.has(key)) fresh.push(file);
		seen.add(key);
	}
	return { fresh, known };
}
