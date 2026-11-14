import { evaluateMathExpression } from "@/utils/math";

/** «10+5», «2*3», «5-2» (a leading minus is just a negative number). */
export function looksLikeExpression({ input }: { input: string }): boolean {
	const trimmed = input.trim();
	if (!trimmed) return false;
	if (/[+*/]/.test(input)) return true;
	const minusIndex = trimmed.indexOf("-");
	return minusIndex > 0;
}

/** A decimal comma reads as a point: a Russian keyboard types «1,5», which parseFloat read as 1. */
export function normalizeDecimalInput(input: string): string {
	return input.replace(/,/g, ".");
}

/**
 * The number a number field's text stands for: a plain number («1,5» or «1.5») or an expression («10+5», «1,5*2»),
 * or null while it isn't one yet («», «1+», «Mixed»). An expression is worked out as it is typed, so the preview
 * shows 15 for «10+5», not the 10 before the operator.
 */
export function evaluateNumberInput({
	input,
	supportsExpressions = true,
}: {
	input: string;
	supportsExpressions?: boolean;
}): number | null {
	const normalized = normalizeDecimalInput(input).trim();
	if (supportsExpressions && looksLikeExpression({ input: normalized })) {
		return evaluateMathExpression({ input: normalized });
	}
	const parsed = Number.parseFloat(normalized);
	return Number.isNaN(parsed) ? null : parsed;
}

/**
 * ↑/↓ in a number field (as in CapCut, Premiere, Figma): the field's number plus or minus one step, ten with Shift.
 * Null when the text isn't a number («Mixed»).
 */
export function nudgeNumberInput({
	input,
	direction,
	step,
	shiftKey,
}: {
	input: string;
	direction: 1 | -1;
	step: number;
	shiftKey: boolean;
}): number | null {
	const current = evaluateNumberInput({ input });
	if (current === null) return null;
	const next = current + direction * step * (shiftKey ? 10 : 1);
	// 0.1 + 0.2 lands on 0.30000000000000004: keep the step's precision
	return Number(next.toFixed(12));
}

export const SCRUB_UNBOUNDED = 1e9;
/** A bounded fine value crosses its whole range in about this many pixels of drag. */
const SCRUB_RANGE_PX = 300;

/**
 * How far a value moves per pixel of drag, or null for the field's default of one unit per pixel (whole-number values:
 * position, rotation, percent). Fine values moved half a unit per pixel whatever their range: Line height jumped by
 * 1.0 in 2 px, Fade in crossed 0–10 s in 20 px, Active word scale 0.5–3 in 5 px.
 */
export function scrubUnitsPerPixel({ min, max, step }: { min: number; max?: number; step: number }): number | null {
	if (step >= 1) return null;
	// Less than a step per pixel is fine: the field adds up the pixels of the whole drag and snaps the total to the step.
	if (max !== undefined && Number.isFinite(min) && max > min) return (max - min) / SCRUB_RANGE_PX;
	return step;
}

/** A drag on a «Mixed» field (several clips, different values): the first clip's value moved by the drag. */
export function mixedScrubValue({ first, pixels, perPixel }: { first: number; pixels: number; perPixel: number | null }): number {
	return first + pixels * (perPixel ?? 1);
}
