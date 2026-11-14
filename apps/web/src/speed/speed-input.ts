import {
	DEFAULT_RETIME_RATE,
	MAX_RETIME_RATE,
	clampRetimeRate,
} from "@/retime/rate";
import type { RetimeConfig } from "@/timeline";
import {
	formatNumberForDisplay,
	getFractionDigitsForStep,
	snapToStep,
} from "@/utils/math";

export const SPEED_STEP = 0.01;
/** The slowest constant speed, as on the slider and in CapCut: 0.1×. A typed «0» gave 0.01×, a clip 100 times longer. */
export const MIN_SPEED = 0.1;
const SPEED_FRACTION_DIGITS = getFractionDigitsForStep({ step: SPEED_STEP });

export function rateToDisplay({ rate }: { rate: number }): string {
	return formatNumberForDisplay({
		value: rate,
		fractionDigits: SPEED_FRACTION_DIGITS,
	});
}

/**
 * A typed speed. Anything below the slowest speed (0.05, 0, a negative number) is the slowest speed: it
 * used to be snapped to 0 first, and clampRetimeRate turns 0 into 1×, so the clip jumped back to normal.
 */
export function parseSpeedInput({ input }: { input: string }): number | null {
	const parsed = parseFloat(input);
	if (Number.isNaN(parsed)) return null;
	const bounded = Math.min(MAX_RETIME_RATE, Math.max(MIN_SPEED, parsed));
	return clampRetimeRate({
		rate: snapToStep({ value: bounded, step: SPEED_STEP }),
	});
}

/**
 * Whether committing this speed changes the clip. Visiting the field (or typing the same speed) must not add
 * an undo step, nor turn a speed ramp into a constant speed (the field shows a ramp's average speed).
 */
export function isSpeedChange({
	committed,
	rate,
	maintainPitch,
}: {
	committed: RetimeConfig | undefined;
	rate: number;
	maintainPitch: boolean;
}): boolean {
	const committedRate = clampRetimeRate({
		rate: committed?.rate ?? DEFAULT_RETIME_RATE,
	});
	return (
		Math.abs(rate - committedRate) > 1e-9 ||
		maintainPitch !== (committed?.maintainPitch ?? false)
	);
}

/**
 * The clip's retime after a typed constant speed: the new speed and pitch over what the saved clip keeps (optical
 * flow, frame-rate settings), its curve dropped; nothing at all at 1× with nothing else kept. Spreading "no retime"
 * over the saved one kept its old rate: 2× with «1» typed stayed 2×.
 */
export function constantRetimeFrom({
	committed,
	rate,
	maintainPitch,
}: {
	committed: RetimeConfig | undefined;
	rate: number;
	maintainPitch: boolean;
}): RetimeConfig | undefined {
	const { curve: _curve, mode: _mode, rate: _rate, maintainPitch: _pitch, ...keep } = committed ?? { rate: DEFAULT_RETIME_RATE };
	if (rate === DEFAULT_RETIME_RATE && !maintainPitch && Object.keys(keep).length === 0) return undefined;
	return { ...keep, rate: clampRetimeRate({ rate }), maintainPitch };
}
