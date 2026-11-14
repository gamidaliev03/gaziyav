/**
 * Text animation presets (in / out / loop), computed procedurally from the
 * element params `anim.in`, `anim.inDuration`, `anim.out`, `anim.outDuration`
 * and `anim.loop`. Nothing is baked into keyframes, so trimming or stretching
 * the clip keeps the exit animation glued to its end, and the preview and the
 * export run exactly the same function for every frame.
 *
 * The keyframable `anim.*` channels (offsetX/offsetY/scale/rotate/opacity/
 * reveal) are added on top, so hand-made keyframes still work.
 */
import { resolveAnimationPathValueAtTime } from "@/animation/resolve";
import type { ElementAnimations } from "@/animation/types";
import { TICKS_PER_SECOND } from "@/wasm";
import { GLYPH_IN, GLYPH_LOOP, GLYPH_OUT, type GlyphState } from "@/text/glyph-anim";

export { TEXT_ANIM_IN, TEXT_ANIM_LOOP, TEXT_ANIM_OUT, type TextAnimIn, type TextAnimLoop, type TextAnimOut } from "./anim-kinds";

export const DEFAULT_ANIM_IN_DURATION = 0.5;
export const DEFAULT_ANIM_OUT_DURATION = 0.4;

/** One frame of a text animation, applied on top of the element's own state. */
export interface TextAnimFrame {
	/** Canvas px. */
	offsetX: number;
	offsetY: number;
	scale: number;
	/** Degrees. */
	rotate: number;
	opacity: number;
	/** 0…1 share of visible characters (typewriter). */
	reveal: number;
	/** Blur radius as a share of the font size. */
	blur: number;
	/** Extra letter spacing as a share of the font size. */
	tracking: number;
}

export const IDENTITY_ANIM_FRAME: TextAnimFrame = {
	offsetX: 0,
	offsetY: 0,
	scale: 1,
	rotate: 0,
	opacity: 1,
	reveal: 1,
	blur: 0,
	tracking: 0,
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInCubic = (t: number) => t ** 3;
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
/** cubic-bezier(0.34, 1.56, 0.64, 1)-like overshoot of ≈10 % (creative-trends §2.0 «backOut»). */
const backOut = (t: number) => {
	const c1 = 1.70158;
	return 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
/** Damped spring that overshoots once and settles at 1. */
const spring = (t: number) =>
	t >= 1 ? 1 : 1 - Math.cos(t * Math.PI * 2.4) * Math.exp(-t * 6.5);
const easeOutBounce = (t: number) => {
	const n1 = 7.5625;
	const d1 = 2.75;
	if (t < 1 / d1) return n1 * t * t;
	if (t < 2 / d1) return n1 * (t - 1.5 / d1) ** 2 + 0.75;
	if (t < 2.5 / d1) return n1 * (t - 2.25 / d1) ** 2 + 0.9375;
	return n1 * (t - 2.625 / d1) ** 2 + 0.984375;
};
/**
 * «Pop» from creative-trends §4.4: scale 0.70 → 1.10 over the first half
 * (easeOutQuad), then 1.10 → 1.00 (easeInOutSine).
 */
export function popCurve(p: number): number {
	if (p >= 1) return 1;
	if (p < 0.5) {
		const t = p / 0.5;
		return 0.7 + 0.4 * (1 - (1 - t) ** 2);
	}
	const t = (p - 0.5) / 0.5;
	return 1.1 - 0.1 * (0.5 - Math.cos(Math.PI * t) / 2);
}

/** Deterministic pseudo-random in [0, 1) — the same frame always looks the same. */
const hash = (value: number) => {
	const x = Math.sin(value * 127.1 + 311.7) * 43758.5453;
	return x - Math.floor(x);
};

function readString(params: Record<string, unknown>, key: string, fallback: string) {
	const value = params[key];
	return typeof value === "string" ? value : fallback;
}

function readNumber(params: Record<string, unknown>, key: string, fallback: number) {
	const value = params[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function applyIn({
	frame,
	kind,
	p,
	t,
	canvasWidth,
	canvasHeight,
}: {
	frame: TextAnimFrame;
	kind: string;
	/** 0…1 progress through the entrance. */
	p: number;
	/** Seconds since the clip start. */
	t: number;
	canvasWidth: number;
	canvasHeight: number;
}): void {
	if (p >= 1) return;
	const e = easeOutCubic(p);
	switch (kind) {
		case "fade":
			frame.opacity *= p;
			break;
		case "pop":
			frame.scale *= popCurve(p);
			frame.opacity *= clamp01(p * 3);
			break;
		case "slam": {
			// Stamp: falls onto the screen from 2.6× (easeInCubic, first 45 %), lands with a 6 % squash and a jolt.
			const land = 0.45;
			if (p < land) {
				frame.scale *= 2.6 - 1.6 * easeInCubic(p / land);
				frame.opacity *= clamp01(p / 0.15);
			} else {
				const q = (p - land) / (1 - land);
				frame.scale *= 1 - 0.06 * Math.sin(Math.PI * Math.min(1, q / 0.35));
				const jolt = Math.exp(-q * 5) * Math.sin(q * 38);
				frame.offsetY += jolt * canvasHeight * 0.012;
				frame.rotate += jolt * 1.5;
			}
			break;
		}
		case "punch": {
			// Camera hit: from 1.8× and blurred straight to sharp (easeOutExpo).
			const x = easeOutExpo(p);
			frame.scale *= 1 + 0.8 * (1 - x);
			frame.blur += (1 - x) * 0.3;
			frame.opacity *= clamp01(p * 3);
			break;
		}
		case "smoothRise": {
			// The «smooth» entrance: up from 8 % of the height, sharpening out of a blur (easeOutExpo).
			const x = easeOutExpo(p);
			frame.offsetY += (1 - x) * canvasHeight * 0.08;
			frame.blur += (1 - x) * 0.25;
			frame.opacity *= clamp01(p * 2.5);
			break;
		}
		case "spin":
			// −120° → 0 while growing 0.2 → 1 with a ≈10 % overshoot.
			frame.rotate -= (1 - e) * 120;
			frame.scale *= 0.2 + 0.8 * backOut(p);
			frame.opacity *= clamp01(p * 4);
			break;
		case "swing":
			// Swings in from −25° and settles like a pendulum.
			frame.rotate -= 25 * (1 - spring(p));
			frame.opacity *= clamp01(p * 4);
			break;
		case "neon": {
			// A neon sign switching on: off/on in 1/24 s steps, more often on as it warms up, then steady.
			const on = p >= 0.7 || (p > 0.08 && hash(Math.floor(t * 24) + 101) < 0.2 + p);
			frame.opacity *= on ? 1 : 0.08;
			break;
		}
		case "rise":
			frame.offsetY += (1 - e) * canvasHeight * 0.05;
			frame.opacity *= e;
			break;
		case "drop":
			frame.offsetY -= (1 - easeOutBounce(p)) * canvasHeight * 0.09;
			frame.opacity *= clamp01(p * 5);
			break;
		case "slideLeft":
			frame.offsetX += (1 - e) * canvasWidth * 0.35;
			frame.opacity *= clamp01(p * 3);
			break;
		case "slideRight":
			frame.offsetX -= (1 - e) * canvasWidth * 0.35;
			frame.opacity *= clamp01(p * 3);
			break;
		case "bounce":
			// Spring k=420, c=18: 0.5 → 1.18 → 0.96 → 1.0 (creative-trends §4.4).
			frame.scale *= 0.5 + 0.5 * spring(p);
			frame.opacity *= clamp01(p * 4);
			break;
		case "typewriter":
			frame.reveal *= p;
			break;
		case "blurIn":
			frame.blur += (1 - e) * 0.35;
			frame.opacity *= e;
			break;
		case "scaleDown":
			frame.scale *= 1 + (1 - e) * 1.4;
			frame.opacity *= clamp01(p * 3);
			break;
		case "tracking":
			frame.tracking += (1 - e) * 0.6;
			frame.opacity *= e;
			break;
		case "glitch": {
			const step = Math.floor(t * 24);
			const strength = 1 - p;
			frame.offsetX += (hash(step) - 0.5) * canvasWidth * 0.06 * strength;
			frame.offsetY += (hash(step + 7) - 0.5) * canvasHeight * 0.01 * strength;
			frame.opacity *= hash(step + 3) < 0.25 * strength ? 0.15 : 1;
			break;
		}
	}
}

function applyOut({
	frame,
	kind,
	q,
	canvasWidth,
	canvasHeight,
}: {
	frame: TextAnimFrame;
	kind: string;
	/** 0…1 progress through the exit (1 = gone). */
	q: number;
	canvasWidth: number;
	canvasHeight: number;
}): void {
	if (q <= 0) return;
	const e = easeInCubic(q);
	switch (kind) {
		case "fade":
			frame.opacity *= 1 - q;
			break;
		case "pop":
			frame.scale *= 1 - 0.6 * e;
			frame.opacity *= 1 - e;
			break;
		case "smoothRise":
			frame.offsetY -= e * canvasHeight * 0.06;
			frame.blur += e * 0.25;
			frame.opacity *= 1 - e;
			break;
		case "spin":
			frame.rotate += e * 120;
			frame.scale *= 1 - 0.8 * e;
			frame.opacity *= 1 - e;
			break;
		case "neon": {
			// switching off: flickers, then dark
			const on = q < 0.3 || (q < 0.85 && hash(Math.floor(q * 14) + 57) < 1 - q);
			frame.opacity *= on ? 1 : 0.08;
			break;
		}
		case "rise":
			frame.offsetY -= e * canvasHeight * 0.06;
			frame.opacity *= 1 - q;
			break;
		case "drop":
			frame.offsetY += e * canvasHeight * 0.08;
			frame.opacity *= 1 - q;
			break;
		case "slideLeft":
			frame.offsetX -= e * canvasWidth * 0.35;
			frame.opacity *= 1 - e;
			break;
		case "blurOut":
			frame.blur += e * 0.35;
			frame.opacity *= 1 - q;
			break;
		case "scaleUp":
			frame.scale *= 1 + e * 0.6;
			frame.opacity *= 1 - q;
			break;
	}
}

function applyLoop({
	frame,
	kind,
	t,
	canvasWidth,
	canvasHeight,
}: {
	frame: TextAnimFrame;
	kind: string;
	t: number;
	canvasWidth: number;
	canvasHeight: number;
}): void {
	switch (kind) {
		case "pulse":
			frame.scale *= 1 + 0.05 * Math.sin((t * Math.PI * 2) / 0.9);
			break;
		case "float":
			frame.offsetY += canvasHeight * 0.008 * Math.sin((t * Math.PI * 2) / 2.4);
			break;
		case "wave":
			frame.rotate += 3 * Math.sin((t * Math.PI * 2) / 1.6);
			break;
		case "flicker": {
			const step = Math.floor(t * 12);
			const r = hash(step);
			frame.opacity *= r < 0.08 ? 0.25 : r < 0.14 ? 0.7 : 1;
			break;
		}
		case "shake": {
			const step = Math.floor(t * 30);
			frame.offsetX += (hash(step) - 0.5) * canvasWidth * 0.01;
			frame.offsetY += (hash(step + 11) - 0.5) * canvasHeight * 0.006;
			break;
		}
	}
}

/**
 * Resolves the animation of a text element at `localTime` (ticks from the clip
 * start). Returns the identity frame when nothing is applied.
 */
export function resolveTextAnimFrame({
	params,
	animations,
	duration,
	localTime,
	canvasWidth,
	canvasHeight,
}: {
	params: Record<string, unknown>;
	animations?: ElementAnimations;
	/** Clip duration in ticks. */
	duration: number;
	/** Ticks from the clip start. */
	localTime: number;
	canvasWidth: number;
	canvasHeight: number;
}): TextAnimFrame {
	const animIn = readString(params, "anim.in", "none");
	const animOut = readString(params, "anim.out", "none");
	const animLoop = readString(params, "anim.loop", "none");
	const hasChannels = animations != null && Object.keys(animations).length > 0;
	if (animIn === "none" && animOut === "none" && animLoop === "none" && !hasChannels) {
		return IDENTITY_ANIM_FRAME;
	}

	const frame: TextAnimFrame = { ...IDENTITY_ANIM_FRAME };
	const t = Math.max(0, localTime) / TICKS_PER_SECOND;
	const total = Math.max(0, duration) / TICKS_PER_SECOND;
	const inDuration = Math.max(
		0.05,
		readNumber(params, "anim.inDuration", DEFAULT_ANIM_IN_DURATION),
	);
	const outDuration = Math.max(
		0.05,
		readNumber(params, "anim.outDuration", DEFAULT_ANIM_OUT_DURATION),
	);
	// Short clips: entrance and exit share the clip instead of overlapping.
	const fitIn = Math.min(inDuration, total * (animOut === "none" ? 1 : 0.6));
	const fitOut = Math.min(outDuration, total * (animIn === "none" ? 1 : 0.4));

	if (animLoop !== "none") {
		applyLoop({ frame, kind: animLoop, t, canvasWidth, canvasHeight });
	}
	if (animIn !== "none" && fitIn > 0) {
		applyIn({
			frame,
			kind: animIn,
			// a motion title's text starts after its plate (anim.inDelay, s)
			p: clamp01((t - Math.max(0, readNumber(params, "anim.inDelay", 0))) / fitIn),
			t,
			canvasWidth,
			canvasHeight,
		});
	}
	if (animOut !== "none" && fitOut > 0) {
		// The last frame of a clip is one frame before its end, so the exit
		// reaches "gone" exactly at the clip end.
		applyOut({
			frame,
			kind: animOut,
			q: clamp01(1 - (total - t) / fitOut),
			canvasWidth,
			canvasHeight,
		});
	}

	if (hasChannels) {
		const channel = (key: string, fallback: number) =>
			resolveAnimationPathValueAtTime({
				animations,
				propertyPath: key,
				localTime: Math.max(0, localTime),
				fallbackValue: readNumber(params, key, fallback),
			});
		frame.offsetX += channel("anim.offsetX", 0);
		frame.offsetY += channel("anim.offsetY", 0);
		frame.scale *= channel("anim.scale", 1);
		frame.rotate += channel("anim.rotate", 0);
		frame.opacity *= clamp01(channel("anim.opacity", 1));
		frame.reveal *= clamp01(channel("anim.reveal", 1));
	} else {
		frame.offsetX += readNumber(params, "anim.offsetX", 0);
		frame.offsetY += readNumber(params, "anim.offsetY", 0);
		frame.scale *= readNumber(params, "anim.scale", 1);
		frame.rotate += readNumber(params, "anim.rotate", 0);
		frame.opacity *= clamp01(readNumber(params, "anim.opacity", 1));
		frame.reveal *= clamp01(readNumber(params, "anim.reveal", 1));
	}
	frame.opacity = clamp01(frame.opacity);
	return frame;
}

/** Active-word pop for captions: the §4.4 curve over 6 frames (0.2 s). */
/**
 * Where a per-letter / per-word animation is on this frame (text/glyph-anim.ts), or null when the clip has none.
 * Same windows as resolveTextAnimFrame: the In after `anim.inDelay`, the Out glued to the clip end.
 */
export function resolveGlyphState({
	params,
	duration,
	localTime,
}: {
	params: Record<string, unknown>;
	/** Ticks. */
	duration: number;
	/** Ticks from the clip start. */
	localTime: number;
}): GlyphState | null {
	const inKind = readString(params, "anim.in", "none");
	const outKind = readString(params, "anim.out", "none");
	const loopKind = readString(params, "anim.loop", "none");
	if (!GLYPH_IN.has(inKind) && !GLYPH_OUT.has(outKind) && !GLYPH_LOOP.has(loopKind)) return null;
	const t = Math.max(0, localTime) / TICKS_PER_SECOND;
	const total = Math.max(0, duration) / TICKS_PER_SECOND;
	const inDuration = Math.max(0.05, readNumber(params, "anim.inDuration", DEFAULT_ANIM_IN_DURATION));
	const outDuration = Math.max(0.05, readNumber(params, "anim.outDuration", DEFAULT_ANIM_OUT_DURATION));
	const fitIn = Math.min(inDuration, total * (outKind === "none" ? 1 : 0.6));
	const fitOut = Math.min(outDuration, total * (inKind === "none" ? 1 : 0.4));
	const delay = Math.max(0, readNumber(params, "anim.inDelay", 0));
	return {
		inKind,
		inP: GLYPH_IN.has(inKind) && fitIn > 0 ? clamp01((t - delay) / fitIn) : 1,
		outKind,
		outQ: GLYPH_OUT.has(outKind) && fitOut > 0 ? clamp01(1 - (total - t) / fitOut) : 0,
		loopKind,
		t,
	};
}

export function wordPopScale({ age }: { age: number }): number {
	return popCurve(clamp01(age / 0.2));
}
