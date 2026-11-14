import type { ParamValues } from "@/params";

// Shared WGSL helpers for hand-written transitions. In a transition pass
// src() = outgoing clip (A), orig() = incoming clip (B), fx.progress = 0..1.
export const COMMON = /* wgsl */ `
fn A(uv: vec2f) -> vec4f { return src_bounded(uv); }
fn B(uv: vec2f) -> vec4f { return orig_bounded(uv); }
fn bell() -> f32 { return sin(3.14159265 * clamp(fx.progress, 0.0, 1.0)); }
fn ease_in_out_cubic(t: f32) -> f32 {
    let x = clamp(t, 0.0, 1.0);
    return select(1.0 - pow(-2.0 * x + 2.0, 3.0) / 2.0, 4.0 * x * x * x, x < 0.5);
}
fn dir_vec(i: f32) -> vec2f {
    if (i < 0.5) { return vec2f(-1.0, 0.0); }
    if (i < 1.5) { return vec2f(1.0, 0.0); }
    if (i < 2.5) { return vec2f(0.0, -1.0); }
    return vec2f(0.0, 1.0);
}
// Sample the A|B strip shifted by \`shift\` (in frames): A at 0, B at -dir.
fn strip(uv: vec2f, d: vec2f, shift: f32) -> vec4f {
    let q = uv - d * shift;
    let qb = q + d;
    let in_a = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0);
    return select(B(qb), A(q), in_a > 0.5);
}
`;

export const DIRECTION_PARAM = {
	key: "direction",
	label: "Direction",
	default: "left",
	options: [
		{ value: "left", label: "Left" },
		{ value: "right", label: "Right" },
		{ value: "up", label: "Up" },
		{ value: "down", label: "Down" },
	],
};
export const DIRECTIONS = ["left", "right", "up", "down"];
export const directionIndex = (p: ParamValues) => Math.max(0, DIRECTIONS.indexOf(String(p.direction ?? "left")));

