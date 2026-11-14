import { defineShaderSource } from "@/effects/shader-sources";
import type { ParamValues } from "@/params";
import type { TransitionDefinition } from "./types";
import { GL_TRANSITIONS } from "./gl";

// docs/effects-research.md §2 and Kadr's creative transitions.
// In a transition pass: src() = outgoing clip (A), orig() = incoming clip (B),
// fx.progress = 0..1 through the transition window.

import { COMMON, DIRECTION_PARAM, directionIndex } from "./common";
import { KADR_TRANSITIONS } from "./kadr";
import { PRO_TRANSITIONS } from "./pro";

export { COMMON, DIRECTION_PARAM, directionIndex };

// Helpers for the trend recipes of docs/creative-trends.md §2 (П1–П6): mirrored edges (no black borders when a
// frame is shifted, rotated or scaled below 1), the recipe curves, value noise. Prefixed `tr_` so they never clash
// with Kadr's helpers.
const TREND = /* wgsl */ `
fn tr_m1(x: f32) -> f32 { let t = fract(x * 0.5) * 2.0; return select(t, 2.0 - t, t > 1.0); }
fn tr_mirror(uv: vec2f) -> vec2f { return vec2f(tr_m1(uv.x), tr_m1(uv.y)); }
fn Am(uv: vec2f) -> vec4f { return src(tr_mirror(uv)); }
fn Bm(uv: vec2f) -> vec4f { return orig(tr_mirror(uv)); }
fn tr_in_quart(t: f32) -> f32 { let x = clamp(t, 0.0, 1.0); return x * x * x * x; }
fn tr_out_quart(t: f32) -> f32 { let x = 1.0 - clamp(t, 0.0, 1.0); return 1.0 - x * x * x * x; }
// Rotate uv about the frame centre, aspect-correct.
fn tr_rotate(uv: vec2f, ang: f32) -> vec2f {
    let a = aspect();
    let q = rotate2((uv - vec2f(0.5)) * vec2f(a, 1.0), -ang);
    return q / vec2f(a, 1.0) + vec2f(0.5);
}
fn tr_noise2(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let a = hash12(i);
    let b = hash12(i + vec2f(1.0, 0.0));
    let c = hash12(i + vec2f(0.0, 1.0));
    let d = hash12(i + vec2f(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Seconds since the cut (the cut sits in the middle of the transition window).
fn tr_since_cut() -> f32 {
    let p = max(fx.progress, 0.0001);
    return fx.time - 0.5 * fx.time / p;
}
`;

const trend = (body: string) => `${COMMON}${TREND}${body}`;

export const TRANSITIONS: TransitionDefinition[] = [
	{
		type: "studio.transition.whip",
		name: "Whip Pan",
		category: "Trending",
		defaultDuration: 0.3,
		params: [DIRECTION_PARAM],
		pack: (p) => [directionIndex(p)],
		// П2: A leaves (0 → 0.5 frame, expo in, 0 → 2°), B arrives (0.5 → 0, expo out, −2° → 0). The motion blur follows
		// the speed, peaking at 0.2 of the frame on the cut. Edges mirrored.
		wgsl: trend(/* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let d = dir_vec(P0().x);
    let into_b = p >= 0.5;
    // expo ramp k = 2^(6·(2p − 1)) (2^−6 at the ends, 1 on the cut) — softer than easeInExpo so 4–5 frames move;
    // shift along d in frame units: A 0 → 0.5, B −0.5 → 0; the blur follows k (the speed)
    let k0 = exp2(-6.0);
    let k = exp2(-6.0 * abs(2.0 * p - 1.0));
    var shift = 0.5 * (k - k0) / (1.0 - k0);
    if (into_b) { shift = -shift; }
    let ang = radians(4.0) * shift;
    let blur = 0.4 * abs(shift);
    let base = tr_rotate(uv, ang) - d * shift;
    var acc = vec4f(0.0);
    if (into_b) {
        for (var i = 0; i < 24; i++) { acc += Bm(base + d * (f32(i) / 23.0 - 0.5) * blur); }
    } else {
        for (var i = 0; i < 24; i++) { acc += Am(base + d * (f32(i) / 23.0 - 0.5) * blur); }
    }
    return acc / 24.0;
}`),
	},
	{
		type: "studio.transition.zoomThrough",
		name: "Zoom Through",
		category: "Trending",
		defaultDuration: 0.34,
		// П1 «Through»: A flies in (scale 1 → 1.35, radial blur 0 → 0.28, +15 % exposure, easeInQuart), the cut sits on
		// the blur peak, B lands 0.8 → 1 with the blur falling off (easeOutQuart). 24 taps toward the centre, edges mirrored.
		wgsl: trend(/* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let c = vec2f(0.5);
    let into_b = p >= 0.5;
    var e = tr_in_quart(p * 2.0);
    var scale = 1.0 + 0.35 * e;
    if (into_b) {
        e = 1.0 - tr_out_quart((p - 0.5) * 2.0);
        scale = 1.0 - 0.2 * e;
    }
    let strength = 0.28 * e;
    let d = zoom_uv(uv, c, scale) - c;
    var acc = vec4f(0.0);
    if (into_b) {
        for (var i = 0; i < 24; i++) { acc += Bm(c + d * (1.0 - strength * f32(i) / 23.0)); }
    } else {
        for (var i = 0; i < 24; i++) { acc += Am(c + d * (1.0 - strength * f32(i) / 23.0)); }
    }
    let col = acc / 24.0;
    return vec4f(min(col.rgb * (1.0 + 0.15 * e), vec3f(1.0)), col.a);
}`),
	},
	{
		type: "studio.transition.flash",
		name: "Flash",
		category: "Trending",
		defaultDuration: 0.3,
		// П4: white rises over the last frames of A (0 → 0.85), the cut, then B comes out of the white (0.85 → 0,
		// easeOutQuad) with its highlights blooming (threshold 0.7, fading with the white).
		wgsl: trend(/* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    if (p < 0.5) {
        let a = A(uv);
        let w = 0.85 * pow(smoothstep(0.15, 0.5, p), 2.0);
        return vec4f(mix(a.rgb, vec3f(1.0), w), max(a.a, w));
    }
    let t = (p - 0.5) * 2.0;
    let k = (1.0 - t) * (1.0 - t);
    let b = B(uv);
    let r = vec2f(1.0 / aspect(), 1.0);
    var glow = vec3f(0.0);
    for (var i = 0; i < 12; i++) {
        let ang = f32(i) * 0.5235988;
        let rad = select(0.012, 0.03, i % 2 == 1);
        glow += max(B(uv + vec2f(cos(ang), sin(ang)) * rad * r).rgb - vec3f(0.7), vec3f(0.0));
    }
    let lit = min(b.rgb + glow * (2.4 / 12.0) * k + max(b.rgb - vec3f(0.7), vec3f(0.0)) * 1.2 * k, vec3f(1.0));
    let w = 0.85 * k;
    return vec4f(mix(lit, vec3f(1.0), w), max(b.a, w));
}`),
	},
	{
		type: "studio.transition.spin",
		name: "Spin",
		category: "Trending",
		defaultDuration: 0.4,
		wgsl: /* wgsl */ `${COMMON}
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let a = aspect();
    let s = 1.0 + 0.9 * bell();
    let spread = bell() * 0.35;
    var acc = vec4f(0.0);
    for (var i = 0; i < 10; i++) {
        let f = f32(i) / 9.0 - 0.5;
        let ang = select(-1.5707963 * (1.0 - ease_out_cubic((p - 0.5) * 2.0)), 1.5707963 * ease_in_cubic(p * 2.0), p < 0.5) + f * spread;
        var q = (uv - vec2f(0.5)) * vec2f(a, 1.0);
        q = rotate2(q, -ang) / s;
        let suv = q / vec2f(a, 1.0) + vec2f(0.5);
        let m = vec2f(1.0) - abs(fract(suv * 0.5) * 2.0 - vec2f(1.0));
        acc += select(B(m), A(m), p < 0.5);
    }
    return acc / 10.0;
}`,
	},
	{
		type: "studio.transition.glitch",
		name: "Glitch",
		category: "Trending",
		defaultDuration: 0.27,
		// П5: every frame 6–14 bands, about half of them shifted ±3–8 % of the width; R/B split 0.6–1.2 %; scanlines
		// −10 %; a quarter of the frames stick (repeat the previous frame's bands) and posterize to 6 levels. Around the
		// cut the shifted bands show A or B at random. Seeded by the frame index, so preview = export.
		wgsl: trend(/* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let amt = bell();
    var fr = floor(fx.frame);
    let stuck = hash11(fr * 1.37 + 5.0) < 0.25 && amt > 0.3;
    if (stuck) { fr = fr - 1.0; }
    let band = floor(uv.y * mix(6.0, 14.0, hash11(fr * 3.1 + 1.0)));
    let on = step(0.5, hash12(vec2f(band + 7.0, fr)));
    let mag = mix(0.03, 0.08, hash12(vec2f(band, fr + 3.0)));
    let sgn = select(-1.0, 1.0, hash12(vec2f(band + 1.0, fr)) > 0.5);
    let u = uv + vec2f(sgn * mag * on * amt, 0.0);
    let ca = vec2f(mix(0.006, 0.012, hash11(fr + 9.0)) * amt, 0.0);
    let swap = on > 0.5 && amt > 0.5;
    let use_b = select(p >= 0.5, hash12(vec2f(band + 3.0, fr * 1.7)) < smoothstep(0.3, 0.7, p), swap);
    var c = vec4f(0.0);
    if (use_b) {
        c = vec4f(Bm(u - ca).r, Bm(u).g, Bm(u + ca).b, Bm(u).a);
    } else {
        c = vec4f(Am(u - ca).r, Am(u).g, Am(u + ca).b, Am(u).a);
    }
    var rgb = c.rgb;
    if (stuck) { rgb = floor(rgb * 5.999) / 5.0; }
    let line = step(0.5, fract(uv.y * fx.resolution.y / 4.0));
    return vec4f(rgb * (1.0 - 0.1 * amt * line), c.a);
}`),
	},
	{
		type: "studio.transition.slide",
		name: "Slide",
		category: "Trending",
		defaultDuration: 0.4,
		params: [DIRECTION_PARAM],
		pack: (p) => [directionIndex(p)],
		wgsl: /* wgsl */ `${COMMON}
fn effect(uv: vec2f) -> vec4f {
    let d = dir_vec(P0().x);
    let e = ease_in_out_cubic(fx.progress);
    // B slides in over A (A stays), with a light motion blur on B
    let blur = bell() * 0.06;
    var acc = vec4f(0.0);
    for (var i = 0; i < 8; i++) {
        let f = (f32(i) / 7.0 - 0.5) * blur;
        let q = uv + d * (1.0 - e + f);
        let in_b = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
        let b = B(q);
        let a = A(uv);
        acc += mix(a, b, in_b * b.a);
    }
    return acc / 8.0;
}`,
	},
	{
		type: "studio.transition.dissolve",
		name: "Dissolve",
		category: "Trending",
		defaultDuration: 0.5,
		wgsl: /* wgsl */ `${COMMON}
fn effect(uv: vec2f) -> vec4f {
    let t = ease_in_out_sine(fx.progress);
    return mix(A(uv), B(uv), t);
}`,
	},
	{
		type: "studio.transition.lightLeak",
		name: "Light Leak",
		category: "Trending",
		defaultDuration: 0.6,
		// П6 (procedural, no assets): three soft blobs (#FF7A1A, #FF2E88, #FFD34D) drift across the frame in screen
		// mode, their shape broken up by low-frequency noise; intensity is a sine peaking on the cut; A → B crossfade in
		// the middle third under the light; 4 % grain while it burns.
		wgsl: trend(/* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let k = pow(bell(), 1.5);
    let base = mix(A(uv), B(uv), smoothstep(0.33, 0.67, p));
    let a = aspect();
    let q = uv * vec2f(a, 1.0);
    let n = tr_noise2(q * 2.5 + vec2f(p * 1.7, -p * 0.9)) * 0.65 + tr_noise2(q * 5.0 - vec2f(p * 2.3, p)) * 0.35;
    let r = 0.3 * max(a, 1.0);
    // the blobs enter from the edges: top-left, right, bottom
    let c1 = vec2f(mix(-0.1, 0.7, p) * a, 0.18);
    let c2 = vec2f(mix(1.1, 0.35, p) * a, 0.62);
    let c3 = vec2f(mix(0.15, 0.6, p) * a, mix(1.05, 0.8, p));
    let shape = (0.6 + 0.8 * n) * k * 0.85;
    let l1 = min(vec3f(1.0, 0.478, 0.102) * exp(-pow(length(q - c1) / r, 2.0)) * shape, vec3f(1.0));
    let l2 = min(vec3f(1.0, 0.18, 0.533) * exp(-pow(length(q - c2) / (r * 0.9), 2.0)) * shape, vec3f(1.0));
    let l3 = min(vec3f(1.0, 0.827, 0.302) * exp(-pow(length(q - c3) / (r * 0.8), 2.0)) * shape, vec3f(1.0));
    // screen the blobs into each other, so overlaps stay warm instead of clipping to white
    let leak = vec3f(1.0) - (vec3f(1.0) - l1) * (vec3f(1.0) - l2) * (vec3f(1.0) - l3);
    let screen = vec3f(1.0) - (vec3f(1.0) - base.rgb) * (vec3f(1.0) - leak);
    let grain = (hash12(uv * fx.resolution + vec2f(fx.frame * 17.0, fx.frame * 5.0)) - 0.5) * 0.08 * k;
    return vec4f(clamp(screen + vec3f(grain), vec3f(0.0), vec3f(1.0)), max(base.a, max(leak.r, leak.g)));
}`),
	},
	{
		type: "studio.transition.dipBlack",
		name: "Dip to Black",
		category: "Trending",
		defaultDuration: 0.5,
		wgsl: /* wgsl */ `${COMMON}
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let black = vec4f(0.0, 0.0, 0.0, 1.0);
    if (p < 0.5) { return mix(A(uv), black, ease_in_out_sine(p * 2.0)); }
    return mix(black, B(uv), ease_in_out_sine((p - 0.5) * 2.0));
}`,
	},
	{
		type: "studio.transition.shake",
		name: "Shake",
		category: "Trending",
		defaultDuration: 0.5,
		// П3 «Impact»: A runs untouched into the cut, B lands with a hit: position noise 4 % of the width at ~13 Hz
		// decaying with τ = 0.1 s (3 frames at 30), ±1.5° roll, scale 1.08 → 1 (easeOutCubic), RGB split 6 px → 0 and a
		// short motion blur between this frame's shake and the previous one. Edges mirrored.
		wgsl: trend(/* wgsl */ `
fn shake_at(t: f32) -> vec3f {
    let env = exp(-max(t, 0.0) / 0.1);
    return vec3f(vnoise(t * 26.0) * 0.04, vnoise(t * 26.0 + 37.0) * 0.04 * aspect(), vnoise(t * 26.0 + 71.0) * radians(1.5)) * env;
}
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    if (p < 0.5) { return A(uv); }
    let t = tr_since_cut();
    let now = shake_at(t);
    let prev = shake_at(t - 1.0 / 60.0);
    let s = 1.08 - 0.08 * ease_out_cubic((p - 0.5) * 2.0);
    let env = exp(-max(t, 0.0) / 0.1);
    let ca = vec2f(6.0 / fx.resolution.x * env, 0.0);
    var acc = vec4f(0.0);
    for (var i = 0; i < 4; i++) {
        let m = mix(prev, now, f32(i) / 3.0);
        let q = zoom_uv(tr_rotate(uv, m.z), vec2f(0.5), s) - m.xy;
        acc += vec4f(Bm(q + ca).r, Bm(q).g, Bm(q - ca).b, Bm(q).a);
    }
    return acc / 4.0;
}`),
	},
];

/**
 * Library organisation of our own and Kadr's transitions: name and category
 * shown in the browser, and duplicates hidden (still registered so projects
 * that use them keep rendering).
 */
const LIBRARY: Record<string, { name?: string; category?: string; hidden?: boolean }> = {
	"studio.transition.zoomThrough": { name: "Zoom In", category: "Trending" },
	"studio.transition.whip": { category: "Trending" },
	"kadr.transition.flashZoom": { category: "Trending" },
	"studio.transition.shake": { category: "Trending" },
	"studio.transition.spin": { category: "Trending" },
	"studio.transition.glitch": { category: "Trending" },
	"kadr.transition.stretch": { category: "Trending" },
	"studio.transition.lightLeak": { category: "Trending" },
	"studio.transition.slide": { category: "Slide & Push" },
	"kadr.transition.push": { category: "Slide & Push" },
	"kadr.transition.doors": { category: "Shape" },
	"studio.transition.flash": { category: "Light" },
	"kadr.transition.dipToWhite": { category: "Light" },
	"studio.transition.dipBlack": { category: "Light" },
	"kadr.transition.filmBurn": { category: "Film" },
	"kadr.transition.pixelate": { category: "Glitch" },
	"studio.transition.dissolve": { category: "Basic" },
	"kadr.transition.blurDissolve": { name: "Blur", category: "Basic" },
	"kadr.transition.lumaFade": { category: "Basic" },
	"kadr.transition.wipe": { name: "Wipe", category: "Basic" },
	"kadr.transition.iris": { category: "Shape" },
	// duplicates of the ones above
	"kadr.transition.shakeZoom": { hidden: true },
	"kadr.transition.swipeBlur": { hidden: true },
	"kadr.transition.zoom": { hidden: true },
};

/** Every transition the renderer knows: ours, Kadr's, then the GL pack. */
export const ALL_TRANSITIONS: TransitionDefinition[] = [...TRANSITIONS, ...KADR_TRANSITIONS, ...PRO_TRANSITIONS, ...GL_TRANSITIONS].map((d) =>
	LIBRARY[d.type] ? { ...d, ...LIBRARY[d.type] } : d,
);

/** What the Transitions browser shows (curated, no duplicates). */
export const LIBRARY_TRANSITIONS: TransitionDefinition[] = ALL_TRANSITIONS.filter((d) => !d.hidden);

export const TRANSITION_CATEGORY_ORDER = ["Trending", "Seamless", "Camera", "Slide & Push", "Light", "Glitch", "Distortion", "Shape", "3D", "Film", "Basic", "Pattern"];

for (const definition of ALL_TRANSITIONS) {
	defineShaderSource({ id: definition.type, wgsl: definition.wgsl });
}

const byType = new Map(ALL_TRANSITIONS.map((definition) => [definition.type, definition]));

export function getTransitionDefinition(type: string): TransitionDefinition | undefined {
	return byType.get(type);
}

export const DEFAULT_TRANSITION_PARAMS = (definition: TransitionDefinition): ParamValues => ({
	...Object.fromEntries((definition.params ?? []).map((param) => [param.key, param.default])),
	...Object.fromEntries(
		(definition.numberParams ?? []).flatMap((param): Array<[string, number | boolean]> =>
			param.type === "vec2"
				? [
						[`${param.key}X`, param.default[0] ?? 0],
						[`${param.key}Y`, param.default[1] ?? 0],
					]
				: param.type === "bool"
					? [[param.key, (param.default[0] ?? 0) > 0.5]]
					: param.type === "color"
						? []
						: [[param.key, param.default[0] ?? 0]],
		),
	),
});
