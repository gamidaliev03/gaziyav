// Text animators of motion-design templates (After Effects' «Animate → Position / Scale / Opacity» with a range
// selector): every letter, word or line gets its own offset, turn, scale and opacity from one progress value,
// staggered left to right. Mask kinds clip each line to its own box, so lines and words rise from behind an edge
// nobody sees. Pure numbers: the player and the export draw the same frame.

/** Entrances drawn per letter, word or line (the whole block stays where it is). */
export const GLYPH_IN = new Set(["letters", "lettersPop", "scatter", "flip", "wordsUp", "maskRise", "wipe"]);
/** Exits drawn per letter or line. */
export const GLYPH_OUT = new Set(["lettersOut", "scatterOut", "maskSink", "wipeOut"]);
/** Loops drawn per letter (wave) or over the block (shimmer, glow pulse). */
export const GLYPH_LOOP = new Set(["lettersWave", "shimmer", "glowPulse"]);

export type GlyphUnit = "char" | "word" | "line";

export interface GlyphState {
	inKind: string;
	/** 0…1 through the entrance (1 = settled). */
	inP: number;
	outKind: string;
	/** 0…1 through the exit (1 = gone). */
	outQ: number;
	loopKind: string;
	/** Seconds since the clip start. */
	t: number;
}

/** What one animated piece of text does on this frame (added to its place in the line). */
export interface GlyphMotion {
	/** Em (of the font size). */
	dx: number;
	dy: number;
	/** Degrees. */
	rotate: number;
	scale: number;
	scaleY: number;
	alpha: number;
	/** Clip the piece to its line's box (mask kinds). */
	masked: boolean;
}

export const unitOf = (kind: string): GlyphUnit =>
	kind === "wordsUp" ? "word" : kind === "maskRise" || kind === "maskSink" ? "line" : "char";

/** Pieces are needed (the in or out window is open, or a per-letter loop runs). */
export function glyphsActive(state: GlyphState | null | undefined): boolean {
	if (!state) return false;
	return (GLYPH_IN.has(state.inKind) && state.inP < 1) || (GLYPH_OUT.has(state.outKind) && state.outQ > 0) || state.loopKind === "lettersWave";
}

/** The unit the pieces are cut in on this frame. */
export function glyphUnit(state: GlyphState): GlyphUnit {
	if (GLYPH_IN.has(state.inKind) && state.inP < 1) return unitOf(state.inKind);
	if (GLYPH_OUT.has(state.outKind) && state.outQ > 0) return unitOf(state.outKind);
	return "char";
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInCubic = (t: number) => t ** 3;
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
const backOut = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
/** Damped spring: overshoots once, settles at 1. */
const spring = (t: number) => (t >= 1 ? 1 : 1 - Math.cos(t * Math.PI * 2.2) * Math.exp(-t * 6));
/** Stable pseudo-random −1…1 per piece (the scatter of a letter never jumps between frames). */
const rand = (i: number, salt: number) => {
	const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
	return (x - Math.floor(x)) * 2 - 1;
};

/** Progress of piece `i` of `n` when the whole goes 0…1: the next one starts after `overlap` of the previous. */
export function staggered(p: number, i: number, n: number, overlap: number): number {
	if (n <= 1) return clamp01(p);
	const step = overlap / (1 + (n - 1) * overlap);
	const span = 1 / (1 + (n - 1) * overlap);
	const v = (p - i * step) / span;
	// the last piece lands exactly when the whole does (no 0.9999… left over)
	return v >= 1 - 1e-9 ? 1 : clamp01(v);
}

const OVERLAP: Record<GlyphUnit, number> = { char: 0.28, word: 0.45, line: 0.55 };
const SOFT = 0.22;

/**
 * Motion of piece `i` of `n`; `x` is its centre across the block (0 left … 1 right, for wipes); `lineEm` is the line
 * height in em (mask kinds travel one line).
 */
export function glyphMotion({ state, i, n, x, lineEm, unit }: { state: GlyphState; i: number; n: number; x: number; lineEm: number; unit: GlyphUnit }): GlyphMotion {
	const m: GlyphMotion = { dx: 0, dy: 0, rotate: 0, scale: 1, scaleY: 1, alpha: 1, masked: false };
	const overlap = OVERLAP[unit];
	if (GLYPH_IN.has(state.inKind) && state.inP < 1) {
		const p = staggered(state.inP, i, n, overlap);
		switch (state.inKind) {
			case "letters": {
				const e = easeOutCubic(p);
				m.dy += (1 - e) * 0.55;
				m.scale *= 0.9 + 0.1 * e;
				m.alpha *= clamp01(p * 1.7);
				break;
			}
			case "lettersPop":
				m.scale *= Math.max(0, spring(p));
				m.alpha *= clamp01(p * 4);
				break;
			case "scatter": {
				const e = easeOutExpo(p);
				m.dx += rand(i, 1) * 1.7 * (1 - e);
				m.dy += (rand(i, 2) * 1.3 - 0.4) * (1 - e);
				m.rotate += rand(i, 3) * 140 * (1 - e);
				m.scale *= 0.3 + 0.7 * e;
				m.alpha *= clamp01(p * 2.2);
				break;
			}
			case "flip":
				m.scaleY *= Math.max(0, backOut(p));
				m.dy -= (1 - easeOutCubic(p)) * 0.12;
				m.alpha *= clamp01(p * 3);
				break;
			case "wordsUp":
			case "maskRise":
				m.dy += (1 - easeOutExpo(p)) * lineEm * 1.08;
				m.masked = true;
				break;
			case "wipe": {
				const a = clamp01((state.inP * (1 + SOFT) - x) / SOFT);
				m.alpha *= a;
				m.dx -= (1 - a) * 0.18;
				break;
			}
		}
	}
	if (GLYPH_OUT.has(state.outKind) && state.outQ > 0) {
		const q = staggered(state.outQ, i, n, overlap);
		switch (state.outKind) {
			case "lettersOut": {
				const e = easeInCubic(q);
				m.dy -= e * 0.5;
				m.alpha *= 1 - clamp01(q * 1.4);
				break;
			}
			case "scatterOut": {
				const e = easeInCubic(q);
				m.dx += rand(i, 4) * 1.6 * e;
				m.dy += (rand(i, 5) * 1.2 - 0.5) * e;
				m.rotate += rand(i, 6) * 140 * e;
				m.scale *= 1 - 0.6 * e;
				m.alpha *= 1 - q;
				break;
			}
			case "maskSink":
				m.dy += easeInCubic(q) * lineEm * 1.08;
				m.masked = true;
				break;
			case "wipeOut":
				m.alpha *= 1 - clamp01((state.outQ * (1 + SOFT) - x) / SOFT);
				break;
		}
	}
	if (state.loopKind === "lettersWave") m.dy += Math.sin(Math.PI * 2 * 0.9 * state.t - i * 0.55) * 0.07;
	return m;
}

/** Glow pulse: how much stronger the glow is on this frame (1 = as set). */
export function glowPulse(state: GlyphState | null | undefined): number {
	if (!state || state.loopKind !== "glowPulse") return 1;
	return 1 + 0.75 * (0.5 + 0.5 * Math.sin(Math.PI * 2 * 1.1 * state.t));
}

/** Shimmer: the light band's centre across the block (−0.3 … 1.3, then a rest), or null between sweeps. */
export function shimmerAt(state: GlyphState | null | undefined): number | null {
	if (!state || state.loopKind !== "shimmer") return null;
	const cycle = (state.t % 2.2) / 2.2;
	return cycle > 0.62 ? null : -0.3 + (cycle / 0.62) * 1.6;
}
