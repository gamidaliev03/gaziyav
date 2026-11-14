// Tracker math: One-Euro smoothing (Casiez et al. — steady when still, responsive when moving), sampling at a
// source time, hand corrections, and the mapping from the clip's picture to canvas pixels.
import type { Transform } from "@/rendering";
import type { Tracker, TrackerFx } from "./types";

/** One smoothed sample: centre and size normalized (top-left origin), angle in degrees. */
export interface TrackBox {
	cx: number;
	cy: number;
	w: number;
	h: number;
	angle: number;
	confidence: number;
}

class OneEuro {
	private x: number | null = null;
	private dx = 0;
	private t: number | null = null;
	constructor(
		private minCutoff: number,
		private beta: number,
		private dCutoff = 1,
	) {}
	private alpha(cutoff: number, dt: number) {
		const tau = 1 / (2 * Math.PI * cutoff);
		return 1 / (1 + tau / dt);
	}
	filter(value: number, t: number): number {
		if (this.x === null || this.t === null || t <= this.t) {
			this.x = value;
			this.t = t;
			return value;
		}
		const dt = t - this.t;
		const rawD = (value - this.x) / dt;
		const ad = this.alpha(this.dCutoff, dt);
		this.dx = ad * rawD + (1 - ad) * this.dx;
		const a = this.alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt);
		const v = a * value + (1 - a) * this.x;
		this.x = v;
		this.t = t;
		return v;
	}
}

export interface SmoothedTrack {
	t: Float64Array;
	cx: Float64Array;
	cy: Float64Array;
	w: Float64Array;
	h: Float64Array;
	angle: Float64Array;
	conf: Float64Array;
}

const smoothedCache = new WeakMap<Tracker, SmoothedTrack>();

/** Forward + backward One-Euro (no lag either way); `smoothing` 0 = raw … 1 = very steady. */
export function smoothedTrack(tracker: Tracker): SmoothedTrack {
	const hit = smoothedCache.get(tracker);
	if (hit) return hit;
	const rows = tracker.samples;
	const n = rows.length;
	const out: SmoothedTrack = {
		t: new Float64Array(n),
		cx: new Float64Array(n),
		cy: new Float64Array(n),
		w: new Float64Array(n),
		h: new Float64Array(n),
		angle: new Float64Array(n),
		conf: new Float64Array(n),
	};
	for (let i = 0; i < n; i++) {
		const [t, x, y, w, h, a = 0, c = 1] = rows[i];
		out.t[i] = t;
		out.cx[i] = x + w / 2;
		out.cy[i] = y + h / 2;
		out.w[i] = w;
		out.h[i] = h;
		// Unwrapped: a turn across ±180° stays a small step (smoothing and in-between frames don't spin the other way).
		out.angle[i] = i > 0 ? out.angle[i - 1] + ((((a - out.angle[i - 1] + 180) % 360) + 360) % 360) - 180 : a;
		out.conf[i] = c;
	}
	const k = Math.max(0, Math.min(1, tracker.smoothing ?? 0.5));
	if (k > 0.001 && n > 2) {
		// minCutoff 4 Hz (light) … 0.25 Hz (very steady); sizes twice as steady as positions.
		const minCutoff = 4 * Math.pow(0.0625, k);
		const beta = 0.7 * (1 - k * 0.8);
		for (const key of ["cx", "cy", "w", "h", "angle"] as const) {
			const cut = key === "w" || key === "h" ? minCutoff * 0.5 : minCutoff;
			const fwd = new OneEuro(cut, beta);
			const bwd = new OneEuro(cut, beta);
			const a = new Float64Array(n);
			const b = new Float64Array(n);
			for (let i = 0; i < n; i++) a[i] = fwd.filter(out[key][i], out.t[i]);
			for (let i = n - 1; i >= 0; i--) b[i] = bwd.filter(out[key][i], -out.t[i]);
			for (let i = 0; i < n; i++) out[key][i] = (a[i] + b[i]) / 2;
		}
	}
	smoothedCache.set(tracker, out);
	return out;
}

/** The box at a source time (seconds), interpolated; holds the ends. null when there are no samples. */
export function trackBoxAt(tracker: Tracker, t: number): TrackBox | null {
	const s = smoothedTrack(tracker);
	const n = s.t.length;
	if (!n) return null;
	let i: number;
	let f = 0;
	if (t <= s.t[0]) i = 0;
	else if (t >= s.t[n - 1]) i = n - 1;
	else {
		let lo = 0;
		let hi = n - 1;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (s.t[mid] <= t) lo = mid;
			else hi = mid;
		}
		i = lo;
		f = s.t[hi] > s.t[lo] ? (t - s.t[lo]) / (s.t[hi] - s.t[lo]) : 0;
	}
	const j = Math.min(n - 1, i + 1);
	const m = (k: keyof SmoothedTrack) => s[k][i] + (s[k][j] - s[k][i]) * f;
	return { cx: m("cx"), cy: m("cy"), w: m("w"), h: m("h"), angle: m("angle"), confidence: Math.min(s.conf[i], s.conf[j]) };
}

/**
 * A hand correction: the box at time `t` becomes `box` (normalized, top-left x/y + w/h); neighbours within
 * `radius` seconds move along with a smooth falloff, so the path stays continuous. Returns new samples.
 */
export function correctTrack(tracker: Tracker, t: number, box: { x: number; y: number; w: number; h: number }, radius = 0.5): number[][] {
	const current = trackBoxAt(tracker, t);
	if (!current) return tracker.samples;
	const dx = box.x + box.w / 2 - current.cx;
	const dy = box.y + box.h / 2 - current.cy;
	const sw = current.w > 0 ? box.w / current.w : 1;
	const sh = current.h > 0 ? box.h / current.h : 1;
	let samples = tracker.samples.map((row) => {
		const d = Math.abs(row[0] - t);
		if (d >= radius) return row;
		const k = 0.5 + 0.5 * Math.cos((Math.PI * d) / radius);
		const [rt, x, y, w, h, a = 0, c = 1] = row;
		const nw = w * (1 + (sw - 1) * k);
		const nh = h * (1 + (sh - 1) * k);
		const cx = x + w / 2 + dx * k;
		const cy = y + h / 2 + dy * k;
		return [rt, cx - nw / 2, cy - nh / 2, nw, nh, a, Math.max(c, k)];
	});
	// No sample near t (a gap): add one.
	if (!samples.some((row) => Math.abs(row[0] - t) < 1 / 120)) {
		samples = [...samples, [t, box.x, box.y, box.w, box.h, current.angle, 1]].sort((a, b) => a[0] - b[0]);
	}
	return samples;
}

/** Drops the samples in [from, to] (seconds). */
export function cutTrack(tracker: Tracker, from: number, to: number): number[][] {
	return tracker.samples.filter((row) => row[0] < from || row[0] > to);
}

export const DEFAULT_FX: Record<Exclude<TrackerFx["kind"], "none">, TrackerFx> = {
	blur: { kind: "blur", amount: 0.6, expand: 1.25, feather: 0.35, shape: "ellipse" },
	pixelate: { kind: "pixelate", amount: 0.5, expand: 1.2, feather: 0.1, shape: "ellipse" },
	spotlight: { kind: "spotlight", amount: 0.65, expand: 1.6, feather: 0.6, shape: "ellipse" },
	colorPop: { kind: "colorPop", amount: 1, expand: 1.3, feather: 0.45, shape: "ellipse" },
	glow: { kind: "glow", amount: 0.6, expand: 1.35, feather: 0.6, shape: "ellipse" },
	filter: { kind: "filter", amount: 1, expand: 1.2, feather: 0.35, shape: "ellipse", look: "bw" },
};

/**
 * Canvas point (px from the canvas centre) of a normalized point of a clip's picture, through the clip's
 * transform (position, scale, rotation) — the same geometry the compositor uses.
 */
export function pictureToCanvas({
	nx,
	ny,
	frame,
	transform,
	canvas,
}: {
	nx: number;
	ny: number;
	frame: [number, number];
	transform: Transform;
	canvas: { width: number; height: number };
}): { x: number; y: number; scale: number } {
	const [fw, fh] = frame;
	const contain = Math.min(canvas.width / fw, canvas.height / fh);
	const lx = (nx - 0.5) * fw * contain * transform.scaleX;
	const ly = (ny - 0.5) * fh * contain * transform.scaleY;
	const r = (transform.rotate * Math.PI) / 180;
	const cos = Math.cos(r);
	const sin = Math.sin(r);
	return {
		x: transform.position.x + lx * cos - ly * sin,
		y: transform.position.y + lx * sin + ly * cos,
		scale: contain * Math.abs(transform.scaleY),
	};
}
