import type { SceneTracks, TimelineElement } from "@/timeline";
import { croppedSize, readCrop } from "@/timeline/crop";
import type { MediaAsset } from "@/media/types";
import { STICKER_INTRINSIC_SIZE_FALLBACK } from "@/stickers/intrinsic-size";
import { DEFAULT_GRAPHIC_SOURCE_SIZE } from "@/graphics";
import { measureTextElement } from "@/text/measure-element";
import {
	getElementLocalTime,
} from "@/animation";
import { resolveTransformAtTime } from "@/rendering/animation-values";
import { buildTransformFromParams } from "@/rendering";
import { type FollowOffset, followPlace, makeFollowResolver } from "@/motion/follow";

export interface ElementBounds {
	cx: number;
	cy: number;
	width: number;
	height: number;
	rotation: number;
}

export interface ElementWithBounds {
	trackId: string;
	elementId: string;
	element: TimelineElement;
	bounds: ElementBounds;
}

function getVisualElementBounds({
	canvasWidth,
	canvasHeight,
	sourceWidth,
	sourceHeight,
	transform,
}: {
	canvasWidth: number;
	canvasHeight: number;
	sourceWidth: number;
	sourceHeight: number;
	transform: {
		scaleX: number;
		scaleY: number;
		position: { x: number; y: number };
		rotate: number;
	};
}): ElementBounds {
	const containScale = Math.min(
		canvasWidth / sourceWidth,
		canvasHeight / sourceHeight,
	);
	const scaledWidth = sourceWidth * containScale * transform.scaleX;
	const scaledHeight = sourceHeight * containScale * transform.scaleY;
	const cx = canvasWidth / 2 + transform.position.x;
	const cy = canvasHeight / 2 + transform.position.y;

	return {
		cx,
		cy,
		width: scaledWidth,
		height: scaledHeight,
		rotation: transform.rotate,
	};
}

function getTransformedRectBounds({
	canvasWidth,
	canvasHeight,
	rect,
	transform,
}: {
	canvasWidth: number;
	canvasHeight: number;
	rect: { left: number; top: number; width: number; height: number };
	transform: {
		scaleX: number;
		scaleY: number;
		position: { x: number; y: number };
		rotate: number;
	};
}): ElementBounds {
	const localCenterX = rect.left + rect.width / 2;
	const localCenterY = rect.top + rect.height / 2;
	const scaledCenterX = localCenterX * transform.scaleX;
	const scaledCenterY = localCenterY * transform.scaleY;
	const rotationRad = (transform.rotate * Math.PI) / 180;
	const cos = Math.cos(rotationRad);
	const sin = Math.sin(rotationRad);
	return {
		cx:
			canvasWidth / 2 +
			transform.position.x +
			scaledCenterX * cos -
			scaledCenterY * sin,
		cy:
			canvasHeight / 2 +
			transform.position.y +
			scaledCenterX * sin +
			scaledCenterY * cos,
		width: rect.width * transform.scaleX,
		height: rect.height * transform.scaleY,
		rotation: transform.rotate,
	};
}

/**
 * Bounds policy: bounds reflect base content geometry (text glyphs + background,
 * sticker/image/video content area) and base transform. Post-effect spill (blur,
 * glow) and mask-clipped regions are intentionally excluded — handles manipulate
 * the canonical element geometry, not visual effect output.
 */
/**
 * An AI Composition layer as it is drawn: Remotion lays it out (its text, shapes and pictures), so its box is measured
 * in the player — the union of what its item shows, in canvas pixels. Null when it isn't on screen now.
 */
function aiLayerBounds({ elementId, canvasWidth, canvasHeight }: { elementId: string; canvasWidth: number; canvasHeight: number }): ElementBounds | null {
	if (typeof document === "undefined") return null;
	const layer = document.querySelector<HTMLElement>("[data-montage-layer]");
	const item = layer?.querySelector<HTMLElement>(`[data-ai-item="${CSS.escape(elementId)}"]`);
	if (!layer || !item) return null;
	const frame = layer.getBoundingClientRect();
	if (frame.width <= 0 || frame.height <= 0) return null;
	let left = Number.POSITIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;
	for (const node of item.querySelectorAll<HTMLElement>("*")) {
		const box = node.getBoundingClientRect();
		// What is drawn, not the full-frame boxes that lay it out.
		if (box.width < 1 || box.height < 1 || (box.width >= frame.width - 1 && box.height >= frame.height - 1)) continue;
		if (getComputedStyle(node).visibility === "hidden") continue;
		left = Math.min(left, box.left);
		top = Math.min(top, box.top);
		right = Math.max(right, box.right);
		bottom = Math.max(bottom, box.bottom);
	}
	if (!Number.isFinite(left)) return null;
	const sx = canvasWidth / frame.width;
	const sy = canvasHeight / frame.height;
	return {
		cx: ((left + right) / 2 - frame.left) * sx,
		cy: ((top + bottom) / 2 - frame.top) * sy,
		width: (right - left) * sx,
		height: (bottom - top) * sy,
		rotation: 0,
	};
}

function getElementBounds({
	element,
	canvasSize,
	mediaAsset,
	localTime,
}: {
	element: TimelineElement;
	canvasSize: { width: number; height: number };
	mediaAsset?: MediaAsset | null;
	localTime: number;
}): ElementBounds | null {
	if (element.type === "audio" || element.type === "effect") return null;
	if ("hidden" in element && element.hidden) return null;

	const { width: canvasWidth, height: canvasHeight } = canvasSize;

	if (element.type === "video" || element.type === "image") {
		const transform = resolveTransformAtTime({
			baseTransform: buildTransformFromParams({ params: element.params }),
			animations: element.animations,
			localTime,
		});
		// A cropped clip is fitted by the part it shows (timeline/crop.ts), as the renderer does.
		const { width: sourceWidth, height: sourceHeight } = croppedSize(
			mediaAsset?.width ?? canvasWidth,
			mediaAsset?.height ?? canvasHeight,
			readCrop(element.params),
		);
		return getVisualElementBounds({
			canvasWidth,
			canvasHeight,
			sourceWidth,
			sourceHeight,
			transform,
		});
	}

	if (element.type === "sticker") {
		const transform = resolveTransformAtTime({
			baseTransform: buildTransformFromParams({ params: element.params }),
			animations: element.animations,
			localTime,
		});
		return getVisualElementBounds({
			canvasWidth,
			canvasHeight,
			sourceWidth: element.intrinsicWidth ?? STICKER_INTRINSIC_SIZE_FALLBACK,
			sourceHeight: element.intrinsicHeight ?? STICKER_INTRINSIC_SIZE_FALLBACK,
			transform,
		});
	}

	if (element.type === "graphic" && element.definitionId.startsWith("ai.") && element.definitionId !== "ai.Composition") {
		const drawn = aiLayerBounds({ elementId: element.id, canvasWidth, canvasHeight });
		if (drawn) return drawn;
	}

	if (element.type === "graphic") {
		const transform = resolveTransformAtTime({
			baseTransform: buildTransformFromParams({ params: element.params }),
			animations: element.animations,
			localTime,
		});
		// a compound clip is a whole frame (its timeline's canvas), not a square shape
		const frame = element.definitionId === "ai.Composition";
		return getVisualElementBounds({
			canvasWidth,
			canvasHeight,
			sourceWidth: frame ? canvasWidth : DEFAULT_GRAPHIC_SOURCE_SIZE,
			sourceHeight: frame ? canvasHeight : DEFAULT_GRAPHIC_SOURCE_SIZE,
			transform,
		});
	}

	if (element.type === "text") {
		const transform = resolveTransformAtTime({
			baseTransform: buildTransformFromParams({ params: element.params }),
			animations: element.animations,
			localTime,
		});

		const canvas = document.createElement("canvas");
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;

		const measured = measureTextElement({
			element,
			canvasHeight,
			canvasWidth,
			localTime,
			ctx,
		});

		return getTransformedRectBounds({
			canvasWidth,
			canvasHeight,
			rect: measured.visualRect,
			transform,
		});
	}

	return null;
}

export const ROTATION_HANDLE_OFFSET = 24;

export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type Edge = "right" | "left" | "bottom";

export function getCornerPosition({
	bounds,
	corner,
}: {
	bounds: ElementBounds;
	corner: Corner;
}): { x: number; y: number } {
	const halfW = bounds.width / 2;
	const halfH = bounds.height / 2;
	const angleRad = (bounds.rotation * Math.PI) / 180;
	const cos = Math.cos(angleRad);
	const sin = Math.sin(angleRad);
	const localX =
		corner === "top-left" || corner === "bottom-left" ? -halfW : halfW;
	const localY =
		corner === "top-left" || corner === "top-right" ? -halfH : halfH;
	return {
		x: bounds.cx + (localX * cos - localY * sin),
		y: bounds.cy + (localX * sin + localY * cos),
	};
}

export function getEdgeHandlePosition({
	bounds,
	edge,
}: {
	bounds: ElementBounds;
	edge: Edge;
}): { x: number; y: number } {
	const halfWidth = bounds.width / 2;
	const halfHeight = bounds.height / 2;
	const angleRad = (bounds.rotation * Math.PI) / 180;
	const cos = Math.cos(angleRad);
	const sin = Math.sin(angleRad);
	const localX = edge === "right" ? halfWidth : edge === "left" ? -halfWidth : 0;
	const localY = edge === "bottom" ? halfHeight : 0;
	return {
		x: bounds.cx + (localX * cos - localY * sin),
		y: bounds.cy + (localX * sin + localY * cos),
	};
}

export function getVisibleElementsWithBounds({
	tracks,
	currentTime,
	canvasSize,
	mediaAssets,
}: {
	tracks: SceneTracks;
	currentTime: number;
	canvasSize: { width: number; height: number };
	mediaAssets: MediaAsset[];
}): ElementWithBounds[] {
	const mediaMap = new Map(mediaAssets.map((m) => [m.id, m]));
	const orderedTracks = [
		...tracks.overlay.filter((track) => !("hidden" in track && track.hidden)),
		...(!tracks.main.hidden ? [tracks.main] : []),
	].reverse();

	const result: ElementWithBounds[] = [];
	const follow = makeFollowResolver(tracks, canvasSize);

	for (const track of orderedTracks) {
		const elements = track.elements
			.filter((element) => !("hidden" in element && element.hidden))
			.filter(
				(element) =>
					currentTime >= element.startTime &&
					currentTime < element.startTime + element.duration,
			)
			.slice()
			.sort((a, b) => {
				if (a.startTime !== b.startTime) return a.startTime - b.startTime;
				return a.id.localeCompare(b.id);
			});

		for (const element of elements) {
			const localTime = getElementLocalTime({
				timelineTime: currentTime,
				elementStartTime: element.startTime,
				elementDuration: element.duration,
			});
			const mediaAsset =
				element.type === "video" || element.type === "image"
					? mediaMap.get(element.mediaId)
					: undefined;
			const bounds = getElementBounds({
				element,
				canvasSize,
				mediaAsset,
				localTime,
			});
			if (bounds) {
				// A layer that follows a tracker is drawn (and grabbed) where the tracker puts it.
				const off = element.follow ? follow(element.follow, currentTime) : null;
				result.push({
					trackId: track.id,
					elementId: element.id,
					element,
					bounds: off ? followBounds(bounds, off) : bounds,
				});
			}
		}
	}

	return result;
}

/** A following layer's box where the tracker carries it (moved, scaled, turned with the object). */
function followBounds(bounds: ElementBounds, off: FollowOffset): ElementBounds {
	const p = followPlace({ x: bounds.cx, y: bounds.cy, scaleX: 1, scaleY: 1, rotate: bounds.rotation }, off);
	return { ...bounds, cx: p.x, cy: p.y, width: bounds.width * p.scaleX, height: bounds.height * p.scaleY, rotation: p.rotate };
}
