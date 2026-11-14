// Hand-made motion of a layer (After Effects for beginners): an In and an Out preset with their timing and an
// easing, kept as plain params on the element (`motion.*`). Nothing is baked into the project: flatten.ts turns
// them into transform keyframes for playback and export, so the preview and the file run the same curve, the
// layer stays freely movable (its own transform is untouched) and trimming keeps the Out glued to the end.
// Pure: no editor core, no Remotion.

export const MOTION_IN = [
	{ value: "none", label: "None" },
	{ value: "fade", label: "Dissolve in" },
	{ value: "slideLeft", label: "Slide from left" },
	{ value: "slideRight", label: "Slide from right" },
	{ value: "slideUp", label: "Slide from below" },
	{ value: "slideDown", label: "Slide from above" },
	{ value: "scale", label: "Scale in" },
	{ value: "pop", label: "Pop" },
	{ value: "spin", label: "Spin" },
] as const;

export const MOTION_OUT = [
	{ value: "none", label: "None" },
	{ value: "fade", label: "Dissolve out" },
	{ value: "slideLeft", label: "Slide to left" },
	{ value: "slideRight", label: "Slide to right" },
	{ value: "slideUp", label: "Fly up" },
	{ value: "slideDown", label: "Drop down" },
	{ value: "scale", label: "Scale out" },
	{ value: "pop", label: "Pop" },
	{ value: "spin", label: "Spin" },
] as const;

export const MOTION_EASE = [
	{ value: "easeOut", label: "Ease out" },
	{ value: "easeInOut", label: "Smooth" },
	{ value: "easeIn", label: "Ease in" },
	{ value: "linear", label: "Linear" },
	{ value: "back", label: "Overshoot" },
	{ value: "bounce", label: "Bounce" },
] as const;

export type MotionKind = (typeof MOTION_IN)[number]["value"];
export type MotionEase = (typeof MOTION_EASE)[number]["value"];

export const MOTION_KEYS = {
	in: "motion.in",
	inDur: "motion.inDur",
	out: "motion.out",
	outDur: "motion.outDur",
	ease: "motion.ease",
	dist: "motion.dist",
} as const;

export const DEFAULT_IN_DUR = 0.5;
export const DEFAULT_OUT_DUR = 0.4;
export const DEFAULT_DIST = 240;

export interface Motion {
	in: MotionKind;
	/** Seconds. */
	inDur: number;
	out: MotionKind;
	outDur: number;
	ease: MotionEase;
	/** Slide distance, canvas px. */
	dist: number;
}

/** What the motion adds to the layer's own transform at one moment. */
export interface MotionFrame {
	dx: number;
	dy: number;
	s: number;
	rot: number;
	op: number;
}

export const IDENTITY_MOTION: MotionFrame = { dx: 0, dy: 0, s: 1, rot: 0, op: 1 };

const KINDS = new Set<string>(MOTION_IN.map((k) => k.value));
const EASES = new Set<string>(MOTION_EASE.map((k) => k.value));

const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const kind = (v: unknown): MotionKind => (typeof v === "string" && KINDS.has(v) ? (v as MotionKind) : "none");

/** The layer's motion, or null when it has neither an In nor an Out. */
export function readMotion(params: Record<string, unknown> | undefined): Motion | null {
	if (!params) return null;
	const m: Motion = {
		in: kind(params[MOTION_KEYS.in]),
		inDur: num(params[MOTION_KEYS.inDur], DEFAULT_IN_DUR, 0.05, 10),
		out: kind(params[MOTION_KEYS.out]),
		outDur: num(params[MOTION_KEYS.outDur], DEFAULT_OUT_DUR, 0.05, 10),
		ease: typeof params[MOTION_KEYS.ease] === "string" && EASES.has(params[MOTION_KEYS.ease] as string) ? (params[MOTION_KEYS.ease] as MotionEase) : "easeOut",
		dist: num(params[MOTION_KEYS.dist], DEFAULT_DIST, 0, 10000),
	};
	return m.in === "none" && m.out === "none" ? null : m;
}

export const hasMotion = (params: Record<string, unknown> | undefined) => readMotion(params) !== null;

/** The params without the motion keys (after the motion was baked into keyframes). */
export function withoutMotion<T extends Record<string, unknown>>(params: T): T {
	const out = { ...params };
	for (const key of Object.values(MOTION_KEYS)) delete out[key];
	return out;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export function ease(name: MotionEase, t: number): number {
	const p = clamp01(t);
	switch (name) {
		case "linear":
			return p;
		case "easeIn":
			return p ** 3;
		case "easeInOut":
			return p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
		case "back": {
			const c1 = 1.70158;
			return 1 + (c1 + 1) * (p - 1) ** 3 + c1 * (p - 1) ** 2;
		}
		case "bounce": {
			const n1 = 7.5625;
			const d1 = 2.75;
			if (p < 1 / d1) return n1 * p * p;
			if (p < 2 / d1) return n1 * (p - 1.5 / d1) ** 2 + 0.75;
			if (p < 2.5 / d1) return n1 * (p - 2.25 / d1) ** 2 + 0.9375;
			return n1 * (p - 2.625 / d1) ** 2 + 0.984375;
		}
		default:
			return 1 - (1 - p) ** 3;
	}
}

/** Scale 0.6 → 1.1 → 1 (the classic pop). */
function popScale(p: number): number {
	if (p >= 1) return 1;
	if (p < 0.6) return 0.6 + 0.5 * (1 - (1 - p / 0.6) ** 2);
	const t = (p - 0.6) / 0.4;
	return 1.1 - 0.1 * (0.5 - Math.cos(Math.PI * t) / 2);
}

/**
 * The state a preset starts from (In) or ends at (Out), at `a` = how far away from rest it is (1 = fully away,
 * 0 = at rest). Out slides go the named way; In slides come from the named side.
 */
function away(k: MotionKind, a: number, dist: number, out: boolean): MotionFrame {
	const f = { ...IDENTITY_MOTION };
	switch (k) {
		case "fade":
			f.op = 1 - a;
			break;
		case "slideLeft":
			f.dx = -dist * a;
			f.op = 1 - a;
			break;
		case "slideRight":
			f.dx = dist * a;
			f.op = 1 - a;
			break;
		case "slideUp":
			// In: comes up from below; Out: flies up.
			f.dy = (out ? -dist : dist) * a;
			f.op = 1 - a;
			break;
		case "slideDown":
			// In: comes down from above; Out: drops down.
			f.dy = (out ? dist : -dist) * a;
			f.op = 1 - a;
			break;
		case "scale":
			f.s = out ? 1 + 0.6 * a : 1 - 0.7 * a;
			f.op = 1 - a;
			break;
		case "spin":
			f.rot = (out ? 180 : -180) * a;
			f.s = 1 - 0.6 * a;
			f.op = 1 - a;
			break;
	}
	return f;
}

const combine = (a: MotionFrame, b: MotionFrame): MotionFrame => ({ dx: a.dx + b.dx, dy: a.dy + b.dy, s: a.s * b.s, rot: a.rot + b.rot, op: a.op * b.op });

/** The motion at `t` seconds into a layer `dur` seconds long. In and Out share a short layer proportionally. */
export function motionAt(m: Motion, t: number, dur: number): MotionFrame {
	let inDur = m.in === "none" ? 0 : m.inDur;
	let outDur = m.out === "none" ? 0 : m.outDur;
	const total = inDur + outDur;
	if (dur > 0 && total > dur) {
		inDur *= dur / total;
		outDur *= dur / total;
	}
	let f = IDENTITY_MOTION;
	if (inDur > 0 && t < inDur) {
		const p = clamp01(t / inDur);
		if (m.in === "pop") f = combine(f, { ...IDENTITY_MOTION, s: popScale(p), op: clamp01(p * 3) });
		else f = combine(f, away(m.in, 1 - ease(m.ease, p), m.dist, false));
	}
	const outStart = dur - outDur;
	if (outDur > 0 && t > outStart) {
		const p = clamp01((t - outStart) / outDur);
		if (m.out === "pop") f = combine(f, { ...IDENTITY_MOTION, s: p < 0.3 ? 1 + 0.1 * (p / 0.3) : 1.1 * (1 - (p - 0.3) / 0.7), op: p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4 });
		// Mirrored: an Ease out In settles into place; the same Out leaves slowly, then speeds away.
		else f = combine(f, away(m.out, 1 - ease(m.ease, 1 - p), m.dist, true));
	}
	return f;
}

/** The motion on top of a transform: offsets add, scale and opacity multiply. */
export function applyMotion<T extends { x: number; y: number; sx: number; sy: number; rot: number; op: number }>(tf: T, f: MotionFrame): T {
	return { ...tf, x: tf.x + f.dx, y: tf.y + f.dy, sx: tf.sx * f.s, sy: tf.sy * f.s, rot: tf.rot + f.rot, op: Math.max(0, Math.min(1, tf.op * f.op)) };
}
