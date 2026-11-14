import type { RetimeConfig } from "@/timeline";
import { clampRetimeRate } from "@/retime/rate";
import { clipFractionAt, getCurveTable, sourceFractionAt, type CurveTable } from "./curve";

function getSafeRate({ rate }: { rate: number }): number {
	return clampRetimeRate({ rate });
}

/** Average speed: the curve's own (source span ÷ clip duration) when there is one, else the constant rate. */
function averageRate(retime?: RetimeConfig): number {
	const table = getRetimeCurveTable(retime);
	return getSafeRate({ rate: table ? table.rate : (retime?.rate ?? 1) });
}

/** The speed-ramp table of a retime, when it has one. */
export function getRetimeCurveTable(retime?: RetimeConfig): CurveTable | null {
	if (retime?.mode !== "curve" || !retime.curve || retime.curve.points.length < 2) return null;
	return getCurveTable(retime.curve);
}

/**
 * Source time (from the clip's trim start) shown at `clipTime`. Speed ramps need the clip's `duration`
 * (same unit as clipTime); without it the average speed is used — exact for spans of the whole clip.
 */
export function getSourceTimeAtClipTime({
	clipTime,
	retime,
	duration,
}: {
	clipTime: number;
	retime?: RetimeConfig;
	duration?: number;
}): number {
	const rate = averageRate(retime);
	const table = duration && duration > 0 ? getRetimeCurveTable(retime) : null;
	if (table && duration) {
		return duration * rate * sourceFractionAt(table, clipTime / duration);
	}
	return clipTime * rate;
}

export function getClipTimeAtSourceTime({
	sourceTime,
	retime,
	duration,
}: {
	sourceTime: number;
	retime?: RetimeConfig;
	duration?: number;
}): number {
	const rate = averageRate(retime);
	const table = duration && duration > 0 ? getRetimeCurveTable(retime) : null;
	if (table && duration) {
		return duration * clipFractionAt(table, sourceTime / (duration * rate));
	}
	return sourceTime / rate;
}

export function getEffectiveRateAt({
	clipTime,
	retime,
	duration,
}: {
	clipTime?: number;
	retime?: RetimeConfig;
	duration?: number;
}): number {
	const table = duration && duration > 0 ? getRetimeCurveTable(retime) : null;
	if (table && duration && clipTime != null) {
		return table.speed(Math.min(1, Math.max(0, sourceFractionAt(table, clipTime / duration))));
	}
	return averageRate(retime);
}

/** Slowest speed of the clip (constant rate or the curve's minimum). */
export function getMinimumRate(retime?: RetimeConfig): number {
	const table = getRetimeCurveTable(retime);
	return table ? table.minSpeed : getSafeRate({ rate: retime?.rate ?? 1 });
}

export function getTimelineDurationForSourceSpan({
	sourceSpan,
	retime,
}: {
	sourceSpan: number;
	retime?: RetimeConfig;
}): number {
	if (sourceSpan <= 0) {
		return 0;
	}
	return sourceSpan / averageRate(retime);
}
