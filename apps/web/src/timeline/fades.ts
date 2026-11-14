// The fades a clip's handles set (components/fade-handles.tsx): its sound (params fadeIn / fadeOut — the mix envelope
// plays and exports them) and its picture (the In / Out animation «fade»).
import type { TimelineElement } from "@/timeline/types";

export type FadeSide = "in" | "out";
type Side = FadeSide;

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** Which fades a clip has: its sound (audio, video) and its picture (video, pictures). */
export function fadeKinds(element: TimelineElement): { sound: boolean; picture: boolean } {
	return { sound: element.type === "audio" || element.type === "video", picture: element.type === "video" || element.type === "image" };
}

/** The fade a clip shows now, seconds: the picture's «fade» animation, else its sound fade. */
export function fadeOf(element: TimelineElement, side: Side): number {
	const params = (element.params ?? {}) as Record<string, unknown>;
	const anim = params[side === "in" ? "anim.in" : "anim.out"];
	if (fadeKinds(element).picture && anim === "fade") return num(params[side === "in" ? "anim.inDuration" : "anim.outDuration"]);
	return num(params[side === "in" ? "fadeIn" : "fadeOut"]);
}

/**
 * The params for a fade of `seconds` on one side: the sound fade and the picture's «fade» animation together (another
 * In / Out animation the clip has keeps its kind and takes the length). 0 removes both.
 */
export function fadeParams(element: TimelineElement, side: Side, seconds: number): Record<string, unknown> {
	const params = (element.params ?? {}) as Record<string, unknown>;
	const { sound, picture } = fadeKinds(element);
	const out: Record<string, unknown> = {};
	if (sound) out[side === "in" ? "fadeIn" : "fadeOut"] = seconds;
	if (picture) {
		const kindKey = side === "in" ? "anim.in" : "anim.out";
		const lengthKey = side === "in" ? "anim.inDuration" : "anim.outDuration";
		const kind = params[kindKey];
		const own = typeof kind === "string" && kind !== "none" && kind !== "fade";
		if (seconds <= 0) {
			if (!own) out[kindKey] = "none";
		} else {
			if (!own) out[kindKey] = "fade";
			out[lengthKey] = seconds;
		}
	}
	return out;
}


/**
 * The longest a fade can be: what is left of the clip after the other side's fade (the two never cross), at most `max`.
 * Not half the clip each: a 5 s clip with a 0.5 s fade-out takes a 4.5 s fade-in (the handle stopped at 2.5 s while the
 * inspector went further, and its dot sat at the wrong place for a longer one).
 */
export function fadeLimit(duration: number, otherFade: number, max = 10): number {
	return Math.max(0, Math.min(max, duration - Math.max(0, Number.isFinite(otherFade) ? otherFade : 0)));
}
