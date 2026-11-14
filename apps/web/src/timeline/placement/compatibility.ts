import type { ElementType, TrackType } from "@/timeline";
import type { ParamValues } from "@/params";
import { generatorOf } from "@/generators/document";

const ELEMENT_TRACK_MAP: Record<ElementType, TrackType> = {
	audio: "audio",
	text: "text",
	sticker: "graphic",
	graphic: "graphic",
	effect: "effect",
	video: "video",
	image: "video",
};

export function getTrackTypeForElementType({
	elementType,
}: {
	elementType: ElementType;
}): TrackType {
	return ELEMENT_TRACK_MAP[elementType];
}

export function canElementGoOnTrack({
	elementType,
	trackType,
}: {
	elementType: ElementType;
	trackType: TrackType;
}): boolean {
	return getTrackTypeForElementType({ elementType }) === trackType;
}

/** A composition clip (montage/flatten.ts COMPOSITION_DEF): a compound clip made of main-track clips stays on the main track, as in CapCut. */
const COMPOSITION_DEFINITION = "ai.Composition";

export function validateElementTrackCompatibility({
	element,
	track,
}: {
	element: { type: ElementType; definitionId?: string; params?: ParamValues };
	track: { type: TrackType };
}): { isValid: boolean; errorMessage?: string } {
	const isValid =
		canElementGoOnTrack({
			elementType: element.type,
			trackType: track.type,
		}) ||
		(element.type === "graphic" && element.definitionId === COMPOSITION_DEFINITION && track.type === "video") ||
		// a ground generator (solid, gradient, background) is a picture of the film: it may sit in the main row
		(element.type === "graphic" && track.type === "video" && generatorOf(element)?.role === "ground");

	if (!isValid) {
		return {
			isValid: false,
			errorMessage: `${element.type} elements cannot be placed on ${track.type} tracks`,
		};
	}

	return { isValid: true };
}
