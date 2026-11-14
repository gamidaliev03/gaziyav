/**
 * The angle the pointer turned between two positions, the short way: a value in (−180, 180]. Dragging the
 * rotation handle across the handle's own 180° line used to make the clip jump by a full turn because every
 * step compared against the first pointer angle, and that difference was wrapped back into ±180°.
 */
export function unwrapAngleDelta({ from, to }: { from: number; to: number }): number {
	if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
	return (((to - from) % 360) + 540) % 360 - 180;
}

/** The total turn of a drag: each pointer step added the short way, so several turns add up instead of wrapping. */
export function accumulateAngleDelta({
	lastAngle,
	accumulatedAngle,
	currentAngle,
}: {
	lastAngle: number;
	accumulatedAngle: number;
	currentAngle: number;
}): { lastAngle: number; accumulatedAngle: number } {
	if (!Number.isFinite(currentAngle)) return { lastAngle, accumulatedAngle };
	const step = unwrapAngleDelta({ from: lastAngle, to: currentAngle });
	return { lastAngle: currentAngle, accumulatedAngle: accumulatedAngle + step };
}
