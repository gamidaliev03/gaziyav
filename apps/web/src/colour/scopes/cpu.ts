// The scopes without WebGPU (the compositor fell back to WebGL, or the GPU path failed): the same tables (math.ts
// measureFrame) from a small copy of the frame, drawn into pixels by the same rules as wgsl.ts. Slower and coarser —
// a few times a second from 320 × 180 samples — but it always answers.
import {
	barTargets,
	CB_DIV,
	CHANNEL_B,
	CHANNEL_G,
	CHANNEL_R,
	CHANNEL_Y,
	CR_DIV,
	histIndex,
	KB,
	KG,
	KR,
	PLOT_MARGIN,
	type ScopeBins,
	skinToneDirection,
	TARGET_HALF,
	traceLevel,
	VEC_GAIN,
	VEC_RADIUS,
	vecIndex,
	WAVE_GAIN,
	waveIndex,
} from "./math";

export type CpuScopeKind = "waveform" | "parade" | "vectorscope" | "histogram";

const BACK: [number, number, number] = [0.035, 0.035, 0.04];
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function put(out: Uint8ClampedArray, i: number, c: [number, number, number]) {
	out[i] = c[0] * 255;
	out[i + 1] = c[1] * 255;
	out[i + 2] = c[2] * 255;
	out[i + 3] = 255;
}

const plotY = (uvY: number) => (1 - uvY - PLOT_MARGIN) / (1 - 2 * PLOT_MARGIN);

function waveCount(bins: ScopeBins, channel: number, column: number, levelF: number, span: number): number {
	if (span <= 1) return bins.counts[waveIndex(channel, column, Math.min(255, Math.max(0, Math.floor(levelF + 0.5))))];
	const lo = Math.floor(levelF - span * 0.5 + 0.5);
	const hi = Math.floor(levelF + span * 0.5 + 0.5);
	let sum = 0;
	for (let l = lo; l <= hi; l++) if (l >= 0 && l <= 255) sum += bins.counts[waveIndex(channel, column, l)];
	return sum;
}

function levelLines(uvY: number, height: number): number {
	const py = plotY(uvY);
	const pxH = 1 / (height * (1 - 2 * PLOT_MARGIN));
	let a = 0;
	for (let i = 0; i <= 4; i++) if (Math.abs(py - i * 0.25) < pxH * 0.5) a = Math.max(a, i === 0 || i === 4 ? 0.2 : 0.1);
	return a;
}

const PARADE_TINTS: Array<[number, number, number]> = [
	[1, 0.36, 0.33],
	[0.36, 0.92, 0.42],
	[0.4, 0.62, 1],
];

/** One scope as RGBA pixels of `width` × `height` (the rules of wgsl.ts DRAW_WGSL, pixel for pixel). */
export function drawScope({ kind, bins, width, height, tinted = true }: { kind: CpuScopeKind; bins: ScopeBins; width: number; height: number; tinted?: boolean }): Uint8ClampedArray {
	const out = new Uint8ClampedArray(width * height * 4);
	const targets = barTargets(0.75);
	const full = barTargets(1);
	const skin = skinToneDirection();
	const perColumn = Math.max(bins.perColumn, 1);
	const total = Math.max(bins.samples, 1);
	for (let y = 0; y < height; y++) {
		const uvY = (y + 0.5) / height;
		for (let x = 0; x < width; x++) {
			const uvX = (x + 0.5) / width;
			const i = (y * width + x) * 4;
			let color: [number, number, number] = [...BACK];
			if (kind === "waveform" || kind === "parade") {
				const g = levelLines(uvY, height);
				color = [mix(color[0], 1, g), mix(color[1], 1, g), mix(color[2], 1, g)];
				const py = plotY(uvY);
				const span = 255 / (height * (1 - 2 * PLOT_MARGIN));
				if (py >= -0.02 && py <= 1.02) {
					if (kind === "waveform") {
						const column = Math.min(bins.columns - 1, Math.floor(uvX * bins.columns));
						const a = traceLevel(waveCount(bins, CHANNEL_Y, column, py * 255, span) / perColumn, WAVE_GAIN);
						color = [mix(color[0], 0.88, a), mix(color[1], 0.9, a), mix(color[2], 0.86, a)];
					} else {
						const third = uvX * 3;
						const channel = Math.min(2, Math.floor(third));
						const x01 = third - Math.floor(third);
						if (x01 < 0.015 || x01 > 0.985) {
							color = [...BACK];
						} else {
							const column = Math.min(bins.columns - 1, Math.floor(((x01 - 0.015) / 0.97) * bins.columns));
							const a = traceLevel(waveCount(bins, channel + 1, column, py * 255, span) / perColumn, WAVE_GAIN);
							const tint = PARADE_TINTS[channel];
							color = [mix(color[0], tint[0], a), mix(color[1], tint[1], a), mix(color[2], tint[2], a)];
						}
					}
				}
			} else if (kind === "vectorscope") {
				const side = Math.min(width, height);
				const px = (2 * VEC_RADIUS) / side;
				const cx = ((uvX - 0.5) * width * 2 * VEC_RADIUS) / side;
				const cy = (-(uvY - 0.5) * height * 2 * VEC_RADIUS) / side;
				const r = Math.hypot(cx, cy);
				let g = 0;
				if (Math.abs(r - VEC_RADIUS + px) < px * 0.6) g = 0.22;
				if (r < VEC_RADIUS && (Math.abs(cx) < px * 0.5 || Math.abs(cy) < px * 0.5)) g = Math.max(g, 0.09);
				const along = cx * skin.cb + cy * skin.cr;
				const across = Math.abs(cx * skin.cr - cy * skin.cb);
				const skinA = along > 0 && along < VEC_RADIUS - px && across < px * 0.6 ? 0.55 : 0;
				for (let t = 0; t < 6; t++) {
					const m = Math.max(Math.abs(cx - targets[t].cb), Math.abs(cy - targets[t].cr));
					if (m < TARGET_HALF && m > TARGET_HALF - px * 1.2) g = Math.max(g, 0.5);
					if (Math.hypot(cx - full[t].cb, cy - full[t].cr) < px * 1.3) g = Math.max(g, 0.35);
				}
				color = [mix(color[0], 1, g), mix(color[1], 1, g), mix(color[2], 1, g)];
				color = [mix(color[0], 1, skinA), mix(color[1], 0.72, skinA), mix(color[2], 0.5, skinA)];
				if (r < VEC_RADIUS) {
					const span = px * 255;
					const under = (ax: number, ay: number) => {
						const bx = (ax + 0.5) * 255;
						const by = (ay + 0.5) * 255;
						if (span <= 1) return bins.counts[vecIndex(Math.min(255, Math.max(0, Math.floor(bx + 0.5))), Math.min(255, Math.max(0, Math.floor(by + 0.5))))];
						let sum = 0;
						for (let yy = Math.floor(by - span * 0.5 + 0.5); yy <= Math.floor(by + span * 0.5 + 0.5); yy++) {
							for (let xx = Math.floor(bx - span * 0.5 + 0.5); xx <= Math.floor(bx + span * 0.5 + 0.5); xx++) {
								if (xx >= 0 && xx <= 255 && yy >= 0 && yy <= 255) sum += bins.counts[vecIndex(xx, yy)];
							}
						}
						return sum / (span * span);
					};
					// the pixel's own cells, and a third of its four neighbours' (wgsl.ts vectorscope)
					const count = Math.max(under(cx, cy), 0.35 * Math.max(under(cx + px, cy), under(cx - px, cy), under(cx, cy + px), under(cx, cy - px)));
					const a = traceLevel(count / total, VEC_GAIN);
					let tint: [number, number, number] = [0.86, 0.86, 0.86];
					if (tinted) {
						const yy = 0.62;
						const rr = yy + cy * CR_DIV;
						const bb = yy + cx * CB_DIV;
						const gg = (yy - KR * rr - KB * bb) / KG;
						const c01 = (v: number) => Math.min(1, Math.max(0, v));
						tint = [mix(0.86, c01(rr), 0.8), mix(0.86, c01(gg), 0.8), mix(0.86, c01(bb), 0.8)];
					}
					color = [mix(color[0], tint[0], a), mix(color[1], tint[1], a), mix(color[2], tint[2], a)];
				}
			} else {
				const x01 = (uvX - 0.03) / 0.94;
				const py = 1 - uvY - PLOT_MARGIN * 0.5;
				const pxW = 1 / (width * 0.94);
				for (let m = 0; m <= 4; m++) {
					if (Math.abs(x01 - m * 0.25) < pxW * 0.5) {
						const g = m === 0 || m === 4 ? 0.16 : 0.08;
						color = [mix(color[0], 1, g), mix(color[1], 1, g), mix(color[2], 1, g)];
					}
				}
				if (x01 >= 0 && x01 <= 1 && py >= 0) {
					const span = 256 / (width * 0.94);
					const levelF = x01 * 255;
					const sums = [0, 0, 0, 0];
					const lo = span <= 1 ? Math.min(255, Math.max(0, Math.floor(levelF + 0.5))) : Math.floor(levelF - span * 0.5 + 0.5);
					const hi = span <= 1 ? lo : Math.floor(levelF + span * 0.5 + 0.5);
					let n = 0;
					for (let l = lo; l <= hi; l++) {
						if (l < 0 || l > 255) continue;
						sums[0] += bins.counts[histIndex(CHANNEL_Y, l)];
						sums[1] += bins.counts[histIndex(CHANNEL_R, l)];
						sums[2] += bins.counts[histIndex(CHANNEL_G, l)];
						sums[3] += bins.counts[histIndex(CHANNEL_B, l)];
						n++;
					}
					const heights = sums.map((s) => Math.sqrt(((s / Math.max(n, 1)) * 256) / total) * 0.4 * (1 - PLOT_MARGIN));
					const add = [py <= heights[1] ? 0.62 : 0, py <= heights[2] ? 0.62 : 0, py <= heights[3] ? 0.62 : 0];
					const weight = [0.95, 0.85, 1];
					color = [color[0] + (1 - color[0]) * add[0] * weight[0], color[1] + (1 - color[1]) * add[1] * weight[1], color[2] + (1 - color[2]) * add[2] * weight[2]];
					if (Math.abs(py - heights[0]) < (1 / height) * 0.8) color = [mix(color[0], 0.92, 0.85), mix(color[1], 0.92, 0.85), mix(color[2], 0.92, 0.85)];
				}
			}
			put(out, i, color);
		}
	}
	return out;
}

/** The size of the copy the CPU path measures. */
export const CPU_SAMPLE = { width: 320, height: 180 };
