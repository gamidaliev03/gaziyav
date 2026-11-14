import type { RetimeConfig } from "@/timeline";
import { getRetimeCurveTable, getSourceTimeAtClipTime } from "./resolve";
import { sourceFractionAt, subCurve, getCurveTable } from "./curve";

export function getSourceSpanAtClipTime({
	clipTime,
	retime,
	duration,
}: {
	clipTime: number;
	retime?: RetimeConfig;
	/** The clip's duration (same unit): needed for exact spans of a speed ramp. */
	duration?: number;
}): number {
	return Math.max(0, getSourceTimeAtClipTime({ clipTime, retime, duration }));
}

/** Retimes of the two halves of a split: a speed ramp is cut into its two parts. */
export function splitRetimeAtClipTime({
	retime,
	splitClipTime,
	duration,
}: {
	retime?: RetimeConfig;
	splitClipTime: number;
	duration?: number;
}): {
	left: RetimeConfig | undefined;
	right: RetimeConfig | undefined;
} {
	const table = getRetimeCurveTable(retime);
	if (!retime || !table || !retime.curve || !duration || duration <= 0) return { left: retime, right: retime };
	const s = Math.min(0.999, Math.max(0.001, sourceFractionAt(table, splitClipTime / duration)));
	const leftCurve = subCurve(retime.curve, 0, s);
	const rightCurve = subCurve(retime.curve, s, 1);
	return {
		left: { ...retime, curve: leftCurve, rate: getCurveTable(leftCurve).rate },
		right: { ...retime, curve: rightCurve, rate: getCurveTable(rightCurve).rate },
	};
}
