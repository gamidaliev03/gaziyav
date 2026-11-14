import type { MediaAsset } from "@/media/types";
import type { TProjectMetadata } from "@/project/types";
import type { ImageElement, SceneTracks, VideoElement } from "@/timeline/types";

/** A save right after the picture is no change: a card goes out of date when the project changed later than this. */
const SAME_MOMENT_MS = 1000;

export const cardIsOld = (meta: Pick<TProjectMetadata, "thumbnailAt" | "updatedAt">): boolean =>
	!meta.thumbnailAt || meta.updatedAt.getTime() > meta.thumbnailAt.getTime() + SAME_MOMENT_MS;

/** The picture of the timeline's first visible clip: a card shows the film, not the first file ever imported. */
export function firstClipPicture({ tracks, assets }: { tracks: SceneTracks; assets: Pick<MediaAsset, "id" | "thumbnailUrl">[] }): string | undefined {
	const clips = [tracks.main, ...tracks.overlay]
		.filter((track) => !("hidden" in track && track.hidden))
		.flatMap((track): readonly unknown[] => track.elements)
		.filter((e): e is VideoElement | ImageElement => {
			const type = (e as { type?: string }).type;
			return (type === "video" || type === "image") && !(e as VideoElement).hidden;
		})
		.sort((a, b) => Number(a.startTime) - Number(b.startTime));
	for (const clip of clips) {
		const picture = assets.find((a) => a.id === clip.mediaId)?.thumbnailUrl;
		if (picture) return picture;
	}
	return undefined;
}
