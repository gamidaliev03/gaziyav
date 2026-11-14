// A copy of the user's file into the project that a crash cut short (services/storage/service.ts saveMediaAsset lists
// such a copy before writing it). Found at the next open and made again from the original.
import type { MediaAssetData } from "./types";

/** Listed with its original but not used in place, and its stored copy is missing or not the size it was listed with. */
export function cutCopy(
	metadata: Pick<MediaAssetData, "source" | "inPlace" | "size">,
	stored: { size: number } | null,
): boolean {
	if (!metadata.source || metadata.inPlace) return false;
	if (!stored) return true;
	return (
		typeof metadata.size === "number" &&
		metadata.size > 0 &&
		stored.size !== metadata.size
	);
}

/** What Chromium writes a file to before moving it into place («<name>.crswap»): left behind only by a crash. */
export const isLeftoverName = (name: string): boolean =>
	name.endsWith(".crswap");
