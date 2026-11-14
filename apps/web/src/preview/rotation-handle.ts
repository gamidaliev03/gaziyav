import { ROTATION_HANDLE_OFFSET } from "@/preview/element-bounds";

/** Half the rotation handle's size: how much room it needs past the point it is centred on. */
export const ROTATION_HANDLE_RADIUS = 11;

type Point = { x: number; y: number };

/**
 * Where the rotation handle goes, in overlay pixels. Above the top edge when there is room; a clip that fills the
 * frame leaves none in Fit, so then below the bottom edge, and when that is off screen too, just inside the top
 * edge — never where it can't be grabbed. `angleRad` is the element's rotation; `up` is its top edge's centre and
 * `down` its bottom edge's centre on screen.
 */
export function placeRotationHandle({
	up,
	down,
	angleRad,
	viewportHeight,
}: {
	up: Point;
	down: Point;
	angleRad: number;
	viewportHeight: number;
}): Point {
	const dx = Math.sin(angleRad) * ROTATION_HANDLE_OFFSET;
	const dy = Math.cos(angleRad) * ROTATION_HANDLE_OFFSET;
	const aboveTop = { x: up.x + dx, y: up.y - dy };
	const belowBottom = { x: down.x - dx, y: down.y + dy };
	const insideTop = { x: up.x - dx, y: up.y + dy };
	const onScreen = (point: Point) =>
		point.y - ROTATION_HANDLE_RADIUS >= 0 && point.y + ROTATION_HANDLE_RADIUS <= viewportHeight;
	if (onScreen(aboveTop)) return aboveTop;
	if (onScreen(belowBottom)) return belowBottom;
	return insideTop;
}
