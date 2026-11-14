// The trim model (pro, 11.11): the four trims film editors cut with, one set of rules for the mouse, the keys and typed
// numbers. See core.ts for what each one changes and README-rules at the top of core.ts for the limits.
import type { SceneTracks, TimelineElement } from "@/timeline/types";

/**
 * - roll: the cut between two touching clips moves — one gets longer, the other shorter, nothing else moves;
 * - ripple: one edge moves and everything after it on that track moves along;
 * - slip: the clip stays where it is and as long as it is, its content moves inside it;
 * - slide: the clip moves between its neighbours, which give and take the frames.
 */
export type TrimKind = "roll" | "ripple" | "slip" | "slide";
export type TrimSide = "left" | "right";

export type TrimTarget =
	| { kind: "roll"; trackId: string; leftId: string; rightId: string }
	| { kind: "ripple"; trackId: string; elementId: string; side: TrimSide }
	| { kind: "slip"; trackId: string; elementId: string }
	| { kind: "slide"; trackId: string; elementId: string };

/**
 * Why a trim stopped short of what was asked:
 * - media: the clip's file has nothing more to show there;
 * - length: a clip would get shorter than one frame;
 * - neighbour: the next clip on the track is in the way;
 * - start: the timeline's start (the main track always starts at 0);
 * - linked: a sound that is still in step with its picture stays with it.
 */
export type TrimLimit = "media" | "length" | "neighbour" | "start" | "linked";

export interface TrimResult {
	/** The tracks as the trim leaves them (what Linkage adds — titles and detached sounds following — comes after). */
	tracks: SceneTracks;
	/** Every clip the trim changed, as it is now and as it was (the live preview shows exactly these: no pass over the timeline). */
	changed: ReadonlyArray<{ trackId: string; element: TimelineElement; was: TimelineElement }>;
	/** What was applied, in ticks; + is later on the timeline (for slip: the content moves later). */
	delta: number;
	/** Set when less than what was asked was applied. */
	limit: TrimLimit | null;
}

export interface TrimPlan {
	target: TrimTarget;
	/** Ticks per frame of the project. */
	frame: number;
	/** The timeline times of the edges that move by the delta: what snaps (none for slip). */
	anchors: number[];
	/** The smallest and largest delta the trim allows, on whole frames, and what stops it there. */
	min: number;
	max: number;
	minLimit: TrimLimit;
	maxLimit: TrimLimit;
	/** Every clip the trim itself can change (their edges are no snap targets). */
	ids: ReadonlySet<string>;
	/** `exact`: the delta came from a snap point on a frame — applied as it is. */
	apply(delta: number, options?: { exact?: boolean }): TrimResult;
}
