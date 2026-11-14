import type { FrameRate } from "opencut-wasm";
import type { MediaAsset } from "@/media/types";

type MediaAssetFpsInput = Pick<MediaAsset, "type" | "fps">;

const STANDARD_FRAME_RATES: Array<{ value: number; rate: FrameRate }> = [
	{ value: 24_000 / 1_001, rate: { numerator: 24_000, denominator: 1_001 } },
	{ value: 24, rate: { numerator: 24, denominator: 1 } },
	{ value: 25, rate: { numerator: 25, denominator: 1 } },
	{ value: 30_000 / 1_001, rate: { numerator: 30_000, denominator: 1_001 } },
	{ value: 30, rate: { numerator: 30, denominator: 1 } },
	{ value: 48, rate: { numerator: 48, denominator: 1 } },
	{ value: 50, rate: { numerator: 50, denominator: 1 } },
	{ value: 60_000 / 1_001, rate: { numerator: 60_000, denominator: 1_001 } },
	{ value: 60, rate: { numerator: 60, denominator: 1 } },
	{ value: 120, rate: { numerator: 120, denominator: 1 } },
];

const STANDARD_FRAME_RATE_TOLERANCE = 0.01;

/**
 * A clip's measured frame rate as the rate it was shot at. 23.976, 29.97, 47.952, 59.94 and 119.88 stay NTSC: rounded to
 * a whole number, a 23.976 clip made a 24 fps project (and a 29.97 one 30): its timecode, frame grid and export ran
 * 0.1 % off the footage — a frame doubled every 42 s (pro-core, 09.11). Anything else is a whole number (a phone's
 * variable rate averaging 29.8 is 30).
 */
const NTSC_RATES = [24_000 / 1_001, 30_000 / 1_001, 48_000 / 1_001, 60_000 / 1_001, 120_000 / 1_001];

export function normalizeMediaFps(fps: number): number | undefined {
	if (!Number.isFinite(fps) || fps <= 0) return undefined;
	return NTSC_RATES.find((rate) => Math.abs(fps - rate) <= STANDARD_FRAME_RATE_TOLERANCE) ?? Math.round(fps);
}

export function frameRateToFloat(rate: FrameRate): number {
	return rate.numerator / rate.denominator;
}

export function frameRatesEqual({
	a,
	b,
}: {
	a: FrameRate;
	b: FrameRate;
}): boolean {
	return a.numerator === b.numerator && a.denominator === b.denominator;
}

export function floatToFrameRate(fps: number): FrameRate {
	const standard = STANDARD_FRAME_RATES.find(
		(candidate) => Math.abs(fps - candidate.value) <= STANDARD_FRAME_RATE_TOLERANCE,
	);
	if (standard) return standard.rate;

	if (Number.isInteger(fps)) {
		return { numerator: fps, denominator: 1 };
	}

	const ARBITRARY_DENOMINATOR = 1_000_000;
	const scaledNumerator = Math.round(fps * ARBITRARY_DENOMINATOR);
	const divisor = gcd({
		left: scaledNumerator,
		right: ARBITRARY_DENOMINATOR,
	});
	return {
		numerator: scaledNumerator / divisor,
		denominator: ARBITRARY_DENOMINATOR / divisor,
	};
}

function gcd({ left, right }: { left: number; right: number }): number {
	let a = Math.abs(left);
	let b = Math.abs(right);
	while (b !== 0) {
		const remainder = a % b;
		a = b;
		b = remainder;
	}
	return a || 1;
}

export function getHighestImportedVideoFps({
	mediaAssets,
}: {
	mediaAssets: MediaAssetFpsInput[];
}): number | null {
	let highestFps: number | null = null;

	for (const asset of mediaAssets) {
		const fps = asset.fps ?? Number.NaN;
		if (asset.type !== "video") continue;
		if (!Number.isFinite(fps) || fps <= 0) continue;

		highestFps = highestFps === null ? fps : Math.max(highestFps, fps);
	}

	return highestFps;
}

export function getRaisedProjectFpsForImportedMedia({
	currentFps,
	importedAssets,
}: {
	currentFps: FrameRate;
	importedAssets: MediaAssetFpsInput[];
}): FrameRate | null {
	const highestImportedVideoFps = getHighestImportedVideoFps({
		mediaAssets: importedAssets,
	});

	const currentFpsFloat = frameRateToFloat(currentFps);

	if (highestImportedVideoFps === null || highestImportedVideoFps <= currentFpsFloat) {
		return null;
	}

	return floatToFrameRate(highestImportedVideoFps);
}
