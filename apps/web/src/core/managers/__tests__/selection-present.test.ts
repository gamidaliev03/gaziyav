import { describe, expect, test } from "bun:test";
import type { EditorCore } from "@/core";
import type { SceneTracks } from "@/timeline/types";
import { SelectionManager } from "../selection-manager";

const tracks = (main: string[], overlay: string[] = []) =>
	({
		main: { id: "main", elements: main.map((id) => ({ id })) },
		overlay: [{ id: "o1", elements: overlay.map((id) => ({ id })) }],
		audio: [],
	}) as unknown as SceneTracks;

// ⌘Z of a compound clip, another timeline shown: the selection stayed on clips that weren't there (the inspector
// showed nothing, ⌫ did nothing).
describe("the selection keeps to clips that are there", () => {
	test("a gone clip drops, a clip now on another track is followed there, the rest stays", () => {
		const selection = new SelectionManager({} as EditorCore);
		selection.setSelectedElements({ elements: [{ trackId: "main", elementId: "A" }, { trackId: "main", elementId: "B" }, { trackId: "o1", elementId: "C" }] });
		selection.keepPresent({ tracks: tracks(["A", "C"]) });
		expect(selection.getSelectedElements()).toEqual([{ trackId: "main", elementId: "A" }, { trackId: "main", elementId: "C" }]);
	});

	test("nothing to drop: no change, nobody told", () => {
		const selection = new SelectionManager({} as EditorCore);
		selection.setSelectedElements({ elements: [{ trackId: "main", elementId: "A" }] });
		const before = selection.getSelectedElements();
		let told = 0;
		selection.subscribe(() => told++);
		selection.keepPresent({ tracks: tracks(["A"]) });
		expect(selection.getSelectedElements()).toBe(before);
		expect(told).toBe(0);
	});
});
