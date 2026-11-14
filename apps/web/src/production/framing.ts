// How a picture sits in the frame: full-bleed (cover) by default, zoomed by a punch-in on a focus point; a wide shot of a
// close face in a narrow frame (a 16:9 close-up in a 9:16 reel) sits framed in the middle instead, on the look's plate
// colour (the project background), so the face is never cut by the frame and the picture is not blown up. Pure: compile (the build)
// and review (the fixes) use the same numbers.

type Size = { width?: number; height?: number };
type Canvas = { width: number; height: number };
export type Box = [number, number, number, number];

/** A face over this share of the frame width at full bleed is too wide for the frame: the picture is framed instead. */
export const FRAMED_FACE_SHARE = 0.72;
/** The face's share of the frame width in a framed picture (a comfortable close-up). */
const FRAMED_FACE_TARGET = 0.5;

const dims = (src: Size, canvas: Canvas) => {
	const sw = src.width || canvas.width;
	const sh = src.height || canvas.height;
	const contain = Math.min(canvas.width / sw, canvas.height / sh);
	const cover = Math.max(canvas.width / sw, canvas.height / sh);
	return { sw, sh, contain, cover };
};

/**
 * The share of full bleed (cover) a source is shown at: 1 (fills the frame) unless the source is wider than the frame
 * and its face would take more than {@link FRAMED_FACE_SHARE} of the frame width at full bleed; then the picture is
 * scaled down until the face takes half the width (never below fitting the whole picture in).
 */
export function framingOf(src: Size, canvas: Canvas, faceBox?: Box | null): number {
	if (!faceBox) return 1;
	const { sw, sh, contain, cover } = dims(src, canvas);
	if (sw / sh <= (canvas.width / canvas.height) * 1.2) return 1;
	const faceShare = (faceBox[2] * sw * cover) / canvas.width;
	if (faceShare <= FRAMED_FACE_SHARE) return 1;
	return Math.round(Math.max(contain / cover, FRAMED_FACE_TARGET / faceShare) * 1000) / 1000;
}

/** The largest punch-in that keeps a face inside the frame with a 3 % margin each side (≥ 1). */
export function facePunchLimit(src: Size, canvas: Canvas, faceBox?: Box | null, base = 1): number {
	if (!faceBox) return Number.POSITIVE_INFINITY;
	const { sw, sh, cover } = dims(src, canvas);
	const wShare = (faceBox[2] * sw * cover * base) / canvas.width;
	const hShare = (faceBox[3] * sh * cover * base) / canvas.height;
	const limit = 0.94 / Math.max(wShare, hShare, 0.01);
	return Math.max(1, Math.round(limit * 1000) / 1000);
}

/**
 * Scale and position for a source of another shape: `base` × full bleed (cover, see {@link framingOf}), zoomed by
 * `punch` on `focus` (0…1 of the source), kept inside the frame; a picture shorter or narrower than the frame stays
 * centred on that axis. `upscale` = how much the source's pixels are enlarged.
 */
export function coverTransform(src: Size, canvas: Canvas, punch = 1, focus?: [number, number], base = 1): { scale: number; x: number; y: number; upscale: number } {
	const { sw, sh, contain, cover } = dims(src, canvas);
	const fill = (cover / contain) * base;
	const scale = fill * punch;
	const dw = sw * contain * scale;
	const dh = sh * contain * scale;
	const [fx, fy] = focus ?? [0.5, 0.5];
	// Keep the focus where a centred fill would show it, then stay inside the frame.
	const d0w = sw * contain * fill;
	const d0h = sh * contain * fill;
	const clamp = (v: number, room: number) => (room <= 0 ? 0 : Math.max(-room, Math.min(room, v)));
	const wantX = (0.5 - fx) * (dw - d0w) + (fill > 1.01 && sw / sh > canvas.width / canvas.height ? (0.5 - fx) * d0w * 0.9 : 0);
	const wantY = (0.5 - fy) * (dh - d0h) + (fill > 1.01 && sh / sw > canvas.height / canvas.width ? (0.5 - fy) * d0h * 0.6 : 0);
	return {
		scale: Math.round(scale * 1000) / 1000,
		x: Math.round(clamp(wantX, (dw - canvas.width) / 2)),
		y: Math.round(clamp(wantY, (dh - canvas.height) / 2)),
		upscale: Math.round(cover * base * punch * 100) / 100,
	};
}

/** The centre of a box (0…1), for a focus point. */
export const centreOf = (b?: Box | null): [number, number] | undefined => (b ? [b[0] + b[2] / 2, b[1] + b[3] / 2] : undefined);
