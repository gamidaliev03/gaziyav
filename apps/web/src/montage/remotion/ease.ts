// Premium motion curves (studio kit, docs/creative-trends.md §13.1). Shared by the in-editor Player and the export renderer.
import { Easing, interpolate } from "remotion";

export const E = {
	/** expo-out — entrances, reveals (default) */
	out: Easing.bezier(0.16, 1, 0.3, 1),
	outQuart: Easing.bezier(0.25, 1, 0.5, 1),
	/** quint in-out — camera moves, transitions */
	inOut: Easing.bezier(0.83, 0, 0.17, 1),
	/** expo-in — exits (always shorter than the entrance) */
	in: Easing.bezier(0.7, 0, 0.84, 0),
	/** overshoot ≈10 % — pills, icons, punches */
	back: Easing.bezier(0.34, 1.56, 0.64, 1),
	linear: (t: number) => t,
};

/** 0→1 progress of an animation that starts at `start` and lasts `dur` frames. Clamped. */
export const prog = (frame: number, start: number, dur: number, ease = E.out) =>
	interpolate(frame, [start, start + Math.max(1, dur)], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
		easing: ease,
	});

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** In/out envelope: rises over `inDur` from `start`, falls over `outDur` ending at `end`. */
export const env = (frame: number, start: number, end: number, inDur = 12, outDur = 8) =>
	Math.min(prog(frame, start, inDur), 1 - prog(frame, end - outDur, outDur, E.in));

/** "Hello *world*\nline two" → lines of words; *x* marks the accent. */
export const parseAccents = (text: string): { w: string; accent: boolean }[][] =>
	String(text ?? "")
		.split("\n")
		.map((line) =>
			line
				.split(/(\*[^*]+\*)/)
				.filter(Boolean)
				.flatMap((seg) => {
					const accent = seg.startsWith("*") && seg.endsWith("*");
					return seg
						.replace(/\*/g, "")
						.split(/\s+/)
						.filter(Boolean)
						.map((w) => ({ w, accent }));
				}),
		)
		.filter((l) => l.length > 0);
