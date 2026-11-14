// Kadr's autoColor maths (pure): frame statistics → our Color effect's slider values.
import type { ParamValues } from "@/params";

export interface ColorStats {
	p1: number;
	p50: number;
	p99: number;
	/** Average linear-light R, G, B of the mid-tones (luma 0.25–0.92), or null when too few. */
	mid: [number, number, number] | null;
	/** Mean of max(r,g,b) − min(r,g,b). */
	chroma: number;
}

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** Stats of RGBA pixels (any number of frames concatenated). */
export function colorStats(px: Uint8ClampedArray | Uint8Array): ColorStats {
	const lum: number[] = [];
	let rs = 0;
	let gs = 0;
	let bs = 0;
	let nMid = 0;
	let chroma = 0;
	for (let i = 0; i + 3 < px.length; i += 4) {
		const r = px[i] / 255;
		const g = px[i + 1] / 255;
		const b = px[i + 2] / 255;
		const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		lum.push(y);
		chroma += Math.max(r, g, b) - Math.min(r, g, b);
		if (y > 0.25 && y < 0.92) {
			rs += lin(r);
			gs += lin(g);
			bs += lin(b);
			nMid++;
		}
	}
	if (!lum.length) return { p1: 0, p50: 0.42, p99: 1, mid: null, chroma: 0.2 };
	lum.sort((a, b) => a - b);
	const at = (q: number) => lum[Math.min(lum.length - 1, Math.floor(lum.length * q))];
	return {
		p1: at(0.01),
		p50: at(0.5),
		p99: at(0.99),
		mid: nMid > 10 ? [rs / nMid, gs / nMid, bs / nMid] : null,
		chroma: chroma / lum.length,
	};
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(2));

/**
 * Kadr's formulas, in the units of our Color effect (exposure in stops; the rest −100…100):
 * - contrast: Kadr's multiplier 0.85 / (p99 − p1) in 0.85…1.25 → (k − 1) × 100;
 * - exposure: Kadr moves the median 70 % of the way to 0.42 (log2(0.42 / median) × 0.7). Our shader scales linear
 *   light and then applies contrast around 0.5, so the same aim is solved for that: the exposure that puts the
 *   median where the contrast step then takes it to 0.42, 70 % of the way, ±1.5 stops;
 * - temperature/tint: Kadr warms a blue cast / pulls a green one to magenta; here the same intent is solved
 *   for our shader (R×(1+0.3t), B×(1−0.3t), G×(1−0.25k) in linear light), 70 % of the way to neutral grey
 *   (a full grey-world correction kills genuine colour such as a sunset), capped at ±60 / ±40;
 * - vibrance 25 / 12 / 0 for flat / muted / colourful footage (Kadr's 0.25 / 0.12 / 0) — none while a colour cast
 *   remains after the white balance (vibrance would boost the cast).
 */
export function autoColorParams(s: ColorStats): ParamValues {
	const k = clamp(0.85 / Math.max(s.p99 - s.p1, 0.2), 0.85, 1.25);
	const aim = 0.5 + (0.42 - 0.5) / k;
	const exposure = clamp(Math.log2(lin(aim) / lin(Math.max(s.p50, 0.02))) * 0.7, -1.5, 1.5);
	const out: ParamValues = {
		exposure: round(exposure, 0.05),
		contrast: Math.round((k - 1) * 100),
		temperature: 0,
		tint: 0,
		vibrance: s.chroma < 0.12 ? 25 : s.chroma < 0.2 ? 12 : 0,
	};
	if (s.mid) {
		const [r, g, b] = s.mid;
		const STRENGTH = 0.7;
		if (r + b > 1e-4) out.temperature = Math.round(clamp(((b - r) / (0.3 * (r + b))) * 100 * STRENGTH, -60, 60));
		// Tint after the temperature change (the shader applies both at once to the same pixel).
		const t = Number(out.temperature) / 100;
		const r2 = r * (1 + 0.3 * t);
		const b2 = b * (1 - 0.3 * t);
		if (g > 1e-4) out.tint = Math.round(clamp(((1 - (r2 + b2) / (2 * g)) / 0.25) * 100 * STRENGTH, -40, 40));
		const g2 = g * (1 - 0.25 * (Number(out.tint) / 100));
		const mean = (r2 + g2 + b2) / 3;
		const residual = mean > 1e-4 ? (Math.max(r2, g2, b2) - Math.min(r2, g2, b2)) / mean : 0;
		if (residual > 0.12) out.vibrance = 0;
	}
	// −0 → 0 (cleaner sliders)
	for (const key of Object.keys(out)) if (out[key] === 0) out[key] = 0;
	return out;
}
