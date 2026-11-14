// Colour maths of the generators: parsing the inspector's colours, OKLab (perceptual ramps without the grey middle of
// an sRGB blend), and the static dither that keeps an 8-bit ramp free of bands in the export.

export interface Rgba {
	/** sRGB 0..1 */
	r: number;
	g: number;
	b: number;
	/** 0..1 */
	a: number;
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(); anything else is opaque black. */
export function parseColor(value: unknown): Rgba {
	const s = String(value ?? "").trim();
	const m = HEX.exec(s);
	if (m) {
		let h = m[1];
		if (h.length <= 4) h = [...h].map((c) => c + c).join("");
		const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
		return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
	}
	const f = /^rgba?\(([^)]+)\)$/i.exec(s);
	if (f) {
		const parts = f[1].split(/[\s,/]+/).filter(Boolean).map(Number);
		if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
			const a = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1;
			return { r: clamp01(parts[0] / 255), g: clamp01(parts[1] / 255), b: clamp01(parts[2] / 255), a: clamp01(a) };
		}
	}
	return { r: 0, g: 0, b: 0, a: 1 };
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const hex2 = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0");
export function formatColor(c: Rgba): string {
	const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
	return c.a >= 1 ? base : `${base}${hex2(c.a)}`;
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);

export interface Oklab {
	L: number;
	A: number;
	B: number;
	alpha: number;
}

export function rgbaToOklab(c: Rgba): Oklab {
	const r = toLinear(c.r);
	const g = toLinear(c.g);
	const b = toLinear(c.b);
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return {
		L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		A: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		B: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
		alpha: c.a,
	};
}

export function oklabToRgba(c: Oklab): Rgba {
	const l = (c.L + 0.3963377774 * c.A + 0.2158037573 * c.B) ** 3;
	const m = (c.L - 0.1055613458 * c.A - 0.0638541728 * c.B) ** 3;
	const s = (c.L - 0.0894841775 * c.A - 1.291485548 * c.B) ** 3;
	return {
		r: clamp01(toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
		g: clamp01(toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
		b: clamp01(toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
		a: clamp01(c.alpha),
	};
}

/**
 * 64×64 interleaved-gradient noise in −1…1 LSB (Jimenez 2014): static, so it never flickers and a still costs no
 * bitrate frame to frame. ±½ LSB is not enough: the middle of an 8-bit band would still round to one flat value.
 */
export const DITHER_SIZE = 64;
export const DITHER: Float32Array = (() => {
	const t = new Float32Array(DITHER_SIZE * DITHER_SIZE);
	for (let y = 0; y < DITHER_SIZE; y++) {
		for (let x = 0; x < DITHER_SIZE; x++) {
			const f = 52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1);
			t[y * DITHER_SIZE + x] = 2 * (f % 1) - 1;
		}
	}
	return t;
})();
