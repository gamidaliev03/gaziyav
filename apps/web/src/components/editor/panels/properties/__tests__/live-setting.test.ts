import { describe, expect, test } from "bun:test";
import { createLiveSetting } from "@/components/editor/panels/properties/hooks/live-setting";

// Canvas colour: the picker showed colours live (no history), then saved the last one with history, and that
// step remembered the last live colour as "before": ⌘Z kept the new colour. Typing a hex made two steps.
function setup(initial: string) {
	let value = initial;
	const history: Array<{ before: string; after: string }> = [];
	const live = createLiveSetting<string>({
		read: () => value,
		write: ({ value: next, pushHistory }) => {
			if (pushHistory) history.push({ before: value, after: next });
			value = next;
		},
		isSame: ({ a, b }) => a.toLowerCase() === b.toLowerCase(),
	});
	return { live, history, value: () => value };
}

describe("a setting changed live, then saved", () => {
	test("the saved step goes back to the value before the drag", () => {
		const s = setup("#000000");
		s.live.preview("#110000");
		s.live.preview("#880000");
		s.live.commit("#ff0000");
		expect(s.value()).toBe("#ff0000");
		expect(s.history).toEqual([{ before: "#000000", after: "#ff0000" }]);
	});

	test("typing a colour and leaving the field is one step, not two", () => {
		const s = setup("#000000");
		// Enter: change + end; then the blur: change + end again with the same colour
		s.live.preview("#ff0000");
		s.live.commit("#ff0000");
		s.live.preview("#ff0000");
		s.live.commit("#ff0000");
		expect(s.history).toHaveLength(1);
		expect(s.history[0]).toEqual({ before: "#000000", after: "#ff0000" });
	});

	test("ending where it started adds no step", () => {
		const s = setup("#000000");
		s.live.preview("#550000");
		s.live.commit("#000000");
		expect(s.history).toHaveLength(0);
		expect(s.value()).toBe("#000000");
	});
});
