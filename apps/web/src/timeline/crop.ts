// CapCut's Crop (timeline toolbar): a video or photo shows only part of its frame, and that part takes the frame's
// place — it is fitted to the canvas as if the media had those proportions. Stored in the clip's params as fractions of
// the source frame (and a straightening angle), so the preview, the frame handles and the export all read the same
// numbers.
import type { ParamValues } from "@/params";

/** The kept part of the source frame, as fractions of its width and height (0–1). */
export interface CropRect {
	x: number;
	y: number;
	width: number;
	height: number;
	/**
	 * Degrees clockwise (±45, CapCut's Rotate in the Crop window): the picture turns about the frame's centre and is
	 * enlarged just enough that the frame has no empty corners; the kept part is then cut from it, upright.
	 */
	rotation?: number;
}

export const CROP_PARAM_KEYS = {
	x: "crop.x",
	y: "crop.y",
	width: "crop.width",
	height: "crop.height",
	rotation: "crop.rotation",
} as const;

export const MAX_CROP_ROTATION = 45;
const MIN_SIZE = 0.02;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** The clip's crop, or null when it shows its whole frame. */
export function readCrop(params: ParamValues | undefined): CropRect | null {
	if (!params) return null;
	const width = Number(params[CROP_PARAM_KEYS.width]);
	const height = Number(params[CROP_PARAM_KEYS.height]);
	if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
	const crop = normalizeCrop({
		x: Number(params[CROP_PARAM_KEYS.x]) || 0,
		y: Number(params[CROP_PARAM_KEYS.y]) || 0,
		width,
		height,
		rotation: Number(params[CROP_PARAM_KEYS.rotation]) || 0,
	});
	return isFullFrame(crop) ? null : crop;
}

export function isFullFrame(crop: CropRect): boolean {
	return (
		crop.x <= 1e-4 &&
		crop.y <= 1e-4 &&
		crop.width >= 1 - 1e-4 &&
		crop.height >= 1 - 1e-4 &&
		Math.abs(crop.rotation ?? 0) < 0.05
	);
}

/** Inside the frame, not smaller than 2 % of it, turned at most 45° either way. */
export function normalizeCrop(crop: CropRect): CropRect {
	const width = Math.min(1, Math.max(MIN_SIZE, crop.width));
	const height = Math.min(1, Math.max(MIN_SIZE, crop.height));
	const rotation = Math.min(MAX_CROP_ROTATION, Math.max(-MAX_CROP_ROTATION, crop.rotation ?? 0));
	return {
		x: Math.min(clamp01(crop.x), 1 - width),
		y: Math.min(clamp01(crop.y), 1 - height),
		width,
		height,
		...(Math.abs(rotation) >= 0.05 ? { rotation } : {}),
	};
}

/**
 * How much a picture turned by `rotation` degrees is enlarged so it still covers its whole upright frame
 * (`sourceWidth` × `sourceHeight`): |cos| + |sin| × the frame's longer side over its shorter one.
 */
export function cropFillScale({
	rotation,
	sourceWidth,
	sourceHeight,
}: {
	rotation: number;
	sourceWidth: number;
	sourceHeight: number;
}): number {
	const angle = (rotation * Math.PI) / 180;
	const aspect = Math.max(sourceWidth / sourceHeight, sourceHeight / sourceWidth);
	return Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)) * aspect;
}

/** The params with this crop (the whole frame removes the keys). */
export function withCrop(params: ParamValues, crop: CropRect | null): ParamValues {
	const next: ParamValues = { ...params };
	for (const key of Object.values(CROP_PARAM_KEYS)) delete next[key];
	if (!crop) return next;
	const kept = normalizeCrop(crop);
	if (isFullFrame(kept)) return next;
	next[CROP_PARAM_KEYS.x] = kept.x;
	next[CROP_PARAM_KEYS.y] = kept.y;
	next[CROP_PARAM_KEYS.width] = kept.width;
	next[CROP_PARAM_KEYS.height] = kept.height;
	if (kept.rotation) next[CROP_PARAM_KEYS.rotation] = kept.rotation;
	return next;
}

/** The source size after the crop (pixels): what the clip is fitted to the canvas by. */
export function croppedSize(width: number, height: number, crop: CropRect | null): { width: number; height: number } {
	if (!crop) return { width, height };
	return { width: Math.max(1, width * crop.width), height: Math.max(1, height * crop.height) };
}

/**
 * The biggest crop of a ratio (width ÷ height, in pixels) centred on `around` inside a source of `sourceWidth` ×
 * `sourceHeight` — what a ratio button of the Crop window sets.
 */
export function cropForRatio({
	ratio,
	sourceWidth,
	sourceHeight,
	around,
}: {
	ratio: number;
	sourceWidth: number;
	sourceHeight: number;
	around?: CropRect;
}): CropRect {
	const sourceRatio = sourceWidth / sourceHeight;
	const width = ratio >= sourceRatio ? 1 : ratio / sourceRatio;
	const height = ratio >= sourceRatio ? sourceRatio / ratio : 1;
	const cx = around ? around.x + around.width / 2 : 0.5;
	const cy = around ? around.y + around.height / 2 : 0.5;
	return normalizeCrop({ x: cx - width / 2, y: cy - height / 2, width, height });
}
