// Designer grades for the Filters browser: one grading pipeline (exposure, white balance, per-channel gamma, hue
// moves, saturation with skin protection, a filmic contrast curve with a soft shoulder, split toning, fade) and
// ~95 presets on it — cinema, film stocks, eras, moods, food / travel / wedding, night, mono. Our own formulas
// (no third-party LUTs). Each is baked into a 33³ cube like the other looks; the Look intensity slider mixes it in.

type RGB = [number, number, number];

export interface Grade {
	/** Stops. */
	exposure?: number;
	/** −1 … 1: an S-curve around the pivot (negative flattens). */
	contrast?: number;
	pivot?: number;
	/** Lifted blacks (a faded print), 0 … 0.2. */
	fade?: number;
	/** Crushed blacks, 0 … 0.1. */
	crush?: number;
	/** Highlights roll off softly above this level (no clipped skies), default 0.78. */
	knee?: number;
	/** −1 cool … 1 warm. */
	temp?: number;
	/** −1 green … 1 magenta. */
	tint?: number;
	gamma?: RGB;
	sat?: number;
	/** Lifts the dull colours more than the vivid ones. */
	vib?: number;
	shadows?: RGB;
	mids?: RGB;
	highs?: RGB;
	/** Hue moves: [centre°, width°, shift°]. */
	hue?: Array<[number, number, number]>;
	/** Saturation per hue: [centre°, width°, ×]. */
	satAt?: Array<[number, number, number]>;
	/** Monochrome: the channel mix; the toning comes from shadows / highs. */
	mono?: RGB;
	/** Bleach bypass, 0 … 1. */
	bleach?: number;
	/** Cross-processed slide film, 0 … 1. */
	cross?: number;
	/** Day for night, 0 … 1. */
	night?: number;
	/** How much skin keeps its own colour (0 … 1, default 0.6): faces stay natural under strong tints. */
	skin?: number;
}

export interface GradeLook {
	id: string;
	name: string;
	category: string;
	/** What the preview shows it on (wedding, food, city night, nature, portrait …). */
	theme: string;
	fn: (c: RGB) => RGB;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function rgbToHsv([r, g, b]: RGB): RGB {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	let h = 0;
	if (d > 1e-6) {
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return [h, max <= 0 ? 0 : d / max, max];
}

function hsvToRgb([h, s, v]: RGB): RGB {
	const c = v * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = v - c;
	const k = Math.floor(h / 60) % 6;
	const [r, g, b] = k === 0 ? [c, x, 0] : k === 1 ? [x, c, 0] : k === 2 ? [0, c, x] : k === 3 ? [0, x, c] : k === 4 ? [x, 0, c] : [c, 0, x];
	return [r + m, g + m, b + m];
}

const hueDistance = (a: number, b: number) => {
	const d = Math.abs(a - b) % 360;
	return d > 180 ? 360 - d : d;
};
const band = (h: number, centre: number, width: number) => {
	const d = hueDistance(h, centre) / Math.max(width, 1);
	return d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d);
};

/** Skin: orange-red hues, moderate saturation, not too dark. */
function skinWeight(c: RGB): number {
	const [h, s, v] = rgbToHsv(c);
	return band(h, 25, 25) * clamp01((s - 0.08) / 0.12) * clamp01((0.75 - s) / 0.2) * clamp01((v - 0.18) / 0.15);
}

/** A filmic S-curve around the pivot; amount −1 … 1. */
function contrastCurve(x: number, amount: number, pivot: number): number {
	if (amount === 0) return x;
	const k = 1 + Math.abs(amount) * 6;
	const lo = 1 / (1 + Math.exp(-k * (0 - pivot)));
	const hi = 1 / (1 + Math.exp(-k * (1 - pivot)));
	const s = (1 / (1 + Math.exp(-k * (x - pivot))) - lo) / (hi - lo);
	return amount > 0 ? mix(x, s, amount) : mix(x, pivot + (x - pivot) * (1 + amount * 0.6), 1);
}

/**
 * Soft shoulder above the knee: the highlights roll toward white and reach it only at 1.3 (a value pushed past
 * white by exposure or a warm tint), so skies, walls and lit skin keep their detail instead of clipping.
 */
const SHOULDER_TOP = 1.3;
const SHOULDER_K = 1.4;
function shoulder(v: number, knee: number): number {
	if (v <= knee) return v;
	const room = 1 - knee;
	const t = (v - knee) / room;
	const top = (SHOULDER_TOP - knee) / room;
	if (t >= top) return 1;
	return knee + (room * (1 - Math.exp(-SHOULDER_K * t))) / (1 - Math.exp(-SHOULDER_K * top));
}

// Channel by channel in plain numbers (no arrays per step): a 33³ look table is ~36 000 calls when a look is applied,
// and the array version took 30–50 ms of it. The same operations in the same order, so the same numbers.
function tone(r: number, gr: number, b: number, g: Grade): RGB {
	const pivot = g.pivot ?? 0.45;
	const amount = g.contrast ?? 0;
	// The curve works on 0 … 1; what a channel has past white is carried over to the shoulder below (clamping it
	// here first made a bright red and a bright green equal — a lit face went yellow).
	let o0 = contrastCurve(clamp01(r), amount, pivot) + Math.max(0, r - 1);
	let o1 = contrastCurve(clamp01(gr), amount, pivot) + Math.max(0, gr - 1);
	let o2 = contrastCurve(clamp01(b), amount, pivot) + Math.max(0, b - 1);
	const crush = g.crush ?? 0;
	if (crush > 0) {
		o0 = Math.max(0, (o0 - crush) / (1 - crush));
		o1 = Math.max(0, (o1 - crush) / (1 - crush));
		o2 = Math.max(0, (o2 - crush) / (1 - crush));
	}
	const fade = g.fade ?? 0;
	if (fade > 0) {
		o0 = fade + o0 * (1 - fade * 0.6);
		o1 = fade + o1 * (1 - fade * 0.6);
		o2 = fade + o2 * (1 - fade * 0.6);
	}
	// The shoulder on the brightness, the channels scaled together: a lit face keeps its hue (per channel, red and
	// green met at the top and skin went yellow). What still passes 1 is eased toward its grey, not clipped.
	const knee = g.knee ?? 0.78;
	const y = 0.2126 * o0 + 0.7152 * o1 + 0.0722 * o2;
	if (y > 1e-4) {
		const k = shoulder(y, knee) / y;
		o0 = o0 * k;
		o1 = o1 * k;
		o2 = o2 * k;
	}
	const top = Math.max(o0, o1, o2);
	if (top > 1) {
		const y2 = 0.2126 * o0 + 0.7152 * o1 + 0.0722 * o2;
		const t = y2 >= 1 ? 1 : (top - 1) / (top - y2);
		o0 = o0 + (y2 - o0) * t;
		o1 = o1 + (y2 - o1) * t;
		o2 = o2 + (y2 - o2) * t;
	}
	const channelKnee = knee + (1 - knee) * 0.5;
	return [shoulder(o0, channelKnee), shoulder(o1, channelKnee), shoulder(o2, channelKnee)];
}

export function applyGrade(input: RGB, g: Grade): RGB {
	const ex = 2 ** (g.exposure ?? 0);
	let c0 = input[0] * ex;
	let c1 = input[1] * ex;
	let c2 = input[2] * ex;
	// white balance
	const t = g.temp ?? 0;
	const ti = g.tint ?? 0;
	c0 = c0 * (1 + 0.09 * t) * (1 + 0.03 * ti);
	c1 = c1 * (1 - 0.06 * ti);
	c2 = c2 * (1 - 0.11 * t) * (1 + 0.03 * ti);
	if (g.gamma) {
		c0 = clamp01(c0) ** g.gamma[0];
		c1 = clamp01(c1) ** g.gamma[1];
		c2 = clamp01(c2) ** g.gamma[2];
	}
	// hue moves and saturation per hue
	if (g.hue?.length || g.satAt?.length) {
		let [h, s, v] = rgbToHsv([clamp01(c0), clamp01(c1), clamp01(c2)]);
		for (const [centre, width, shift] of g.hue ?? []) h = (h + shift * band(h, centre, width) + 360) % 360;
		for (const [centre, width, k] of g.satAt ?? []) s = clamp01(s * mix(1, k, band(h, centre, width)));
		[c0, c1, c2] = hsvToRgb([h, s, v]);
	}
	// saturation and vibrance (s0: rgbToHsv's saturation of the clamped colour)
	const y0 = 0.2126 * c0 + 0.7152 * c1 + 0.0722 * c2;
	const sat = g.sat ?? 1;
	const k0 = clamp01(c0);
	const k1 = clamp01(c1);
	const k2 = clamp01(c2);
	const max0 = Math.max(k0, k1, k2);
	const s0 = max0 <= 0 ? 0 : (max0 - Math.min(k0, k1, k2)) / max0;
	const vib = 1 + (g.vib ?? 0) * (1 - s0);
	c0 = y0 + (c0 - y0) * sat * vib;
	c1 = y0 + (c1 - y0) * sat * vib;
	c2 = y0 + (c2 - y0) * sat * vib;
	if (g.mono) {
		const m = g.mono;
		const y = clamp01((c0 * m[0] + c1 * m[1] + c2 * m[2]) / (m[0] + m[1] + m[2]));
		c0 = y;
		c1 = y;
		c2 = y;
	}
	if (g.bleach) {
		// the silver left in: a luminance layer laid over the colour (overlay), less saturation
		const y = 0.2126 * c0 + 0.7152 * c1 + 0.0722 * c2;
		const over = (v: number) => (y < 0.5 ? 2 * v * y : 1 - 2 * (1 - v) * (1 - y));
		const o0 = over(c0);
		const o1 = over(c1);
		const o2 = over(c2);
		c0 = mix(c0, mix(y, o0, 0.55), g.bleach);
		c1 = mix(c1, mix(y, o1, 0.55), g.bleach);
		c2 = mix(c2, mix(y, o2, 0.55), g.bleach);
	}
	if (g.cross) {
		const k = g.cross;
		const s = (x: number, a: number) => contrastCurve(clamp01(x), a, 0.5);
		const n0 = mix(c0, s(c0, 0.6), k);
		const n1 = mix(c1, s(c1, 0.35) * 1.03, k);
		const n2 = mix(c2, 0.12 + 0.7 * s(c2, -0.6), k);
		c0 = n0;
		c1 = n1;
		c2 = n2;
	}
	if (g.night) {
		const k = g.night;
		const y = 0.2126 * c0 + 0.7152 * c1 + 0.0722 * c2;
		const n0 = y * 0.45 + c0 * 0.1;
		const n1 = y * 0.6 + c1 * 0.12;
		const n2 = y * 0.9 + c2 * 0.25;
		c0 = mix(c0, n0 * 0.62, k);
		c1 = mix(c1, n1 * 0.62, k);
		c2 = mix(c2, n2 * 0.62, k);
	}
	// split toning by luminance
	if (g.shadows || g.mids || g.highs) {
		const y = clamp01(0.2126 * c0 + 0.7152 * c1 + 0.0722 * c2);
		const ws = (1 - y) ** 2;
		const wh = y ** 2;
		const wm = Math.max(0, 1 - ws - wh);
		const sh = g.shadows ?? [0, 0, 0];
		const md = g.mids ?? [0, 0, 0];
		const hi = g.highs ?? [0, 0, 0];
		c0 = c0 + sh[0] * ws + md[0] * wm + hi[0] * wh;
		c1 = c1 + sh[1] * ws + md[1] * wm + hi[1] * wh;
		c2 = c2 + sh[2] * ws + md[2] * wm + hi[2] * wh;
	}
	const out = tone(c0, c1, c2, g);
	// skin keeps its own colour: back toward the tone-only grade of the input
	const keep = (g.skin ?? 0.6) * skinWeight([clamp01(input[0]), clamp01(input[1]), clamp01(input[2])]);
	if (keep > 0 && !g.mono) {
		const plain = tone(input[0] * ex, input[1] * ex, input[2] * ex, g);
		out[0] = mix(out[0], plain[0], keep * 0.7);
		out[1] = mix(out[1], plain[1], keep * 0.7);
		out[2] = mix(out[2], plain[2], keep * 0.7);
	}
	out[0] = clamp01(out[0]);
	out[1] = clamp01(out[1]);
	out[2] = clamp01(out[2]);
	return out;
}

interface Preset extends Grade {
	id: string;
	name: string;
	category: string;
	theme: string;
}

// Values are tuned on the preview stills: skin checked on a portrait, highlights on a sky.
const PRESETS: Preset[] = [
	// ---- Movies
	{ id: "g.blockbuster", name: "Blockbuster", category: "Movies", theme: "action", contrast: 0.45, temp: 0.1, sat: 1.05, shadows: [-0.05, 0.03, 0.08], highs: [0.07, 0.02, -0.06], skin: 0.75 },
	{ id: "g.tealOrangePro", name: "Teal & Orange Pro", category: "Movies", theme: "city", contrast: 0.35, sat: 1.1, hue: [[200, 60, -10], [35, 30, -5]], shadows: [-0.06, 0.04, 0.09], highs: [0.09, 0.03, -0.07], skin: 0.8 },
	{ id: "g.noir", name: "Noir", category: "Movies", theme: "city-night", mono: [0.35, 0.55, 0.1], contrast: 0.7, crush: 0.05, knee: 0.85 },
	{ id: "g.fincher", name: "Green Thriller", category: "Movies", theme: "city", contrast: 0.3, sat: 0.75, temp: -0.1, tint: -0.35, shadows: [-0.02, 0.05, 0.02], highs: [0.04, 0.05, -0.03], fade: 0.03 },
	{ id: "g.pastelFrame", name: "Pastel Symmetry", category: "Movies", theme: "travel", contrast: -0.2, fade: 0.08, sat: 0.9, temp: 0.15, mids: [0.04, 0.0, 0.03], hue: [[120, 50, -15]], satAt: [[30, 40, 1.15], [200, 50, 0.8]] },
	{ id: "g.neonSciFi", name: "Neon Sci-Fi", category: "Movies", theme: "city-night", contrast: 0.4, sat: 1.25, temp: -0.3, tint: 0.3, shadows: [0.02, -0.02, 0.1], highs: [0.08, -0.02, 0.06], hue: [[30, 40, -20]] },
	{ id: "g.bleachBypass", name: "Bleach Bypass", category: "Movies", theme: "action", bleach: 0.8, contrast: 0.25, sat: 0.85 },
	{ id: "g.dayForNight", name: "Day for Night", category: "Movies", theme: "nature", night: 0.9, contrast: 0.2, crush: 0.02 },
	{ id: "g.desertEpic", name: "Desert Epic", category: "Movies", theme: "travel", contrast: 0.35, temp: 0.45, sat: 0.95, highs: [0.06, 0.03, -0.05], shadows: [0.02, 0.0, -0.02], hue: [[200, 50, 15]] },
	{ id: "g.matrix", name: "Code Green", category: "Movies", theme: "tech", contrast: 0.4, sat: 0.7, tint: -0.7, shadows: [-0.03, 0.04, -0.01], highs: [-0.02, 0.06, 0.0], skin: 0.4 },
	{ id: "g.westernDust", name: "Western Dust", category: "Movies", theme: "travel", contrast: 0.3, temp: 0.55, sat: 0.7, fade: 0.05, highs: [0.07, 0.03, -0.04] },
	{ id: "g.coldWar", name: "Cold Steel", category: "Movies", theme: "city", contrast: 0.35, temp: -0.45, sat: 0.6, shadows: [-0.03, 0.0, 0.05], skin: 0.7 },
	{ id: "g.romance", name: "Romance", category: "Movies", theme: "wedding", contrast: 0.1, temp: 0.25, tint: 0.15, sat: 0.95, fade: 0.04, highs: [0.05, 0.02, 0.01] },
	{ id: "g.horror", name: "Dread", category: "Movies", theme: "city-night", contrast: 0.5, sat: 0.5, temp: -0.2, tint: -0.2, crush: 0.04, shadows: [-0.02, 0.02, 0.03] },
	{ id: "g.superhero", name: "Hero", category: "Movies", theme: "sports", contrast: 0.5, sat: 1.25, vib: 0.3, highs: [0.04, 0.02, -0.03], skin: 0.8 },
	{ id: "g.indie", name: "Indie", category: "Movies", theme: "portrait", contrast: -0.1, fade: 0.06, sat: 0.85, temp: 0.1, mids: [0.02, 0.01, -0.01] },
	// ---- Film stocks (our own takes, not emulations of a brand)
	{ id: "g.landscapeCool", name: "Cool Landscape 100", category: "Film", theme: "nature", contrast: 0.3, temp: -0.15, sat: 1.1, satAt: [[120, 50, 1.15], [210, 50, 1.2]], hue: [[90, 40, 10]] },
	{ id: "g.slide64", name: "Slide 64", category: "Film", theme: "travel", contrast: 0.45, sat: 1.25, crush: 0.03, satAt: [[0, 30, 1.2], [210, 50, 1.15]], highs: [0.02, 0.01, -0.02] },
	{ id: "g.tungsten800", name: "Tungsten 800 Night", category: "Film", theme: "city-night", contrast: 0.3, temp: -0.35, sat: 1.1, highs: [0.1, 0.0, -0.04], shadows: [-0.02, 0.02, 0.06], hue: [[0, 30, 8]] },
	{ id: "g.crossProcess", name: "Cross Process", category: "Film", theme: "fashion", cross: 0.85, sat: 1.1 },
	{ id: "g.expired", name: "Expired Film", category: "Film", theme: "travel", contrast: -0.1, fade: 0.1, temp: 0.2, tint: 0.2, sat: 0.8, shadows: [0.03, 0.0, 0.05], highs: [0.05, 0.04, -0.04] },
	{ id: "g.instant", name: "Instant Print", category: "Film", theme: "kids", contrast: -0.15, fade: 0.09, temp: 0.15, sat: 0.85, mids: [0.02, 0.03, 0.0], highs: [0.04, 0.04, 0.0] },
	{ id: "g.superEight", name: "Super 8", category: "Film", theme: "travel", contrast: 0.2, temp: 0.35, sat: 0.9, fade: 0.07, highs: [0.06, 0.03, -0.03], knee: 0.7 },
	{ id: "g.cineNeg", name: "Cine Negative", category: "Film", theme: "portrait", contrast: -0.05, fade: 0.05, sat: 0.9, shadows: [-0.02, 0.02, 0.04], highs: [0.04, 0.02, -0.01], skin: 0.85 },
	{ id: "g.goldenStock", name: "Gold 200", category: "Film", theme: "travel", contrast: 0.25, temp: 0.4, sat: 1.05, highs: [0.07, 0.04, -0.03], satAt: [[50, 30, 1.2]] },
	{ id: "g.chrome", name: "Chrome", category: "Film", theme: "cars", contrast: 0.4, sat: 0.9, temp: -0.1, highs: [0.02, 0.02, 0.04], satAt: [[0, 40, 1.15], [210, 40, 1.15]] },
	// ---- Eras
	{ id: "g.seventies", name: "70s", category: "Retro", theme: "music", contrast: 0.05, fade: 0.08, temp: 0.4, sat: 0.85, tint: 0.1, shadows: [0.04, 0.02, -0.02], highs: [0.06, 0.04, -0.05], hue: [[120, 60, -20]] },
	{ id: "g.eighties", name: "80s", category: "Retro", theme: "music", contrast: 0.3, sat: 1.2, tint: 0.3, shadows: [0.03, -0.02, 0.08], highs: [0.07, 0.0, 0.05] },
	{ id: "g.camcorder", name: "90s Camcorder", category: "Retro", theme: "kids", contrast: 0.15, sat: 1.1, temp: -0.05, tint: -0.1, fade: 0.05, knee: 0.68, mids: [0.0, 0.02, 0.02] },
	{ id: "g.y2k", name: "Y2K", category: "Retro", theme: "fashion", contrast: 0.2, sat: 1.15, temp: -0.2, tint: 0.25, highs: [0.03, 0.03, 0.08], fade: 0.03 },
	{ id: "g.sixties", name: "60s Print", category: "Retro", theme: "fashion", contrast: 0.1, fade: 0.07, sat: 0.95, temp: 0.2, shadows: [0.0, 0.03, 0.04], satAt: [[0, 30, 1.2]] },
	{ id: "g.vhsColor", name: "VHS Colour", category: "Retro", theme: "kids", contrast: 0.1, sat: 1.2, fade: 0.06, knee: 0.66, tint: 0.15, shadows: [0.0, 0.0, 0.05] },
	{ id: "g.oldPhoto", name: "Old Photo", category: "Retro", theme: "portrait", mono: [0.3, 0.59, 0.11], contrast: 0.1, fade: 0.1, shadows: [0.06, 0.02, -0.03], highs: [0.1, 0.06, -0.02] },
	{ id: "g.technicolor", name: "Three-Strip", category: "Retro", theme: "fashion", contrast: 0.3, sat: 1.35, satAt: [[0, 30, 1.25], [120, 40, 1.2], [220, 40, 1.2]] },
	// ---- Mood
	{ id: "g.moody", name: "Moody", category: "Mood", theme: "nature", contrast: 0.35, exposure: -0.25, sat: 0.75, temp: -0.1, crush: 0.02, shadows: [-0.02, 0.01, 0.03], highs: [0.03, 0.02, 0.0], skin: 0.7 },
	{ id: "g.darkForest", name: "Dark Forest", category: "Mood", theme: "nature", contrast: 0.3, exposure: -0.3, sat: 0.8, hue: [[100, 50, 25]], satAt: [[100, 60, 0.7]], shadows: [-0.02, 0.03, 0.02] },
	{ id: "g.brightAiry", name: "Bright & Airy", category: "Life", theme: "wedding", exposure: 0.3, contrast: -0.2, fade: 0.04, sat: 0.9, temp: 0.08, highs: [0.02, 0.02, 0.02], knee: 0.72, skin: 0.9 },
	{ id: "g.dreamy", name: "Dreamy", category: "Mood", theme: "wedding", exposure: 0.15, contrast: -0.25, fade: 0.08, sat: 0.85, tint: 0.15, highs: [0.05, 0.03, 0.04] },
	{ id: "g.melancholy", name: "Melancholy", category: "Mood", theme: "city", contrast: 0.1, sat: 0.55, temp: -0.25, fade: 0.05, shadows: [-0.01, 0.01, 0.04] },
	{ id: "g.warmGlow", name: "Warm Glow", category: "Mood", theme: "portrait", contrast: 0.1, temp: 0.4, sat: 1.0, highs: [0.06, 0.03, -0.02], knee: 0.7, skin: 0.85 },
	{ id: "g.coldMorning", name: "Cold Morning", category: "Mood", theme: "nature", contrast: 0.15, temp: -0.4, sat: 0.85, fade: 0.04, highs: [0.0, 0.02, 0.05] },
	{ id: "g.goldenHour", name: "Golden Hour", category: "Mood", theme: "nature", contrast: 0.2, temp: 0.55, sat: 1.1, highs: [0.08, 0.04, -0.03], shadows: [0.02, 0.0, -0.02], skin: 0.8 },
	{ id: "g.blueHour", name: "Blue Hour", category: "Mood", theme: "city-night", contrast: 0.25, temp: -0.5, sat: 1.05, shadows: [-0.02, 0.0, 0.06], highs: [0.04, 0.02, 0.0] },
	{ id: "g.stormy", name: "Stormy", category: "Mood", theme: "nature", contrast: 0.45, exposure: -0.2, sat: 0.6, temp: -0.2, crush: 0.03 },
	{ id: "g.faded", name: "Faded", category: "Mood", theme: "fashion", contrast: -0.15, fade: 0.12, sat: 0.8 },
	{ id: "g.muted", name: "Muted", category: "Mood", theme: "business", contrast: 0.05, sat: 0.65, fade: 0.04 },
	{ id: "g.lavender", name: "Lavender", category: "Mood", theme: "beauty", contrast: -0.05, tint: 0.35, temp: -0.05, fade: 0.05, sat: 0.9, highs: [0.03, 0.0, 0.05] },
	{ id: "g.mint", name: "Mint", category: "Mood", theme: "beauty", contrast: -0.05, tint: -0.3, temp: -0.1, fade: 0.05, sat: 0.9, highs: [0.0, 0.04, 0.03] },
	{ id: "g.peach", name: "Peach", category: "Mood", theme: "beauty", contrast: -0.1, temp: 0.25, tint: 0.15, fade: 0.05, sat: 0.95, highs: [0.05, 0.03, 0.01] },
	{ id: "g.cyberpunk", name: "Cyberpunk", category: "Mood", theme: "gaming", contrast: 0.45, sat: 1.35, tint: 0.45, temp: -0.25, shadows: [0.03, -0.03, 0.1], highs: [0.1, -0.02, 0.04], hue: [[60, 40, -30]] },
	{ id: "g.vaporwave", name: "Vaporwave", category: "Mood", theme: "music", contrast: 0.1, fade: 0.05, sat: 1.2, tint: 0.5, temp: -0.15, shadows: [0.02, -0.02, 0.08], highs: [0.06, 0.0, 0.06] },
	{ id: "g.underwater", name: "Underwater", category: "Mood", theme: "travel", contrast: 0.1, temp: -0.6, tint: -0.2, sat: 0.95, shadows: [-0.04, 0.03, 0.06] },
	// ---- Life: weddings, lifestyle, people
	{ id: "g.weddingSoft", name: "Wedding Soft", category: "Life", theme: "wedding", exposure: 0.2, contrast: -0.15, fade: 0.05, temp: 0.12, sat: 0.92, knee: 0.7, skin: 0.95 },
	{ id: "g.weddingFilm", name: "Wedding Film", category: "Life", theme: "wedding", contrast: 0.05, fade: 0.06, temp: 0.18, sat: 0.9, highs: [0.04, 0.03, 0.0], satAt: [[120, 50, 0.8]], skin: 0.9 },
	{ id: "g.lifestyle", name: "Lifestyle", category: "Life", theme: "fashion", exposure: 0.1, contrast: 0.1, sat: 1.05, vib: 0.2, temp: 0.08, skin: 0.85 },
	{ id: "g.cleanSkin", name: "Clean Skin", category: "Life", theme: "beauty", exposure: 0.1, contrast: 0.05, sat: 1.0, satAt: [[25, 25, 0.85]], skin: 1 },
	{ id: "g.vlog", name: "Vlog", category: "Life", theme: "travel", contrast: 0.2, sat: 1.12, vib: 0.25, temp: 0.05 },
	{ id: "g.minimal", name: "Minimal", category: "Life", theme: "business", exposure: 0.15, contrast: 0.0, sat: 0.8, fade: 0.03 },
	{ id: "g.office", name: "Office", category: "Life", theme: "business", contrast: 0.15, temp: -0.1, sat: 0.9, highs: [0.0, 0.01, 0.03] },
	{ id: "g.realEstate", name: "Bright Interior", category: "Life", theme: "real-estate", exposure: 0.35, contrast: 0.1, temp: 0.05, sat: 1.05, knee: 0.7, vib: 0.2 },
	{ id: "g.fitness", name: "Fitness", category: "Life", theme: "fitness", contrast: 0.45, sat: 0.9, temp: -0.05, crush: 0.02, skin: 0.6 },
	// ---- Food
	{ id: "g.foodWarm", name: "Food Warm", category: "Food", theme: "food", contrast: 0.25, temp: 0.3, sat: 1.15, vib: 0.3, satAt: [[10, 30, 1.15], [40, 30, 1.15]], skin: 0.3 },
	{ id: "g.foodFresh", name: "Food Fresh", category: "Food", theme: "food", exposure: 0.1, contrast: 0.2, sat: 1.15, satAt: [[100, 50, 1.25], [0, 25, 1.1]], temp: 0.05 },
	{ id: "g.bakery", name: "Bakery", category: "Food", theme: "food", contrast: 0.15, temp: 0.4, sat: 1.05, highs: [0.05, 0.03, -0.02], fade: 0.03 },
	{ id: "g.coffee", name: "Coffee", category: "Food", theme: "food", contrast: 0.3, temp: 0.3, sat: 0.85, exposure: -0.1, shadows: [0.03, 0.01, -0.02] },
	{ id: "g.dessert", name: "Dessert", category: "Food", theme: "food", exposure: 0.15, contrast: 0.05, tint: 0.15, sat: 1.1, fade: 0.03 },
	{ id: "g.darkFood", name: "Dark Food", category: "Food", theme: "food", contrast: 0.45, exposure: -0.25, sat: 1.05, crush: 0.03, temp: 0.15 },
	{ id: "g.product", name: "Product Pop", category: "Food", theme: "tech", contrast: 0.3, sat: 1.2, vib: 0.35, knee: 0.75 },
	// ---- Travel
	{ id: "g.tropical", name: "Tropical", category: "Travel", theme: "travel", contrast: 0.25, temp: 0.1, sat: 1.25, hue: [[200, 40, -12]], satAt: [[180, 50, 1.35]] },
	{ id: "g.mountain", name: "Mountain Air", category: "Travel", theme: "nature", contrast: 0.3, temp: -0.15, sat: 1.05, satAt: [[210, 50, 1.2]], highs: [0.0, 0.01, 0.03] },
	{ id: "g.city", name: "City Day", category: "Travel", theme: "city", contrast: 0.3, sat: 1.0, temp: -0.05, shadows: [-0.02, 0.0, 0.03], highs: [0.03, 0.02, 0.0] },
	{ id: "g.autumn", name: "Autumn", category: "Travel", theme: "nature", contrast: 0.2, temp: 0.3, sat: 1.1, hue: [[90, 50, -30]], satAt: [[30, 40, 1.3]] },
	{ id: "g.winter", name: "Winter", category: "Travel", theme: "nature", exposure: 0.15, contrast: 0.15, temp: -0.35, sat: 0.8, highs: [0.0, 0.02, 0.05] },
	{ id: "g.safari", name: "Safari", category: "Travel", theme: "travel", contrast: 0.25, temp: 0.45, sat: 0.95, satAt: [[100, 50, 0.8]], highs: [0.05, 0.03, -0.03] },
	{ id: "g.seaside", name: "Seaside", category: "Travel", theme: "travel", exposure: 0.15, contrast: 0.1, temp: -0.05, sat: 1.1, satAt: [[195, 40, 1.3]], fade: 0.02 },
	// ---- Night
	{ id: "g.neonNight", name: "Neon Night", category: "Night", theme: "city-night", contrast: 0.35, sat: 1.3, temp: -0.2, tint: 0.25, shadows: [0.0, 0.0, 0.06], highs: [0.06, 0.0, 0.05] },
	{ id: "g.streetLights", name: "Street Lights", category: "Night", theme: "city-night", contrast: 0.3, temp: 0.2, sat: 1.1, shadows: [-0.02, 0.01, 0.05], highs: [0.08, 0.04, -0.02] },
	{ id: "g.midnight", name: "Midnight", category: "Night", theme: "city-night", exposure: -0.2, contrast: 0.35, temp: -0.45, sat: 0.9, crush: 0.02 },
	{ id: "g.concert", name: "Concert", category: "Night", theme: "music", contrast: 0.45, sat: 1.35, tint: 0.2, crush: 0.03, highs: [0.05, 0.0, 0.04] },
	{ id: "g.party", name: "Party", category: "Night", theme: "music", contrast: 0.35, sat: 1.3, tint: 0.35, temp: 0.1, highs: [0.06, 0.0, 0.05] },
	{ id: "g.gamer", name: "Gamer RGB", category: "Night", theme: "gaming", contrast: 0.4, sat: 1.4, tint: 0.3, temp: -0.3, shadows: [0.02, 0.0, 0.08] },
	{ id: "g.sportsNight", name: "Stadium", category: "Night", theme: "sports", contrast: 0.4, sat: 1.15, temp: -0.1, highs: [0.02, 0.03, 0.04], crush: 0.02 },
	// ---- Mono
	{ id: "g.bwSoft", name: "B&W Soft", category: "Mono", theme: "portrait", mono: [0.3, 0.59, 0.11], contrast: -0.1, fade: 0.05 },
	{ id: "g.bwHigh", name: "B&W High Contrast", category: "Mono", theme: "sports", mono: [0.35, 0.55, 0.1], contrast: 0.8, crush: 0.04 },
	{ id: "g.bwRedFilter", name: "B&W Red Filter", category: "Mono", theme: "nature", mono: [0.75, 0.25, 0.0], contrast: 0.4 },
	{ id: "g.sepia", name: "Sepia", category: "Mono", theme: "portrait", mono: [0.3, 0.59, 0.11], contrast: 0.1, shadows: [0.05, 0.02, -0.04], highs: [0.08, 0.05, -0.02], fade: 0.04 },
	{ id: "g.selenium", name: "Selenium", category: "Mono", theme: "city", mono: [0.3, 0.6, 0.1], contrast: 0.3, shadows: [0.02, -0.01, 0.04], highs: [0.02, 0.01, 0.0] },
	{ id: "g.cyanotype", name: "Cyanotype", category: "Mono", theme: "nature", mono: [0.25, 0.55, 0.2], contrast: 0.2, shadows: [-0.06, 0.0, 0.08], highs: [-0.02, 0.02, 0.06] },
	{ id: "g.silverScreen", name: "Silver Screen", category: "Mono", theme: "fashion", mono: [0.3, 0.6, 0.1], contrast: 0.45, knee: 0.85, fade: 0.02 },
	{ id: "g.duotoneNeon", name: "Duotone Neon", category: "Mono", theme: "gaming", mono: [0.3, 0.6, 0.1], contrast: 0.4, shadows: [0.1, -0.05, 0.25], highs: [0.05, 0.25, 0.2] },
	{ id: "g.duotoneSunset", name: "Duotone Sunset", category: "Mono", theme: "music", mono: [0.3, 0.6, 0.1], contrast: 0.35, shadows: [0.2, -0.02, 0.12], highs: [0.15, 0.08, -0.08] },
];

export const GRADE_LOOKS: GradeLook[] = PRESETS.map(({ id, name, category, theme, ...grade }) => ({
	id,
	name,
	category,
	theme,
	fn: (c: RGB) => applyGrade(c, grade),
}));
