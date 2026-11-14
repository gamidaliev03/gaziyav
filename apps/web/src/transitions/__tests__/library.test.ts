import { expect, test } from "bun:test";
import { ALL_TRANSITIONS, LIBRARY_TRANSITIONS, TRANSITION_CATEGORY_ORDER } from "@/transitions/definitions";

test("the transitions library: 140+ shown, no two with one name, every one in a known group; the hidden twins stay registered", () => {
	expect(LIBRARY_TRANSITIONS.length).toBeGreaterThanOrEqual(140);
	const names = LIBRARY_TRANSITIONS.map((d) => d.name.toLowerCase());
	expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
	for (const d of LIBRARY_TRANSITIONS) expect([d.type, TRANSITION_CATEGORY_ORDER.includes(d.category)]).toEqual([d.type, true]);
	// 1.0.82: twelve GL transitions that were another one to the eye are hidden, not gone
	const hidden = ["pixelize", "DefocusBlur", "fadecolor", "SimpleZoom", "SimpleZoomOut", "circleopen", "rotateTransition", "randomNoisex", "perlin", "BowTieVertical", "ripple", "powerKaleido"].map((id) => `gl.transition.${id}`);
	for (const type of hidden) {
		expect([type, ALL_TRANSITIONS.find((d) => d.type === type)?.hidden]).toEqual([type, true]);
		expect(LIBRARY_TRANSITIONS.some((d) => d.type === type)).toBe(false);
	}
});
