// Colour arithmetic for the themes (night 11–12.11): WCAG contrast, laying a translucent colour over another, and OKLCH
// to move a colour's lightness without changing its hue — how an accent of any colour is made readable on any theme.
// Pure functions, no DOM: the engine runs on the server (the boot script's default) and in the page.

export type RGB = { r: number; g: number; b: number };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function parseHex(hex: string): RGB {
	let h = hex.trim().replace(/^#/, "");
	if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join("");
	const n = Number.parseInt(h.slice(0, 6), 16);
	if (!/^[0-9a-f]{6}/i.test(h) || !Number.isFinite(n)) return { r: 0, g: 0, b: 0 };
	return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function isHex(value: unknown): value is string {
	return typeof value === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

export function toHex({ r, g, b }: RGB): string {
	const h = (x: number) => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, "0");
	return `#${h(r)}${h(g)}${h(b)}`;
}

/** `r g b` for the app's `rgb(var(--x) / a)` variables. */
export function triplet(hex: string): string {
	const { r, g, b } = parseHex(hex);
	return `${r} ${g} ${b}`;
}

export function rgba(hex: string, alpha: number): string {
	const { r, g, b } = parseHex(hex);
	return `rgb(${r} ${g} ${b} / ${Math.round(clamp(alpha, 0, 1) * 1000) / 1000})`;
}

/** `top` at `alpha` laid over the opaque `under`. */
export function over(top: string, alpha: number, under: string): string {
	const a = parseHex(top);
	const b = parseHex(under);
	const t = clamp(alpha, 0, 1);
	return toHex({ r: a.r * t + b.r * (1 - t), g: a.g * t + b.g * (1 - t), b: a.b * t + b.b * (1 - t) });
}

const lin = (c: number) => {
	const s = c / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2.x relative luminance. */
export function luminance(hex: string): number {
	const { r, g, b } = parseHex(hex);
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: string, b: string): number {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---- OKLab / OKLCH (Björn Ottosson's matrices)
type LCH = { l: number; c: number; h: number };

export function toOklch(hex: string): LCH {
	const { r, g, b } = parseHex(hex);
	const R = lin(r);
	const G = lin(g);
	const B = lin(b);
	const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
	const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
	const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	const c = Math.hypot(A, Bb);
	let h = (Math.atan2(Bb, A) * 180) / Math.PI;
	if (h < 0) h += 360;
	return { l: L, c, h };
}

const gam = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

function oklchToRgbRaw({ l, c, h }: LCH): { r: number; g: number; b: number } {
	const a = c * Math.cos((h * Math.PI) / 180);
	const b = c * Math.sin((h * Math.PI) / 180);
	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return {
		r: 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
		g: -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
		b: -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
	};
}

/** OKLCH → hex; a colour outside sRGB loses chroma until it fits (the hue and the lightness stay). */
export function fromOklch(lch: LCH): string {
	const l = clamp(lch.l, 0, 1);
	let c = Math.max(0, lch.c);
	for (let i = 0; i < 24; i++) {
		const { r, g, b } = oklchToRgbRaw({ l, c, h: lch.h });
		if ([r, g, b].every((x) => x >= -0.0005 && x <= 1.0005)) break;
		c *= 0.88;
	}
	const { r, g, b } = oklchToRgbRaw({ l, c, h: lch.h });
	return toHex({ r: gam(clamp(r, 0, 1)) * 255, g: gam(clamp(g, 0, 1)) * 255, b: gam(clamp(b, 0, 1)) * 255 });
}

/** The same colour, lighter (+) or darker (−) in OKLCH lightness. */
export function shiftL(hex: string, dl: number): string {
	const lch = toOklch(hex);
	return fromOklch({ ...lch, l: lch.l + dl });
}

/** Mixes `hex` towards `toward` by `t` in OKLab, keeping `hex`'s lightness: a tint that never changes contrast much. */
export function tintKeepL(hex: string, toward: string, t: number): string {
	if (t <= 0) return hex;
	const a = toOklch(hex);
	const b = toOklch(toward);
	const ax = a.c * Math.cos((a.h * Math.PI) / 180);
	const ay = a.c * Math.sin((a.h * Math.PI) / 180);
	const bx = b.c * Math.cos((b.h * Math.PI) / 180);
	const by = b.c * Math.sin((b.h * Math.PI) / 180);
	const x = ax + (bx - ax) * t;
	const y = ay + (by - ay) * t;
	let h = (Math.atan2(y, x) * 180) / Math.PI;
	if (h < 0) h += 360;
	return fromOklch({ l: a.l, c: Math.hypot(x, y), h });
}

/** The lowest contrast of `fg` against every colour of `bgs`. */
export function minContrast(fg: string, bgs: string[]): number {
	return Math.min(...bgs.map((b) => contrast(fg, b)));
}

/**
 * Moves `hex`'s lightness (hue and chroma kept) the shortest way until it has `min` contrast against every colour of `bgs`:
 * lighter on dark surfaces, darker on light ones. Gives the nearest colour that passes, or the extreme it reached.
 */
export function ensureContrast(hex: string, bgs: string[], min: number, dir?: 1 | -1): string {
	if (minContrast(hex, bgs) >= min) return hex;
	const lch = toOklch(hex);
	const darkBg = bgs.reduce((s, b) => s + luminance(b), 0) / bgs.length < 0.18;
	const d = dir ?? (darkBg ? 1 : -1);
	let lo = 0;
	let hi = d > 0 ? 1 - lch.l : lch.l;
	const at = (t: number) => fromOklch({ ...lch, l: lch.l + d * t });
	if (minContrast(at(hi), bgs) < min) return d > 0 ? (minContrast("#ffffff", bgs) >= min ? "#ffffff" : at(hi)) : at(hi);
	for (let i = 0; i < 22; i++) {
		const mid = (lo + hi) / 2;
		if (minContrast(at(mid), bgs) >= min) hi = mid;
		else lo = mid;
	}
	return at(hi);
}

/**
 * A colour drawn at `alpha` (a focus ring at 50 %) that keeps `min` contrast against every surface it can sit on, after
 * being laid over it. Searches the lightness like `ensureContrast`.
 */
export function ensureContrastAt(hex: string, alpha: number, bgs: string[], min: number): string {
	const ok = (c: string) => bgs.every((b) => contrast(over(c, alpha, b), b) >= min);
	if (ok(hex)) return hex;
	const lch = toOklch(hex);
	const darkBg = bgs.reduce((s, b) => s + luminance(b), 0) / bgs.length < 0.18;
	const d = darkBg ? 1 : -1;
	const at = (t: number) => fromOklch({ ...lch, l: lch.l + d * t });
	let lo = 0;
	let hi = d > 0 ? 1 - lch.l : lch.l;
	if (!ok(at(hi))) return darkBg ? "#ffffff" : "#000000";
	for (let i = 0; i < 22; i++) {
		const mid = (lo + hi) / 2;
		if (ok(at(mid))) hi = mid;
		else lo = mid;
	}
	return at(hi);
}

// ---- CIELAB lightness: the unit of the surface rules S1–S4 (docs/DESIGN.md §1)
/** L* (CIELAB, D65), 0–100. */
export function labL(hex: string): number {
	const { r, g, b } = parseHex(hex);
	const Y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
	return Y > 216 / 24389 ? 116 * Math.cbrt(Y) - 16 : (24389 / 27) * Y;
}

/**
 * `hex` moved the least in lightness, towards `dir` (+1 lighter, −1 darker), until it is at least `min` L* away from
 * every colour of `refs` (hue and chroma kept; the other side when that one has no room). Already far enough → `hex` itself: a look whose numbers hold is not touched.
 */
export function ensureDeltaL(hex: string, refs: string[], min: number, dir: 1 | -1): string {
	const ok = (c: string) => refs.every((r) => Math.abs(labL(c) - labL(r)) >= min);
	if (ok(hex)) return hex;
	const lch = toOklch(hex);
	// the given side first; when it runs out of room (white, black), the other side
	for (const d of [dir, -dir]) {
		for (let t = 0.002; t <= 0.6 && lch.l + d * t >= 0 && lch.l + d * t <= 1; t += 0.002) {
			const c = fromOklch({ ...lch, l: lch.l + d * t });
			if (ok(c)) return c;
		}
	}
	return hex;
}

/** Which side of `ref` `hex` lies on in lightness (+1 lighter, −1 darker; equal → `fallback`). */
export const sideOf = (hex: string, ref: string, fallback: 1 | -1): 1 | -1 => {
	const d = labL(hex) - labL(ref);
	return Math.abs(d) < 0.05 ? fallback : d > 0 ? 1 : -1;
};

// ---- APCA lightness contrast (docs/DESIGN.md T2: body |Lc| ≥ 75, secondary ≥ 60) — the formula of the design linter
/** |Lc| of text `fg` on `bg` (APCA 0.0.98G-4g constants), 0–108. */
export function apca(fg: string, bg: string): number {
	// biome-ignore lint/suspicious/noApproximativeNumericConstant: APCA's own exponent (1.414), not √2
	const clamp = (y: number) => (y > 0.022 ? y : y + (0.022 - y) ** 1.414);
	const yt = clamp(luminance(fg));
	const yb = clamp(luminance(bg));
	if (Math.abs(yb - yt) < 0.0005) return 0;
	const sc = yb > yt ? (yb ** 0.56 - yt ** 0.57) * 1.14 : (yb ** 0.65 - yt ** 0.62) * 1.14;
	return Math.abs(sc) < 0.1 ? 0 : (Math.abs(sc) - 0.027) * 100;
}

/** The colour nearest `hex` (OKLCH lightness only, away from the backgrounds) whose |Lc| is ≥ `min` on every bg. */
export function ensureApca(hex: string, bgs: string[], min: number): string {
	const ok = (c: string) => bgs.every((b) => apca(c, b) >= min);
	if (ok(hex)) return hex;
	const lch = toOklch(hex);
	const darkBg = bgs.reduce((s, b) => s + luminance(b), 0) / bgs.length < 0.18;
	const d = darkBg ? 1 : -1;
	const at = (t: number) => fromOklch({ ...lch, l: lch.l + d * t });
	let lo = 0;
	let hi = d > 0 ? 1 - lch.l : lch.l;
	if (!ok(at(hi))) return at(hi);
	for (let i = 0; i < 22; i++) {
		const mid = (lo + hi) / 2;
		if (ok(at(mid))) hi = mid;
		else lo = mid;
	}
	return at(hi);
}
