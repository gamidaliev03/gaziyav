// A compound clip's speed (CapCut / Final Cut: a compound is retimed like any clip). Stored on the compound as
// params["compound.rate"] (0.1–10×, 1 = as made). Its trimStart / trimEnd / duration stay in the parent's time, as for
// any graphic, so splitting and trimming on the parent need nothing new: the compound's window into its own timeline is
// [trimStart × rate, (trimStart + duration) × rate]. Flattening (flatten.ts) cuts the inner clips to that window in the
// compound's own time and maps them to the parent's: start and length ÷ rate, every video / sound × rate (its speed
// ramp scaled), keyframes ÷ rate — so preview, the mix and the export all read the same retimed clips.
// Pure: no editor core, no wasm.
import type { ElementAnimations } from "@/animation/types";
import type { RetimeConfig, TimelineElement, TimelineTrack } from "@/timeline/types";
import { OUTER_MIX, type OuterMixLayer } from "./compound-sound";

export const COMPOUND_RATE = "compound.rate";
/** Voices inside keep their pitch at the compound's speed. */
export const COMPOUND_KEEP_PITCH = "compound.keepPitch";
export const MIN_COMPOUND_RATE = 0.1;
export const MAX_COMPOUND_RATE = 10;

/** The compound's speed (1 when it has none). */
export function compoundRate(compound: { params?: Record<string, unknown> }): number {
	const v = compound.params?.[COMPOUND_RATE];
	if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return 1;
	return Math.min(MAX_COMPOUND_RATE, Math.max(MIN_COMPOUND_RATE, v));
}

/** The part of its own timeline a compound plays (its own ticks). */
export function compoundWindow(compound: TimelineElement, rate = compoundRate(compound)): { start: number; end: number; offset: number } {
	return { start: compound.trimStart * rate, end: (compound.trimStart + compound.duration) * rate, offset: 0 };
}

function scaleAnimations(animations: ElementAnimations, rate: number): ElementAnimations {
	const scale = (c: unknown) => {
		const ch = c as { keys?: { time: number }[] } | undefined;
		return ch && Array.isArray(ch.keys) ? { ...ch, keys: ch.keys.map((k) => ({ ...k, time: Math.round(k.time / rate) })) } : c;
	};
	const out: ElementAnimations = {};
	for (const [path, data] of Object.entries(animations)) {
		if (!data) continue;
		if (Array.isArray((data as { keys?: unknown }).keys)) out[path] = scale(data) as ElementAnimations[string];
		else out[path] = Object.fromEntries(Object.entries(data).map(([k, c]) => [k, scale(c)])) as ElementAnimations[string];
	}
	return out;
}

/** A clip's speed × the compound's (a speed ramp keeps its shape, every point × rate). */
export function scaleRetime(retime: RetimeConfig | undefined, rate: number, keepPitch = false): RetimeConfig {
	const base = retime ?? { rate: 1 };
	return {
		...base,
		...(keepPitch ? { maintainPitch: true } : {}),
		rate: (base.rate || 1) * rate,
		...(base.curve ? { curve: { ...base.curve, points: base.curve.points.map((p) => ({ ...p, y: p.y * rate })) } } : {}),
	};
}

/** A clip of the compound's own timeline (cut to its window) at its place on the parent's, at the compound's speed. */
export function toParentTime<T extends TimelineElement>(el: T, compound: TimelineElement, rate: number): T {
	const at = (t: number) => Math.round(compound.startTime - compound.trimStart + t / rate);
	const out: Record<string, unknown> = {
		...el,
		startTime: at(el.startTime),
		duration: Math.max(1, Math.round(el.duration / rate)),
	};
	if (el.type === "video" || el.type === "audio") out.retime = scaleRetime((el as { retime?: RetimeConfig }).retime, rate, compound.params?.[COMPOUND_KEEP_PITCH] === true);
	if (el.animations) out.animations = scaleAnimations(el.animations, rate);
	const layers = (el.params as Record<string, unknown>)[OUTER_MIX];
	if (Array.isArray(layers)) {
		out.params = {
			...el.params,
			[OUTER_MIX]: (layers as OuterMixLayer[]).map((l) => ({
				...l,
				start: at(l.start),
				duration: l.duration / rate,
				...(l.volume ? { volume: { ...l.volume, animations: scaleAnimations(l.volume.animations, rate) } } : {}),
			})),
		};
	}
	return out as T;
}

/** A whole track of the compound's timeline mapped to the parent's (its transitions as long as the clips are short). */
export function trackToParentTime<K extends TimelineTrack>(track: K, compound: TimelineElement, rate: number): K {
	const transitions = (track as { transitions?: { duration: number }[] }).transitions;
	return {
		...track,
		elements: (track.elements as TimelineElement[]).map((e) => toParentTime(e, compound, rate)),
		...(transitions ? { transitions: transitions.map((t) => ({ ...t, duration: Math.round(t.duration / rate) })) } : {}),
	} as K;
}
