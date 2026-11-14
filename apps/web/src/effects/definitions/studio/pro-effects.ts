import type { ParamDefinition, ParamValues } from "@/params";
import type { EffectDefinition } from "@/effects/types";
import { defineShaderEffect, num, numberParam, rgb } from "./shader-effect";

// Gaziyav's own effects pack: 16 shader families (our code), each with tuned variants — camera shakes and zoom
// pulses, blurs, glow / bloom / star / anamorphic / halation, chromatic splits, glitches, VHS, film, light leaks,
// flashes, stylize (CRT, pixel, halftone, thermal, night vision, comic, sketch …), mirrors and kaleidoscopes,
// distortions, cinematic frames, weather and party lights. Every variant has Strength; most have Speed.
// Mirrored edges: a shifted, turned or scaled frame never shows black borders.
const PE = /* wgsl */ `
// Patterns in a fixed 1080-line frame: the preview renders smaller than the export (scanlines, grain, dots,
// pixels and edges had another size there).
fn pe_res() -> vec2f { return vec2f(1080.0 * aspect(), 1080.0); }
fn pe_px() -> vec2f { return vec2f(1.0) / pe_res(); }
fn pe_m1(x: f32) -> f32 { let t = fract(x * 0.5) * 2.0; return select(t, 2.0 - t, t > 1.0); }
fn pe_mirror(uv: vec2f) -> vec2f { return vec2f(pe_m1(uv.x), pe_m1(uv.y)); }
fn S(uv: vec2f) -> vec4f { return src(pe_mirror(uv)); }
fn pe_noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2f(1.0, 0.0)), u.x), mix(hash12(i + vec2f(0.0, 1.0)), hash12(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn pe_fbm(p: vec2f) -> f32 {
    var s = 0.0;
    var a = 0.5;
    var q = p;
    for (var i = 0; i < 4; i++) {
        s += a * pe_noise(q);
        q = q * 2.03 + vec2f(1.7, 9.2);
        a *= 0.5;
    }
    return s;
}
fn pe_centered(uv: vec2f) -> vec2f { return (uv - vec2f(0.5)) * vec2f(aspect(), 1.0); }
fn pe_scale(uv: vec2f, c: vec2f, s: f32) -> vec2f {
    let a = aspect();
    return c + ((uv - c) * vec2f(a, 1.0) / max(s, 0.0001)) / vec2f(a, 1.0);
}
fn pe_rot(uv: vec2f, ang: f32) -> vec2f {
    let a = aspect();
    let q = rotate2((uv - vec2f(0.5)) * vec2f(a, 1.0), -ang);
    return q / vec2f(a, 1.0) + vec2f(0.5);
}
fn pe_screen(a: vec3f, b: vec3f) -> vec3f { return vec3f(1.0) - (vec3f(1.0) - clamp(a, vec3f(0.0), vec3f(1.0))) * (vec3f(1.0) - clamp(b, vec3f(0.0), vec3f(1.0))); }
fn pe_hsv(h: f32, s: f32, v: f32) -> vec3f {
    let k = vec3f(1.0, 2.0 / 3.0, 1.0 / 3.0);
    let p = abs(fract(vec3f(h) + k) * 6.0 - vec3f(3.0));
    return v * mix(vec3f(1.0), clamp(p - vec3f(1.0), vec3f(0.0), vec3f(1.0)), s);
}
fn pe_hue_rotate(c: vec3f, a: f32) -> vec3f {
    let k = vec3f(0.57735);
    let ca = cos(a);
    return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
fn pe_bright(uv: vec2f, th: f32) -> vec3f { let c = S(uv).rgb; return max(c - vec3f(th), vec3f(0.0)) / max(1.0 - th, 0.01); }
fn pe_disc(i: i32, n: i32) -> vec2f {
    let ang = f32(i) * 2.3998;
    let r = sqrt((f32(i) + 0.5) / f32(n));
    return vec2f(cos(ang) / aspect(), sin(ang)) * r;
}
fn pe_edge(uv: vec2f) -> f32 {
    let px = pe_px();
    let l = luma(S(uv - vec2f(px.x, 0.0)).rgb);
    let r = luma(S(uv + vec2f(px.x, 0.0)).rgb);
    let u = luma(S(uv - vec2f(0.0, px.y)).rgb);
    let d = luma(S(uv + vec2f(0.0, px.y)).rgb);
    return length(vec2f(r - l, d - u));
}
`;

const fx = (body: string) => `${PE}${body}`;

// ------------------------------------------------------------------ the families
const SHADERS: Record<string, string> = {
	// P0 = (amp, freq, rot°, zoom), P1 = (mode 0 noise · 1 beat · 2 bounce · 3 stepped, decay)
	shake: fx(`
fn effect(uv: vec2f) -> vec4f {
    let amp = P0().x;
    let freq = P0().y;
    let rot = radians(P0().z);
    let zoom = P0().w;
    let mode = P1().x;
    let t = fx.time;
    let env = select(1.0, exp(-t * P1().y), P1().y > 0.0);
    var off = vec2f(0.0);
    var ang = 0.0;
    var kick = 0.0;
    if (mode < 0.5) {
        off = vec2f(vnoise(t * freq), vnoise(t * freq + 17.3)) * amp;
        ang = vnoise(t * freq * 0.7 + 5.1) * rot;
    } else if (mode < 1.5) {
        kick = exp(-fract(t * freq) * 7.0);
        off = vec2f(vnoise(t * 31.0), vnoise(t * 31.0 + 3.0)) * amp * kick;
        ang = vnoise(t * 23.0) * rot * kick;
    } else if (mode < 2.5) {
        off = vec2f(sin(t * freq * 6.2831853) * amp * 0.35, -abs(sin(t * freq * 3.14159265)) * amp);
        ang = sin(t * freq * 6.2831853) * rot;
    } else {
        let st = floor(t * freq);
        off = (vec2f(hash11(st), hash11(st + 9.1)) - vec2f(0.5)) * 2.0 * amp;
        ang = (hash11(st + 4.2) - 0.5) * 2.0 * rot;
    }
    let s = 1.0 + zoom + kick * zoom * 2.0 + amp * 1.2;
    return S(pe_scale(pe_rot(uv - off * env, ang * env), vec2f(0.5), s));
}`),
	// P0 = (amount, rate Hz, mode 0 beat · 1 breathe · 2 push-in · 3 bounce, blur)
	pulse: fx(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let rate = P0().y;
    let mode = P0().z;
    let t = fx.time;
    var k = 0.0;
    if (mode < 0.5) { k = exp(-fract(t * rate) * 6.0); }
    else if (mode < 1.5) { k = 0.5 - 0.5 * cos(t * rate * 6.2831853); }
    else if (mode < 2.5) { k = ease_in_out_sine(fx.progress); }
    else { k = abs(sin(t * rate * 3.14159265)); }
    let s = 1.0 + amt * k;
    var acc = vec4f(0.0);
    for (var i = 0; i < 8; i++) {
        acc += S(pe_scale(uv, vec2f(0.5), s * (1.0 - P0().w * amt * k * f32(i) / 7.0 * 0.3)));
    }
    return acc / 8.0;
}`),
	// P0 = (amount, mode 0 radial · 1 spin · 2 directional · 3 tilt-shift · 4 soft glow · 5 defocus, angle°, focus y), P1.x = band
	blur: fx(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let mode = P0().y;
    var acc = vec4f(0.0);
    if (mode < 0.5) {
        for (var i = 0; i < 16; i++) { acc += S(pe_scale(uv, vec2f(0.5), 1.0 + amt * 0.25 * f32(i) / 15.0)); }
        return acc / 16.0;
    }
    if (mode < 1.5) {
        for (var i = 0; i < 16; i++) { acc += S(pe_rot(uv, (f32(i) / 15.0 - 0.5) * amt * 0.3)); }
        return acc / 16.0;
    }
    if (mode < 2.5) {
        let a = radians(P0().z);
        let d = vec2f(cos(a), sin(a)) * amt * 0.06;
        for (var i = 0; i < 16; i++) { acc += S(uv + d * (f32(i) / 15.0 - 0.5)); }
        return acc / 16.0;
    }
    if (mode < 3.5) {
        let band = max(P1().x, 0.01);
        let k = smoothstep(band, band + 0.25, abs(uv.y - P0().w)) * amt;
        for (var i = 0; i < 16; i++) { acc += S(uv + pe_disc(i, 16) * 0.014 * k); }
        let col = acc / 16.0;
        let y = luma(col.rgb);
        return vec4f(mix(vec3f(y), col.rgb, 1.0 + 0.35 * amt), col.a);
    }
    if (mode < 4.5) {
        let base = S(uv);
        for (var i = 0; i < 16; i++) { acc += S(uv + pe_disc(i, 16) * 0.025); }
        let soft = acc / 16.0;
        return vec4f(mix(base.rgb, pe_screen(base.rgb, soft.rgb * 0.75), amt), base.a);
    }
    for (var i = 0; i < 24; i++) { acc += S(uv + pe_disc(i, 24) * 0.022 * amt); }
    return acc / 24.0;
}`),
	// P0 = (amount, threshold, mode 0 bloom · 1 neon edges · 2 star · 3 anamorphic · 4 halation, size), P2 = colour
	glow: fx(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let th = P0().y;
    let mode = P0().z;
    let size = P0().w;
    let base = S(uv);
    var g = vec3f(0.0);
    if (mode < 0.5) {
        for (var i = 0; i < 24; i++) { g += pe_bright(uv + pe_disc(i, 24) * 0.045 * size, th); }
        return vec4f(pe_screen(base.rgb, g / 24.0 * 2.0 * amt), base.a);
    }
    if (mode < 1.5) {
        let e = clamp(pe_edge(uv) * 6.0, 0.0, 1.0);
        var halo = 0.0;
        for (var i = 0; i < 12; i++) { halo += pe_edge(uv + pe_disc(i, 12) * 0.008 * size); }
        let lit = (e * 1.4 + clamp(halo / 12.0 * 7.0, 0.0, 1.0) * 0.8) * amt;
        return vec4f(base.rgb * (1.0 - 0.55 * amt) + P2().rgb * lit, base.a);
    }
    if (mode < 2.5) {
        for (var k = 0; k < 4; k++) {
            let ang = f32(k) * 0.785398 + 0.3927;
            let d = vec2f(cos(ang) / aspect(), sin(ang));
            for (var i = 1; i < 12; i++) {
                let f = f32(i) / 12.0;
                g += (pe_bright(uv + d * f * 0.09 * size, th) + pe_bright(uv - d * f * 0.09 * size, th)) * (1.0 - f);
            }
        }
        return vec4f(pe_screen(base.rgb, g / 24.0 * 1.8 * amt), base.a);
    }
    if (mode < 3.5) {
        for (var i = 1; i < 24; i++) {
            let f = f32(i) / 24.0;
            let o = vec2f(f * 0.28 * size, 0.0);
            g += (pe_bright(uv + o, th) + pe_bright(uv - o, th)) * (1.0 - f);
        }
        return vec4f(pe_screen(base.rgb, g / 24.0 * vec3f(0.35, 0.6, 1.0) * 2.4 * amt), base.a);
    }
    for (var i = 0; i < 16; i++) { g += pe_bright(uv + pe_disc(i, 16) * 0.014 * size, th); }
    return vec4f(pe_screen(base.rgb, g / 16.0 * vec3f(1.0, 0.28, 0.1) * 1.6 * amt), base.a);
}`),
	// P0 = (amount, mode 0 radial · 1 RGB wave · 2 prism, speed)
	chroma: fx(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let mode = P0().y;
    let t = fx.time * P0().z;
    let a = S(uv).a;
    if (mode < 0.5) {
        let c = uv - vec2f(0.5);
        let k = amt * 0.025 * (0.3 + dot(c, c) * 3.0);
        return vec4f(S(uv + c * k).r, S(uv).g, S(uv - c * k).b, a);
    }
    if (mode < 1.5) {
        let w = amt * 0.012;
        let r = S(uv + vec2f(sin(uv.y * 28.0 + t * 4.0) * w, 0.0)).r;
        let g = S(uv + vec2f(sin(uv.y * 28.0 + t * 4.0 + 2.1) * w, 0.0)).g;
        let b = S(uv + vec2f(sin(uv.y * 28.0 + t * 4.0 + 4.2) * w, 0.0)).b;
        return vec4f(r, g, b, a);
    }
    let o = vec2f(amt * 0.018, amt * 0.006);
    let l = S(uv - o).rgb;
    let m = S(uv).rgb;
    let r2 = S(uv + o).rgb;
    let prism = vec3f(l.r, m.g, r2.b);
    return vec4f(mix(m, prism * 1.05, clamp(amt, 0.0, 1.0)), a);
}`),
	// P0 = (amount, rate, mode 0 digital · 1 blocks · 2 tear · 3 smear · 4 signal loss · 5 pixel sort, size)
	glitch: fx(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let rate = max(P0().y, 0.1);
    let mode = P0().z;
    let tick = floor(fx.time * rate * 12.0);
    let burst = step(0.45, hash11(floor(fx.time * rate * 3.0) + 0.37));
    let k = amt * (0.35 + 0.65 * burst);
    if (mode < 0.5) {
        let row = floor(uv.y * 30.0);
        let on = step(0.7, hash12(vec2f(row, tick)));
        let q = uv + vec2f((hash12(vec2f(row * 1.3, tick)) - 0.5) * 0.12 * k * on, 0.0);
        let s = 0.012 * k;
        return vec4f(S(q + vec2f(s, 0.0)).r, S(q).g, S(q - vec2f(s, 0.0)).b, S(q).a);
    }
    if (mode < 1.5) {
        let cell = floor(uv * vec2f(16.0, 9.0) * max(P0().w, 0.3));
        let on = step(1.0 - 0.35 * k, hash12(cell + vec2f(tick * 0.31, tick * 0.17)));
        let off = (vec2f(hash12(cell + 4.0), hash12(cell + 8.0)) - vec2f(0.5)) * 0.15 * on;
        let c = S(uv + off);
        return vec4f(mix(c.rgb, c.gbr, on * 0.6), c.a);
    }
    if (mode < 2.5) {
        let line = floor(uv.y * 160.0);
        let band = step(0.65, pe_noise(vec2f(uv.y * 10.0, tick * 0.5)));
        let shift = (hash12(vec2f(line, tick)) - 0.5) * 0.16 * k * (0.2 + band);
        let c = S(uv + vec2f(shift, 0.0));
        let scan = 1.0 - 0.2 * k * step(0.5, fract(uv.y * 135.0));
        return vec4f(c.rgb * scan, c.a);
    }
    if (mode < 3.5) {
        let base = S(uv);
        var acc = base;
        var n = 1.0;
        for (var i = 1; i < 12; i++) {
            let q = uv - vec2f(0.0, f32(i) * 0.01 * k);
            let s = S(q);
            let w = step(0.5, hash12(floor(q * vec2f(40.0, 22.0)) + tick)) * k;
            acc += s * w;
            n += w;
        }
        return acc / n;
    }
    if (mode < 4.5) {
        let row = floor(uv.y * 60.0);
        let drop = step(1.0 - 0.25 * k, hash12(vec2f(row, tick)));
        let nz = hash12(floor(uv * vec2f(192.0, 108.0)) + tick);
        let c = S(uv + vec2f(drop * 0.05, 0.0));
        let snow = mix(c.rgb, vec3f(nz), drop * 0.8 + 0.12 * k);
        return vec4f(snow * (1.0 - 0.3 * k * step(0.92, hash11(tick))), c.a);
    }
    let base = S(uv);
    var acc = base;
    var n = 1.0;
    for (var i = 1; i < 16; i++) {
        let s = S(uv - vec2f(0.0, f32(i) * 0.008 * k));
        let w = smoothstep(0.5, 0.85, luma(s.rgb));
        acc += s * w;
        n += w;
    }
    return acc / n;
}`),
	// P0 = (amount, noise, bleed, mode 0 VHS · 1 tracking · 2 night · 3 camcorder)
	vhs: fx(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let mode = P0().w;
    let t = fx.time;
    let wob = sin(uv.y * 90.0 + t * 25.0) * 0.0015 * amt + (pe_noise(vec2f(uv.y * 40.0, t * 3.0)) - 0.5) * 0.004 * amt;
    var q = vec2f(uv.x + wob, uv.y);
    var track = 0.0;
    if (mode > 0.5 && mode < 1.5) {
        let y0 = fract(t * 0.35);
        track = exp(-pow((uv.y - y0) * 14.0, 2.0)) * amt;
        q.x += track * 0.03 * sin(uv.y * 300.0 + t * 50.0);
    }
    let bleed = P0().z * 0.006;
    let r = S(q + vec2f(bleed, 0.0)).r;
    let g = S(q).g;
    let b = S(q - vec2f(bleed, 0.0)).b;
    var col = vec3f(r, g, b);
    let y = luma(col);
    col = mix(col, vec3f(y), 0.15 * amt);
    let nz = hash12(floor(uv * vec2f(192.0, 108.0)) + floor(fx.time * 30.0)) - 0.5;
    col += vec3f(nz * P0().y * 0.18);
    col = mix(col, vec3f(hash12(uv * 900.0 + floor(fx.time * 30.0))), clamp(track, 0.0, 0.85));
    if (mode > 1.5 && mode < 2.5) {
        col = vec3f(y * 0.25, y * 1.05, y * 0.3) * 1.2 + vec3f(nz * 0.15);
    }
    if (mode > 2.5) {
        col = mix(col, col * vec3f(1.05, 1.02, 0.92), amt) * (1.0 + 0.08 * amt);
    }
    let scan = 1.0 - 0.12 * amt * step(0.5, fract(uv.y * 135.0));
    let c = pe_centered(uv);
    let vig = 1.0 - 0.35 * amt * dot(c, c);
    return vec4f(col * scan * vig, S(q).a);
}`),
	// P0 = (amount, grain, dust, mode 0 grain · 1 old film · 2 8mm · 3 16mm · 4 gate weave · 5 burned edges)
	film: fx(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let mode = P0().w;
    let tick = floor(fx.time * 24.0);
    var q = uv;
    if (mode > 1.5 && mode < 4.5) {
        let wv = select(0.004, 0.0015, mode > 2.5 && mode < 3.5);
        q += (vec2f(hash11(tick), hash11(tick + 3.3)) - vec2f(0.5)) * wv * amt;
    }
    let base = S(q);
    var col = base.rgb;
    if (mode > 0.5 && mode < 1.5) {
        let y = luma(col);
        col = mix(col, vec3f(y * 1.07, y * 0.9, y * 0.68), 0.8 * amt);
    }
    if (mode > 1.5 && mode < 2.5) {
        col = mix(col, col * vec3f(1.08, 1.0, 0.82), amt);
    }
    let g = (hash12(floor(uv * pe_res() / 3.0) + vec2f(tick * 1.7, tick)) - 0.5) * P0().y;
    col += vec3f(g * 0.22 * (1.2 - luma(col)));
    let dust = step(0.9975, hash12(floor(uv * pe_res() / 3.0) + tick)) * P0().z;
    let sx = hash11(tick * 1.31);
    let scratch = exp(-pow((uv.x - sx) * pe_res().x / 1.6, 2.0)) * step(0.6, hash11(tick + 2.0)) * P0().z;
    col = col - vec3f(dust * 0.75) + vec3f(scratch * 0.3);
    let flick = 1.0 + (hash11(tick + 5.0) - 0.5) * 0.12 * amt * select(0.3, 1.0, mode > 0.5);
    col *= flick;
    let c = pe_centered(uv);
    var vig = 1.0 - select(0.15, 0.55, mode > 0.5) * amt * dot(c, c);
    if (mode > 4.5) {
        let e = max(abs(uv.x - 0.5) * 2.0, abs(uv.y - 0.5) * 2.0);
        let burn = smoothstep(0.7, 1.0, e + (pe_fbm(uv * 6.0 + fx.time * 0.3) - 0.5) * 0.25);
        col = mix(col, vec3f(1.0, 0.45, 0.1) * 0.9, burn * amt * 0.8);
        vig = 1.0 - 0.3 * amt * dot(c, c);
    }
    return vec4f(col * vig, base.a);
}`),
	// P0 = (amount, speed, mode 0 leak · 1 corner burn · 2 sweep · 3 flicker · 4 rainbow, angle), P2 = colour
	leak: fx(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let sp = P0().y;
    let mode = P0().z;
    let t = fx.time * sp;
    let base = S(uv);
    var light = vec3f(0.0);
    if (mode < 0.5) {
        let n = pe_fbm(uv * vec2f(1.6, 1.1) + vec2f(t * 0.25, -t * 0.1));
        let m = smoothstep(0.45, 0.85, n + 0.35 * (1.0 - uv.x));
        light = P2().rgb * m * 1.3;
    } else if (mode < 1.5) {
        let d = length(pe_centered(uv) - vec2f(-0.7, -0.45));
        let m = smoothstep(1.1, 0.0, d + (pe_noise(uv * 3.0 + t) - 0.5) * 0.25);
        light = P2().rgb * m * m * 1.6;
    } else if (mode < 2.5) {
        let a = radians(P0().w);
        let x = dot(uv - vec2f(0.5), vec2f(cos(a), sin(a)));
        let pos = fract(t * 0.25) * 2.2 - 1.1;
        light = P2().rgb * (exp(-pow((x - pos) * 9.0, 2.0)) * 1.3 + exp(-pow((x - pos) * 40.0, 2.0)) * 0.8);
    } else if (mode < 3.5) {
        let f = pe_noise(vec2f(t * 6.0, 0.0));
        light = P2().rgb * smoothstep(0.35, 0.9, f) * (0.6 + 0.4 * uv.y);
    } else {
        let n = pe_fbm(uv * 1.3 + vec2f(t * 0.2, t * 0.05));
        let m = smoothstep(0.4, 0.9, n + 0.3 * uv.x);
        light = pe_hsv(fract(uv.x * 0.6 + uv.y * 0.3 + t * 0.08), 0.75, 1.0) * m * 1.2;
    }
    return vec4f(pe_screen(base.rgb, light * amt), base.a);
}`),
	// P0 = (amount, rate, mode 0 flash · 1 strobe · 2 camera flash · 3 colour flash), P2 = colour
	flash: fx(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let rate = max(P0().y, 0.1);
    let mode = P0().z;
    let t = fx.time;
    let base = S(uv);
    var k = 0.0;
    var col = P2().rgb;
    if (mode < 0.5) { k = exp(-t * rate * 6.0); }
    else if (mode < 1.5) { k = step(0.5, fract(t * rate)) * 0.85; }
    else if (mode < 2.5) { k = exp(-fract(t * rate) * 14.0) * step(fract(t * rate * 0.5), 0.5); }
    else {
        k = exp(-fract(t * rate) * 5.0);
        col = pe_hsv(fract(floor(t * rate) * 0.17), 0.7, 1.0);
    }
    return vec4f(mix(base.rgb, pe_screen(base.rgb, col), clamp(k * amt, 0.0, 1.0)), base.a);
}`),
	// P0 = (amount, size, mode, levels), P2 / P3 = colours
	style: fx(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let size = max(P0().y, 1.0);
    let mode = P0().z;
    let base = S(uv);
    var col = base.rgb;
    if (mode < 0.5) {
        let c = uv - vec2f(0.5);
        let q = vec2f(0.5) + c * (1.0 + dot(c, c) * 0.25 * amt);
        col = S(q).rgb;
        let px = q * pe_res() / 4.0;
        let mask = vec3f(
            0.8 + 0.2 * step(fract(px.x / 3.0), 0.34),
            0.8 + 0.2 * step(abs(fract(px.x / 3.0) - 0.5), 0.17),
            0.8 + 0.2 * step(0.66, fract(px.x / 3.0)));
        let scan = 0.75 + 0.25 * sin(px.y * 3.14159265 / 2.0);
        let edge = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
        col = mix(base.rgb, col * mask * scan * 1.25 * edge, amt);
    } else if (mode < 1.5) {
        let cells = pe_res() / size;
        let q = (floor(uv * cells) + vec2f(0.5)) / cells;
        let c = S(q).rgb;
        let lv = max(P0().w, 2.0);
        col = mix(base.rgb, floor(c * lv + vec3f(0.5)) / lv, amt);
    } else if (mode < 2.5) {
        let a = 0.785398;
        let p = rotate2(uv * pe_res() / size, a);
        let cell = fract(p) - vec2f(0.5);
        let y = luma(S(uv).rgb);
        let dot_ = step(length(cell), sqrt(1.0 - y) * 0.62);
        col = mix(base.rgb, mix(vec3f(0.97, 0.96, 0.92), P2().rgb, dot_), amt);
    } else if (mode < 3.5) {
        let lv = max(P0().w, 2.0);
        col = mix(base.rgb, floor(base.rgb * lv + vec3f(0.5)) / lv, amt);
    } else if (mode < 4.5) {
        let y = luma(base.rgb);
        col = mix(base.rgb, mix(P2().rgb, P3().rgb, smoothstep(0.05, 0.95, y)), amt);
    } else if (mode < 5.5) {
        let y = luma(base.rgb);
        let heat = select(select(mix(vec3f(1.0, 0.0, 0.0), vec3f(1.0, 1.0, 0.0), (y - 0.66) * 3.0), mix(vec3f(0.6, 0.0, 0.8), vec3f(1.0, 0.0, 0.0), (y - 0.33) * 3.0), y < 0.66), mix(vec3f(0.0, 0.0, 0.35), vec3f(0.6, 0.0, 0.8), y * 3.0), y < 0.33);
        col = mix(base.rgb, heat, amt);
    } else if (mode < 6.5) {
        let y = luma(base.rgb);
        let nz = hash12(floor(uv * pe_res() / 2.0) + floor(fx.time * 30.0)) - 0.5;
        let c = pe_centered(uv);
        let g = vec3f(0.15, 1.0, 0.25) * (y * 1.6 + nz * 0.25) * (1.0 - 0.9 * dot(c, c));
        col = mix(base.rgb, g, amt);
    } else if (mode < 7.5) {
        let lv = 4.0;
        let p = floor(base.rgb * lv + vec3f(0.5)) / lv;
        let e = smoothstep(0.08, 0.2, pe_edge(uv));
        let cell = fract(rotate2(uv * pe_res() / 6.0, 0.4)) - vec2f(0.5);
        let dots = step(length(cell), 0.25) * step(luma(base.rgb), 0.55) * 0.12;
        col = mix(base.rgb, (p - vec3f(dots)) * (1.0 - e), amt);
    } else if (mode < 8.5) {
        let e = pe_edge(uv);
        let y = luma(base.rgb);
        let pencil = vec3f(1.0 - clamp(e * 5.0, 0.0, 1.0)) * (0.9 + 0.1 * y);
        let paper = vec3f(0.98, 0.96, 0.9);
        col = mix(base.rgb, pencil * paper, amt);
    } else if (mode < 9.5) {
        let px = pe_px();
        let e = luma(S(uv - px).rgb) - luma(S(uv + px).rgb);
        col = mix(base.rgb, vec3f(0.5 + e * 2.0), amt);
    } else {
        let y = luma(base.rgb);
        let bayer = fract(sin(dot(floor(uv * pe_res() / size), vec2f(12.9898, 78.233))) * 43758.5453);
        let on = step(bayer, y);
        col = mix(base.rgb, mix(P3().rgb, P2().rgb, on), amt);
    }
    return vec4f(col, base.a);
}`),
	// P0 = (mode 0 mirror ↔ · 1 mirror ↕ · 2 quad · 3 kaleidoscope · 4 tiles, segments / tiles, spin, zoom)
	mirror: fx(`
fn effect(uv: vec2f) -> vec4f {
    let mode = P0().x;
    let n = max(P0().y, 2.0);
    var q = uv;
    if (mode < 0.5) { q = vec2f(select(uv.x, 1.0 - uv.x, uv.x > 0.5), uv.y); }
    else if (mode < 1.5) { q = vec2f(uv.x, select(uv.y, 1.0 - uv.y, uv.y > 0.5)); }
    else if (mode < 2.5) { q = vec2f(select(uv.x, 1.0 - uv.x, uv.x > 0.5), select(uv.y, 1.0 - uv.y, uv.y > 0.5)); }
    else if (mode < 3.5) {
        let c = pe_centered(uv);
        let r = length(c) / max(P0().w, 0.2);
        var a = atan2(c.y, c.x) + fx.time * P0().z;
        let seg = 6.2831853 / n;
        a = abs((a - seg * floor(a / seg)) - seg * 0.5);
        q = vec2f(cos(a), sin(a)) * r / vec2f(aspect(), 1.0) + vec2f(0.5);
    } else {
        q = fract(uv * n);
    }
    return S(q);
}`),
	// P0 = (amount, speed, mode 0 fisheye · 1 bulge · 2 pinch · 3 swirl · 4 wave · 5 ripple · 6 water · 7 glass · 8 jelly, scale)
	distort: fx(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let t = fx.time * P0().y;
    let mode = P0().z;
    let sc = max(P0().w, 0.1);
    let c = pe_centered(uv);
    let r = length(c);
    var q = uv;
    if (mode < 0.5) {
        q = c / (1.0 + amt * r * r) / vec2f(aspect(), 1.0) + vec2f(0.5);
    } else if (mode < 1.5) {
        let k = 1.0 - amt * 0.6 * smoothstep(0.5 * sc, 0.0, r);
        q = c * k / vec2f(aspect(), 1.0) + vec2f(0.5);
    } else if (mode < 2.5) {
        let k = 1.0 + amt * 0.8 * smoothstep(0.5 * sc, 0.0, r);
        q = c * k / vec2f(aspect(), 1.0) + vec2f(0.5);
    } else if (mode < 3.5) {
        let a = amt * 4.0 * smoothstep(0.6 * sc, 0.0, r) + t * 0.0;
        q = rotate2(c, a) / vec2f(aspect(), 1.0) + vec2f(0.5);
    } else if (mode < 4.5) {
        q = uv + vec2f(sin(uv.y * 12.0 / sc + t * 3.0), cos(uv.x * 10.0 / sc + t * 2.5)) * 0.012 * amt;
    } else if (mode < 5.5) {
        let w = sin(r * 40.0 / sc - t * 6.0) * 0.01 * amt;
        q = uv + normalize(c + vec2f(0.0001)) / vec2f(aspect(), 1.0) * w;
    } else if (mode < 6.5) {
        let w = vec2f(pe_fbm(uv * 3.0 / sc + vec2f(t * 0.4, 0.0)), pe_fbm(uv * 3.0 / sc + vec2f(5.2, t * 0.4))) - vec2f(0.5);
        q = uv + w * 0.06 * amt;
    } else if (mode < 7.5) {
        let cell = floor(uv * vec2f(12.0, 7.0) / sc);
        let o = (vec2f(hash12(cell), hash12(cell + 3.1)) - vec2f(0.5)) * 0.03 * amt;
        q = uv + o;
    } else {
        let w = sin(t * 6.0) * exp(-fract(t * 0.5) * 2.0);
        q = vec2f(0.5) + (uv - vec2f(0.5)) * vec2f(1.0 + 0.06 * amt * w, 1.0 - 0.06 * amt * w) + vec2f(sin(uv.y * 8.0 + t * 5.0) * 0.006 * amt, 0.0);
    }
    return S(q);
}`),
	// P0 = (amount, ratio, mode 0 letterbox · 1 vignette · 2 oval vignette · 3 lens dirt · 4 anamorphic, softness)
	frame: fx(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let mode = P0().z;
    let base = S(uv);
    var col = base.rgb;
    let c = pe_centered(uv);
    if (mode < 0.5 || mode > 3.5) {
        let want = max(P0().y, 1.0);
        let bar = clamp((1.0 - aspect() / want) * 0.5, 0.0, 0.45) * amt;
        let inside = smoothstep(bar, bar + 0.002, uv.y) * smoothstep(bar, bar + 0.002, 1.0 - uv.y);
        col = col * inside;
        if (mode > 3.5) {
            var g = vec3f(0.0);
            for (var i = 1; i < 16; i++) {
                let f = f32(i) / 16.0;
                g += (pe_bright(uv + vec2f(f * 0.25, 0.0), 0.75) + pe_bright(uv - vec2f(f * 0.25, 0.0), 0.75)) * (1.0 - f);
            }
            col = pe_screen(col * vec3f(0.96, 0.99, 1.04), g / 16.0 * vec3f(0.3, 0.55, 1.0) * 1.6) * inside;
        }
    } else if (mode < 1.5) {
        let v = smoothstep(0.85 + P0().w * 0.4, 0.25, length(c * vec2f(0.8, 1.0)));
        col = col * mix(1.0, v, amt);
    } else if (mode < 2.5) {
        let e = length(c * vec2f(1.0 / aspect(), 1.0) * vec2f(1.0, 1.25));
        let v = 1.0 - smoothstep(0.42, 0.42 + 0.1 + P0().w * 0.3, e);
        col = col * mix(1.0, v, amt);
    } else {
        let smudge = smoothstep(0.55, 0.85, pe_fbm(uv * vec2f(4.0, 3.0) + vec2f(3.1, 1.7)));
        var lit = vec3f(0.0);
        for (var i = 0; i < 12; i++) { lit += pe_bright(uv + pe_disc(i, 12) * 0.12, 0.6); }
        col = pe_screen(col, lit / 12.0 * smudge * 2.2 * amt + vec3f(smudge * 0.05 * amt));
    }
    return vec4f(col, base.a);
}`),
	// P0 = (amount, speed, mode 0 rain · 1 snow · 2 dust · 3 sparkles · 4 bokeh · 5 fog, size)
	weather: fx(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let t = fx.time * P0().y;
    let mode = P0().z;
    let size = max(P0().w, 0.2);
    let base = S(uv);
    var col = base.rgb;
    let a = aspect();
    if (mode < 0.5) {
        var r = 0.0;
        for (var l = 0; l < 3; l++) {
            let fl = f32(l);
            let sc = vec2f(80.0 + fl * 40.0, 6.0 + fl * 3.0) / size;
            let p = vec2f(uv.x * a + uv.y * 0.15, uv.y + t * (1.6 + fl * 0.5)) * sc;
            let cell = floor(p);
            let f = fract(p);
            let on = step(0.92, hash12(cell + fl * 7.0));
            r += on * smoothstep(0.08, 0.0, abs(f.x - 0.5)) * smoothstep(0.0, 0.5, f.y) * smoothstep(1.0, 0.5, f.y) * (0.5 + 0.2 * fl);
        }
        col = mix(col * (1.0 - 0.15 * amt), vec3f(0.85, 0.9, 1.0), clamp(r * amt, 0.0, 0.8));
    } else if (mode < 1.5) {
        var s = 0.0;
        for (var l = 0; l < 3; l++) {
            let fl = f32(l);
            let sc = (8.0 + fl * 6.0) / size;
            let p = vec2f(uv.x * a + sin(t * 0.7 + fl) * 0.1, uv.y - t * (0.12 + fl * 0.06)) * sc;
            let cell = floor(p);
            let f = fract(p) - vec2f(0.5) - (vec2f(hash12(cell), hash12(cell + 1.3)) - vec2f(0.5)) * 0.6;
            s += smoothstep(0.08 - fl * 0.015, 0.0, length(f)) * step(0.55, hash12(cell + 5.0));
        }
        col = mix(col, vec3f(1.0), clamp(s * amt, 0.0, 1.0));
    } else if (mode < 2.5) {
        var d = 0.0;
        for (var l = 0; l < 2; l++) {
            let fl = f32(l);
            let p = (vec2f(uv.x * a, uv.y) + vec2f(t * 0.02 * (fl + 1.0), -t * 0.01)) * (14.0 + fl * 10.0) / size;
            let cell = floor(p);
            let f = fract(p) - vec2f(0.5);
            d += smoothstep(0.06, 0.0, length(f)) * step(0.85, hash12(cell + fl * 3.0)) * (0.5 + 0.5 * sin(t * 2.0 + hash12(cell) * 6.0));
        }
        col = pe_screen(col, vec3f(1.0, 0.95, 0.85) * d * 0.7 * amt);
    } else if (mode < 3.5) {
        let p = vec2f(uv.x * a, uv.y) * 18.0 / size;
        let cell = floor(p);
        let f = fract(p) - vec2f(0.5);
        let on = step(0.88, hash12(cell));
        let tw = pow(0.5 + 0.5 * sin(t * 6.0 + hash12(cell + 2.0) * 30.0), 6.0);
        let star = (smoothstep(0.04, 0.0, abs(f.x)) * smoothstep(0.35, 0.0, abs(f.y)) + smoothstep(0.04, 0.0, abs(f.y)) * smoothstep(0.35, 0.0, abs(f.x))) * on * tw;
        col = pe_screen(col, vec3f(1.0, 0.95, 0.8) * star * amt * 1.5);
    } else if (mode < 4.5) {
        var b = vec3f(0.0);
        for (var i = 0; i < 18; i++) {
            let fi = f32(i);
            let cpos = vec2f(fract(hash11(fi * 3.1) + t * 0.02 * (hash11(fi) - 0.5)), fract(hash11(fi * 7.7) - t * 0.015));
            let rr = (0.03 + 0.06 * hash11(fi * 1.9)) * size;
            let dd = length((uv - cpos) * vec2f(a, 1.0));
            b += pe_hsv(hash11(fi * 4.3), 0.35, 1.0) * (1.0 - smoothstep(rr * 0.85, rr, dd)) * 0.35;
        }
        col = pe_screen(col, b * amt);
    } else {
        let f = pe_fbm(uv * vec2f(2.0, 3.0) / size + vec2f(t * 0.05, 0.0));
        let fog = smoothstep(0.2, 0.9, f + uv.y * 0.35);
        col = mix(col, vec3f(0.86, 0.88, 0.9), fog * amt * 0.7);
    }
    return vec4f(col, base.a);
}`),
	// P0 = (amount, speed, mode 0 disco · 1 neon pulse · 2 colour cycle · 3 lasers · 4 colour strobe)
	party: fx(`
fn effect(uv: vec2f) -> vec4f {
    let amt = P0().x;
    let t = fx.time * P0().y;
    let mode = P0().z;
    let base = S(uv);
    var col = base.rgb;
    let a = aspect();
    if (mode < 0.5) {
        var l = vec3f(0.0);
        for (var i = 0; i < 6; i++) {
            let fi = f32(i);
            let cpos = vec2f(0.5 + 0.45 * sin(t * (0.6 + fi * 0.13) + fi * 2.1), 0.5 + 0.4 * cos(t * (0.5 + fi * 0.11) + fi * 1.3));
            let d = length((uv - cpos) * vec2f(a, 1.0));
            l += pe_hsv(fract(fi / 6.0 + t * 0.05), 0.8, 1.0) * smoothstep(0.32, 0.0, d);
        }
        col = col * (1.0 - 0.45 * amt) + col * l * 1.4 * amt + l * 0.15 * amt;
    } else if (mode < 1.5) {
        let k = 0.5 + 0.5 * sin(t * 6.2831853);
        col = mix(col, pe_screen(col, pe_hsv(fract(t * 0.1), 0.85, 1.0) * 0.6), k * amt);
    } else if (mode < 2.5) {
        col = mix(col, pe_hue_rotate(col, t * 1.5), amt);
    } else if (mode < 3.5) {
        var b = vec3f(0.0);
        for (var i = 0; i < 5; i++) {
            let fi = f32(i);
            let ang = sin(t * (0.7 + fi * 0.2) + fi) * 0.9 + 1.5708;
            let origin = vec2f(0.2 + fi * 0.15, 1.05);
            let dir = vec2f(cos(ang), -sin(ang));
            let rel = (uv - origin) * vec2f(a, 1.0);
            let dist = abs(rel.x * dir.y - rel.y * dir.x);
            b += pe_hsv(fract(fi * 0.21 + 0.5), 0.9, 1.0) * smoothstep(0.006, 0.0, dist) * step(0.0, dot(rel, dir));
            b += pe_hsv(fract(fi * 0.21 + 0.5), 0.9, 1.0) * smoothstep(0.04, 0.0, dist) * 0.25 * step(0.0, dot(rel, dir));
        }
        col = pe_screen(col * (1.0 - 0.3 * amt), b * amt);
    } else {
        let on = step(0.5, fract(t * 2.0));
        col = mix(col, col * pe_hsv(fract(floor(t * 2.0) * 0.23), 0.75, 1.3), on * amt);
    }
    return vec4f(col, base.a);
}`),
};

// ------------------------------------------------------------------ variants
interface Variant {
	id: string;
	name: string;
	ru: string;
	family: keyof typeof SHADERS;
	category: string;
	/** The 16 floats P0..P3 at full strength: [a, b, c, d, e, f, g, h, colour r, g, b, x, colour2 r, g, b, x]. */
	base: number[];
	/** Slots the Strength slider scales (default: slot 0). */
	strengthSlots?: number[];
	/** Slot the Speed slider sets, with its default. */
	speed?: [number, number];
	color?: string;
	color2?: string;
	/** Extra sliders: each sets one slot of the base (a count of tiles, an angle). */
	params?: Array<{ key: string; label: string; slot: number; default: number; min: number; max: number; step: number }>;
}

const C = { lens: "Lens", camera: "Camera", blur: "Blur", light: "Light", glitch: "Glitch", retro: "Retro", film: "Film", style: "Style", distort: "Distort", frame: "Frame", weather: "Weather", party: "Party" };

const V: Variant[] = [
	// camera
	{ id: "heartbeat", name: "Heartbeat", ru: "сердцебиение", family: "shake", category: C.camera, base: [0.004, 1.2, 0.5, 0.05, 1, 0], strengthSlots: [0, 3], speed: [1, 1.2] },
	{ id: "drunk", name: "Drunk", ru: "пьяная камера", family: "shake", category: C.camera, base: [0.02, 0.4, 5, 0.06, 0, 0], strengthSlots: [0, 2], speed: [1, 0.4] },
	{ id: "bounce", name: "Bounce", ru: "прыжки", family: "shake", category: C.camera, base: [0.025, 1.5, 1, 0.04, 2, 0], strengthSlots: [0, 2], speed: [1, 1.5] },
	{ id: "stepShake", name: "Glitch Shake", ru: "рывки", family: "shake", category: C.camera, base: [0.015, 8, 1.5, 0.03, 3, 0], strengthSlots: [0, 2], speed: [1, 8] },
	{ id: "beatPulse", name: "Beat Pulse", ru: "пульс под бит", family: "pulse", category: C.camera, base: [0.12, 2, 0, 0.6], speed: [1, 2] },
	{ id: "breathe", name: "Breathe", ru: "дыхание", family: "pulse", category: C.camera, base: [0.05, 0.4, 1, 0], speed: [1, 0.4] },
	{ id: "zoomBounce", name: "Zoom Bounce", ru: "зум-прыжок", family: "pulse", category: C.camera, base: [0.1, 1.5, 3, 0.3], speed: [1, 1.5] },
	// blur
	{ id: "spinBlur", name: "Spin Blur", ru: "вращение", family: "blur", category: C.blur, base: [1, 1, 0, 0.5] },
	{ id: "motionBlur", name: "Motion Blur", ru: "смаз движения", family: "blur", category: C.blur, base: [1, 2, 0, 0.5], params: [{ key: "angle", label: "Angle, °", slot: 2, default: 0, min: 0, max: 180, step: 1 }] },
	{ id: "softGlow", name: "Soft Glow", ru: "мягкое свечение", family: "blur", category: C.blur, base: [0.7, 4, 0, 0.5] },
	{ id: "defocus", name: "Defocus", ru: "расфокус", family: "blur", category: C.blur, base: [1, 5, 0, 0.5] },
	// light: glow
	{ id: "bloom", name: "Bloom", ru: "блум", family: "glow", category: C.light, base: [0.8, 0.6, 0, 1] },
	{ id: "starFilter", name: "Star Filter", ru: "звёздный фильтр", family: "glow", category: C.light, base: [1, 0.7, 2, 1] },
	{ id: "anamorphicStreak", name: "Anamorphic Streak", ru: "анаморфный блик", family: "glow", category: C.light, base: [1, 0.72, 3, 1] },
	{ id: "halation", name: "Halation", ru: "ореол плёнки", family: "glow", category: C.film, base: [0.8, 0.6, 4, 1] },
	// chroma
	{ id: "rgbWave", name: "RGB Wave", ru: "RGB волна", family: "chroma", category: C.glitch, base: [1, 1, 1], speed: [2, 1] },
	{ id: "prism", name: "Prism", ru: "призма", family: "chroma", category: C.light, base: [1, 2, 1] },
	// glitch
	{ id: "digitalGlitch", name: "Digital Glitch", ru: "цифровой глитч", family: "glitch", category: C.glitch, base: [1, 1, 0, 1], speed: [1, 1] },
	{ id: "blockGlitch", name: "Block Glitch", ru: "блоки", family: "glitch", category: C.glitch, base: [1, 1, 1, 1], speed: [1, 1] },
	{ id: "scanTear", name: "Scan Tear", ru: "разрыв строк", family: "glitch", category: C.glitch, base: [1, 1, 2, 1], speed: [1, 1] },
	{ id: "dataSmear", name: "Data Smear", ru: "датамош", family: "glitch", category: C.glitch, base: [1, 1, 3, 1], speed: [1, 1] },
	{ id: "signalLoss", name: "Signal Loss", ru: "потеря сигнала", family: "glitch", category: C.glitch, base: [1, 1, 4, 1], speed: [1, 1] },
	{ id: "pixelSort", name: "Pixel Sort", ru: "сортировка пикселей", family: "glitch", category: C.glitch, base: [1, 1, 5, 1], speed: [1, 1] },
	// retro
	{ id: "vhsPro", name: "VHS Tape", ru: "кассета VHS", family: "vhs", category: C.retro, base: [1, 1, 1, 0] },
	{ id: "vhsTracking", name: "VHS Tracking", ru: "трекинг VHS", family: "vhs", category: C.retro, base: [1, 1, 1, 1] },
	{ id: "nightCam", name: "Night Cam", ru: "ночная камера", family: "vhs", category: C.retro, base: [1, 1.4, 0.6, 2] },
	{ id: "camcorder90s", name: "Camcorder 90s", ru: "камкордер 90-х", family: "vhs", category: C.retro, base: [0.8, 0.8, 0.8, 3] },
	{ id: "crt", name: "CRT Screen", ru: "кинескоп", family: "style", category: C.retro, base: [1, 1, 0, 0] },
	{ id: "pixelArt", name: "Pixel Art", ru: "пиксель-арт", family: "style", category: C.retro, base: [1, 8, 1, 6] },
	{ id: "gameboy", name: "Handheld Console", ru: "консоль", family: "style", category: C.retro, base: [1, 4, 10, 0], color: "#9bbc0f", color2: "#0f380f" },
	// film
	{ id: "film8mm", name: "8mm", ru: "8 мм", family: "film", category: C.film, base: [1, 1.4, 0.8, 2] },
	{ id: "film16mm", name: "16mm", ru: "16 мм", family: "film", category: C.film, base: [1, 0.8, 0.4, 3] },
	{ id: "gateWeave", name: "Gate Weave", ru: "дрожание кадра", family: "film", category: C.film, base: [1, 0.4, 0, 4] },
	{ id: "burnedEdges", name: "Burned Edges", ru: "прожжённые края", family: "film", category: C.film, base: [1, 0.6, 0.3, 5] },
	// light leaks and flashes
	{ id: "leakRainbow", name: "Rainbow Leak", ru: "радужный засвет", family: "leak", category: C.light, base: [0.8, 1, 4, 0], speed: [1, 1] },
	{ id: "cornerBurn", name: "Corner Burn", ru: "угловой засвет", family: "leak", category: C.light, base: [0.9, 1, 1, 0], speed: [1, 1], color: "#ff6a1a" },
	{ id: "lightSweep", name: "Light Sweep", ru: "световая полоса", family: "leak", category: C.light, base: [0.8, 1, 2, 30], speed: [1, 1], color: "#fff2d6" },
	{ id: "flickerLight", name: "Flicker Light", ru: "мерцание", family: "leak", category: C.light, base: [0.7, 1, 3, 0], speed: [1, 1], color: "#ffd7a1" },
	{ id: "cameraFlash", name: "Camera Flash", ru: "фотовспышка", family: "flash", category: C.light, base: [1, 1.5, 2], speed: [1, 1.5], color: "#ffffff" },
	// stylize
	{ id: "sketch", name: "Sketch", ru: "скетч", family: "style", category: C.style, base: [1, 1, 8, 0] },
	{ id: "emboss", name: "Emboss", ru: "тиснение", family: "style", category: C.style, base: [1, 1, 9, 0] },
	{ id: "dither", name: "1-bit Dither", ru: "дизеринг", family: "style", category: C.style, base: [1, 2, 10, 0], color: "#f2f2f2", color2: "#111111" },
	// mirror
	{ id: "mirrorQuad", name: "Quad Mirror", ru: "четыре зеркала", family: "mirror", category: C.lens, base: [2, 2, 0, 1], strengthSlots: [] },
	{ id: "tiles", name: "Tiles", ru: "плитка", family: "mirror", category: C.lens, base: [4, 2, 0, 1], strengthSlots: [], params: [{ key: "tiles", label: "Tiles per side", slot: 1, default: 2, min: 2, max: 6, step: 1 }] },
	// distort
	{ id: "fisheye", name: "Fisheye", ru: "рыбий глаз", family: "distort", category: C.distort, base: [1.2, 1, 0, 1] },
	{ id: "bulge", name: "Bulge", ru: "выпуклость", family: "distort", category: C.distort, base: [1, 1, 1, 1] },
	{ id: "pinch", name: "Pinch", ru: "щипок", family: "distort", category: C.distort, base: [1, 1, 2, 1] },
	{ id: "swirl", name: "Swirl", ru: "водоворот", family: "distort", category: C.distort, base: [1, 1, 3, 1] },
	{ id: "wave", name: "Wave", ru: "волна", family: "distort", category: C.distort, base: [1, 1, 4, 1], speed: [1, 1] },
	{ id: "ripple", name: "Ripple", ru: "рябь", family: "distort", category: C.distort, base: [1, 1, 5, 1], speed: [1, 1] },
	{ id: "water", name: "Water", ru: "вода", family: "distort", category: C.distort, base: [1, 1, 6, 1], speed: [1, 1] },
	{ id: "glass", name: "Glass Blocks", ru: "стеклоблоки", family: "distort", category: C.distort, base: [1, 1, 7, 1] },
	{ id: "jelly", name: "Jelly", ru: "желе", family: "distort", category: C.distort, base: [1, 1, 8, 1], speed: [1, 1] },
	// frame
	{ id: "vignetteOval", name: "Vignette Oval", ru: "виньетка овал", family: "frame", category: C.frame, base: [1, 0, 2, 0.3] },
	{ id: "lensDirt", name: "Lens Dirt", ru: "грязь на линзе", family: "frame", category: C.frame, base: [1, 0, 3, 0] },
	{ id: "anamorphicLook", name: "Anamorphic Look", ru: "анаморфот", family: "frame", category: C.frame, base: [1, 2.39, 4, 0] },
	// weather
	{ id: "rain", name: "Rain", ru: "дождь", family: "weather", category: C.weather, base: [1, 1, 0, 1], speed: [1, 1] },
	{ id: "snow", name: "Snow", ru: "снег", family: "weather", category: C.weather, base: [1, 1, 1, 1], speed: [1, 1] },
	{ id: "dust", name: "Floating Dust", ru: "пылинки", family: "weather", category: C.weather, base: [1, 1, 2, 1], speed: [1, 1] },
	{ id: "sparkles", name: "Sparkles", ru: "блёстки", family: "weather", category: C.weather, base: [1, 1, 3, 1], speed: [1, 1] },
	{ id: "bokehLights", name: "Bokeh Lights", ru: "боке", family: "weather", category: C.weather, base: [1, 1, 4, 1], speed: [1, 1] },
	{ id: "fog", name: "Fog", ru: "туман", family: "weather", category: C.weather, base: [1, 1, 5, 1], speed: [1, 1] },
	// party
	{ id: "disco", name: "Disco Lights", ru: "диско", family: "party", category: C.party, base: [1, 1, 0], speed: [1, 1] },
	{ id: "neonPulse", name: "Neon Pulse", ru: "неоновый пульс", family: "party", category: C.party, base: [0.8, 1, 1], speed: [1, 1] },
	{ id: "colorCycle", name: "Colour Cycle", ru: "переливы цвета", family: "party", category: C.party, base: [1, 1, 2], speed: [1, 1] },
	{ id: "lasers", name: "Lasers", ru: "лазеры", family: "party", category: C.party, base: [1, 1, 3], speed: [1, 1] },
	{ id: "colorStrobe", name: "Colour Strobe", ru: "цветной строб", family: "party", category: C.party, base: [0.8, 1, 4], speed: [1, 1] },
];

function makeEffect(v: Variant): EffectDefinition {
	const strengthSlots = v.strengthSlots ?? [0];
	const params: ParamDefinition[] = [];
	if (strengthSlots.length > 0) params.push(numberParam("strength", "Strength, %", 100, 0, 200, 1));
	if (v.speed) params.push(numberParam("speed", "Speed", v.speed[1], 0.05, Math.max(10, v.speed[1] * 3), 0.05));
	if (v.color) params.push({ key: "color", label: "Colour", type: "color", default: v.color } as ParamDefinition);
	if (v.color2) params.push({ key: "color2", label: "Colour 2", type: "color", default: v.color2 } as ParamDefinition);
	for (const x of v.params ?? []) params.push(numberParam(x.key, x.label, x.default, x.min, x.max, x.step));
	return defineShaderEffect({
		type: `pro.fx.${v.id}`,
		name: v.name,
		keywords: [v.name.toLowerCase(), v.ru, v.family],
		category: v.category,
		params,
		shader: `pro.fx.family.${v.family}`,
		wgsl: SHADERS[v.family],
		pack: ({ p }: { p: ParamValues }) => {
			const out = new Array<number>(32).fill(0);
			v.base.forEach((value, i) => {
				out[i] = value;
			});
			const k = num(p, "strength", 100) / 100;
			for (const slot of strengthSlots) out[slot] = v.base[slot] * k;
			if (v.speed) out[v.speed[0]] = num(p, "speed", v.speed[1]);
			for (const x of v.params ?? []) out[x.slot] = num(p, x.key, x.default);
			if (v.color) {
				const [r, g, b] = rgb(p, "color", [1, 1, 1]);
				out[8] = r;
				out[9] = g;
				out[10] = b;
			}
			if (v.color2) {
				const [r, g, b] = rgb(p, "color2", [0, 0, 0]);
				out[12] = r;
				out[13] = g;
				out[14] = b;
			}
			return out;
		},
	});
}

export const proEffects: EffectDefinition[] = V.map(makeEffect);
