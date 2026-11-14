import { describe, expect, test } from "bun:test";
import { onlyPlacementChanged } from "@/components/editor/panels/properties/hooks/placement";
import type { TimelineElement } from "@/timeline";

const clip = { id: "a", type: "video", startTime: 0, duration: 100, trimStart: 0, trimEnd: 0, opacity: 1, transform: { x: 0 } } as unknown as TimelineElement;

// Dragging the selected clip re-rendered the whole inspector on every pointer move.
describe("a timeline drag or trim changes only the clip's place", () => {
	test("moved or trimmed: the panel can wait for the drop", () => {
		expect(onlyPlacementChanged(clip, { ...clip, startTime: 40 } as unknown as TimelineElement)).toBe(true);
		expect(onlyPlacementChanged(clip, { ...clip, duration: 80, trimStart: 20 } as unknown as TimelineElement)).toBe(true);
	});
	test("a value the inspector shows changed: it must follow", () => {
		expect(onlyPlacementChanged(clip, { ...clip, opacity: 0.5 } as unknown as TimelineElement)).toBe(false);
		expect(onlyPlacementChanged(clip, { ...clip, transform: { x: 5 } } as unknown as TimelineElement)).toBe(false);
	});
});

// perf, 13.11: typing into a title's text field re-rendered the whole inspector on every key (rc39: 1 135 component
// renders a key, test/perf-counts.mjs); the field shows what is typed, the panel waits for the field to be left.
describe("typing changes only a title's words", () => {
	const title = { id: "t", type: "text", startTime: 0, duration: 100, params: { content: "Chapter 7", fontSize: 5, color: "#fff" } } as unknown as TimelineElement;
	test("only the words: the panel can wait", async () => {
		const { onlyTypedTextChanged } = await import("@/components/editor/panels/properties/hooks/placement");
		expect(onlyTypedTextChanged(title, { ...title, params: { ...(title as unknown as { params: object }).params, content: "Chapter 7 typed" } } as unknown as TimelineElement)).toBe(true);
		expect(onlyTypedTextChanged(title, title)).toBe(true);
	});
	test("anything else the panel shows: it follows", async () => {
		const { onlyTypedTextChanged } = await import("@/components/editor/panels/properties/hooks/placement");
		const p = (title as unknown as { params: object }).params;
		expect(onlyTypedTextChanged(title, { ...title, params: { ...p, fontSize: 9 } } as unknown as TimelineElement)).toBe(false);
		expect(onlyTypedTextChanged(title, { ...title, params: { ...p, content: "x", color: "#000" } } as unknown as TimelineElement)).toBe(false);
		expect(onlyTypedTextChanged(title, { ...title, name: "renamed" } as unknown as TimelineElement)).toBe(false);
	});
	test("the panel waits only while the focus is in its own field (typing on the canvas still shows in it)", async () => {
		const { typingInInspector } = await import("@/components/editor/panels/properties/hooks/placement");
		expect(typingInInspector()).toBe(false);
	});
});
