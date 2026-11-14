// Authors write `fn effect(uv: vec2f) -> vec4f`. uv origin is top-left.
// Colors are gamma-encoded sRGB with straight alpha.
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct FxUniforms {
    resolution: vec2f,
    time: f32,
    progress: f32,
    frame: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
    params: array<vec4f, 8>,
}

@group(0) @binding(0) var src_tex: texture_2d<f32>;
@group(0) @binding(1) var lin_samp: sampler;
@group(1) @binding(0) var<uniform> fx: FxUniforms;
@group(2) @binding(0) var orig_tex: texture_2d<f32>;
@group(2) @binding(1) var aux0_tex: texture_2d<f32>;
@group(2) @binding(2) var aux1_tex: texture_2d<f32>;

fn src(uv: vec2f) -> vec4f { return textureSampleLevel(src_tex, lin_samp, uv, 0.0); }
fn orig(uv: vec2f) -> vec4f { return textureSampleLevel(orig_tex, lin_samp, uv, 0.0); }
fn aux0(uv: vec2f) -> vec4f { return textureSampleLevel(aux0_tex, lin_samp, uv, 0.0); }
fn aux1(uv: vec2f) -> vec4f { return textureSampleLevel(aux1_tex, lin_samp, uv, 0.0); }

// Transparent outside [0,1] (used by geometric effects so edges do not smear).
fn src_bounded(uv: vec2f) -> vec4f {
    let inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    return src(clamp(uv, vec2f(0.0), vec2f(1.0))) * inside;
}
fn orig_bounded(uv: vec2f) -> vec4f {
    let inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    return orig(clamp(uv, vec2f(0.0), vec2f(1.0))) * inside;
}

fn P0() -> vec4f { return fx.params[0]; }
fn P1() -> vec4f { return fx.params[1]; }
fn P2() -> vec4f { return fx.params[2]; }
fn P3() -> vec4f { return fx.params[3]; }
fn P4() -> vec4f { return fx.params[4]; }
fn P5() -> vec4f { return fx.params[5]; }
fn P6() -> vec4f { return fx.params[6]; }
fn P7() -> vec4f { return fx.params[7]; }

fn texel() -> vec2f { return vec2f(1.0) / fx.resolution; }
fn aspect() -> f32 { return fx.resolution.x / max(fx.resolution.y, 1.0); }
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

// "Hash without Sine" (Dave Hoskins, MIT).
fn hash12(p: vec2f) -> f32 {
    var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
    p3 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
fn hash11(p: f32) -> f32 {
    var x = fract(p * 0.1031);
    x = x * (x + 33.33);
    x = x * (x + x);
    return fract(x);
}
// Smooth 1D value noise in [-1, 1].
fn vnoise(x: f32) -> f32 {
    let i = floor(x);
    let f = fract(x);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(hash11(i), hash11(i + 1.0), u) * 2.0 - 1.0;
}
fn rotate2(p: vec2f, a: f32) -> vec2f {
    let c = cos(a);
    let s = sin(a);
    return vec2f(p.x * c - p.y * s, p.x * s + p.y * c);
}
// Scale `uv` about `center` in an aspect-correct way.
fn zoom_uv(uv: vec2f, center: vec2f, scale: f32) -> vec2f {
    return center + (uv - center) / max(scale, 0.0001);
}
fn ease_out_cubic(t: f32) -> f32 { let u = 1.0 - clamp(t, 0.0, 1.0); return 1.0 - u * u * u; }
fn ease_in_cubic(t: f32) -> f32 { let u = clamp(t, 0.0, 1.0); return u * u * u; }
fn ease_in_out_sine(t: f32) -> f32 { return 0.5 - 0.5 * cos(3.14159265 * clamp(t, 0.0, 1.0)); }
