// Which trim the pointer would make where it is: the pointer zone decides, there is no mode to get lost in.
//
// With the Select tool (A) the timeline is what it was, plus:
//   · it never rolls (the lead, 14.11: roll belongs to T): on a cut the cut itself is the boundary — left of it the
//     outgoing clip's tail, right of it the incoming clip's head (globals.css [data-touch]); a free edge keeps its
//     zone outside the clip;
//   · ⌥ on a clip's edge ripples it on any track (the plain drag there is the trim it always was);
//   · ⌥⌘ inside a clip slips it, ⇧⌥⌘ slides it.
// With the Trim tool (T) the zones are explicit and wider: a cut rolls, an edge ripples, a clip's body slips (⌥: slides).
import { TICKS_PER_SECOND } from "@/wasm";
import { TOUCH_TICKS } from "./core";
import type { TrimKind, TrimSide, TrimTarget } from "./types";

export type TrimTool = "select" | "trim";

export interface ZoneClip {
	id: string;
	start: number;
	end: number;
}

export type Zone =
	/** `near`: the side of the cut the pointer is on. */
	| { at: "cut"; left: ZoneClip; right: ZoneClip; near: TrimSide }
	| { at: "edge"; clip: ZoneClip; side: TrimSide }
	| { at: "body"; clip: ZoneClip };

/** The Trim tool's free edge reaches this far outside the clip. */
const HANDLE_OUT_PX = 2.5;
const HANDLE_SHARE = 0.4;
/**
 * The Select tool's handle, as globals.css .tl-trim draws it at a clip `w` px wide: `out` outside a free edge (2.5 px,
 * growing to 6 px as the clip narrows from 18 to 32 px), `in` inside (9.5 px, a third of the clip, none under 9 px).
 * On a cut the edge is all inside: in + out, at most 40 % of the clip.
 */
export function selectHandlePx(w: number): { in: number; out: number; atCut: number } {
	const out = Math.min(6, Math.max(2.5, 6 - (w - 18) / 4));
	const inside = w < 9 ? 0 : Math.min(9.5, w / 3);
	return { in: inside, out, atCut: Math.min(inside + out, w * 0.4) };
}
/** The Trim tool's edge strip reaches a little further into the clip. */
const TOOL_IN_PX = 14;
/** Half the Trim tool's roll strip on a cut (narrower between narrow clips). */
const ROLL_HALF_PX = { wide: 4.5, narrow: 2.5 } as const;
/** Clips narrower than this get the narrow roll strip. */
const NARROW_PX = 24;

/** The zone under a time on a track (clips sorted by start), at `pps` pixels per second. Null over a gap. */
export function zoneAt({ clips, time, pps, tool }: { clips: readonly ZoneClip[]; time: number; pps: number; tool: TrimTool }): Zone | null {
	if (!(pps > 0)) return null;
	const px = (ticks: number) => (ticks / TICKS_PER_SECOND) * pps;
	const x = px(time);
	const reach = TOOL_IN_PX + 6;
	const inside = (clip: ZoneClip) => Math.min(TOOL_IN_PX, (px(clip.end) - px(clip.start)) * HANDLE_SHARE);
	let body: ZoneClip | null = null;
	let best: { zone: Zone; distance: number } | null = null;
	const offer = (zone: Zone, distance: number) => {
		if (!best || distance < best.distance) best = { zone, distance };
	};
	// The first clip that ends within reach of the pointer (the clips of a track lie in order, one at a time): a long
	// film's track is not walked from its start on every mouse move.
	const from = time - (reach / pps) * TICKS_PER_SECOND;
	let low = 0;
	let high = clips.length;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (clips[mid].end < from) low = mid + 1;
		else high = mid;
	}
	for (let i = low; i < clips.length; i++) {
		const clip = clips[i];
		const xs = px(clip.start);
		const xe = px(clip.end);
		if (xe < x - reach) continue;
		if (xs > x + reach) break;
		const next = clips[i + 1];
		const touches = !!next && Math.abs(next.start - clip.end) <= TOUCH_TICKS;
		const previous = clips[i - 1];
		const touched = !!previous && Math.abs(clip.start - previous.end) <= TOUCH_TICKS;
		if (tool === "select") {
			// no roll strip: on a cut the tail's zone ends just before the cut and the head's starts on it
			const h = selectHandlePx(xe - xs);
			if (touches ? x >= xe - h.atCut && x < xe : x >= xe - h.in && x <= xe + h.out) offer({ at: "edge", clip, side: "right" }, Math.abs(x - xe));
			if (touched ? x >= xs && x <= xs + h.atCut : x <= xs + h.in && x >= xs - h.out) offer({ at: "edge", clip, side: "left" }, Math.abs(x - xs));
			if (x >= xs && x <= xe) body = clip;
			continue;
		}
		if (touches) {
			const narrow = Math.min(xe - xs, px(next.end) - px(next.start)) < NARROW_PX;
			const half = narrow ? ROLL_HALF_PX.narrow : ROLL_HALF_PX.wide;
			if (Math.abs(x - xe) < half) return { at: "cut", left: clip, right: next, near: x < xe ? "left" : "right" };
		}
		// the tail's strip, then the head's
		if (x >= xe - inside(clip) && x <= xe + (touches ? 0 : HANDLE_OUT_PX)) offer({ at: "edge", clip, side: "right" }, Math.abs(x - xe));
		if (x <= xs + inside(clip) && x >= xs - (touched ? 0 : HANDLE_OUT_PX)) offer({ at: "edge", clip, side: "left" }, Math.abs(x - xs));
		if (x >= xs && x <= xe) body = clip;
	}
	if (best) return (best as { zone: Zone }).zone;
	return body ? { at: "body", clip: body } : null;
}

export interface PressKeys {
	alt: boolean;
	meta: boolean;
	shift: boolean;
}

/** The trim a press in a zone starts, or null when the press is not the trim model's (the timeline handles it as always). */
export function trimForPress({ zone, tool, keys, trackId }: { zone: Zone | null; tool: TrimTool; keys: PressKeys; trackId: string }): TrimTarget | null {
	if (!zone) return null;
	if (tool === "trim") {
		if (zone.at === "cut") return { kind: "roll", trackId, leftId: zone.left.id, rightId: zone.right.id };
		if (zone.at === "edge") return { kind: "ripple", trackId, elementId: zone.clip.id, side: zone.side };
		return { kind: keys.alt ? "slide" : "slip", trackId, elementId: zone.clip.id };
	}
	if (zone.at === "cut") {
		if (!keys.alt) return { kind: "roll", trackId, leftId: zone.left.id, rightId: zone.right.id };
		// ⌥ on the cut: the edge on the pointer's side, rippled
		return keys.meta ? null : zone.near === "left" ? { kind: "ripple", trackId, elementId: zone.left.id, side: "right" } : { kind: "ripple", trackId, elementId: zone.right.id, side: "left" };
	}
	if (zone.at === "edge") return keys.alt && !keys.meta ? { kind: "ripple", trackId, elementId: zone.clip.id, side: zone.side } : null;
	if (keys.alt && keys.meta) return { kind: keys.shift ? "slide" : "slip", trackId, elementId: zone.clip.id };
	return null;
}

/** The pointer shape of a trim: its kind, and for a ripple which edge. */
export type TrimCursor = "roll" | "ripple-left" | "ripple-right" | "slip" | "slide";
export const cursorFor = (target: TrimTarget): TrimCursor => (target.kind === "ripple" ? `ripple-${target.side}` : target.kind);
export const kindOf = (target: TrimTarget): TrimKind => target.kind;
