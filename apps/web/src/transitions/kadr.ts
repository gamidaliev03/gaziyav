import type { ParamValues } from "@/params";
import { COMMON, DIRECTION_PARAM, DIRECTIONS, directionIndex } from "./common";
import type { TransitionDefinition, TransitionNumberParam } from "./types";

// Kadr's built-in and creative transitions (Kadr's own Swift code, ported to
// WGSL by formula: BuiltinTransitions.swift / CreativeTransitions.swift).
// Kadr ids are kept (kadr.transition.<id>) so presets map 1:1.
// Kadr's Whip Pan, Zoom Punch, Spin, Glitch and Flash are the Trending ones in
// definitions.ts; the Core Image-only ones (ripple, page curl, bars swipe,
// mod) map to their GL Transitions equivalents in the GL pack.

const KADR_HELPERS = /* wgsl */ `
fn ease_in3(t: f32) -> f32 { let x = clamp(t, 0.0, 1.0); return x * x * x; }
fn ease_out3(t: f32) -> f32 { let x = 1.0 - clamp(t, 0.0, 1.0); return 1.0 - x * x * x; }
fn signed_rnd(i: f32, seed: f32) -> f32 { return hash11(i * 7.31 + seed * 13.17) * 2.0 - 1.0; }
// scale about the centre (aspect-correct), with rotation and an offset in uv
fn xform(uv: vec2f, s: vec2f, rot: f32, off: vec2f) -> vec2f {
    let a = aspect();
    var q = (uv - vec2f(0.5) - off) * vec2f(a, 1.0);
    q = rotate2(q, -rot);
    q = q / s;
    return q / vec2f(a, 1.0) + vec2f(0.5);
}
fn axis_pos(uv: vec2f, d: vec2f) -> f32 {
    // 0 at the edge the wipe starts from, 1 at the opposite edge
    if (d.x > 0.5) { return uv.x; }
    if (d.x < -0.5) { return 1.0 - uv.x; }
    if (d.y < -0.5) { return 1.0 - uv.y; }
    return uv.y;
}
`;

const wgsl = (body: string) => `${COMMON}${KADR_HELPERS}${body}`;

function num(key: string, label: string, def: number, min: number, max: number, slot: number): TransitionNumberParam {
	return { key, label, type: "number", default: [def], min, max, slot, size: 1 };
}

function packWith(params: TransitionNumberParam[], extra?: (values: ParamValues) => Array<[number, number]>) {
	return (values: ParamValues) => {
		const out = new Array<number>(32).fill(0);
		for (const param of params) {
			const raw = values[param.key];
			out[param.slot] = typeof raw === "number" && Number.isFinite(raw) ? raw : param.default[0];
		}
		for (const [slot, value] of extra?.(values) ?? []) out[slot] = value;
		return out;
	};
}

const WIPE_DIRECTION = { ...DIRECTION_PARAM, default: "right" };
const dirSlot = (slot: number) => (values: ParamValues): Array<[number, number]> => [[slot, directionIndex(values)]];
const wipeDirSlot = (slot: number) => (values: ParamValues): Array<[number, number]> => [
	[slot, Math.max(0, DIRECTIONS.indexOf(String(values.direction ?? "right")))],
];

const softness = num("softness", "Softness", 0.1, 0, 1, 1);
const irisSoftness = num("softness", "Softness", 0.15, 0, 1, 0);
const blurAmount = num("blur", "Blur, px", 40, 0, 200, 0);
const zoomAmount = num("zoom", "Zoom", 0.6, 0.1, 2, 0);
const zoomBlur = num("blur", "Blur", 0.5, 0, 1, 1);

export const KADR_TRANSITIONS: TransitionDefinition[] = [
	{
		type: "kadr.transition.shakeZoom",
		name: "Shake Zoom",
		category: "Trending",
		defaultDuration: 0.4,
		wgsl: wgsl(/* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let k = bell();
    let i = floor(p * 30.0);
    let amp = k * 0.03;
    let jitter = vec2f(signed_rnd(i, 3.0), signed_rnd(i, 4.0) * aspect()) * amp;
    let rot = signed_rnd(i, 5.0) * k * 0.04;
    let s = 1.0 + k * 0.35;
    let ang = signed_rnd(i, 6.0) * 3.14159265;
    let dir = vec2f(cos(ang), sin(ang)) * (k * 18.0) * texel();
    var acc = vec4f(0.0);
    for (var n = 0; n < 8; n++) {
        let f = f32(n) / 7.0 - 0.5;
        let q = xform(uv, vec2f(s), rot, jitter) + dir * f;
        acc += select(orig(q), src(q), p < 0.5);
    }
    return acc / 8.0;
}`),
	},
	{
		type: "kadr.transition.flashZoom",
		name: "Flash Zoom",
		category: "Trending",
		defaultDuration: 0.4,
		wgsl: wgsl(/* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let b = bell();
    let s = select(1.4 - ease_out3((p - 0.5) * 2.0) * 0.4, 1.0 + ease_in3(p * 2.0) * 0.8, p < 0.5);
    let blur = b * 0.07;
    var acc = vec4f(0.0);
    for (var n = 0; n < 12; n++) {
        let f = f32(n) / 11.0;
        let q = zoom_uv(uv, vec2f(0.5), s * (1.0 + blur * f));
        acc += select(orig(q), src(q), p < 0.5);
    }
    let c = acc / 12.0;
    return vec4f(min(c.rgb * exp2(pow(b, 3.0) * 3.5), vec3f(1.0)), c.a);
}`),
	},
	{
		type: "kadr.transition.swipeBlur",
		name: "Swipe Blur",
		category: "Trending",
		defaultDuration: 0.4,
		params: [DIRECTION_PARAM],
		pack: (values) => [directionIndex(values)],
		wgsl: wgsl(/* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let d = dir_vec(P0().x);
    let e = select(0.5 + ease_out3((p - 0.5) * 2.0) * 0.5, ease_in3(p * 2.0) * 0.5, p < 0.5);
    let spread = pow(bell(), 2.0) * 0.1;
    var acc = vec4f(0.0);
    for (var n = 0; n < 16; n++) {
        let f = (f32(n) / 15.0 - 0.5) * spread;
        acc += strip(uv, d, e + f);
    }
    return acc / 16.0;
}`),
	},
	{
		type: "kadr.transition.stretch",
		name: "Stretch",
		category: "Trending",
		defaultDuration: 0.35,
		wgsl: wgsl(/* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let k = select(1.0 - ease_out3((p - 0.5) * 2.0), ease_in3(p * 2.0), p < 0.5);
    let s = vec2f(1.0 + k * 2.5, 1.0 - k * 0.15);
    let blur = k * 60.0 * texel().x;
    var acc = vec4f(0.0);
    for (var n = 0; n < 10; n++) {
        let f = f32(n) / 9.0 - 0.5;
        let q = xform(uv, s, 0.0, vec2f(0.0)) + vec2f(blur * f, 0.0);
        acc += select(orig(q), src(q), p < 0.5);
    }
    return acc / 10.0;
}`),
	},
	{
		type: "kadr.transition.lumaFade",
		name: "Luma Fade",
		category: "Film & Fade",
		defaultDuration: 0.6,
		wgsl: wgsl(/* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let b = B(uv);
    let slope = 4.0;
    let offset = (1.0 - p) * (1.0 + 1.0 / slope) - 1.0 / slope;
    let m = clamp((luma(b.rgb) - offset) * slope, 0.0, 1.0);
    return mix(A(uv), b, m);
}`),
	},
	{
		type: "kadr.transition.pixelate",
		name: "Pixelate",
		category: "Shapes & Patterns",
		defaultDuration: 0.5,
		wgsl: wgsl(/* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let size = max(1.0, bell() * 60.0 * fx.resolution.x / 1920.0);
    let cell = size / fx.resolution;
    let q = (floor((uv - vec2f(0.5)) / cell) + vec2f(0.5)) * cell + vec2f(0.5);
    return mix(A(q), B(q), smoothstep(0.4, 0.6, p));
}`),
	},
	{
		type: "kadr.transition.doors",
		name: "Doors",
		category: "Wipe & Slide",
		defaultDuration: 0.6,
		wgsl: wgsl(/* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let e = ease_in_out_cubic(fx.progress);
    let h = 0.5 * e;
    if (uv.x < 0.5 - h) { return A(vec2f(uv.x + h, uv.y)); }
    if (uv.x > 0.5 + h) { return A(vec2f(uv.x - h, uv.y)); }
    return B(uv);
}`),
	},
	{
		type: "kadr.transition.filmBurn",
		name: "Film Burn",
		category: "Film & Fade",
		defaultDuration: 0.7,
		wgsl: wgsl(/* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let k = bell();
    let base = mix(A(uv), B(uv), smoothstep(0.35, 0.65, p));
    let a = aspect();
    let d = length((uv - vec2f(0.75, 0.7)) * vec2f(a, 1.0)) / max(a, 1.0);
    let t = clamp(d / (0.2 + 1.2 * k), 0.0, 1.0);
    let col = mix(vec3f(1.0, 0.75, 0.35), vec3f(1.0, 0.25, 0.05), t);
    let alpha = mix(min(1.0, k * 1.4), 0.0, t);
    let burn = col * alpha;
    return vec4f(vec3f(1.0) - (vec3f(1.0) - base.rgb) * (vec3f(1.0) - burn), max(base.a, alpha));
}`),
	},
	{
		type: "kadr.transition.dipToWhite",
		name: "Dip to White",
		category: "Film & Fade",
		defaultDuration: 0.5,
		wgsl: wgsl(/* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let white = vec4f(1.0);
    if (p < 0.5) { return mix(A(uv), white, ease_in_out_sine(p * 2.0)); }
    return mix(white, B(uv), ease_in_out_sine((p - 0.5) * 2.0));
}`),
	},
	{
		type: "kadr.transition.blurDissolve",
		name: "Blur Dissolve",
		category: "Film & Fade",
		defaultDuration: 0.6,
		numberParams: [blurAmount],
		pack: packWith([blurAmount]),
		wgsl: wgsl(/* wgsl */ `
fn disk(uv: vec2f, r: vec2f, from_a: bool) -> vec4f {
    var acc = vec4f(0.0);
    for (var n = 0; n < 16; n++) {
        let f = f32(n);
        let ang = f * 2.39996323;
        let rad = sqrt((f + 0.5) / 16.0);
        let q = uv + vec2f(cos(ang), sin(ang)) * rad * r;
        acc += select(orig(q), src(q), from_a);
    }
    return acc / 16.0;
}
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let r = texel() * P0().x * (fx.resolution.x / 1920.0) * bell() * 1.5;
    return mix(disk(uv, r, true), disk(uv, r, false), ease_in_out_sine(p));
}`),
	},
	{
		type: "kadr.transition.wipe",
		name: "Soft Wipe",
		category: "Wipe & Slide",
		defaultDuration: 0.5,
		params: [WIPE_DIRECTION],
		numberParams: [softness],
		pack: packWith([softness], wipeDirSlot(0)),
		wgsl: wgsl(/* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let d = dir_vec(P0().x);
    let soft = max(0.002, P0().y * 0.5);
    let e = -soft / 2.0 + ease_in_out_cubic(fx.progress) * (1.0 + soft);
    let m = 1.0 - smoothstep(e - soft / 2.0, e + soft / 2.0, axis_pos(uv, d));
    return mix(A(uv), B(uv), m);
}`),
	},
	{
		type: "kadr.transition.push",
		name: "Push",
		category: "Wipe & Slide",
		defaultDuration: 0.5,
		params: [DIRECTION_PARAM],
		pack: packWith([], dirSlot(0)),
		wgsl: wgsl(/* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let d = dir_vec(P0().x);
    let e = ease_in_out_cubic(fx.progress);
    let spread = bell() * 0.04;
    var acc = vec4f(0.0);
    for (var n = 0; n < 8; n++) {
        let f = (f32(n) / 7.0 - 0.5) * spread;
        acc += strip(uv, d, e + f);
    }
    return acc / 8.0;
}`),
	},
	{
		type: "kadr.transition.zoom",
		name: "Cross Zoom",
		category: "Zoom & Blur",
		defaultDuration: 0.6,
		numberParams: [zoomAmount, zoomBlur],
		pack: packWith([zoomAmount, zoomBlur]),
		wgsl: wgsl(/* wgsl */ `
fn zoomed(uv: vec2f, s: f32, amount: f32, from_a: bool) -> vec4f {
    var acc = vec4f(0.0);
    for (var n = 0; n < 12; n++) {
        let f = f32(n) / 11.0;
        let q = zoom_uv(uv, vec2f(0.5), s * (1.0 + amount * f));
        acc += select(orig(q), src(q), from_a);
    }
    return acc / 12.0;
}
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let za = P0().x;
    let amount = P0().y * 0.16 * pow(bell(), 2.0);
    let a = zoomed(uv, 1.0 + za * ease_in3(min(p / 0.6, 1.0)), amount, true);
    let b = zoomed(uv, 1.0 + za * (1.0 - ease_out3(max((p - 0.4) / 0.6, 0.0))), amount, false);
    return mix(a, b, smoothstep(0.4, 0.6, p));
}`),
	},
	{
		type: "kadr.transition.iris",
		name: "Iris",
		category: "Wipe & Slide",
		defaultDuration: 0.6,
		numberParams: [irisSoftness],
		pack: packWith([irisSoftness]),
		wgsl: wgsl(/* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let a = aspect();
    let hd = length(vec2f(a, 1.0)) / 2.0;
    let s = max(0.002, P0().x * hd);
    let r = ease_in_out_cubic(fx.progress) * (hd + s);
    let d = length((uv - vec2f(0.5)) * vec2f(a, 1.0));
    let m = 1.0 - smoothstep(max(0.0, r - s), max(r, 0.0001), d);
    return mix(A(uv), B(uv), m);
}`),
	},
];
