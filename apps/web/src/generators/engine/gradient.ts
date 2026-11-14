// Solids and gradient ramps, drawn per pixel in plain JavaScript: the same code gives the player's texture, the
// export's and the bun test's hash. A ramp is interpolated in OKLab through a 1024-entry table, then dithered by a
// static pattern (no 8-bit bands after H.264, no flicker, almost no bitrate).
import type { ParamDefinition, ParamValues } from "@/params";
import type { GeneratorSpec, GenTime, PixelBuffer } from "../types";
import { clamp01, DITHER, DITHER_SIZE, formatColor, oklabToRgba, parseColor, rgbaToOklab, type Oklab } from "./color";

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/* ------------------------------------------------------------------ Solid */

export const SOLID_PARAMS: ParamDefinition[] = [
	{ key: "gen.color", label: "Color", type: "color", default: "#2f6bff" },
	{ key: "gen.opacity", label: "Opacity", type: "number", default: 100, min: 0, max: 100, step: 1, unit: "percent" },
];

function solidColor(params: ParamValues) {
	const c = parseColor(params["gen.color"]);
	return { ...c, a: c.a * clamp01(num(params["gen.opacity"], 100) / 100) };
}

export const solidSpec: GeneratorSpec = {
	id: "solid",
	family: "Solids",
	name: "Solid",
	keywords: ["solid", "color", "colour", "fill", "matte", "сплошной", "цвет", "заливка"],
	role: "ground",
	params: SOLID_PARAMS,
	animated: () => false,
	// one colour: a tiny texture, stretched
	resolution: 0,
	maxSide: 8,
	pixels(out, params) {
		const c = solidColor(params);
		const r = Math.round(c.r * 255);
		const g = Math.round(c.g * 255);
		const b = Math.round(c.b * 255);
		const a = Math.round(c.a * 255);
		const d = out.data;
		for (let i = 0; i < d.length; i += 4) {
			d[i] = r;
			d[i + 1] = g;
			d[i + 2] = b;
			d[i + 3] = a;
		}
	},
	representative: (params) => formatColor(solidColor(params)),
};

/* --------------------------------------------------------------- Gradient */

export const GRADIENT_SHAPES = ["linear", "radial", "angular", "diamond"] as const;
export const GRADIENT_MOTIONS = ["still", "drift", "rotate", "breathe"] as const;
export const MAX_STOPS = 5;
const STOP_COLORS = ["#ff5f6d", "#ffc371", "#6a5cff", "#00d2ff", "#ffffff"];
const STOP_POSITIONS = [0, 100, 50, 25, 75];

export const GRADIENT_PARAMS: ParamDefinition[] = [
	{
		key: "gen.shape",
		label: "Shape",
		type: "select",
		default: "linear",
		options: [
			{ value: "linear", label: "Linear" },
			{ value: "radial", label: "Radial" },
			{ value: "angular", label: "Angular" },
			{ value: "diamond", label: "Diamond" },
		],
	},
	{ key: "gen.stops", label: "Colors", type: "number", default: 2, min: 2, max: MAX_STOPS, step: 1 },
	...Array.from({ length: MAX_STOPS }, (_, i): ParamDefinition[] => [
		{ key: `gen.c${i + 1}`, label: `Color ${i + 1}`, type: "color", default: STOP_COLORS[i] },
		{ key: `gen.p${i + 1}`, label: `Position ${i + 1}`, type: "number", default: STOP_POSITIONS[i], min: 0, max: 100, step: 1, unit: "percent" },
	]).flat(),
	{ key: "gen.angle", label: "Angle", type: "number", default: 0, min: -360, max: 360, step: 1 },
	{ key: "gen.cx", label: "Center X", type: "number", default: 0, min: -100, max: 100, step: 1 },
	{ key: "gen.cy", label: "Center Y", type: "number", default: 0, min: -100, max: 100, step: 1 },
	{ key: "gen.scale", label: "Scale", type: "number", default: 100, min: 10, max: 400, step: 1 },
	{
		key: "gen.motion",
		label: "Motion",
		type: "select",
		default: "still",
		options: [
			{ value: "still", label: "Still" },
			{ value: "drift", label: "Drift" },
			{ value: "rotate", label: "Rotate" },
			{ value: "breathe", label: "Breathe" },
		],
	},
	{ key: "gen.speed", label: "Speed", type: "number", default: 1, min: 0, max: 4, step: 0.05 },
	{ key: "gen.dither", label: "No banding", type: "boolean", default: true },
];

export const stopCount = (params: ParamValues) => Math.max(2, Math.min(MAX_STOPS, Math.round(num(params["gen.stops"], 2))));

function gradientShows(key: string, params: ParamValues): boolean {
	const m = /^gen\.[cp](\d)$/.exec(key);
	if (m) return Number(m[1]) <= stopCount(params);
	if (key === "gen.speed") return params["gen.motion"] !== "still" && params["gen.motion"] !== undefined;
	if (key === "gen.angle") return params["gen.shape"] !== "radial";
	if (key === "gen.scale") return params["gen.shape"] !== "angular";
	return true;
}

const LUT_SIZE = 1024;

/** The ramp as a table of sRGB 0..255 floats (+ alpha 0..255): stops sorted by position, OKLab between them. */
export function buildRamp(params: ParamValues): Float32Array {
	const n = stopCount(params);
	const stops: { p: number; c: Oklab }[] = [];
	for (let i = 1; i <= n; i++) {
		stops.push({ p: clamp01(num(params[`gen.p${i}`], STOP_POSITIONS[i - 1]) / 100), c: rgbaToOklab(parseColor(params[`gen.c${i}`] ?? STOP_COLORS[i - 1])) });
	}
	// stable: equal positions keep the stops' own order (a hard edge)
	stops.sort((a, b) => a.p - b.p);
	const lut = new Float32Array(LUT_SIZE * 4);
	let k = 0;
	for (let i = 0; i < LUT_SIZE; i++) {
		const t = i / (LUT_SIZE - 1);
		while (k < stops.length - 2 && t > stops[k + 1].p) k++;
		const a = stops[k];
		const b = stops[Math.min(k + 1, stops.length - 1)];
		const span = b.p - a.p;
		const f = t <= a.p ? 0 : t >= b.p ? 1 : span > 0 ? (t - a.p) / span : 1;
		// a transparent stop takes the other's colour (no dark fringe), only its alpha fades
		const wa = a.c.alpha * (1 - f);
		const wb = b.c.alpha * f;
		const w = wa + wb;
		const mix = (x: number, y: number) => (w > 0 ? (x * wa + y * wb) / w : x * (1 - f) + y * f);
		const rgb = oklabToRgba({ L: mix(a.c.L, b.c.L), A: mix(a.c.A, b.c.A), B: mix(a.c.B, b.c.B), alpha: a.c.alpha * (1 - f) + b.c.alpha * f });
		lut[i * 4] = rgb.r * 255;
		lut[i * 4 + 1] = rgb.g * 255;
		lut[i * 4 + 2] = rgb.b * 255;
		lut[i * 4 + 3] = rgb.a * 255;
	}
	return lut;
}

/** The shape's geometry at this frame (motion applied): seconds = frame / fps, never the clock. */
export function gradientGeometry(params: ParamValues, time: GenTime) {
	const seconds = time.fps > 0 ? time.frame / time.fps : 0;
	const motion = String(params["gen.motion"] ?? "still");
	const phase = num(params["gen.speed"], 1) * seconds;
	const w = (2 * Math.PI) / 10; // one cycle in 10 s at speed 1
	let angle = (num(params["gen.angle"], 0) * Math.PI) / 180;
	let cx = num(params["gen.cx"], 0) / 100;
	let cy = num(params["gen.cy"], 0) / 100;
	let scale = Math.max(0.1, num(params["gen.scale"], 100) / 100);
	if (motion === "rotate") angle += w * phase;
	else if (motion === "drift") {
		cx += 0.3 * Math.sin(w * phase);
		cy += 0.2 * Math.sin(w * 0.73 * phase + 1.1);
		angle += 0.25 * Math.sin(w * 0.5 * phase);
	} else if (motion === "breathe") scale *= 1 + 0.2 * Math.sin(w * phase);
	return { angle, cx, cy, scale };
}

export function drawGradient(out: PixelBuffer, params: ParamValues, time: GenTime): void {
	const { width, height, data } = out;
	if (width <= 0 || height <= 0) return;
	const lut = buildRamp(params);
	const shape = String(params["gen.shape"] ?? "linear");
	const dither = params["gen.dither"] !== false;
	const { angle, cx, cy, scale } = gradientGeometry(params, time);
	// units: the shorter half-side = 1, so circles stay round in any aspect
	const unit = Math.min(width, height) / 2;
	const hw = width / 2 / unit;
	const hh = height / 2 / unit;
	const ox = cx * hw;
	const oy = cy * hh;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const extentLinear = Math.max(1e-6, (Math.abs(hw * cos) + Math.abs(hh * sin)) * scale);
	const extentRadial = Math.max(1e-6, Math.hypot(hw, hh) * scale);
	const extentDiamond = Math.max(1e-6, (hw + hh) * scale);
	const kind = shape === "radial" ? 1 : shape === "angular" ? 2 : shape === "diamond" ? 3 : 0;
	const last = LUT_SIZE - 1;
	let i = 0;
	for (let y = 0; y < height; y++) {
		const py = (y + 0.5) / unit - hh - oy;
		const drow = (y % DITHER_SIZE) * DITHER_SIZE;
		for (let x = 0; x < width; x++, i += 4) {
			const px = (x + 0.5) / unit - hw - ox;
			let t: number;
			if (kind === 0) t = ((px * cos + py * sin) / extentLinear + 1) / 2;
			else if (kind === 1) t = Math.sqrt(px * px + py * py) / extentRadial;
			else if (kind === 2) {
				const a = Math.atan2(py, px) - angle;
				t = a / (2 * Math.PI);
				t -= Math.floor(t);
			} else {
				const rx = px * cos + py * sin;
				const ry = -px * sin + py * cos;
				t = (Math.abs(rx) + Math.abs(ry)) / extentDiamond;
			}
			const j = (t <= 0 ? 0 : t >= 1 ? last : Math.round(t * last)) * 4;
			const d = dither ? DITHER[drow + (x % DITHER_SIZE)] : 0;
			data[i] = lut[j] + d;
			data[i + 1] = lut[j + 1] + d;
			data[i + 2] = lut[j + 2] + d;
			data[i + 3] = lut[j + 3];
		}
	}
}

export const gradientSpec: GeneratorSpec = {
	id: "gradient",
	family: "Gradients",
	name: "Gradient",
	keywords: ["gradient", "ramp", "linear", "radial", "angular", "conic", "diamond", "градиент", "рамп", "переход цвета"],
	role: "ground",
	params: GRADIENT_PARAMS,
	shows: gradientShows,
	animated: (params) => String(params["gen.motion"] ?? "still") !== "still" && num(params["gen.speed"], 1) !== 0,
	// a smooth ramp: 960 px on the long side is enough (the compositor's bilinear scale keeps it smooth)
	resolution: 1,
	maxSide: 960,
	pixels: drawGradient,
	// the ramp's mean colour: an older build shows the clip as one flat colour of about the same look
	representative: (params) => {
		const lut = buildRamp(params);
		let r = 0;
		let g = 0;
		let b = 0;
		let a = 0;
		for (let i = 0; i < lut.length; i += 4) {
			const w = lut[i + 3] / 255;
			r += lut[i] * w;
			g += lut[i + 1] * w;
			b += lut[i + 2] * w;
			a += w;
		}
		const n = lut.length / 4;
		return a > 0 ? formatColor({ r: r / a / 255, g: g / a / 255, b: b / a / 255, a: a / n }) : "#00000000";
	},
};
