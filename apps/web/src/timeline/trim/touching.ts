// Which clip edges lie on a cut (the next clip starts where this one ends). With the Select tool the cut itself is the
// boundary between the two edges' zones (docs/TIMELINE.md, «the Select tool never rolls»): left of it the outgoing
// clip's tail, right of it the incoming clip's head. A free edge keeps its zone outside the clip.
import { TOUCH_TICKS } from "./core";

export type TouchedEdges = "l" | "r" | "lr";

/** Each clip that touches a neighbour: "l" its start is a cut, "r" its end, "lr" both. One pass over the sorted track. */
export function touchingEdges(elements: ReadonlyArray<{ id: string; startTime: number; duration: number }>): Map<string, TouchedEdges> {
	const sorted = [...elements].sort((a, b) => a.startTime - b.startTime);
	const out = new Map<string, TouchedEdges>();
	for (let i = 0; i + 1 < sorted.length; i++) {
		const a = sorted[i];
		const b = sorted[i + 1];
		if (Math.abs(b.startTime - (a.startTime + a.duration)) > TOUCH_TICKS) continue;
		out.set(a.id, out.get(a.id) === "l" ? "lr" : "r");
		out.set(b.id, "l");
	}
	return out;
}
