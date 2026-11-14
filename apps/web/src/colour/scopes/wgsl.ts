// The scopes' two GPU programs. The numbers come from math.ts (one definition for the GPU, the CPU fallback and the
// tests); a test compares the tables this compute pass fills with math.ts measureFrame on the same frame.
import { barTargets, CB_DIV, CB_SCALE, CR_DIV, CR_SCALE, HIST_OFFSET, KB, KG, KR, LEVELS, LUMA_WEIGHTS, PLOT_MARGIN, SKIN_TONE_ANGLE, TARGET_HALF, VEC_GAIN, VEC_OFFSET, VEC_RADIUS, VEC_SIZE, WAVE_COLS, WAVE_GAIN } from "./math";

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));

const SHARED = /* wgsl */ `
const KR = ${f(KR)};
const KG = ${f(KG)};
const KB = ${f(KB)};
const CB_DIV = ${f(CB_DIV)};
const CR_DIV = ${f(CR_DIV)};
const WAVE_COLS = ${WAVE_COLS}u;
const LEVELS = ${LEVELS}u;
const VEC_SIZE = ${VEC_SIZE}u;
const VEC_OFFSET = ${VEC_OFFSET}u;
const HIST_OFFSET = ${HIST_OFFSET}u;
`;

/**
 * One pass over the frame: every sampled pixel adds one to its waveform cells (Y', R', G', B' by column), its
 * vectorscope cell and its histogram cells. `grid` samples, `step` source pixels apart, each taken at the middle of
 * its step.
 */
export const MEASURE_WGSL = /* wgsl */ `
${SHARED}
struct Params {
	src_size: vec2u,
	grid: vec2u,
	step: vec2u,
	columns: u32,
	pad: u32,
}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> bins: array<atomic<u32>>;
@group(0) @binding(2) var<uniform> params: Params;

fn level(v: f32) -> u32 { return u32(clamp(floor(v * 255.0 + 0.5), 0.0, 255.0)); }

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
	if (id.x >= params.grid.x || id.y >= params.grid.y) { return; }
	let p = min(id.xy * params.step + params.step / 2u, params.src_size - vec2u(1u));
	let c = clamp(textureLoad(src, vec2i(p), 0).rgb, vec3f(0.0), vec3f(1.0));
	// the pixel's 8-bit codes, then whole-number sums only (math.ts pixelBins, the same lines)
	let rl = level(c.r);
	let gl = level(c.g);
	let bl = level(c.b);
	let sum = ${LUMA_WEIGHTS[0]}u * rl + ${LUMA_WEIGHTS[1]}u * gl + ${LUMA_WEIGHTS[2]}u * bl;
	let yl = min((sum + 5000u) / 10000u, 255u);
	let cbl = min((10000u * bl + ${128 * CB_SCALE}u - sum) / ${CB_SCALE}u, 255u);
	let crl = min((10000u * rl + ${128 * CR_SCALE}u - sum) / ${CR_SCALE}u, 255u);
	let column = min(p.x * params.columns / params.src_size.x, params.columns - 1u);
	atomicAdd(&bins[(0u * WAVE_COLS + column) * LEVELS + yl], 1u);
	atomicAdd(&bins[(1u * WAVE_COLS + column) * LEVELS + rl], 1u);
	atomicAdd(&bins[(2u * WAVE_COLS + column) * LEVELS + gl], 1u);
	atomicAdd(&bins[(3u * WAVE_COLS + column) * LEVELS + bl], 1u);
	atomicAdd(&bins[VEC_OFFSET + crl * VEC_SIZE + cbl], 1u);
	atomicAdd(&bins[HIST_OFFSET + yl], 1u);
	atomicAdd(&bins[HIST_OFFSET + LEVELS + rl], 1u);
	atomicAdd(&bins[HIST_OFFSET + 2u * LEVELS + gl], 1u);
	atomicAdd(&bins[HIST_OFFSET + 3u * LEVELS + bl], 1u);
}
`;

const targets = barTargets(0.75);
const fullTargets = barTargets(1);
const skin = { x: Math.cos((SKIN_TONE_ANGLE * Math.PI) / 180), y: Math.sin((SKIN_TONE_ANGLE * Math.PI) / 180) };

/** Scope kinds as the draw program numbers them. */
export const KIND = { waveform: 0, parade: 1, vectorscope: 2, histogram: 3 } as const;

/**
 * Draws one scope into its cell from the tables. One device pixel reads the cells it covers (summed when the cell is
 * smaller than the table, the nearest one otherwise), so nothing is skipped at any strip size.
 */
export const DRAW_WGSL = /* wgsl */ `
${SHARED}
const MARGIN = ${f(PLOT_MARGIN)};
const VEC_RADIUS = ${f(VEC_RADIUS)};
const TARGET_HALF = ${f(TARGET_HALF)};
const WAVE_GAIN = ${f(WAVE_GAIN)};
const VEC_GAIN = ${f(VEC_GAIN)};
const TARGETS = array<vec2f, 6>(${targets.map((t) => `vec2f(${f(t.cb)}, ${f(t.cr)})`).join(", ")});
const FULL_TARGETS = array<vec2f, 6>(${fullTargets.map((t) => `vec2f(${f(t.cb)}, ${f(t.cr)})`).join(", ")});
const SKIN = vec2f(${f(skin.x)}, ${f(skin.y)});

struct View {
	// the cell in device pixels
	size: vec2f,
	// samples per waveform column; all samples
	per_column: f32,
	total: f32,
	kind: u32,
	columns: u32,
	// 1: the vectorscope's trace takes the colour it stands for
	tinted: u32,
	pad: u32,
}
@group(0) @binding(0) var<storage, read> bins: array<u32>;
@group(0) @binding(1) var<uniform> view: View;

struct VertexOutput {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
}
@vertex
fn vertex_main(@builtin(vertex_index) index: u32) -> VertexOutput {
	// one triangle that covers the viewport
	let p = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
	var out: VertexOutput;
	out.position = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
	out.uv = vec2f(p.x, 1.0 - p.y);
	return out;
}

const BACK = vec3f(0.035, 0.035, 0.04);
const LINE = vec3f(1.0, 1.0, 1.0);

fn trace(share: f32, gain: f32) -> f32 { return 1.0 - exp(-share * gain); }

// the count of one waveform channel over the levels a pixel covers, per level it covers
fn wave_count(channel: u32, column: u32, level_f: f32, span: f32) -> f32 {
	let base = (channel * WAVE_COLS + column) * LEVELS;
	if (span <= 1.0) {
		return f32(bins[base + u32(clamp(floor(level_f + 0.5), 0.0, 255.0))]);
	}
	let lo = i32(floor(level_f - span * 0.5 + 0.5));
	let hi = i32(floor(level_f + span * 0.5 + 0.5));
	var sum = 0.0;
	for (var l = lo; l <= hi; l++) {
		if (l >= 0 && l <= 255) { sum += f32(bins[base + u32(l)]); }
	}
	return sum;
}

// the plot's own area inside its margins: 0 at the bottom (0 %), 1 at the top (100 %)
fn plot_y(uv_y: f32) -> f32 { return (1.0 - uv_y - MARGIN) / (1.0 - 2.0 * MARGIN); }

fn level_lines(uv: vec2f) -> f32 {
	let py = plot_y(uv.y);
	let px_h = 1.0 / (view.size.y * (1.0 - 2.0 * MARGIN));
	var a = 0.0;
	for (var i = 0; i <= 4; i++) {
		let d = abs(py - f32(i) * 0.25);
		if (d < px_h * 0.5) { a = max(a, select(0.10, 0.2, i == 0 || i == 4)); }
	}
	return a;
}

fn waveform(uv: vec2f, channel: u32, x01: f32) -> f32 {
	let py = plot_y(uv.y);
	if (py < -0.02 || py > 1.02) { return 0.0; }
	let column = min(u32(x01 * f32(view.columns)), view.columns - 1u);
	let span = 255.0 / (view.size.y * (1.0 - 2.0 * MARGIN));
	let count = wave_count(channel, column, py * 255.0, span);
	return trace(count / max(view.per_column, 1.0), WAVE_GAIN);
}

// what the vectorscope's table holds under one pixel at colour difference c (per table cell when it covers several)
fn vec_count(c: vec2f, px: f32) -> f32 {
	let bin = (c + vec2f(0.5)) * 255.0;
	let span = px * 255.0;
	if (span <= 1.0) {
		let b = vec2u(clamp(floor(bin + vec2f(0.5)), vec2f(0.0), vec2f(255.0)));
		return f32(bins[VEC_OFFSET + b.y * VEC_SIZE + b.x]);
	}
	let lo = vec2i(floor(bin - vec2f(span * 0.5) + vec2f(0.5)));
	let hi = vec2i(floor(bin + vec2f(span * 0.5) + vec2f(0.5)));
	var count = 0.0;
	for (var y = lo.y; y <= hi.y; y++) {
		for (var x = lo.x; x <= hi.x; x++) {
			if (x >= 0 && x <= 255 && y >= 0 && y <= 255) { count += f32(bins[VEC_OFFSET + u32(y) * VEC_SIZE + u32(x)]); }
		}
	}
	return count / (span * span);
}

fn vectorscope(uv: vec2f) -> vec4f {
	// a square in the middle of the cell
	let side = min(view.size.x, view.size.y);
	let p = (uv - vec2f(0.5)) * view.size / side * 2.0;
	let c = vec2f(p.x, -p.y) * VEC_RADIUS;
	let px = 2.0 * VEC_RADIUS / side;
	var color = BACK;
	let r = length(c);
	// rim, axes, the skin-tone line
	var g = 0.0;
	if (abs(r - VEC_RADIUS + px) < px * 0.6) { g = 0.22; }
	if (r < VEC_RADIUS && (abs(c.x) < px * 0.5 || abs(c.y) < px * 0.5)) { g = max(g, 0.09); }
	let along = dot(c, SKIN);
	let across = abs(c.x * SKIN.y - c.y * SKIN.x);
	var skin_a = 0.0;
	if (along > 0.0 && along < VEC_RADIUS - px && across < px * 0.6) { skin_a = 0.55; }
	// the boxes of 75 % bars, dots at 100 %
	var boxes = TARGETS;
	var dots = FULL_TARGETS;
	for (var i = 0; i < 6; i++) {
		let d = abs(c - boxes[i]);
		let m = max(d.x, d.y);
		if (m < TARGET_HALF && m > TARGET_HALF - px * 1.2) { g = max(g, 0.5); }
		if (length(c - dots[i]) < px * 1.3) { g = max(g, 0.35); }
	}
	color = mix(color, LINE, g);
	color = mix(color, vec3f(1.0, 0.72, 0.5), skin_a);
	if (r >= VEC_RADIUS) { return vec4f(color, 1.0); }
	// the trace: the table cells this pixel covers, and a third of what its four neighbours cover — one colour that
	// fills a whole table cell (a colour bar) is then a small dot with a soft edge, not a single pixel
	let own = vec_count(c, px);
	let near = max(max(vec_count(c + vec2f(px, 0.0), px), vec_count(c - vec2f(px, 0.0), px)), max(vec_count(c + vec2f(0.0, px), px), vec_count(c - vec2f(0.0, px), px)));
	let count = max(own, near * 0.35);
	let a = trace(count / max(view.total, 1.0), VEC_GAIN);
	var tint = vec3f(0.86);
	if (view.tinted == 1u) {
		let yy = 0.62;
		let rr = yy + c.y * CR_DIV;
		let bb = yy + c.x * CB_DIV;
		let gg = (yy - KR * rr - KB * bb) / KG;
		tint = mix(vec3f(0.86), clamp(vec3f(rr, gg, bb), vec3f(0.0), vec3f(1.0)), 0.8);
	}
	color = mix(color, tint, a);
	return vec4f(color, 1.0);
}

fn histogram(uv: vec2f) -> vec4f {
	let x01 = (uv.x - 0.03) / 0.94;
	var color = BACK;
	let py = 1.0 - uv.y - MARGIN * 0.5;
	// 0 %, 50 %, 100 % marks
	let px_w = 1.0 / (view.size.x * 0.94);
	for (var i = 0; i <= 4; i++) {
		if (abs(x01 - f32(i) * 0.25) < px_w * 0.5) { color = mix(color, LINE, select(0.08, 0.16, i == 0 || i == 4)); }
	}
	if (x01 < 0.0 || x01 > 1.0 || py < 0.0) { return vec4f(color, 1.0); }
	let span = 256.0 / (view.size.x * 0.94);
	let level_f = x01 * 255.0;
	var sums = vec4f(0.0);
	if (span <= 1.0) {
		let l = u32(clamp(floor(level_f + 0.5), 0.0, 255.0));
		sums = vec4f(f32(bins[HIST_OFFSET + l]), f32(bins[HIST_OFFSET + LEVELS + l]), f32(bins[HIST_OFFSET + 2u * LEVELS + l]), f32(bins[HIST_OFFSET + 3u * LEVELS + l]));
	} else {
		let lo = i32(floor(level_f - span * 0.5 + 0.5));
		let hi = i32(floor(level_f + span * 0.5 + 0.5));
		var n = 0.0;
		for (var l = lo; l <= hi; l++) {
			if (l >= 0 && l <= 255) {
				let u = u32(l);
				sums += vec4f(f32(bins[HIST_OFFSET + u]), f32(bins[HIST_OFFSET + LEVELS + u]), f32(bins[HIST_OFFSET + 2u * LEVELS + u]), f32(bins[HIST_OFFSET + 3u * LEVELS + u]));
				n += 1.0;
			}
		}
		sums = sums / max(n, 1.0);
	}
	// a level that holds the same share as every other is 40 % high; the square root keeps small shares readable
	let heights = sqrt(sums * 256.0 / max(view.total, 1.0)) * 0.4 * (1.0 - MARGIN);
	let add = vec3f(
		select(0.0, 0.62, py <= heights.y),
		select(0.0, 0.62, py <= heights.z),
		select(0.0, 0.62, py <= heights.w),
	);
	color = color + (vec3f(1.0) - color) * add * vec3f(0.95, 0.85, 1.0);
	let px_h = 1.0 / view.size.y;
	if (abs(py - heights.x) < px_h * 0.8) { color = mix(color, vec3f(0.92), 0.85); }
	return vec4f(color, 1.0);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
	let uv = input.uv;
	if (view.kind == 2u) { return vectorscope(uv); }
	if (view.kind == 3u) { return histogram(uv); }
	var color = mix(BACK, LINE, level_lines(uv));
	if (view.kind == 0u) {
		let a = waveform(uv, 0u, uv.x);
		color = mix(color, vec3f(0.88, 0.9, 0.86), a);
		return vec4f(color, 1.0);
	}
	// parade: red, green, blue side by side, a thin gap between them
	let third = uv.x * 3.0;
	let channel = min(u32(third), 2u);
	let x01 = fract(third);
	if (x01 < 0.015 || x01 > 0.985) { return vec4f(BACK, 1.0); }
	let a = waveform(uv, channel + 1u, (x01 - 0.015) / 0.97);
	var tints = array<vec3f, 3>(vec3f(1.0, 0.36, 0.33), vec3f(0.36, 0.92, 0.42), vec3f(0.4, 0.62, 1.0));
	color = mix(color, tints[channel], a);
	return vec4f(color, 1.0);
}
`;
