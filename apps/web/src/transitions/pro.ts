import type { ParamValues } from "@/params";
import { COMMON, DIRECTION_PARAM, directionIndex } from "./common";
import type { TransitionDefinition, TransitionNumberParam } from "./types";

// Gaziyav's own pack in the spirit of the paid AE / Premiere packs: motion-blurred pushes with inertia, camera
// zooms and spins with blur, light rays and flares, RGB-split glitches, shape reveals with a glowing rim,
// seamless reels moves, film. Our own code (no third-party shaders). Every one has Strength; the moves have
// Direction. Mirrored edges: a shifted, scaled or turned frame never shows black borders.
const PRO_HELPERS = /* wgsl */ `
// Patterns in a fixed 1080-line frame (the preview renders smaller than the export: per-pixel lines differed) and
// randomness on the progress (the preview and the export count frames differently).
fn pr_res() -> vec2f { return vec2f(1080.0 * aspect(), 1080.0); }
fn pr_tick(rate: f32) -> f32 { return floor(fx.progress * rate); }
fn pr_time() -> f32 { return fx.progress * 2.0; }
fn pr_m1(x: f32) -> f32 { let t = fract(x * 0.5) * 2.0; return select(t, 2.0 - t, t > 1.0); }
fn pr_mirror(uv: vec2f) -> vec2f { return vec2f(pr_m1(uv.x), pr_m1(uv.y)); }
fn pA(uv: vec2f) -> vec4f { return src(pr_mirror(uv)); }
fn pB(uv: vec2f) -> vec4f { return orig(pr_mirror(uv)); }
fn pAB(uv: vec2f, into_b: bool) -> vec4f { return select(pA(uv), pB(uv), into_b); }
fn pr_inside(q: vec2f) -> f32 { return step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0); }
fn pr_back_out(t: f32, s: f32) -> f32 { let x = clamp(t, 0.0, 1.0) - 1.0; return 1.0 + x * x * ((s + 1.0) * x + s); }
fn pr_expo_in_out(t: f32) -> f32 {
    let x = clamp(t, 0.0, 1.0);
    if (x <= 0.0) { return 0.0; }
    if (x >= 1.0) { return 1.0; }
    if (x < 0.5) { return 0.5 * exp2(20.0 * x - 10.0); }
    return 1.0 - 0.5 * exp2(-20.0 * x + 10.0);
}
// 0 → 1 → 0 over the window, peaking on the cut
fn pr_tent(p: f32) -> f32 { return 1.0 - abs(2.0 * clamp(p, 0.0, 1.0) - 1.0); }
fn pr_bell(p: f32) -> f32 { return sin(3.14159265 * clamp(p, 0.0, 1.0)); }
fn pr_scale(uv: vec2f, c: vec2f, s: f32) -> vec2f {
    let a = aspect();
    return c + ((uv - c) * vec2f(a, 1.0) / max(s, 0.0001)) / vec2f(a, 1.0);
}
fn pr_rot(uv: vec2f, ang: f32) -> vec2f {
    let a = aspect();
    let q = rotate2((uv - vec2f(0.5)) * vec2f(a, 1.0), -ang);
    return q / vec2f(a, 1.0) + vec2f(0.5);
}
fn pr_noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let a = hash12(i);
    let b = hash12(i + vec2f(1.0, 0.0));
    let c = hash12(i + vec2f(0.0, 1.0));
    let d = hash12(i + vec2f(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn pr_fbm(p: vec2f) -> f32 {
    var s = 0.0;
    var amp = 0.5;
    var q = p;
    for (var i = 0; i < 4; i++) {
        s += amp * pr_noise(q);
        q = q * 2.03 + vec2f(1.7, 9.2);
        amp *= 0.5;
    }
    return s;
}
// Aspect-correct position from the centre (x scaled by the frame's aspect)
fn pr_centered(uv: vec2f) -> vec2f { return (uv - vec2f(0.5)) * vec2f(aspect(), 1.0); }
// A shape reveal: B inside where d < r, a soft edge and a glowing rim (glow = rim strength)
fn pr_reveal(uv: vec2f, d: f32, r: f32, glow: f32) -> vec4f {
    let edge = 0.012;
    let m = 1.0 - smoothstep(r - edge, r + edge, d);
    let col = mix(A(uv), B(uv), m);
    let rim = exp(-pow((d - r) * 60.0, 2.0)) * glow * step(0.001, r);
    return vec4f(col.rgb + vec3f(1.0, 0.92, 0.8) * rim, max(col.a, rim));
}
`;

const pro = (body: string) => `${COMMON}${PRO_HELPERS}${body}`;

function num(key: string, label: string, def: number, min: number, max: number, slot: number): TransitionNumberParam {
	return { key, label, type: "number", default: [def], min, max, slot, size: 1 };
}

// slot 0: direction (when there is one); slot 1: strength; slot 2..: extras
function packer(params: TransitionNumberParam[], withDirection: boolean) {
	return (values: ParamValues) => {
		const out = new Array<number>(32).fill(0);
		if (withDirection) out[0] = directionIndex(values);
		for (const param of params) {
			const raw = values[param.key];
			out[param.slot] = typeof raw === "number" && Number.isFinite(raw) ? raw : param.default[0];
		}
		return out;
	};
}

const strength = num("strength", "Strength", 1, 0, 2, 1);
const SPIN_DIRECTION = {
	key: "direction",
	label: "Direction",
	default: "left",
	options: [
		{ value: "left", label: "Counter-clockwise" },
		{ value: "right", label: "Clockwise" },
	],
};

interface Recipe {
	id: string;
	name: string;
	category: string;
	duration: number;
	direction?: "four" | "spin";
	extra?: TransitionNumberParam[];
	body: string;
}

const RECIPES: Recipe[] = [
	// ---------------------------------------------------------------- Slide & Push
	{
		id: "inertiaPush",
		name: "Inertia Push",
		category: "Slide & Push",
		duration: 0.5,
		direction: "four",
		// Both frames as one strip, expo in-out; the blur follows the speed (peak on the cut).
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let d = dir_vec(P0().x);
    let s = pr_expo_in_out(p);
    let v = exp2(-10.0 * abs(2.0 * p - 1.0));
    let blur = P0().y * 0.3 * v;
    var acc = vec4f(0.0);
    for (var i = 0; i < 16; i++) {
        acc += strip(uv + d * (f32(i) / 15.0 - 0.5) * blur, d, s);
    }
    return acc / 16.0;
}`,
	},
	{
		id: "slideOver",
		name: "Slide Over",
		category: "Slide & Push",
		duration: 0.6,
		direction: "four",
		extra: [num("inertia", "Inertia", 1, 0, 2, 2)],
		// B slides in over A with an overshoot (back-out) and motion blur; A drifts a quarter of the way and darkens.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = clamp(fx.progress, 0.0, 1.0);
    let d = dir_vec(P0().x);
    let k = 1.70158 * P0().z;
    let pos = 1.0 - pr_back_out(p, k);
    let vel = abs(pr_back_out(min(p + 0.02, 1.0), k) - pr_back_out(max(p - 0.02, 0.0), k)) / 0.04;
    let blur = P0().y * 0.05 * vel;
    let shade = clamp(1.0 - 0.45 * (1.0 - pos), 0.4, 1.0);
    var acc = vec4f(0.0);
    for (var i = 0; i < 12; i++) {
        let o = d * (f32(i) / 11.0 - 0.5) * blur;
        let qb = uv + o + d * pos;
        let a = pA(uv + o * 0.3 + d * 0.25 * (pos - 1.0));
        acc += mix(vec4f(a.rgb * shade, a.a), B(qb), pr_inside(qb));
    }
    return acc / 12.0;
}`,
	},
	{
		id: "reelSwipe",
		name: "Reel Swipe",
		category: "Slide & Push",
		duration: 0.45,
		direction: "four",
		// The feed scroll of a phone: a fast push with a rubber-band settle, a slight scale-down in the middle.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = clamp(fx.progress, 0.0, 1.0);
    let d = dir_vec(P0().x);
    let s = pr_back_out(p, 0.9);
    let v = 1.0 - abs(2.0 * p - 1.0);
    let sc = 1.0 - 0.06 * v * P0().y;
    let q0 = pr_scale(uv, vec2f(0.5), sc);
    var acc = vec4f(0.0);
    for (var i = 0; i < 12; i++) {
        let o = d * (f32(i) / 11.0 - 0.5) * 0.12 * v * P0().y;
        acc += strip(q0 + o, d, s);
    }
    let col = acc / 12.0;
    return vec4f(col.rgb * (1.0 - 0.15 * v), col.a);
}`,
	},
	// ---------------------------------------------------------------- Camera
	{
		id: "zoomPunch",
		name: "Zoom Punch",
		category: "Camera",
		duration: 0.35,
		extra: [num("flash", "Flash", 0.5, 0, 1, 2)],
		// A punches in with a radial blur, a flash on the cut, B lands from the same zoom.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let into_b = p >= 0.5;
    let t = pr_tent(p);
    let e = t * t;
    let scale = 1.0 + 0.35 * P0().y * e;
    let blur = 0.25 * P0().y * e;
    var acc = vec4f(0.0);
    for (var i = 0; i < 16; i++) {
        acc += pAB(pr_scale(uv, vec2f(0.5), scale * (1.0 + blur * f32(i) / 15.0)), into_b);
    }
    let col = acc / 16.0;
    let flash = exp(-pow((p - 0.5) * 14.0, 2.0)) * P0().z;
    return vec4f(col.rgb + vec3f(flash), col.a);
}`,
	},
	{
		id: "pullBack",
		name: "Pull Back",
		category: "Camera",
		duration: 0.5,
		// The camera pulls back: A shrinks with an outward blur, B arrives from close up to full frame.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let into_b = p >= 0.5;
    let t = pr_tent(p);
    let e = ease_in_cubic(t);
    let scale = select(1.0 - 0.45 * e, 1.0 + 0.6 * e, into_b);
    let blur = 0.22 * P0().y * e;
    var acc = vec4f(0.0);
    for (var i = 0; i < 16; i++) {
        acc += pAB(pr_scale(uv, vec2f(0.5), scale * (1.0 - blur * f32(i) / 15.0)), into_b);
    }
    return acc / 16.0;
}`,
	},
	{
		id: "spinZoom",
		name: "Spin Zoom",
		category: "Camera",
		duration: 0.5,
		direction: "spin",
		// A spins a quarter turn and zooms in, B spins on from the other side; a rotational blur trails the turn.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let into_b = p >= 0.5;
    let e = ease_in_cubic(pr_tent(p));
    let sgn = select(1.0, -1.0, P0().x > 0.5);
    let ang = sgn * select(1.0, -1.0, into_b) * 1.5708 * e;
    let scale = 1.0 + 0.6 * e;
    var acc = vec4f(0.0);
    for (var i = 0; i < 16; i++) {
        let a2 = ang * (1.0 - 0.25 * P0().y * f32(i) / 15.0);
        acc += pAB(pr_scale(pr_rot(uv, a2), vec2f(0.5), scale), into_b);
    }
    return acc / 16.0;
}`,
	},
	{
		id: "cameraRoll",
		name: "Camera Roll",
		category: "Camera",
		duration: 0.55,
		direction: "spin",
		// A barrel roll: half a turn out, half a turn in, zoomed so the corners stay filled, blur along the turn.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = clamp(fx.progress, 0.0, 1.0);
    let into_b = p >= 0.5;
    let sgn = select(1.0, -1.0, P0().x > 0.5);
    let turn = pr_expo_in_out(p) * 3.14159265;
    let ang = sgn * select(turn, turn - 3.14159265, into_b);
    let speed = exp2(-8.0 * abs(2.0 * p - 1.0));
    var acc = vec4f(0.0);
    for (var i = 0; i < 16; i++) {
        let a2 = ang - sgn * speed * 0.5 * P0().y * f32(i) / 15.0;
        acc += pAB(pr_scale(pr_rot(uv, a2), vec2f(0.5), 1.0 + 0.4 * speed), into_b);
    }
    return acc / 16.0;
}`,
	},
	// ---------------------------------------------------------------- Light
	{
		id: "lightRays",
		name: "Light Rays",
		category: "Light",
		duration: 0.7,
		// Rays from the bright parts toward the light, swelling to the cut where A gives way to B.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let bl = pr_bell(p);
    let m = smoothstep(0.4, 0.6, p);
    let base = mix(A(uv), B(uv), m);
    let c = vec2f(0.5, 0.42);
    var rays = 0.0;
    for (var i = 0; i < 20; i++) {
        let f = f32(i) / 20.0;
        let q = mix(uv, c, f * 0.65 * bl);
        let s = mix(pA(q), pB(q), m);
        rays += max(luma(s.rgb) - 0.5, 0.0) * (1.0 - f);
    }
    rays = rays / 20.0 * 7.0 * bl * P0().y;
    let warm = vec3f(1.0, 0.86, 0.62);
    return vec4f(base.rgb + warm * rays + vec3f(0.3 * bl * bl * P0().y), base.a);
}`,
	},
	{
		id: "flareSweep",
		name: "Flare Sweep",
		category: "Light",
		duration: 0.6,
		// A lens-flare streak crosses the frame on a slant; A ahead of it, B behind, a warm halo around the core.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let a = aspect();
    let x = (uv.x * a + uv.y * 0.35) / (a + 0.35);
    let pos = mix(-0.25, 1.25, ease_in_out_sine(p));
    let dist = x - pos;
    let core = exp(-dist * dist * 900.0);
    let glow = exp(-dist * dist * 35.0);
    let col = mix(B(uv), A(uv), smoothstep(pos - 0.03, pos + 0.03, x));
    let flare = vec3f(1.0, 0.92, 0.8) * core * 1.8 + vec3f(1.0, 0.62, 0.32) * glow * 0.5;
    let fringe = vec3f(0.3, 0.5, 1.0) * exp(-pow(dist + 0.05, 2.0) * 400.0) * 0.4;
    return vec4f(col.rgb + (flare + fringe) * P0().y, col.a);
}`,
	},
	{
		id: "bokehFlash",
		name: "Bokeh Flash",
		category: "Light",
		duration: 0.7,
		// Out-of-focus lights bloom over the cut, warm on the left, cool on the right.
		body: `
fn pr_bokeh(uv: vec2f) -> f32 {
    var s = 0.0;
    let a = aspect();
    for (var i = 0; i < 16; i++) {
        let fi = f32(i);
        let c = vec2f(hash11(fi * 3.1 + 1.0), hash11(fi * 7.7 + 2.0));
        let r = 0.035 + 0.075 * hash11(fi * 1.9 + 5.0);
        let d = length((uv - c) * vec2f(a, 1.0));
        s += (1.0 - smoothstep(r * 0.82, r, d)) * (0.45 + 0.55 * hash11(fi * 4.3 + 7.0));
    }
    return s;
}
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let bl = pr_bell(p);
    let base = mix(A(uv), B(uv), smoothstep(0.35, 0.65, p));
    let b = pr_bokeh(uv) * bl * bl * P0().y;
    let tint = mix(vec3f(1.0, 0.78, 0.5), vec3f(0.65, 0.82, 1.0), uv.x);
    return vec4f(base.rgb * (1.0 - 0.25 * bl) + tint * b * 0.85 + vec3f(0.2 * bl * bl), base.a);
}`,
	},
	{
		id: "neonSweep",
		name: "Neon Sweep",
		category: "Light",
		duration: 0.55,
		direction: "four",
		// A neon bar (magenta into cyan) wipes along the direction, glowing; B behind it.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let d = dir_vec(P0().x);
    let x = select(select(uv.y, 1.0 - uv.y, d.y < -0.5), select(uv.x, 1.0 - uv.x, d.x < -0.5), abs(d.x) > 0.5);
    let pos = mix(-0.15, 1.15, ease_in_out_cubic(p));
    let dist = x - pos;
    let col = mix(B(uv), A(uv), smoothstep(pos - 0.004, pos + 0.004, x));
    let neon = mix(vec3f(1.0, 0.2, 0.8), vec3f(0.1, 0.9, 1.0), clamp(0.5 + dist * 8.0, 0.0, 1.0));
    let glow = exp(-dist * dist * 2500.0) * 1.6 + exp(-dist * dist * 120.0) * 0.45;
    return vec4f(col.rgb + neon * glow * P0().y, col.a);
}`,
	},
	{
		id: "exposureBloom",
		name: "Exposure Bloom",
		category: "Light",
		duration: 0.5,
		// Over-exposure with a soft bloom of the highlights; on the cut it's nearly white, B comes out of it.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let bl = pr_bell(p);
    let into_b = p >= 0.5;
    let base = pAB(uv, into_b);
    var bloom = vec3f(0.0);
    for (var i = 0; i < 12; i++) {
        let ang = f32(i) * 0.5236;
        let o = vec2f(cos(ang), sin(ang)) * 0.02 * bl * vec2f(1.0 / aspect(), 1.0);
        let s = pAB(uv + o, into_b).rgb;
        bloom += max(s - vec3f(0.6), vec3f(0.0));
    }
    let gain = 1.0 + 2.2 * bl * bl * P0().y;
    let rgb = base.rgb * gain + bloom / 12.0 * 3.0 * bl * P0().y;
    return vec4f(mix(rgb, vec3f(1.0), 0.55 * pow(bl, 6.0) * P0().y), base.a);
}`,
	},
	// ---------------------------------------------------------------- Glitch
	{
		id: "rgbSplit",
		name: "RGB Split",
		category: "Glitch",
		duration: 0.4,
		// The red and blue planes pull apart to the cut while slices jump sideways; the cut itself is ragged.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let bl = pr_bell(p);
    let amt = 0.035 * P0().y * bl * bl;
    let slice = floor(uv.y * 26.0);
    let tick = pr_tick(14.0);
    let jit = (hash12(vec2f(slice, tick)) - 0.5) * 2.0;
    let on = step(0.62, hash12(vec2f(slice * 1.7, tick + 3.0)));
    let q = uv + vec2f(jit * amt * 2.5 * on, 0.0);
    let into_b = p >= 0.5 + 0.1 * (hash12(vec2f(slice, 9.0)) - 0.5);
    let r = pAB(q + vec2f(amt, 0.0), into_b).r;
    let g = pAB(q, into_b);
    let b = pAB(q - vec2f(amt, 0.0), into_b).b;
    return vec4f(r, g.g, b, g.a);
}`,
	},
	{
		id: "digitalBlocks",
		name: "Digital Blocks",
		category: "Glitch",
		duration: 0.45,
		// Blocks of the frame jump and swap to B one by one, a datamosh look.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let bl = pr_bell(p);
    let grid = vec2f(16.0, 9.0);
    let cell = floor(uv * grid);
    let tick = pr_tick(14.0);
    let r = hash12(cell + vec2f(tick * 0.37, tick * 0.11));
    let order = hash12(cell * 1.31);
    let into_b = order < p;
    let jump = step(1.0 - 0.45 * bl * P0().y, r);
    let off = (vec2f(hash12(cell + 4.0), hash12(cell + 8.0)) - 0.5) * 0.12 * jump * P0().y;
    let c = pAB(uv + off, into_b);
    let tint = mix(vec3f(1.0), vec3f(0.6, 1.2, 1.4), jump * 0.5);
    return vec4f(c.rgb * tint, c.a);
}`,
	},
	{
		id: "scanTear",
		name: "Scanline Tear",
		category: "Glitch",
		duration: 0.4,
		// Horizontal lines tear sideways more and more to the cut, scanlines on top.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let bl = pr_bell(p);
    let line = floor(uv.y * 160.0);
    let tick = pr_tick(28.0);
    let n = hash12(vec2f(line, tick)) - 0.5;
    let band = step(0.7, pr_noise(vec2f(uv.y * 12.0, tick * 0.7)));
    let shift = n * 0.15 * bl * P0().y * (0.3 + band);
    let into_b = p >= 0.5;
    let c = pAB(uv + vec2f(shift, 0.0), into_b);
    let scan = 1.0 - 0.18 * bl * step(0.5, fract(uv.y * 135.0));
    return vec4f(c.rgb * scan, c.a);
}`,
	},
	{
		id: "vhsRewind",
		name: "VHS Rewind",
		category: "Glitch",
		duration: 0.6,
		// A tape rewinding: the picture rolls up, a tracking band of noise runs through, the colours bleed.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let bl = pr_bell(p);
    let roll = fract(uv.y + 1.5 * bl * bl * P0().y);
    let q = vec2f(uv.x + 0.01 * sin(uv.y * 80.0 + pr_time() * 30.0) * bl, roll);
    let into_b = p >= 0.5;
    let y0 = fract(pr_time() * 1.7);
    let track = exp(-pow((uv.y - y0) * 18.0, 2.0)) * bl;
    let noise = hash12(vec2f(floor(uv.x * 160.0), floor(uv.y * 90.0) + pr_tick(28.0)));
    let bleed = 0.008 * bl * P0().y;
    let r = pAB(q + vec2f(bleed, 0.0), into_b).r;
    let g = pAB(q, into_b);
    let b = pAB(q - vec2f(bleed, 0.0), into_b).b;
    let col = mix(vec3f(r, g.g, b), vec3f(noise), clamp(track * 1.2, 0.0, 0.9));
    return vec4f(col * (1.0 - 0.15 * bl), g.a);
}`,
	},
	{
		id: "lumaSmear",
		name: "Luma Smear",
		category: "Glitch",
		duration: 0.5,
		// The bright parts smear sideways (a pixel-sort look) more and more to the cut.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let bl = pr_bell(p);
    let into_b = p >= 0.5;
    let base = pAB(uv, into_b);
    var acc = base;
    var n = 1.0;
    for (var i = 1; i < 14; i++) {
        let q = uv - vec2f(f32(i) * 0.012 * bl * P0().y, 0.0);
        let s = pAB(q, into_b);
        let w = smoothstep(0.45, 0.8, luma(s.rgb));
        acc += s * w;
        n += w;
    }
    return acc / n;
}`,
	},
	{
		id: "glitchZoom",
		name: "Glitch Zoom",
		category: "Glitch",
		duration: 0.4,
		// A zoom punch with the colour planes split and a few frames of jitter around the cut.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let into_b = p >= 0.5;
    let t = pr_tent(p);
    let e = t * t;
    let tick = pr_tick(14.0);
    let jit = (vec2f(hash11(tick), hash11(tick + 7.0)) - 0.5) * 0.03 * e * P0().y;
    let scale = 1.0 + 0.3 * e * P0().y;
    let q = pr_scale(uv, vec2f(0.5), scale) + jit;
    let amt = 0.025 * e * P0().y;
    let r = pAB(pr_scale(q, vec2f(0.5), 1.0 + amt), into_b).r;
    let g = pAB(q, into_b);
    let b = pAB(pr_scale(q, vec2f(0.5), 1.0 - amt), into_b).b;
    return vec4f(r, g.g, b, g.a);
}`,
	},
	// ---------------------------------------------------------------- Distortion
	{
		id: "liquid",
		name: "Liquid",
		category: "Distortion",
		duration: 0.7,
		// The picture turns to liquid (a flowing noise warp) and settles as B.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let bl = pr_bell(p);
    let t = pr_time() * 0.6;
    let w = vec2f(pr_fbm(uv * 3.0 + vec2f(t, 0.0)), pr_fbm(uv * 3.0 + vec2f(5.2, t))) - 0.5;
    let q = uv + w * 0.18 * bl * P0().y;
    return mix(pA(q), pB(q), smoothstep(0.3, 0.7, p));
}`,
	},
	{
		id: "heatHaze",
		name: "Heat Haze",
		category: "Distortion",
		duration: 0.7,
		// Shimmering air rising through the frame, strongest on the cut.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let bl = pr_bell(p);
    let t = pr_time() * 3.0;
    let n = pr_noise(vec2f(uv.x * 18.0, uv.y * 6.0 + t)) - 0.5;
    let q = uv + vec2f(n * 0.04, sin(uv.x * 40.0 + t) * 0.008) * bl * P0().y;
    return mix(pA(q), pB(q), smoothstep(0.35, 0.65, p));
}`,
	},
	{
		id: "lensWarp",
		name: "Lens Warp",
		category: "Distortion",
		duration: 0.5,
		// A fisheye bulge swells to the cut and lets go on B.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let bl = pr_bell(p);
    let c = pr_centered(uv);
    let r2 = dot(c, c);
    let k = 0.9 * bl * P0().y;
    let q = c / (1.0 + k * r2) / vec2f(aspect(), 1.0) + vec2f(0.5);
    let into_b = p >= 0.5;
    let col = pAB(q, into_b);
    return vec4f(col.rgb * (1.0 - 0.35 * bl * r2), col.a);
}`,
	},
	{
		id: "rippleRing",
		name: "Ripple Ring",
		category: "Distortion",
		duration: 0.7,
		// A ring wave runs out from the centre; B inside the ring, A outside it.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let c = pr_centered(uv);
    let d = length(c);
    let r = p * 1.2;
    let wave = sin((d - r) * 60.0) * exp(-pow((d - r) * 9.0, 2.0)) * 0.02 * P0().y;
    let q = uv + normalize(c + vec2f(0.0001)) / vec2f(aspect(), 1.0) * wave;
    let m = 1.0 - smoothstep(r - 0.02, r + 0.02, d);
    return mix(pA(q), pB(q), m);
}`,
	},
	// ---------------------------------------------------------------- Shape
	{
		id: "diamondReveal",
		name: "Diamond",
		category: "Shape",
		duration: 0.6,
		body: `
fn effect(uv: vec2f) -> vec4f {
    let c = pr_centered(uv);
    let d = abs(c.x) + abs(c.y);
    return pr_reveal(uv, d, ease_in_out_cubic(fx.progress) * 1.5, P0().y);
}`,
	},
	{
		id: "hexReveal",
		name: "Hexagon",
		category: "Shape",
		duration: 0.6,
		body: `
fn effect(uv: vec2f) -> vec4f {
    let c = abs(pr_centered(uv));
    let d = max(c.x * 0.866 + c.y * 0.5, c.y);
    return pr_reveal(uv, d, ease_in_out_cubic(fx.progress) * 1.25, P0().y);
}`,
	},
	{
		id: "crossReveal",
		name: "Cross",
		category: "Shape",
		duration: 0.6,
		body: `
fn effect(uv: vec2f) -> vec4f {
    let c = abs(pr_centered(uv));
    let d = min(max(c.x * 0.35, c.y), max(c.x, c.y * 0.35));
    return pr_reveal(uv, d, ease_in_out_cubic(fx.progress) * 1.0, P0().y);
}`,
	},
	{
		id: "triangleReveal",
		name: "Triangle",
		category: "Shape",
		duration: 0.6,
		body: `
fn effect(uv: vec2f) -> vec4f {
    let c = pr_centered(uv) - vec2f(0.0, 0.08);
    let d = max(abs(c.x) * 0.866 - c.y * 0.5, c.y);
    return pr_reveal(uv, d, ease_in_out_cubic(fx.progress) * 1.6, P0().y);
}`,
	},
	{
		id: "circleGlow",
		name: "Circle Glow",
		category: "Shape",
		duration: 0.6,
		body: `
fn effect(uv: vec2f) -> vec4f {
    let d = length(pr_centered(uv));
    return pr_reveal(uv, d, ease_in_out_cubic(fx.progress) * 1.05, 0.8 * P0().y);
}`,
	},
	{
		id: "ringBurst",
		name: "Ring Burst",
		category: "Shape",
		duration: 0.6,
		// Two rings run out from the centre: between them A shows through, then B fills.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = ease_in_out_cubic(fx.progress);
    let d = length(pr_centered(uv));
    let outer = p * 1.15;
    let inner = max(p * 1.15 - 0.25, 0.0);
    let ring = smoothstep(inner - 0.01, inner + 0.01, d) * (1.0 - smoothstep(outer - 0.01, outer + 0.01, d));
    let inside = 1.0 - smoothstep(inner - 0.01, inner + 0.01, d);
    let col = mix(A(uv), B(uv), inside);
    let glow = (exp(-pow((d - outer) * 50.0, 2.0)) + exp(-pow((d - inner) * 50.0, 2.0))) * P0().y;
    return vec4f(mix(col.rgb, col.rgb * 1.25, ring) + vec3f(1.0, 0.9, 0.75) * glow * 0.7, col.a);
}`,
	},
	// ---------------------------------------------------------------- Seamless (reels)
	{
		id: "seamlessZoom",
		name: "Seamless Zoom",
		category: "Seamless",
		duration: 0.5,
		// One continuous zoom in: A dives in, B arrives small (mirrored around) and grows to fill — no stop.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = clamp(fx.progress, 0.0, 1.0);
    let into_b = p >= 0.5;
    let z = exp2(pr_expo_in_out(p) * 2.0);
    let scale = select(z, z / 4.0, into_b);
    let speed = exp2(-8.0 * abs(2.0 * p - 1.0));
    var acc = vec4f(0.0);
    for (var i = 0; i < 16; i++) {
        acc += pAB(pr_scale(uv, vec2f(0.5), scale * (1.0 + 0.3 * speed * P0().y * f32(i) / 15.0)), into_b);
    }
    return acc / 16.0;
}`,
	},
	{
		id: "seamlessSpin",
		name: "Seamless Spin",
		category: "Seamless",
		duration: 0.55,
		direction: "spin",
		// One continuous turn: A spins out, B carries on spinning the same way into place.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = clamp(fx.progress, 0.0, 1.0);
    let into_b = p >= 0.5;
    let sgn = select(1.0, -1.0, P0().x > 0.5);
    let turn = pr_expo_in_out(p) * 6.2831853;
    let ang = sgn * select(turn, turn - 6.2831853, into_b);
    let speed = exp2(-8.0 * abs(2.0 * p - 1.0));
    let scale = 1.0 + 0.5 * speed;
    var acc = vec4f(0.0);
    for (var i = 0; i < 16; i++) {
        acc += pAB(pr_scale(pr_rot(uv, ang - sgn * speed * 0.6 * P0().y * f32(i) / 15.0), vec2f(0.5), scale), into_b);
    }
    return acc / 16.0;
}`,
	},
	{
		id: "seamlessStretch",
		name: "Seamless Stretch",
		category: "Seamless",
		duration: 0.45,
		direction: "four",
		// A stretches along the direction into streaks, B snaps back out of the same streaks.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let d = abs(dir_vec(P0().x));
    let into_b = p >= 0.5;
    let e = ease_in_cubic(pr_tent(p));
    let s = 1.0 + 4.0 * e * P0().y;
    let c = uv - vec2f(0.5);
    let q = vec2f(0.5) + c / mix(vec2f(1.0), vec2f(s), d);
    var acc = vec4f(0.0);
    for (var i = 0; i < 10; i++) {
        acc += pAB(q + d * (f32(i) / 9.0 - 0.5) * 0.08 * e, into_b);
    }
    return acc / 10.0;
}`,
	},
	// ---------------------------------------------------------------- Film
	{
		id: "filmRoll",
		name: "Film Roll",
		category: "Film",
		duration: 0.5,
		// The film slips a frame: A runs up out of the gate, a black frame line with sprocket holes, B comes up after.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = clamp(fx.progress, 0.0, 1.0);
    let s = pr_expo_in_out(p) * 1.08;
    let y = uv.y + s;
    let gap = 0.08;
    var col = vec4f(0.0, 0.0, 0.0, 1.0);
    if (y < 1.0) {
        col = pA(vec2f(uv.x, y));
    } else if (y > 1.0 + gap) {
        col = pB(vec2f(uv.x, y - 1.0 - gap));
    } else {
        let hole = step(0.5, fract(uv.x * 9.0)) * step(abs(y - 1.0 - gap * 0.5), gap * 0.25);
        col = vec4f(vec3f(0.02 + 0.85 * hole), 1.0);
    }
    let speed = exp2(-8.0 * abs(2.0 * p - 1.0));
    return vec4f(col.rgb * (1.0 - 0.25 * speed * P0().y), col.a);
}`,
	},
	{
		id: "frameStutter",
		name: "Frame Stutter",
		category: "Film",
		duration: 0.5,
		// The film stutters between the two shots for a few frames, with a jolt of the gate.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let tick = pr_tick(14.0);
    let flip = hash11(tick * 3.7) < smoothstep(0.2, 0.8, p);
    let near = pr_tent(p);
    let jolt = vec2f(0.0, (hash11(tick + 11.0) - 0.5) * 0.04 * near * P0().y);
    let col = pAB(uv + jolt, flip);
    let flicker = 1.0 + (hash11(tick + 5.0) - 0.5) * 0.3 * near;
    return vec4f(col.rgb * flicker, col.a);
}`,
	},
	{
		id: "oldFilm",
		name: "Old Film",
		category: "Film",
		duration: 0.8,
		// Into an old print and out: sepia, flicker, dust and a scratch, strongest on the cut.
		body: `
fn effect(uv: vec2f) -> vec4f {
    let p = fx.progress;
    let bl = pr_bell(p) * P0().y;
    let base = mix(A(uv), B(uv), smoothstep(0.4, 0.6, p));
    let g = luma(base.rgb);
    let sepia = vec3f(g * 1.07, g * 0.9, g * 0.68);
    var col = mix(base.rgb, sepia, clamp(bl, 0.0, 1.0));
    let tick = pr_tick(14.0);
    let flick = 1.0 + (hash11(tick) - 0.5) * 0.25 * bl;
    let dust = step(0.9985, hash12(floor(uv * pr_res() / 3.0) + tick)) * bl;
    let sx = hash11(tick * 1.3);
    let scratch = exp(-pow((uv.x - sx) * pr_res().x / 1.5, 2.0)) * step(0.5, hash11(tick + 2.0)) * bl;
    col = col * flick - vec3f(dust * 0.8) + vec3f(scratch * 0.35);
    let vig = 1.0 - 0.5 * bl * dot(pr_centered(uv), pr_centered(uv));
    return vec4f(col * vig, base.a);
}`,
	},
];

export const PRO_TRANSITIONS: TransitionDefinition[] = RECIPES.map((recipe) => {
	const numberParams = [strength, ...(recipe.extra ?? [])];
	return {
		type: `pro.transition.${recipe.id}`,
		name: recipe.name,
		category: recipe.category,
		defaultDuration: recipe.duration,
		params: recipe.direction === "four" ? [DIRECTION_PARAM] : recipe.direction === "spin" ? [SPIN_DIRECTION] : undefined,
		numberParams,
		credit: "Gaziyav",
		pack: packer(numberParams, !!recipe.direction),
		wgsl: pro(recipe.body),
	};
});
