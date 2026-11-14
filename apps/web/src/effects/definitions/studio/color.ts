import { customLutTextureId, LOOKS, lookTextureId, LUT_SIZE } from "@/effects/luts/looks";
import { defineShaderSource } from "@/effects/shader-sources";
import type { EffectDefinition, EffectPass, EffectRenderParams } from "@/effects/types";
import type { ParamDefinition, ParamValues } from "@/params";
import { num, numberParam } from "./shader-effect";

export const COLOR_EFFECT_TYPE = "studio.color";

// The Color section is one effect in passes, in the colourist's order: basic tone + white balance + saturation, then
// curves, HSL, colour wheels and last the LUT look (+ vignette). A pass whose settings are all neutral is skipped.
// One shader takes at most 32 numbers, hence the passes; the param keys of the first version are kept, so older
// projects open unchanged.

const BASIC_WGSL = /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let src_c = src(uv);
    var c = src_c.rgb;
    let exposure = P0().x;
    let contrast = P0().y;
    let saturation = P0().z;
    let vibrance = P0().w;
    let temperature = P1().x;
    let tint = P1().y;
    let highlights = P1().z;
    let shadows = P1().w;
    let whites = P2().x;
    let blacks = P2().y;
    // exposure + white balance in linear light
    var lin = pow(max(c, vec3f(0.0)), vec3f(2.2));
    lin = lin * exp2(exposure);
    lin = lin * vec3f(1.0 + temperature * 0.3, 1.0 - tint * 0.25, 1.0 - temperature * 0.3);
    c = pow(max(lin, vec3f(0.0)), vec3f(1.0 / 2.2));
    // highlights / shadows, then whites / blacks (the far ends only)
    let y0 = luma(clamp(c, vec3f(0.0), vec3f(1.0)));
    c = c + vec3f(shadows * 0.35 * (1.0 - y0) * (1.0 - y0));
    c = c + vec3f(highlights * 0.35 * y0 * y0);
    c = c + vec3f(whites * 0.3 * y0 * y0 * y0);
    c = c + vec3f(blacks * 0.3 * (1.0 - y0) * (1.0 - y0) * (1.0 - y0));
    // contrast around mid grey
    c = (c - vec3f(0.5)) * contrast + vec3f(0.5);
    // saturation + vibrance
    let y = luma(c);
    c = mix(vec3f(y), c, saturation);
    let mx = max(c.r, max(c.g, c.b));
    let mn = min(c.r, min(c.g, c.b));
    c = mix(vec3f(y), c, 1.0 + vibrance * (1.0 - clamp(mx - mn, 0.0, 1.0)));
    return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), src_c.a);
}`;

// Five points per curve at x = 0, ¼, ½, ¾, 1 (Catmull-Rom through them): master first, then R, G, B.
const CURVES_WGSL = /* wgsl */ `
fn curve5(x: f32, ys: array<f32, 5>) -> f32 {
    var y = ys;
    let t = clamp(x, 0.0, 1.0) * 4.0;
    let i = min(i32(floor(t)), 3);
    let f = t - f32(i);
    let p1 = y[i];
    let p2 = y[i + 1];
    let p0 = select(y[max(i - 1, 0)], 2.0 * p1 - p2, i == 0);
    let p3 = select(y[min(i + 2, 4)], 2.0 * p2 - p1, i == 3);
    let f2 = f * f;
    let f3 = f2 * f;
    let v = 0.5 * (2.0 * p1 + (p2 - p0) * f + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * f2 + (3.0 * p1 - p0 - 3.0 * p2 + p3) * f3);
    return clamp(v, 0.0, 1.0);
}
fn effect(uv: vec2f) -> vec4f {
    let s = src(uv);
    let m = array<f32, 5>(P0().x, P0().y, P0().z, P0().w, P4().x);
    let r = array<f32, 5>(P1().x, P1().y, P1().z, P1().w, P4().y);
    let g = array<f32, 5>(P2().x, P2().y, P2().z, P2().w, P4().z);
    let b = array<f32, 5>(P3().x, P3().y, P3().z, P3().w, P4().w);
    var c = clamp(s.rgb, vec3f(0.0), vec3f(1.0));
    c = vec3f(curve5(c.r, m), curve5(c.g, m), curve5(c.b, m));
    c = vec3f(curve5(c.r, r), curve5(c.g, g), curve5(c.b, b));
    return vec4f(c, s.a);
}`;

// Eight hue ranges, each with a hue shift (±30°), saturation and luminance; grey pixels are left alone.
const HSL_WGSL = /* wgsl */ `
fn rgb2hsv(c: vec3f) -> vec3f {
    let k = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    let p = mix(vec4f(c.bg, k.wz), vec4f(c.gb, k.xy), step(c.b, c.g));
    let q = mix(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), step(p.x, c.r));
    let d = q.x - min(q.w, q.y);
    let e = 1.0e-10;
    return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
fn hsv2rgb(c: vec3f) -> vec3f {
    let p = abs(fract(vec3f(c.x) + vec3f(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - vec3f(3.0));
    return c.z * mix(vec3f(1.0), clamp(p - vec3f(1.0), vec3f(0.0), vec3f(1.0)), c.y);
}
fn effect(uv: vec2f) -> vec4f {
    let s = src(uv);
    let c = clamp(s.rgb, vec3f(0.0), vec3f(1.0));
    let hsv = rgb2hsv(c);
    var hs = array<f32, 8>(P0().x, P0().y, P0().z, P0().w, P1().x, P1().y, P1().z, P1().w);
    var ss = array<f32, 8>(P2().x, P2().y, P2().z, P2().w, P3().x, P3().y, P3().z, P3().w);
    var ls = array<f32, 8>(P4().x, P4().y, P4().z, P4().w, P5().x, P5().y, P5().z, P5().w);
    var centers = array<f32, 8>(0.0, 30.0, 60.0, 120.0, 180.0, 230.0, 275.0, 320.0);
    var dh = 0.0;
    var ds = 0.0;
    var dl = 0.0;
    for (var i = 0; i < 8; i++) {
        let d = abs(fract(hsv.x - centers[i] / 360.0 + 0.5) - 0.5) * 360.0;
        let w = max(0.0, 1.0 - d / 45.0);
        dh = dh + hs[i] * w;
        ds = ds + ss[i] * w;
        dl = dl + ls[i] * w;
    }
    let chroma = smoothstep(0.0, 0.25, hsv.y);
    let h = fract(hsv.x + dh * chroma * 30.0 / 360.0);
    let sat = clamp(hsv.y * (1.0 + ds * chroma), 0.0, 1.0);
    var rgb = hsv2rgb(vec3f(h, sat, hsv.z));
    rgb = rgb * (1.0 + dl * 0.5 * chroma);
    return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), s.a);
}`;

// Lift / gamma / gain: a colour push (the wheel) and a level per tonal range.
const WHEELS_WGSL = /* wgsl */ `
fn wheel(v: vec2f) -> vec3f {
    // atan2(0, 0) is NaN on some GPUs: a centred wheel is no tint
    if (length(v) < 0.00001) { return vec3f(0.0); }
    let a = atan2(v.y, v.x);
    // twice Kadr's push: a wheel pulled to its edge is a clear grade, not a hint
    let r = min(1.0, length(v)) * 0.5;
    return vec3f(cos(a), cos(a - 2.094), cos(a + 2.094)) * r;
}
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let st = wheel(P0().xy);
    let mt = wheel(P1().xy);
    let ht = wheel(P2().xy);
    let sl = P0().z;
    let ml = P1().z;
    let hl = P2().z;
    let y = luma(c.rgb);
    let ws = max(0.0, 1.0 - y * 2.0);
    let wh = max(0.0, y * 2.0 - 1.0);
    let wm = 1.0 - ws - wh;
    var v = c.rgb + (st + vec3f(sl)) * ws + (ht + vec3f(hl)) * wh;
    let gamma = exp2(-(mt + vec3f(ml)) * 2.0);
    v = v + (pow(max(v, vec3f(0.0)), gamma) - v) * wm;
    return vec4f(clamp(v, vec3f(0.0), vec3f(1.0)), c.a);
}`;

const LOOK_WGSL = /* wgsl */ `
fn lut_sample(c: vec3f) -> vec3f {
    let size = P0().z;
    let cc = clamp(c, vec3f(0.0), vec3f(1.0)) * (size - 1.0);
    let b0 = floor(cc.b);
    let b1 = min(b0 + 1.0, size - 1.0);
    let fb = cc.b - b0;
    let w = size * size;
    let y = (cc.g + 0.5) / size;
    let s0 = aux0(vec2f((b0 * size + cc.r + 0.5) / w, y)).rgb;
    let s1 = aux0(vec2f((b1 * size + cc.r + 0.5) / w, y)).rgb;
    return mix(s0, s1, fb);
}
fn effect(uv: vec2f) -> vec4f {
    let src_c = src(uv);
    var c = clamp(src_c.rgb, vec3f(0.0), vec3f(1.0));
    if (P0().w > 0.5) {
        c = mix(c, lut_sample(c), P0().y);
    }
    let vig = P0().x;
    let a = aspect();
    let p = (uv - vec2f(0.5)) * vec2f(min(a, 1.0), min(1.0 / a, 1.0)) * 2.0;
    let k = smoothstep(0.35, 1.05, length(p) / 1.41421 * 1.25);
    c = c * (1.0 - vig * k);
    return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), src_c.a);
}`;

const SHADERS = [
	{ id: COLOR_EFFECT_TYPE, wgsl: BASIC_WGSL },
	{ id: `${COLOR_EFFECT_TYPE}.curves`, wgsl: CURVES_WGSL },
	{ id: `${COLOR_EFFECT_TYPE}.hsl`, wgsl: HSL_WGSL },
	{ id: `${COLOR_EFFECT_TYPE}.wheels`, wgsl: WHEELS_WGSL },
	{ id: `${COLOR_EFFECT_TYPE}.look`, wgsl: LOOK_WGSL },
];
for (const shader of SHADERS) defineShaderSource(shader);

export const COLOR_LOOK_OPTIONS = [
	{ value: "none", label: "None" },
	...LOOKS.map((look) => ({ value: look.id, label: look.name })),
	{ value: "custom", label: "Imported LUT" },
];

export function colorLutTextureId(p: ParamValues): string | null {
	const look = typeof p.look === "string" ? p.look : "none";
	if (look === "none") return null;
	if (look === "custom") {
		return typeof p.lutData === "string" && p.lutData ? customLutTextureId(p.lutData) : null;
	}
	return lookTextureId(look);
}

/** Curve channels and the five points of each (output %, at input 0, 25, 50, 75, 100 %). */
export const CURVE_CHANNELS = ["m", "r", "g", "b"] as const;
export type CurveChannel = (typeof CURVE_CHANNELS)[number];
export const CURVE_X = [0, 25, 50, 75, 100];
export const curveKey = (channel: CurveChannel, i: number) => `curve${channel.toUpperCase()}${i}`;

/** HSL ranges (hue centres 0°, 30°, 60°, 120°, 180°, 230°, 275°, 320°). */
export const HSL_RANGES = [
	{ id: "red", label: "Red", swatch: "#ef4444" },
	{ id: "orange", label: "Orange", swatch: "#f97316" },
	{ id: "yellow", label: "Yellow", swatch: "#eab308" },
	{ id: "green", label: "Green", swatch: "#22c55e" },
	{ id: "aqua", label: "Aqua", swatch: "#06b6d4" },
	{ id: "blue", label: "Blue", swatch: "#3b82f6" },
	{ id: "purple", label: "Purple", swatch: "#e8a33d" },
	{ id: "magenta", label: "Magenta", swatch: "#d946ef" },
] as const;
export type HslAxis = "h" | "s" | "l";
export const hslKey = (axis: HslAxis, range: string) => `hsl${axis.toUpperCase()}_${range}`;

/** Colour wheels: shadows (lift), midtones (gamma), highlights (gain); x/y is the push, level the brightness. */
export const WHEELS = [
	{ id: "lift", label: "Shadows" },
	{ id: "gamma", label: "Midtones" },
	{ id: "gain", label: "Highlights" },
] as const;
export const wheelKey = (wheel: string, part: "x" | "y" | "level") => `wheel${wheel[0].toUpperCase()}${wheel.slice(1)}${part === "level" ? "Level" : part.toUpperCase()}`;

const params: ParamDefinition[] = [
	numberParam("exposure", "Exposure", 0, -3, 3, 0.05),
	numberParam("contrast", "Contrast", 0, -100, 100, 1),
	numberParam("highlights", "Highlights", 0, -100, 100, 1),
	numberParam("shadows", "Shadows", 0, -100, 100, 1),
	numberParam("whites", "Whites", 0, -100, 100, 1),
	numberParam("blacks", "Blacks", 0, -100, 100, 1),
	numberParam("temperature", "Temperature", 0, -100, 100, 1),
	numberParam("tint", "Tint", 0, -100, 100, 1),
	numberParam("saturation", "Saturation", 0, -100, 100, 1),
	numberParam("vibrance", "Vibrance", 0, -100, 100, 1),
	...CURVE_CHANNELS.flatMap((ch) => CURVE_X.map((x, i) => numberParam(curveKey(ch, i), `Curve ${ch} ${x}`, x, 0, 100, 1))),
	...(["h", "s", "l"] as const).flatMap((axis) => HSL_RANGES.map((r) => numberParam(hslKey(axis, r.id), `${r.label} ${axis}`, 0, -100, 100, 1))),
	...WHEELS.flatMap((w) => [
		numberParam(wheelKey(w.id, "x"), `${w.label} x`, 0, -1, 1, 0.01),
		numberParam(wheelKey(w.id, "y"), `${w.label} y`, 0, -1, 1, 0.01),
		numberParam(wheelKey(w.id, "level"), `${w.label} level`, 0, -100, 100, 1),
	]),
	{ key: "look", label: "Look", type: "select", default: "none", options: COLOR_LOOK_OPTIONS },
	numberParam("lookIntensity", "Look intensity", 100, 0, 100, 1),
	numberParam("vignette", "Vignette", 0, 0, 100, 1),
];

/** The settings of each group, for its own Reset and for skipping a neutral pass. */
export const COLOR_GROUP_KEYS = {
	basic: ["exposure", "contrast", "highlights", "shadows", "whites", "blacks"],
	balance: ["temperature", "tint"],
	saturation: ["saturation", "vibrance"],
	curves: CURVE_CHANNELS.flatMap((ch) => CURVE_X.map((_, i) => curveKey(ch, i))),
	hsl: (["h", "s", "l"] as const).flatMap((axis) => HSL_RANGES.map((r) => hslKey(axis, r.id))),
	wheels: WHEELS.flatMap((w) => [wheelKey(w.id, "x"), wheelKey(w.id, "y"), wheelKey(w.id, "level")]),
	look: ["look", "lookIntensity", "vignette", "lutData", "lutName"],
} as const;
export type ColorGroup = keyof typeof COLOR_GROUP_KEYS;

const DEFAULTS: ParamValues = Object.fromEntries(params.map((p) => [p.key, p.default]));

/** True when every setting of the group is at its default (look: "none" and no vignette). */
export function isColorGroupNeutral(group: ColorGroup, p: ParamValues): boolean {
	return COLOR_GROUP_KEYS[group].every((key) => {
		if (key === "lutData" || key === "lutName" || key === "lookIntensity") return true;
		const d = DEFAULTS[key];
		const v = p[key] ?? d;
		return typeof d === "number" ? Math.abs(num(p, key, d) - d) < 1e-6 : v === d;
	});
}

/** The group's settings back to their defaults (the look group also forgets an imported LUT). */
export function resetColorGroup(group: ColorGroup, p: ParamValues): ParamValues {
	const next: ParamValues = { ...p };
	for (const key of COLOR_GROUP_KEYS[group]) {
		if (key in DEFAULTS) next[key] = DEFAULTS[key];
		else delete next[key];
	}
	return next;
}

function buildPasses(ctx: EffectRenderParams): EffectPass[] {
	const p = ctx.effectParams;
	const pass = (shader: string, values: number[], textures?: string[]): EffectPass => ({
		shader,
		uniforms: { u_time: 0, u_progress: 0, u_frame: 0, u_params: values.slice(0, 32) },
		...(textures && textures.length > 0 ? { textures } : {}),
	});
	// The basic pass always runs (the effect is never empty); the others only when they change something.
	const passes: EffectPass[] = [
		pass(COLOR_EFFECT_TYPE, [
			num(p, "exposure", 0),
			1 + num(p, "contrast", 0) / 100,
			1 + num(p, "saturation", 0) / 100,
			num(p, "vibrance", 0) / 100,
			num(p, "temperature", 0) / 100,
			num(p, "tint", 0) / 100,
			num(p, "highlights", 0) / 100,
			num(p, "shadows", 0) / 100,
			num(p, "whites", 0) / 100,
			num(p, "blacks", 0) / 100,
		]),
	];
	if (!isColorGroupNeutral("curves", p)) {
		const y = (ch: CurveChannel, i: number) => num(p, curveKey(ch, i), CURVE_X[i]) / 100;
		passes.push(
			pass(`${COLOR_EFFECT_TYPE}.curves`, [
				...[0, 1, 2, 3].map((i) => y("m", i)),
				...[0, 1, 2, 3].map((i) => y("r", i)),
				...[0, 1, 2, 3].map((i) => y("g", i)),
				...[0, 1, 2, 3].map((i) => y("b", i)),
				y("m", 4),
				y("r", 4),
				y("g", 4),
				y("b", 4),
			]),
		);
	}
	if (!isColorGroupNeutral("hsl", p)) {
		const v = (axis: HslAxis) => HSL_RANGES.map((r) => num(p, hslKey(axis, r.id), 0) / 100);
		passes.push(pass(`${COLOR_EFFECT_TYPE}.hsl`, [...v("h"), ...v("s"), ...v("l")]));
	}
	if (!isColorGroupNeutral("wheels", p)) {
		passes.push(
			pass(
				`${COLOR_EFFECT_TYPE}.wheels`,
				WHEELS.flatMap((w) => [num(p, wheelKey(w.id, "x"), 0), num(p, wheelKey(w.id, "y"), 0), num(p, wheelKey(w.id, "level"), 0) / 200, 0]),
			),
		);
	}
	const lut = colorLutTextureId(p);
	if (lut || num(p, "vignette", 0) > 0) {
		passes.push(
			pass(
				`${COLOR_EFFECT_TYPE}.look`,
				[num(p, "vignette", 0) / 100, num(p, "lookIntensity", 100) / 100, LUT_SIZE, lut ? 1 : 0],
				lut ? [lut] : undefined,
			),
		);
	}
	return passes;
}

export const colorEffect: EffectDefinition = {
	type: COLOR_EFFECT_TYPE,
	name: "Color",
	keywords: ["color", "adjust", "lut", "look", "curves", "hsl", "wheels", "цвет"],
	category: "Color",
	hidden: true,
	params,
	shaders: SHADERS,
	renderer: { passes: [], buildPasses },
};
