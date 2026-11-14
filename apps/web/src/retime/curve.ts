// Speed ramps (CapCut-style curves). A curve gives the speed v(s) over the clip's source span, s ∈ [0, 1]
// (x of the points), smooth between points (monotone cubic in log-speed: no overshoot, no negative speed).
// The clip lasts D = S · K where S is the source span and K = ∫₀¹ ds / v(s); RetimeConfig.rate stores 1 / K
// (the average speed), so everything that only knows a constant rate still gets the right span and length.
// Clip time ↔ source time goes through a precomputed table: O(1) per lookup (audio asks per sample).
import type { SpeedCurve, SpeedCurvePresetId } from "@/motion/types";

export const MIN_CURVE_SPEED = 0.1;
export const MAX_CURVE_SPEED = 10;

type Pt = { x: number; y: number };

export const SPEED_CURVE_PRESETS: ReadonlyArray<{ id: SpeedCurvePresetId; label: string; points: Pt[] }> = [
	{ id: "montage", label: "Montage", points: [{ x: 0, y: 1 }, { x: 0.2, y: 3.5 }, { x: 0.4, y: 0.6 }, { x: 0.6, y: 0.6 }, { x: 0.8, y: 3.5 }, { x: 1, y: 1 }] },
	{ id: "hero", label: "Hero", points: [{ x: 0, y: 2.5 }, { x: 0.35, y: 2.5 }, { x: 0.47, y: 0.3 }, { x: 0.58, y: 0.3 }, { x: 0.7, y: 2.5 }, { x: 1, y: 2.5 }] },
	{ id: "bullet", label: "Bullet", points: [{ x: 0, y: 4 }, { x: 0.38, y: 4 }, { x: 0.5, y: 0.15 }, { x: 0.62, y: 4 }, { x: 1, y: 4 }] },
	{ id: "jumpCut", label: "Jump Cut", points: [{ x: 0, y: 1 }, { x: 0.42, y: 1 }, { x: 0.5, y: 8 }, { x: 0.58, y: 1 }, { x: 1, y: 1 }] },
	{ id: "flashIn", label: "Flash In", points: [{ x: 0, y: 6 }, { x: 0.25, y: 4 }, { x: 0.55, y: 1 }, { x: 1, y: 1 }] },
	{ id: "flashOut", label: "Flash Out", points: [{ x: 0, y: 1 }, { x: 0.45, y: 1 }, { x: 0.75, y: 4 }, { x: 1, y: 6 }] },
	// creative-trends П11 «velocity edit»: 1× → 5× → held → brakes to 0.3× on the key moment → back to 1×
	{ id: "velocity", label: "Velocity", points: [{ x: 0, y: 1 }, { x: 0.1, y: 5 }, { x: 0.38, y: 5 }, { x: 0.48, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.72, y: 1 }, { x: 1, y: 1 }] },
	{ id: "custom", label: "Custom", points: [{ x: 0, y: 1 }, { x: 0.25, y: 1 }, { x: 0.5, y: 1 }, { x: 0.75, y: 1 }, { x: 1, y: 1 }] },
];

const clampSpeed = (v: number) => Math.min(MAX_CURVE_SPEED, Math.max(MIN_CURVE_SPEED, Number.isFinite(v) ? v : 1));

/** Points sorted, deduplicated, ending at x = 0 and x = 1, speeds clamped. */
export function normalizeCurvePoints(points: ReadonlyArray<Pt>): Pt[] {
	const out = points
		.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
		.map((p) => ({ x: Math.min(1, Math.max(0, p.x)), y: clampSpeed(p.y) }))
		.sort((a, b) => a.x - b.x);
	const dedup: Pt[] = [];
	for (const p of out) {
		if (dedup.length && Math.abs(dedup[dedup.length - 1].x - p.x) < 1e-4) dedup[dedup.length - 1] = p;
		else dedup.push(p);
	}
	if (!dedup.length) return [{ x: 0, y: 1 }, { x: 1, y: 1 }];
	if (dedup[0].x > 0) dedup.unshift({ x: 0, y: dedup[0].y });
	if (dedup[dedup.length - 1].x < 1) dedup.push({ x: 1, y: dedup[dedup.length - 1].y });
	return dedup;
}

/** Speed at s (monotone cubic Hermite in log space, Fritsch–Carlson). */
function buildSpeedFn(points: Pt[]): (s: number) => number {
	const n = points.length;
	const xs = points.map((p) => p.x);
	const ys = points.map((p) => Math.log(p.y));
	if (n === 1) return () => points[0].y;
	const d: number[] = [];
	for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-9, xs[i + 1] - xs[i]));
	const m: number[] = new Array(n);
	m[0] = d[0];
	m[n - 1] = d[n - 2];
	for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
	for (let i = 0; i < n - 1; i++) {
		if (d[i] === 0) {
			m[i] = 0;
			m[i + 1] = 0;
			continue;
		}
		const a = m[i] / d[i];
		const b = m[i + 1] / d[i];
		const h = a * a + b * b;
		if (h > 9) {
			const t = 3 / Math.sqrt(h);
			m[i] = t * a * d[i];
			m[i + 1] = t * b * d[i];
		}
	}
	return (s: number) => {
		if (s <= xs[0]) return Math.exp(ys[0]);
		if (s >= xs[n - 1]) return Math.exp(ys[n - 1]);
		let i = 0;
		while (i < n - 2 && s > xs[i + 1]) i++;
		const h = xs[i + 1] - xs[i];
		const t = (s - xs[i]) / h;
		const t2 = t * t;
		const t3 = t2 * t;
		const v =
			(2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
		return Math.exp(v);
	};
}

const GRID = 2048;

export interface CurveTable {
	/** ∫₀¹ ds / v: clip duration ÷ source span. */
	k: number;
	/** Average speed (1 / k). */
	rate: number;
	minSpeed: number;
	maxSpeed: number;
	speed: (s: number) => number;
	/** u (clip fraction) on a uniform grid → s (source fraction). */
	sOfU: Float64Array;
	/** s on a uniform grid → u. */
	uOfS: Float64Array;
	speedStart: number;
	speedEnd: number;
}

const cache = new Map<string, CurveTable>();

export function curveKey(curve: Pick<SpeedCurve, "points">): string {
	return curve.points.map((p) => `${p.x.toFixed(4)}:${p.y.toFixed(4)}`).join("|");
}

export function getCurveTable(curve: Pick<SpeedCurve, "points">): CurveTable {
	const key = curveKey(curve);
	const hit = cache.get(key);
	if (hit) return hit;
	const points = normalizeCurvePoints(curve.points);
	const speed = buildSpeedFn(points);
	// T(s) = ∫₀ˢ ds / v on the s grid (trapezoid), then u = T / K.
	const uOfS = new Float64Array(GRID + 1);
	let minSpeed = Number.POSITIVE_INFINITY;
	let maxSpeed = 0;
	let prev = 1 / speed(0);
	for (let i = 1; i <= GRID; i++) {
		const v = speed(i / GRID);
		minSpeed = Math.min(minSpeed, v);
		maxSpeed = Math.max(maxSpeed, v);
		const cur = 1 / v;
		uOfS[i] = uOfS[i - 1] + ((prev + cur) / 2) * (1 / GRID);
		prev = cur;
	}
	minSpeed = Math.min(minSpeed, speed(0));
	maxSpeed = Math.max(maxSpeed, speed(0));
	const k = uOfS[GRID];
	for (let i = 0; i <= GRID; i++) uOfS[i] /= k;
	// Invert: s on a uniform u grid.
	const sOfU = new Float64Array(GRID + 1);
	let j = 0;
	for (let i = 0; i <= GRID; i++) {
		const u = i / GRID;
		while (j < GRID - 1 && uOfS[j + 1] < u) j++;
		const u0 = uOfS[j];
		const u1 = uOfS[j + 1];
		const f = u1 > u0 ? (u - u0) / (u1 - u0) : 0;
		sOfU[i] = Math.min(1, Math.max(0, (j + Math.min(1, Math.max(0, f))) / GRID));
	}
	sOfU[GRID] = 1;
	const table: CurveTable = {
		k,
		rate: 1 / k,
		minSpeed,
		maxSpeed,
		speed,
		sOfU,
		uOfS,
		speedStart: speed(0),
		speedEnd: speed(1),
	};
	if (cache.size > 64) cache.delete(cache.keys().next().value as string);
	cache.set(key, table);
	return table;
}

function lerpTable(table: Float64Array, x: number): number {
	const f = x * GRID;
	const i = Math.min(GRID - 1, Math.max(0, Math.floor(f)));
	const t = f - i;
	return table[i] + (table[i + 1] - table[i]) * t;
}

/** Source fraction s at clip fraction u (linear beyond the ends, at the end speeds). */
export function sourceFractionAt(table: CurveTable, u: number): number {
	if (u <= 0) return u * table.k * table.speedStart;
	if (u >= 1) return 1 + (u - 1) * table.k * table.speedEnd;
	return lerpTable(table.sOfU, u);
}

/** Clip fraction u at source fraction s. */
export function clipFractionAt(table: CurveTable, s: number): number {
	if (s <= 0) return s / (table.k * table.speedStart);
	if (s >= 1) return 1 + (s - 1) / (table.k * table.speedEnd);
	return lerpTable(table.uOfS, s);
}

export function buildCurve(preset: SpeedCurvePresetId, points?: ReadonlyArray<Pt>): SpeedCurve {
	const base = points ?? SPEED_CURVE_PRESETS.find((p) => p.id === preset)?.points ?? SPEED_CURVE_PRESETS[0].points;
	return { preset, points: normalizeCurvePoints(base) };
}

/** The part [s0, s1] of a curve as a curve of its own (for split). */
export function subCurve(curve: SpeedCurve, s0: number, s1: number): SpeedCurve {
	const table = getCurveTable(curve);
	const span = Math.max(1e-6, s1 - s0);
	const inner = normalizeCurvePoints(curve.points).filter((p) => p.x > s0 + 1e-4 && p.x < s1 - 1e-4);
	// Dense enough samples keep the shape when only a small piece is left.
	const extra: Pt[] = [];
	for (let i = 1; i < 8; i++) extra.push({ x: s0 + (span * i) / 8, y: table.speed(s0 + (span * i) / 8) });
	const pts = [{ x: s0, y: table.speed(s0) }, ...inner, ...extra, { x: s1, y: table.speed(s1) }].map((p) => ({
		x: (p.x - s0) / span,
		y: p.y,
	}));
	return { preset: "custom", points: normalizeCurvePoints(pts) };
}
