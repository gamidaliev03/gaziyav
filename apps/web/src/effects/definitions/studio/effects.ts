import type { EffectDefinition } from "@/effects/types";
import { bool, defineShaderEffect, num, numberParam, rgb } from "./shader-effect";

// follow docs/effects-research.md and Kadr's own effect parameters.
// uv origin is top-left; colors are gamma-encoded sRGB, straight alpha.

const CAMERA = "Camera";
const LIGHT = "Light";
const STYLE = "Style";
const RETRO = "Retro";

// ── Пунч-зум ────────────────────────────────────────────────────────────────
const ZOOM_PUNCH_WGSL = /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let amount = P0().x;
    let attack = max(P0().y, 0.001);
    let blur = P0().z;
    let k = ease_out_cubic(fx.time / attack);
    let s = 1.0 + amount * k;
    let c = vec2f(P1().x, P1().y);
    // short zoom blur while the punch is moving
    let smear = blur * amount * (1.0 - clamp(fx.time / attack, 0.0, 1.0));
    var acc = vec4f(0.0);
    for (var i = 0; i < 8; i++) {
        let f = f32(i) / 7.0;
        acc += src_bounded(zoom_uv(uv, c, s * (1.0 - smear * f * 0.5)));
    }
    return acc / 8.0;
}`;

export const zoomPunchEffect = defineShaderEffect({
	type: "studio.zoomPunch",
	name: "Zoom Punch",
	keywords: ["zoom", "punch", "наезд", "зум", "пунч"],
	category: CAMERA,
	params: [
		numberParam("amount", "Amount, %", 15, 0, 60, 1),
		numberParam("attack", "Speed, s", 0.12, 0.02, 1, 0.01),
		numberParam("blur", "Motion blur", 0.6, 0, 1, 0.05),
		numberParam("centerX", "Center X", 50, 0, 100, 1),
		numberParam("centerY", "Center Y", 45, 0, 100, 1),
	],
	wgsl: ZOOM_PUNCH_WGSL,
	pack: ({ p }) => [
		num(p, "amount", 15) / 100,
		num(p, "attack", 0.12),
		num(p, "blur", 0.6),
		0,
		num(p, "centerX", 50) / 100,
		num(p, "centerY", 45) / 100,
	],
	// The library tile's hover preview: a 0.12 s punch is 2–3 frames of a 1.5 s loop and reads as a still
	// zoomed picture. The tile plays it slower so the move is visible; the clip's default stays 0.12 s.
	thumbnailParams: { attack: 0.5 },
});

// ── Плавный наезд (Ken Burns) ───────────────────────────────────────────────
const KEN_BURNS_WGSL = /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let amount = P0().x;
    let zoom_out = P0().y;
    let drift = P0().z;
    let e = ease_in_out_sine(fx.progress);
    let k = select(e, 1.0 - e, zoom_out > 0.5);
    let s = 1.0 + amount * k;
    let c = vec2f(0.5 + drift * (e - 0.5), 0.5);
    return src_bounded(zoom_uv(uv, c, s));
}`;

export const kenBurnsEffect = defineShaderEffect({
	type: "studio.kenBurns",
	name: "Slow Push-In",
	keywords: ["ken burns", "push", "наезд", "дыхание"],
	category: CAMERA,
	params: [
		numberParam("amount", "Amount, %", 8, 0, 40, 1),
		{ key: "zoomOut", label: "Zoom out", type: "boolean", default: false },
		numberParam("drift", "Drift, %", 2, -10, 10, 0.5),
	],
	wgsl: KEN_BURNS_WGSL,
	pack: ({ p }) => [num(p, "amount", 8) / 100, bool(p, "zoomOut"), num(p, "drift", 2) / 100],
});

// ── Тряска / Ручная камера ──────────────────────────────────────────────────
const SHAKE_WGSL = /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let amp = P0().x;
    let freq = P0().y;
    let rot_deg = P0().z;
    let decay = P0().w;
    let seed = P1().x;
    let t = fx.time;
    let env = select(1.0, exp(-t / max(decay, 0.001)), decay > 0.0);
    let x = t * freq + seed;
    let off = vec2f(
        vnoise(x) * 0.7 + vnoise(x * 2.13 + 11.0) * 0.3,
        vnoise(x + 37.0) * 0.7 + vnoise(x * 1.91 + 53.0) * 0.3
    ) * amp * env;
    let rot = (vnoise(x + 71.0) * rot_deg * env) * 0.0174533;
    let zoom = 1.0 + amp * 2.2 + abs(rot_deg) * 0.006;
    let a = aspect();
    var p = (uv - vec2f(0.5)) * vec2f(a, 1.0);
    p = rotate2(p, -rot) / zoom;
    let suv = p / vec2f(a, 1.0) + vec2f(0.5) - off * vec2f(1.0, a);
    return src_bounded(suv);
}`;

export const shakeEffect = defineShaderEffect({
	type: "studio.shake",
	name: "Shake",
	keywords: ["shake", "impact", "тряска", "удар"],
	category: CAMERA,
	params: [
		numberParam("amplitude", "Amount, %", 2.5, 0, 10, 0.1),
		numberParam("frequency", "Frequency, Hz", 12, 0.2, 30, 0.1),
		numberParam("rotation", "Rotation, °", 1.5, 0, 10, 0.1),
		numberParam("decay", "Decay, s", 0.35, 0, 5, 0.05),
		numberParam("seed", "Seed", 0, 0, 99, 1),
	],
	wgsl: SHAKE_WGSL,
	pack: ({ p }) => [
		num(p, "amplitude", 2.5) / 100,
		num(p, "frequency", 12),
		num(p, "rotation", 1.5),
		num(p, "decay", 0.35),
		num(p, "seed", 0) * 17.31,
	],
});

export const handheldEffect = defineShaderEffect({
	type: "studio.handheld",
	name: "Handheld",
	keywords: ["handheld", "drift", "телефон", "рука"],
	category: CAMERA,
	shader: "studio.shake",
	params: [
		numberParam("amplitude", "Amount, %", 0.6, 0, 3, 0.05),
		numberParam("frequency", "Frequency, Hz", 0.9, 0.1, 5, 0.05),
		numberParam("rotation", "Rotation, °", 0.3, 0, 3, 0.05),
		numberParam("seed", "Seed", 0, 0, 99, 1),
	],
	wgsl: SHAKE_WGSL,
	pack: ({ p }) => [
		num(p, "amplitude", 0.6) / 100,
		num(p, "frequency", 0.9),
		num(p, "rotation", 0.3),
		0,
		num(p, "seed", 0) * 17.31 + 5.0,
	],
});

// ── Вспышка ─────────────────────────────────────────────────────────────────
const FLASH_WGSL = /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let strength = P0().x;
    let len = max(P0().y, 0.04);
    let period = P0().z;
    let col = P1().xyz;
    var t = fx.time;
    if (period > 0.0) { t = t - floor(t / period) * period; }
    let attack = 1.0 / 30.0;
    let up = clamp(t / attack, 0.0, 1.0);
    let down = 1.0 - clamp((t - attack) / len, 0.0, 1.0);
    let e = up * down * down * strength;
    return vec4f(mix(c.rgb, col, e), c.a);
}`;

export const flashEffect = defineShaderEffect({
	type: "studio.flash",
	name: "Flash",
	keywords: ["flash", "вспышка", "белый"],
	category: LIGHT,
	params: [
		numberParam("strength", "Amount", 0.9, 0, 1, 0.05),
		numberParam("length", "Length, s", 0.2, 0.04, 1.5, 0.01),
		numberParam("rate", "Repeats per second", 0, 0, 3, 0.5),
		{ key: "color", label: "Color", type: "color", default: "#ffffff" },
	],
	wgsl: FLASH_WGSL,
	pack: ({ p }) => {
		// ≤ 3 flashes per second (WCAG 2.3.1)
		const rate = Math.min(3, Math.max(0, num(p, "rate", 0)));
		return [
			num(p, "strength", 0.9),
			num(p, "length", 0.2),
			rate > 0 ? 1 / rate : 0,
			0,
			...rgb(p, "color", [1, 1, 1]),
		];
	},
});

// ── Зум-блюр ────────────────────────────────────────────────────────────────
const ZOOM_BLUR_WGSL = /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let decay = P0().y;
    let env = select(1.0, exp(-fx.time / max(decay, 0.001)), decay > 0.0);
    let amount = P0().x * env;
    let c = vec2f(P0().z, P0().w);
    var acc = vec4f(0.0);
    for (var i = 0; i < 24; i++) {
        let f = f32(i) / 23.0;
        acc += src_bounded(c + (uv - c) * (1.0 - amount * f));
    }
    return acc / 24.0;
}`;

export const zoomBlurEffect = defineShaderEffect({
	type: "studio.zoomBlur",
	name: "Zoom Blur",
	keywords: ["zoom blur", "radial", "рывок", "зум"],
	category: CAMERA,
	params: [
		numberParam("amount", "Amount", 0.25, 0, 0.8, 0.01),
		numberParam("decay", "Decay, s", 0, 0, 3, 0.05),
		numberParam("centerX", "Center X", 50, 0, 100, 1),
		numberParam("centerY", "Center Y", 50, 0, 100, 1),
	],
	wgsl: ZOOM_BLUR_WGSL,
	pack: ({ p }) => [
		num(p, "amount", 0.25),
		num(p, "decay", 0),
		num(p, "centerX", 50) / 100,
		num(p, "centerY", 50) / 100,
	],
});

// ── RGB-сдвиг ───────────────────────────────────────────────────────────────
const RGB_SPLIT_WGSL = /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let pulse = P0().z;
    var env = 1.0;
    if (pulse > 0.0) {
        let ph = fx.time * pulse;
        env = exp(-(ph - floor(ph)) * 5.0);
    }
    let amount = P0().x * env;
    let radial = P0().y;
    let dir = select(vec2f(1.0, 0.0), (uv - vec2f(0.5)) * 2.0, radial > 0.5);
    let d = dir * amount * vec2f(1.0, aspect());
    let r = src_bounded(uv + d);
    let g = src(uv);
    let b = src_bounded(uv - d);
    return vec4f(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
}`;

export const rgbSplitEffect = defineShaderEffect({
	type: "studio.rgbSplit",
	name: "RGB Split",
	keywords: ["rgb", "chromatic", "aberration", "хроматическая"],
	category: STYLE,
	params: [
		numberParam("amount", "Amount, %", 0.8, 0, 5, 0.05),
		{ key: "radial", label: "Radial", type: "boolean", default: false },
		numberParam("pulse", "Pulses per second", 0, 0, 3, 0.25),
	],
	wgsl: RGB_SPLIT_WGSL,
	pack: ({ p }) => [num(p, "amount", 0.8) / 100, bool(p, "radial"), num(p, "pulse", 0)],
});

// ── Глитч ───────────────────────────────────────────────────────────────────
const GLITCH_WGSL = /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let intensity = P0().x;
    let freq = P0().y;
    let split = P0().z;
    let fr = floor(fx.frame / 2.0);
    let gate = step(hash11(fr * 1.37 + 0.5), freq * 0.7);
    let amt = intensity * gate;
    var u = uv;
    for (var i = 0; i < 6; i++) {
        let bi = f32(i);
        let y0 = hash11(fr * 7.13 + bi * 13.31);
        let h = 0.015 + 0.07 * hash11(fr * 3.37 + bi * 5.11);
        let inside = step(y0, uv.y) * step(uv.y, y0 + h);
        u.x = u.x + (hash11(fr * 9.71 + bi * 2.93) - 0.5) * 0.3 * amt * inside;
    }
    let d = vec2f(split * amt, 0.0);
    let r = src_bounded(u + d);
    let g = src_bounded(u);
    let b = src_bounded(u - d);
    var c = vec4f(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
    let line = step(0.5, fract(uv.y * fx.resolution.y / 3.0));
    c = vec4f(c.rgb * (1.0 - 0.18 * amt * line), c.a);
    return c;
}`;

export const glitchEffect = defineShaderEffect({
	type: "studio.glitch",
	name: "Glitch",
	keywords: ["glitch", "глитч", "сбой", "digital"],
	category: STYLE,
	params: [
		numberParam("intensity", "Amount", 0.6, 0, 1, 0.05),
		numberParam("frequency", "Frequency", 0.5, 0, 1, 0.05),
		numberParam("split", "Color split, %", 0.8, 0, 4, 0.05),
	],
	wgsl: GLITCH_WGSL,
	pack: ({ p }) => [num(p, "intensity", 0.6), num(p, "frequency", 0.5), num(p, "split", 0.8) / 100],
});

// ── Зерно ───────────────────────────────────────────────────────────────────
const GRAIN_WGSL = /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let amount = P0().x;
    let size = max(P0().y, 0.5);
    let cell = floor(uv * fx.resolution / size);
    let n = hash12(cell + vec2f(fx.frame * 17.13, fx.frame * 31.71)) - 0.5;
    let y = luma(c.rgb);
    let w = 1.0 - abs(y * 2.0 - 1.0) * 0.6;
    let g = n * amount * 0.45 * w;
    return vec4f(clamp(c.rgb + vec3f(g), vec3f(0.0), vec3f(1.0)), c.a);
}`;

export const grainEffect = defineShaderEffect({
	type: "studio.grain",
	name: "Film Grain",
	keywords: ["grain", "film", "зерно", "плёнка", "шум"],
	category: RETRO,
	params: [
		numberParam("amount", "Amount", 0.25, 0, 1, 0.01),
		numberParam("size", "Size, px", 1.5, 0.5, 4, 0.1),
	],
	wgsl: GRAIN_WGSL,
	pack: ({ p, height }) => [num(p, "amount", 0.25), num(p, "size", 1.5) * Math.max(1, height / 1920)],
});

// ── Виньетка ────────────────────────────────────────────────────────────────
const VIGNETTE_WGSL = /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let intensity = P0().x;
    let radius = P0().y;
    let softness = max(P0().z, 0.01);
    let a = aspect();
    let p = (uv - vec2f(0.5)) * vec2f(min(a, 1.0), min(1.0 / a, 1.0)) * 2.0;
    let d = length(p) / 1.41421;
    let k = smoothstep(radius - softness, radius, d * 1.25);
    return vec4f(c.rgb * (1.0 - intensity * k), c.a);
}`;

export const vignetteEffect = defineShaderEffect({
	type: "studio.vignette",
	name: "Vignette",
	keywords: ["vignette", "виньетка", "края"],
	category: LIGHT,
	params: [
		numberParam("intensity", "Amount", 0.5, 0, 1, 0.01),
		numberParam("radius", "Radius", 0.9, 0.2, 1.5, 0.01),
		numberParam("softness", "Softness", 0.6, 0.05, 1.2, 0.01),
	],
	wgsl: VIGNETTE_WGSL,
	pack: ({ p }) => [num(p, "intensity", 0.5), num(p, "radius", 0.9), num(p, "softness", 0.6)],
});

// ── VHS ─────────────────────────────────────────────────────────────────────
const VHS_WGSL = /* wgsl */ `
fn rgb2yiq(c: vec3f) -> vec3f {
    return vec3f(
        dot(c, vec3f(0.299, 0.587, 0.114)),
        dot(c, vec3f(0.596, -0.274, -0.322)),
        dot(c, vec3f(0.211, -0.523, 0.312))
    );
}
fn yiq2rgb(c: vec3f) -> vec3f {
    return vec3f(
        c.x + 0.956 * c.y + 0.621 * c.z,
        c.x - 0.272 * c.y - 0.647 * c.z,
        c.x - 1.106 * c.y + 1.703 * c.z
    );
}
fn effect(uv: vec2f) -> vec4f {
    let amount = P0().x;
    let tracking = P0().y;
    let px = texel().x;
    // tracking band rolling down the frame
    let band_y = fract(fx.time * 0.12);
    let in_band = smoothstep(0.0, 0.04, uv.y - band_y) * (1.0 - smoothstep(0.04, 0.09, uv.y - band_y));
    let line_jit = (hash11(floor(uv.y * fx.resolution.y / 2.0) + fx.frame * 3.1) - 0.5) * px * 2.0 * amount;
    var u = uv + vec2f(line_jit + in_band * tracking * amount * 0.02 * (hash11(fx.frame) - 0.3), 0.0);
    let base = src_bounded(u);
    // horizontal chroma smear
    var chroma = vec3f(0.0);
    for (var i = 0; i < 6; i++) {
        let o = (f32(i) - 1.0) * px * 3.0 * amount;
        chroma += rgb2yiq(src_bounded(u - vec2f(o, 0.0)).rgb);
    }
    chroma = chroma / 6.0;
    var yiq = vec3f(rgb2yiq(base.rgb).x, chroma.y * (1.0 - 0.2 * amount), chroma.z * (1.0 - 0.2 * amount));
    var c = yiq2rgb(yiq);
    // RGB split 3 px
    let rs = src_bounded(u + vec2f(px * 3.0 * amount, 0.0)).r;
    c.r = mix(c.r, rs, 0.5 * amount);
    // noise + scanlines
    let n = hash12(uv * fx.resolution + vec2f(fx.frame * 13.0, fx.frame * 7.0)) - 0.5;
    c = c + vec3f(n * 0.08 * amount) + vec3f(in_band * tracking * amount * 0.12 * n);
    let line = step(0.5, fract(uv.y * fx.resolution.y / 2.0));
    c = c * (1.0 - 0.1 * amount * line);
    return vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), base.a);
}`;

export const vhsEffect = defineShaderEffect({
	type: "studio.vhs",
	name: "VHS",
	keywords: ["vhs", "кассета", "ретро", "retro"],
	category: RETRO,
	params: [
		numberParam("amount", "Amount", 0.7, 0, 1, 0.05),
		{ key: "tracking", label: "Tracking band", type: "boolean", default: true },
	],
	wgsl: VHS_WGSL,
	pack: ({ p }) => [num(p, "amount", 0.7), bool(p, "tracking")],
});

// ── Засветка ────────────────────────────────────────────────────────────────
const LIGHT_LEAK_WGSL = /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let amount = P0().x;
    let speed = P0().y;
    let col = P1().xyz;
    let t = fx.time * speed;
    let a = aspect();
    let p = uv * vec2f(a, 1.0);
    let c1 = vec2f((0.15 + 0.25 * sin(t * 0.7)) * a, 0.2 + 0.3 * cos(t * 0.5));
    let c2 = vec2f((0.85 + 0.2 * cos(t * 0.6 + 1.7)) * a, 0.75 + 0.2 * sin(t * 0.8 + 0.4));
    let g1 = exp(-pow(length(p - c1) / (0.45 * max(a, 1.0)), 2.0));
    let g2 = exp(-pow(length(p - c2) / (0.35 * max(a, 1.0)), 2.0));
    let leak = clamp((col * g1 + mix(col, vec3f(1.0, 0.3, 0.45), 0.5) * g2 * 0.8) * amount, vec3f(0.0), vec3f(1.0));
    let screen = vec3f(1.0) - (vec3f(1.0) - c.rgb) * (vec3f(1.0) - leak);
    return vec4f(screen, c.a);
}`;

export const lightLeakEffect = defineShaderEffect({
	type: "studio.lightLeak",
	name: "Light Leak",
	keywords: ["light leak", "засветка", "плёнка", "тёплый"],
	category: LIGHT,
	params: [
		numberParam("amount", "Amount", 0.6, 0, 1, 0.01),
		numberParam("speed", "Speed", 1, 0, 4, 0.1),
		{ key: "color", label: "Color", type: "color", default: "#ff7326" },
	],
	wgsl: LIGHT_LEAK_WGSL,
	pack: ({ p }) => [num(p, "amount", 0.6), num(p, "speed", 1), 0, 0, ...rgb(p, "color", [1, 0.45, 0.15])],
});

// ── Резкость ────────────────────────────────────────────────────────────────
const SHARPEN_WGSL = /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let amount = P0().x;
    let r = texel() * P0().y;
    var blur = vec3f(0.0);
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            blur += src(uv + vec2f(f32(x), f32(y)) * r).rgb;
        }
    }
    blur = blur / 9.0;
    return vec4f(clamp(c.rgb + (c.rgb - blur) * amount, vec3f(0.0), vec3f(1.0)), c.a);
}`;

export const sharpenEffect = defineShaderEffect({
	type: "studio.sharpen",
	name: "Sharpen",
	keywords: ["sharpen", "резкость", "чёткость"],
	category: STYLE,
	params: [
		numberParam("amount", "Amount", 0.6, 0, 3, 0.05),
		numberParam("radius", "Radius, px", 1.5, 0.5, 6, 0.1),
	],
	wgsl: SHARPEN_WGSL,
	pack: ({ p, width }) => [num(p, "amount", 0.6), num(p, "radius", 1.5) * Math.max(1, width / 1080)],
});

/** Shown in the Effects tab, in ad-priority order (PRIORITIES.md §3.1). */
export const studioEffects: EffectDefinition[] = [
	zoomPunchEffect,
	zoomBlurEffect,
	shakeEffect,
	handheldEffect,
	flashEffect,
	glitchEffect,
	rgbSplitEffect,
	grainEffect,
	vhsEffect,
	vignetteEffect,
	sharpenEffect,
	lightLeakEffect,
	kenBurnsEffect,
];
