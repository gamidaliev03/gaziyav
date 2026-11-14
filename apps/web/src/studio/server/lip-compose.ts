// The composite back (rule «we control what leaves the Mac»): from the provider's answer only the face region is
// taken — the face box grown and feathered — and laid over OUR frame; outside the region every byte is the source's.
// Pure functions on planar YUV 4:2:0 frames (what ffmpeg decodes to): the stitch in lip-media.ts and the unit tests
// use the same code.

export type Box = [number, number, number, number]; // x, y, w, h in pixels, top-left origin

/** One frame's face, as lipmarks reports it (null: no face, or no lips seen). */
export interface FaceMark {
	box: Box;
	conf?: number;
	yaw?: number;
}

export interface MaskRules {
	/** Grown by this share of the box width on each side… */
	side: number;
	/** …of the box height above and below (the jaw moves down when the mouth opens). */
	top: number;
	bottom: number;
	/** The soft edge, as a share of the grown width (alpha 0 → 1 over it, inside the grown box). */
	feather: number;
	/** Below this landmark confidence a frame's box is not trusted. */
	minConf: number;
	/** A box whose size or centre jumps more than this share of the smoothed one is not trusted. */
	jump: number;
}

export const MASK_RULES: MaskRules = { side: 0.12, top: 0.06, bottom: 0.22, feather: 0.12, minConf: 0.3, jump: 0.35 };

export interface Mask {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	/** Feather width in pixels. */
	f: number;
}

/** The region of a frame taken from the answer: the box grown, clipped to the frame, on even pixels (4:2:0). */
export function maskOf(box: Box, width: number, height: number, r: MaskRules = MASK_RULES): Mask {
	const [x, y, w, h] = box;
	const even = (v: number, up: boolean) => (up ? Math.ceil(v / 2) * 2 : Math.floor(v / 2) * 2);
	const x0 = Math.max(0, even(x - w * r.side, false));
	const x1 = Math.min(width, even(x + w + w * r.side, true));
	const y0 = Math.max(0, even(y - h * r.top, false));
	const y1 = Math.min(height, even(y + h + h * r.bottom, true));
	return { x0, y0, x1, y1, f: Math.max(2, Math.round((x1 - x0) * r.feather)) };
}

/** 0…1 across the soft edge (a raised cosine: no visible step). */
function ramp(d: number, f: number): number {
	if (d >= f) return 1;
	if (d <= 0) return 0;
	return 0.5 - 0.5 * Math.cos((Math.PI * d) / f);
}

/** The mask's weight at a pixel (0 outside the grown box). */
export function alphaAt(m: Mask, px: number, py: number): number {
	if (px < m.x0 || px >= m.x1 || py < m.y0 || py >= m.y1) return 0;
	const d = Math.min(px - m.x0 + 0.5, m.x1 - px - 0.5, py - m.y0 + 0.5, m.y1 - py - 0.5);
	return ramp(d, m.f);
}

/**
 * `out` = the base frame with the answer laid over it inside the mask (in place on `out`, which holds a copy of the
 * base). Planar YUV 4:2:0, `width`×`height` even. Returns the number of luma pixels that took any of the answer.
 */
export function blendFace(out: Uint8Array, answer: Uint8Array, width: number, height: number, m: Mask): number {
	let touched = 0;
	const cw = width >> 1;
	const ch = height >> 1;
	const ySize = width * height;
	const cSize = cw * ch;
	for (let y = m.y0; y < m.y1; y++) {
		const row = y * width;
		for (let x = m.x0; x < m.x1; x++) {
			const a = alphaAt(m, x, y);
			if (a <= 0) continue;
			const i = row + x;
			out[i] = a >= 1 ? answer[i] : Math.round(out[i] + (answer[i] - out[i]) * a);
			touched++;
		}
	}
	for (let y = m.y0 >> 1; y < Math.min(ch, m.y1 >> 1); y++) {
		for (let x = m.x0 >> 1; x < Math.min(cw, m.x1 >> 1); x++) {
			// the chroma sample sits between four luma pixels: their mean weight
			const a = (alphaAt(m, 2 * x, 2 * y) + alphaAt(m, 2 * x + 1, 2 * y) + alphaAt(m, 2 * x, 2 * y + 1) + alphaAt(m, 2 * x + 1, 2 * y + 1)) / 4;
			if (a <= 0) continue;
			for (const plane of [ySize, ySize + cSize]) {
				const i = plane + y * cw + x;
				out[i] = a >= 1 ? answer[i] : Math.round(out[i] + (answer[i] - out[i]) * a);
			}
		}
	}
	return touched;
}

/**
 * The face box of every frame of a piece, smoothed over ±`half` frames, or null where it is not trustworthy (no face,
 * low confidence, a jump against its neighbours): such a frame takes the provider's whole frame.
 */
export function trustedBoxes(marks: Array<FaceMark | null>, r: MaskRules = MASK_RULES, half = 2): Array<Box | null> {
	const ok = marks.map((m) => (m && m.box[2] > 4 && m.box[3] > 4 && (m.conf == null || m.conf >= r.minConf) ? m.box : null));
	const out: Array<Box | null> = [];
	for (let i = 0; i < ok.length; i++) {
		const b = ok[i];
		if (!b) {
			out.push(null);
			continue;
		}
		const near = ok.slice(Math.max(0, i - half), i + half + 1).filter((x): x is Box => !!x);
		const med = (k: number) => near.map((x) => x[k]).sort((p, q) => p - q)[near.length >> 1];
		const cx = med(0) + med(2) / 2;
		const cy = med(1) + med(3) / 2;
		const w = med(2);
		const h = med(3);
		const jumped = Math.abs(b[2] - w) > r.jump * w || Math.abs(b[0] + b[2] / 2 - cx) > r.jump * w || Math.abs(b[1] + b[3] / 2 - cy) > r.jump * h;
		// the smoothed box (the median of its neighbours: no shimmer of the edge from frame to frame)
		out.push(jumped ? null : [cx - w / 2, cy - h / 2, w, h]);
	}
	return out;
}
