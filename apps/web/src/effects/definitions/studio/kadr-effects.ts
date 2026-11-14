import type { EffectDefinition } from "@/effects/types";
import { bool, defineShaderEffect, num, numberParam, rgb } from "./shader-effect";

// Kadr's built-in effects (Kadr's own Swift code: BuiltinEffects.swift,
// CreativeEffects.swift), re-implemented as single-pass WGSL by formula.
// Kadr ids are kept (kadr.effect.<id>). Pixel sizes are at 1920 px width and
// scale with the frame (PX()).

const PX = /* wgsl */ `
fn PX() -> f32 { return fx.resolution.x / 1920.0; }
fn sobel(uv: vec2f, r: vec2f) -> f32 {
    let tl = luma(src(uv + vec2f(-r.x, -r.y)).rgb);
    let t = luma(src(uv + vec2f(0.0, -r.y)).rgb);
    let tr = luma(src(uv + vec2f(r.x, -r.y)).rgb);
    let l = luma(src(uv + vec2f(-r.x, 0.0)).rgb);
    let rr = luma(src(uv + vec2f(r.x, 0.0)).rgb);
    let bl = luma(src(uv + vec2f(-r.x, r.y)).rgb);
    let b = luma(src(uv + vec2f(0.0, r.y)).rgb);
    let br = luma(src(uv + vec2f(r.x, r.y)).rgb);
    let gx = -tl - 2.0 * l - bl + tr + 2.0 * rr + br;
    let gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
    return length(vec2f(gx, gy));
}
fn disk_blur(uv: vec2f, radius: vec2f) -> vec4f {
    var acc = vec4f(0.0);
    for (var n = 0; n < 16; n++) {
        let f = f32(n);
        let ang = f * 2.39996323;
        let rad = sqrt((f + 0.5) / 16.0);
        acc += src(uv + vec2f(cos(ang), sin(ang)) * rad * radius);
    }
    return acc / 16.0;
}
fn grain_at(uv: vec2f, seed: f32) -> f32 {
    return hash12(floor(uv * fx.resolution / max(1.0, 1.5 * PX())) + vec2f(seed * 17.13, seed * 31.71)) - 0.5;
}
fn overlay(base: vec3f, blend: vec3f) -> vec3f {
    return select(vec3f(1.0) - 2.0 * (vec3f(1.0) - base) * (vec3f(1.0) - blend), 2.0 * base * blend, base < vec3f(0.5));
}
`;
const w = (body: string) => `${PX}${body}`;

const FILM = "Film";
const GRAPHIC = "Graphic";
const DISTORT = "Distort";
const LENS = "Lens";
const CAMERA = "Camera";
const COLOR = "Color";
const STYLE = "Style";
const KEYING = "Keying";
const LIGHT = "Light";

export const kadrEffects: EffectDefinition[] = [
	defineShaderEffect({
		type: "kadr.effect.blackWhite",
		name: "Black & White",
		keywords: ["mono", "bw", "grayscale", "чб"],
		category: COLOR,
		params: [
			numberParam("red", "Red", 0.3, -1, 2, 0.01),
			numberParam("green", "Green", 0.59, -1, 2, 0.01),
			numberParam("blue", "Blue", 0.11, -1, 2, 0.01),
			numberParam("contrast", "Contrast", 1, 0.5, 2, 0.01),
			numberParam("toneAmount", "Tone", 0, 0, 1, 0.01),
			{ key: "toneColor", label: "Tone color", type: "color", default: "#dbb885" },
		],
		wgsl: w(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    var y = dot(c.rgb, P0().xyz);
    y = clamp((y - 0.5) * P0().w + 0.5, 0.0, 1.0);
    let tone = P1().yzw / max(luma(P1().yzw), 0.001) * y;
    return vec4f(clamp(mix(vec3f(y), tone, P1().x), vec3f(0.0), vec3f(1.0)), c.a);
}`),
		pack: ({ p }) => [num(p, "red", 0.3), num(p, "green", 0.59), num(p, "blue", 0.11), num(p, "contrast", 1), num(p, "toneAmount", 0), ...rgb(p, "toneColor", [0.86, 0.72, 0.52])],
	}),
	defineShaderEffect({
		type: "kadr.effect.duotone",
		name: "Duotone",
		keywords: ["duotone", "two tone", "gradient map"],
		category: GRAPHIC,
		params: [
			{ key: "shadows", label: "Shadows", type: "color", default: "#1f0d59" },
			{ key: "highlights", label: "Highlights", type: "color", default: "#ff8c59" },
		],
		wgsl: w(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    return vec4f(mix(P0().xyz, P1().xyz, luma(c.rgb)), c.a);
}`),
		pack: ({ p }) => [...rgb(p, "shadows", [0.12, 0.05, 0.35]), 0, ...rgb(p, "highlights", [1, 0.55, 0.35])],
	}),
	defineShaderEffect({
		type: "kadr.effect.posterize",
		name: "Posterize",
		keywords: ["posterize", "levels", "pop art"],
		category: GRAPHIC,
		params: [numberParam("levels", "Levels", 6, 2, 30, 1)],
		wgsl: w(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let l = max(P0().x, 2.0);
    return vec4f(floor(c.rgb * l + 0.5) / l, c.a);
}`),
		pack: ({ p }) => [num(p, "levels", 6)],
	}),
	defineShaderEffect({
		type: "kadr.effect.halftone",
		name: "Halftone",
		keywords: ["halftone", "dots", "print", "cmyk"],
		category: GRAPHIC,
		params: [numberParam("size", "Dot size, px", 8, 2, 40, 0.5), { key: "cmyk", label: "CMYK colour", type: "boolean", default: true }],
		wgsl: w(`
fn dot_cov(uv: vec2f, angle: f32, size: f32, channel: i32, cmyk: bool) -> f32 {
    let px = uv * fx.resolution;
    let p = rotate2(px, angle);
    let cell = (floor(p / size) + vec2f(0.5)) * size;
    let center = rotate2(cell, -angle) / fx.resolution;
    let s = src(center).rgb;
    var v = 1.0 - luma(s);
    if (cmyk) {
        let k = 1.0 - max(s.r, max(s.g, s.b));
        let d = max(1.0 - k, 0.001);
        if (channel == 0) { v = (1.0 - s.r - k) / d; }
        if (channel == 1) { v = (1.0 - s.g - k) / d; }
        if (channel == 2) { v = (1.0 - s.b - k) / d; }
        if (channel == 3) { v = k; }
    }
    let r = sqrt(clamp(v, 0.0, 1.0)) * size * 0.72;
    return 1.0 - smoothstep(r - 0.8, r + 0.8, length(p - cell));
}
fn effect(uv: vec2f) -> vec4f {
    let a = src(uv).a;
    let size = max(2.0, P0().x * PX());
    if (P0().y < 0.5) {
        let k = dot_cov(uv, 0.785398, size, 4, false);
        return vec4f(vec3f(1.0 - k), a);
    }
    let cc = dot_cov(uv, 0.261799, size, 0, true);
    let mm = dot_cov(uv, 1.308997, size, 1, true);
    let yy = dot_cov(uv, 0.0, size, 2, true);
    let kk = dot_cov(uv, 0.785398, size, 3, true);
    return vec4f((1.0 - kk) * vec3f(1.0 - cc, 1.0 - mm, 1.0 - yy), a);
}`),
		pack: ({ p }) => [num(p, "size", 8), bool(p, "cmyk") || p.cmyk === undefined ? 1 : 0],
	}),
	defineShaderEffect({
		type: "kadr.effect.comic",
		name: "Comic",
		keywords: ["comic", "cartoon", "ink"],
		category: GRAPHIC,
		params: [numberParam("ink", "Ink", 1, 0, 2, 0.05)],
		wgsl: w(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let e = sobel(uv, texel() * 1.5 * PX());
    let ink = 1.0 - smoothstep(0.15, 0.45, e * P0().x);
    let y = luma(c.rgb);
    let sat = mix(vec3f(y), c.rgb, 1.5);
    let poster = floor(clamp(sat, vec3f(0.0), vec3f(1.0)) * 4.0 + 0.5) / 4.0;
    return vec4f(poster * ink, c.a);
}`),
		pack: ({ p }) => [num(p, "ink", 1)],
	}),
	defineShaderEffect({
		type: "kadr.effect.neon",
		name: "Neon Edges",
		keywords: ["neon", "edges", "glow", "outline"],
		category: GRAPHIC,
		params: [
			{ key: "color", label: "Color", type: "color", default: "#33e6ff" },
			numberParam("glow", "Glow", 0.8, 0, 2, 0.05),
			numberParam("darken", "Darken", 0.7, 0, 1, 0.05),
		],
		wgsl: w(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let r = texel() * PX();
    let e = clamp(sobel(uv, r) * 3.0, 0.0, 1.0);
    var halo = 0.0;
    for (var n = 0; n < 4; n++) {
        let ang = f32(n) * 1.5707963 + 0.785398;
        halo += clamp(sobel(uv + vec2f(cos(ang), sin(ang)) * r * 8.0, r) * 3.0, 0.0, 1.0);
    }
    let edge = clamp(e + halo * 0.25 * P1().x, 0.0, 1.0);
    let dark = c.rgb * exp2(-3.0 * P1().y);
    return vec4f(clamp(dark + P0().xyz * edge * (1.0 + P1().x), vec3f(0.0), vec3f(1.0)), c.a);
}`),
		pack: ({ p }) => [...rgb(p, "color", [0.2, 0.9, 1]), 0, num(p, "glow", 0.8), num(p, "darken", 0.7)],
	}),
	defineShaderEffect({
		type: "kadr.effect.filmLook",
		name: "Film Look",
		keywords: ["film", "halation", "cinematic", "kodak"],
		category: FILM,
		params: [numberParam("halation", "Halation", 0.5, 0, 1, 0.01), numberParam("grain", "Grain", 0.35, 0, 1, 0.01)],
		wgsl: w(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let glow = disk_blur(uv, texel() * 18.0 * PX());
    let hi = clamp((glow.rgb - vec3f(0.55)) * 2.2, vec3f(0.0), vec3f(1.0));
    let halo = vec3f(luma(hi)) * vec3f(1.0, 0.35, 0.2) * P0().x;
    var o = vec3f(1.0) - (vec3f(1.0) - c.rgb) * (vec3f(1.0) - halo);
    o = (o - vec3f(0.5)) * 0.94 + vec3f(0.5);
    o = mix(vec3f(luma(o)), o, 0.92) * vec3f(1.03, 1.0, 0.96);
    let g = grain_at(uv, fx.frame) * 0.18 * P0().y + 0.5;
    o = mix(o, overlay(clamp(o, vec3f(0.0), vec3f(1.0)), vec3f(g)), 0.9);
    return vec4f(clamp(o, vec3f(0.0), vec3f(1.0)), c.a);
}`),
		pack: ({ p }) => [num(p, "halation", 0.5), num(p, "grain", 0.35)],
	}),
	defineShaderEffect({
		type: "kadr.effect.oldFilm",
		name: "Old Film",
		keywords: ["old film", "sepia", "scratches", "vintage"],
		category: FILM,
		params: [numberParam("age", "Age", 0.7, 0, 1, 0.01)],
		wgsl: w(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let age = P0().x;
    let y = luma(c.rgb);
    let sepia = vec3f(y * 1.07, y * 0.74, y * 0.43) + vec3f(0.08, 0.04, 0.0);
    var o = mix(c.rgb, sepia, 0.8 * age);
    o = o * exp2((hash11(fx.frame * 1.31) - 0.5) * 0.3 * age);
    let a = aspect();
    let d = length((uv - vec2f(0.5)) * vec2f(a, 1.0)) / length(vec2f(a, 1.0));
    o = o * (1.0 - smoothstep(0.25, 0.75, d) * 0.85 * age);
    let col = floor(uv.x * fx.resolution.x / max(1.0, 2.0 * PX()));
    let scratch = step(0.997, hash11(col * 3.7 + floor(fx.frame / 2.0) * 11.0)) * (0.5 + 0.5 * hash11(uv.y * 40.0 + fx.frame));
    o = vec3f(1.0) - (vec3f(1.0) - o) * (1.0 - scratch * 0.35 * age);
    let g = grain_at(uv, fx.frame) * 0.15 * age + 0.5;
    o = overlay(clamp(o, vec3f(0.0), vec3f(1.0)), vec3f(g));
    return vec4f(clamp(o, vec3f(0.0), vec3f(1.0)), c.a);
}`),
		pack: ({ p }) => [num(p, "age", 0.7)],
	}),
	defineShaderEffect({
		type: "kadr.effect.letterbox",
		name: "Cinematic Bars",
		keywords: ["letterbox", "bars", "cinema", "2.39"],
		category: FILM,
		params: [
			{
				key: "ratio",
				label: "Ratio",
				type: "select",
				default: "2.39",
				options: [
					{ value: "2.39", label: "2.39:1" },
					{ value: "2.0", label: "2:1" },
					{ value: "1.85", label: "1.85:1" },
					{ value: "1.33", label: "4:3" },
				],
			},
		],
		wgsl: w(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let ratio = P0().x;
    let a = aspect();
    var bar = 0.0;
    if (a < ratio) {
        let h = (1.0 - a / ratio) / 2.0;
        bar = step(uv.y, h) + step(1.0 - h, uv.y);
    } else {
        let wd = (1.0 - ratio / a) / 2.0;
        bar = step(uv.x, wd) + step(1.0 - wd, uv.x);
    }
    return select(c, vec4f(0.0, 0.0, 0.0, 1.0), bar > 0.5);
}`),
		pack: ({ p }) => [Number.parseFloat(String(p.ratio ?? "2.39")) || 2.39],
	}),
	defineShaderEffect({
		type: "kadr.effect.kaleidoscope",
		name: "Kaleidoscope",
		keywords: ["kaleidoscope", "mirror", "psychedelic"],
		category: DISTORT,
		params: [numberParam("count", "Segments", 6, 2, 24, 1), numberParam("angle", "Angle, °", 0, 0, 360, 1)],
		wgsl: w(`
fn effect(uv: vec2f) -> vec4f {
    let a = aspect();
    let p = (uv - vec2f(0.5)) * vec2f(a, 1.0);
    let seg = 6.2831853 / max(P0().x, 2.0);
    var ang = atan2(p.y, p.x) - P0().y;
    ang = ang - floor(ang / seg) * seg;
    ang = abs(ang - seg * 0.5) + P0().y;
    let q = vec2f(cos(ang), sin(ang)) * length(p);
    let suv = q / vec2f(a, 1.0) + vec2f(0.5);
    return src(vec2f(1.0) - abs(fract(suv * 0.5) * 2.0 - vec2f(1.0)));
}`),
		pack: ({ p }) => [num(p, "count", 6), (num(p, "angle", 0) * Math.PI) / 180],
	}),
	defineShaderEffect({
		type: "kadr.effect.mirror",
		name: "Mirror",
		keywords: ["mirror", "symmetry", "reflect"],
		category: DISTORT,
		params: [
			{
				key: "axis",
				label: "Axis",
				type: "select",
				default: "vertical",
				options: [
					{ value: "vertical", label: "Left → right" },
					{ value: "horizontal", label: "Top → bottom" },
				],
			},
		],
		wgsl: w(`
fn effect(uv: vec2f) -> vec4f {
    var q = uv;
    if (P0().x < 0.5) { if (q.x > 0.5) { q.x = 1.0 - q.x; } } else { if (q.y > 0.5) { q.y = 1.0 - q.y; } }
    return src(q);
}`),
		pack: ({ p }) => [p.axis === "horizontal" ? 1 : 0],
	}),
	defineShaderEffect({
		type: "kadr.effect.tiltShift",
		name: "Tilt-Shift",
		keywords: ["tilt shift", "miniature", "toy"],
		category: LENS,
		params: [
			numberParam("radius", "Blur, px", 14, 0, 60, 0.5),
			numberParam("center", "Center", 0.5, 0, 1, 0.01),
			numberParam("band", "Sharp band", 0.18, 0.02, 0.8, 0.01),
		],
		wgsl: w(`
fn effect(uv: vec2f) -> vec4f {
    let half = P0().z * 0.5;
    let m = smoothstep(half, half * 3.0, abs(uv.y - P0().y));
    let c = disk_blur(uv, texel() * P0().x * PX() * m * 1.6);
    let y = luma(c.rgb);
    return vec4f(clamp(mix(vec3f(y), c.rgb, 1.2), vec3f(0.0), vec3f(1.0)), c.a);
}`),
		pack: ({ p }) => [num(p, "radius", 14), num(p, "center", 0.5), num(p, "band", 0.18)],
	}),
	defineShaderEffect({
		type: "kadr.effect.nightVision",
		name: "Night Vision",
		keywords: ["night vision", "green", "spy"],
		category: CAMERA,
		params: [numberParam("noise", "Noise", 0.25, 0, 1, 0.01)],
		wgsl: w(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    var o = vec3f(0.2, 1.0, 0.3) * luma(c.rgb) * exp2(0.6);
    let n = max(grain_at(uv, fx.frame) + 0.5, 0.0) * P0().x;
    o = vec3f(1.0) - (vec3f(1.0) - o) * (vec3f(1.0) - vec3f(n * 0.2, n, n * 0.3));
    let a = aspect();
    let d = length((uv - vec2f(0.5)) * vec2f(a, 1.0)) / length(vec2f(a, 1.0));
    o = o * (1.0 - smoothstep(0.2, 0.62, d));
    return vec4f(clamp(o, vec3f(0.0), vec3f(1.0)), c.a);
}`),
		pack: ({ p }) => [num(p, "noise", 0.25)],
	}),
	defineShaderEffect({
		type: "kadr.effect.thermal",
		name: "Thermal",
		keywords: ["thermal", "heat", "infrared"],
		category: CAMERA,
		params: [],
		wgsl: w(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let t = clamp(luma(c.rgb), 0.0, 1.0) * 4.0;
    let i = floor(min(t, 3.999));
    let f = t - i;
    var a = vec3f(0.0, 0.0, 0.0);
    var b = vec3f(0.1, 0.0, 0.8);
    if (i > 0.5) { a = vec3f(0.1, 0.0, 0.8); b = vec3f(0.85, 0.0, 0.6); }
    if (i > 1.5) { a = vec3f(0.85, 0.0, 0.6); b = vec3f(1.0, 0.45, 0.0); }
    if (i > 2.5) { a = vec3f(1.0, 0.45, 0.0); b = vec3f(1.0, 1.0, 0.6); }
    return vec4f(mix(a, b, f), c.a);
}`),
		pack: () => [0],
	}),
	defineShaderEffect({
		type: "kadr.effect.glow",
		name: "Glow",
		keywords: ["glow", "bloom", "dreamy", "soft"],
		category: LIGHT,
		params: [numberParam("intensity", "Intensity", 0.6, 0, 2, 0.01), numberParam("radius", "Radius, px", 20, 0, 120, 1)],
		wgsl: w(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let b = disk_blur(uv, texel() * P0().y * PX() * 1.5);
    let bright = clamp((b.rgb - vec3f(0.6)) * 2.5, vec3f(0.0), vec3f(1.0)) * P0().x;
    return vec4f(vec3f(1.0) - (vec3f(1.0) - c.rgb) * (vec3f(1.0) - clamp(bright, vec3f(0.0), vec3f(1.0))), c.a);
}`),
		pack: ({ p }) => [num(p, "intensity", 0.6), num(p, "radius", 20)],
	}),
	defineShaderEffect({
		type: "kadr.effect.mosaic",
		name: "Mosaic",
		keywords: ["mosaic", "pixelate", "censor", "blur face"],
		category: STYLE,
		params: [numberParam("cellSize", "Cell, px", 24, 2, 200, 1)],
		wgsl: w(`
fn effect(uv: vec2f) -> vec4f {
    let cell = max(2.0, P0().x * PX()) * texel();
    let base = floor(uv / cell) * cell;
    var acc = vec4f(0.0);
    acc += src(base + cell * vec2f(0.25, 0.25));
    acc += src(base + cell * vec2f(0.75, 0.25));
    acc += src(base + cell * vec2f(0.25, 0.75));
    acc += src(base + cell * vec2f(0.75, 0.75));
    return acc / 4.0;
}`),
		pack: ({ p }) => [num(p, "cellSize", 24)],
	}),
	defineShaderEffect({
		type: "kadr.effect.chromaKey",
		name: "Chroma Key",
		keywords: ["chroma key", "green screen", "keying", "хромакей"],
		category: KEYING,
		params: [
			{ key: "keyColor", label: "Key color", type: "color", default: "#1acc40" },
			numberParam("tolerance", "Tolerance", 0.3, 0, 1, 0.01),
			numberParam("softness", "Softness", 0.2, 0, 1, 0.01),
			numberParam("spill", "Spill", 0.6, 0, 1, 0.01),
			{ key: "matte", label: "Show matte", type: "boolean", default: false },
		],
		wgsl: w(`
fn cbcr(c: vec3f) -> vec2f {
    let y = dot(c, vec3f(0.2126, 0.7152, 0.0722));
    return vec2f((c.b - y) / 1.8556, (c.r - y) / 1.5748);
}
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let key = P0().xyz;
    let d = distance(cbcr(c.rgb), cbcr(key)) * 2.0;
    let tol = P1().x * 0.5;
    let alpha = smoothstep(tol, tol + max(P1().y * 0.5, 0.001), d);
    // spill: pull the key hue out of the remaining edge pixels
    var o = c.rgb;
    let kmax = max(key.r, max(key.g, key.b));
    if (key.g >= kmax) { o.g = mix(o.g, min(o.g, (o.r + o.b) * 0.5), P1().z * (1.0 - alpha * 0.5)); }
    if (key.b >= kmax && key.g < kmax) { o.b = mix(o.b, min(o.b, (o.r + o.g) * 0.5), P1().z * (1.0 - alpha * 0.5)); }
    if (P1().w > 0.5) { return vec4f(vec3f(alpha * c.a), 1.0); }
    return vec4f(o, c.a * alpha);
}`),
		pack: ({ p }) => [...rgb(p, "keyColor", [0.1, 0.8, 0.25]), 0, num(p, "tolerance", 0.3), num(p, "softness", 0.2), num(p, "spill", 0.6), bool(p, "matte")],
	}),
	defineShaderEffect({
		type: "kadr.effect.denoise",
		name: "Denoise",
		keywords: ["denoise", "noise reduction", "clean", "smooth skin"],
		category: STYLE,
		params: [numberParam("level", "Level", 0.02, 0, 0.1, 0.001)],
		wgsl: w(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let sr = max(P0().x * 4.0, 0.0001);
    var acc = vec3f(0.0);
    var wsum = 0.0;
    for (var y = -2; y <= 2; y++) {
        for (var x = -2; x <= 2; x++) {
            let o = vec2f(f32(x), f32(y));
            let s = src(uv + o * texel() * PX()).rgb;
            let d = s - c.rgb;
            let wgt = exp(-dot(o, o) / 4.5) * exp(-dot(d, d) / (2.0 * sr * sr));
            acc += s * wgt;
            wsum += wgt;
        }
    }
    return vec4f(acc / wsum, c.a);
}`),
		pack: ({ p }) => [num(p, "level", 0.02)],
	}),
	defineShaderEffect({
		type: "kadr.effect.colorWheels",
		name: "Color Wheels",
		keywords: ["color wheels", "lift gamma gain", "grade", "tint"],
		category: COLOR,
		thumbnailParams: { shadowsTintX: -0.7, shadowsTintY: -0.5, highsTintX: 0.8, highsTintY: 0.3, mids: 0.05 },
		params: [
			numberParam("shadowsTintX", "Shadows tint X", 0, -1, 1, 0.01),
			numberParam("shadowsTintY", "Shadows tint Y", 0, -1, 1, 0.01),
			numberParam("shadows", "Shadows level", 0, -0.5, 0.5, 0.01),
			numberParam("midsTintX", "Midtones tint X", 0, -1, 1, 0.01),
			numberParam("midsTintY", "Midtones tint Y", 0, -1, 1, 0.01),
			numberParam("mids", "Midtones level", 0, -0.5, 0.5, 0.01),
			numberParam("highsTintX", "Highlights tint X", 0, -1, 1, 0.01),
			numberParam("highsTintY", "Highlights tint Y", 0, -1, 1, 0.01),
			numberParam("highs", "Highlights level", 0, -0.5, 0.5, 0.01),
		],
		wgsl: w(`
fn wheel(v: vec2f) -> vec3f {
    // atan2(0, 0) is NaN on some GPUs: a centred wheel is no tint
    if (length(v) < 0.00001) { return vec3f(0.0); }
    let a = atan2(v.y, v.x);
    let r = min(1.0, length(v)) * 0.25;
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
}`),
		pack: ({ p }) => [
			num(p, "shadowsTintX", 0), num(p, "shadowsTintY", 0), num(p, "shadows", 0), 0,
			num(p, "midsTintX", 0), num(p, "midsTintY", 0), num(p, "mids", 0), 0,
			num(p, "highsTintX", 0), num(p, "highsTintY", 0), num(p, "highs", 0),
		],
	}),
	defineShaderEffect({
		type: "kadr.effect.mask",
		name: "Shape Mask",
		keywords: ["mask", "shape", "ellipse", "vignette mask"],
		category: STYLE,
		params: [
			{
				key: "shape",
				label: "Shape",
				type: "select",
				default: "ellipse",
				options: [
					{ value: "ellipse", label: "Ellipse" },
					{ value: "rectangle", label: "Rectangle" },
					{ value: "linear", label: "Linear" },
					{ value: "mirror", label: "Band" },
				],
			},
			numberParam("x", "Center X", 0.5, 0, 1, 0.01),
			numberParam("y", "Center Y", 0.5, 0, 1, 0.01),
			numberParam("width", "Width", 0.6, 0.01, 2, 0.01),
			numberParam("height", "Height", 0.6, 0.01, 2, 0.01),
			numberParam("rotation", "Rotation, °", 0, -180, 180, 1),
			numberParam("feather", "Feather", 0.05, 0, 0.5, 0.005),
			{ key: "invert", label: "Invert", type: "boolean", default: false },
		],
		wgsl: w(`
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let res = fx.resolution;
    // Kadr's y axis points up
    let center = vec2f(P0().y, 1.0 - P0().z) * res;
    let size = vec2f(P0().w, P1().x) * res;
    let p = rotate2(uv * res - center, P1().y);
    let shape = P0().x;
    var sd = 0.0;
    if (shape < 0.5) {
        let r = min(size.x, size.y) * 0.5;
        sd = (length(p / (size * 0.5)) - 1.0) * r;
    } else if (shape < 1.5) {
        let q = abs(p) - size * 0.5;
        sd = max(q.x, q.y);
    } else if (shape < 2.5) {
        sd = -p.y;
    } else {
        sd = abs(p.y) - size.y * 0.5;
    }
    let f = max(0.75, P1().z * min(res.x, res.y) * 1.5);
    var m = 1.0 - smoothstep(-f, f, sd);
    if (P1().w > 0.5) { m = 1.0 - m; }
    return vec4f(c.rgb, c.a * m);
}`),
		pack: ({ p }) => {
			const shapes = ["ellipse", "rectangle", "linear", "mirror"];
			return [
				Math.max(0, shapes.indexOf(String(p.shape ?? "ellipse"))),
				num(p, "x", 0.5),
				num(p, "y", 0.5),
				num(p, "width", 0.6),
				num(p, "height", 0.6),
				(num(p, "rotation", 0) * Math.PI) / 180,
				num(p, "feather", 0.05),
				bool(p, "invert"),
			];
		},
	}),

];
