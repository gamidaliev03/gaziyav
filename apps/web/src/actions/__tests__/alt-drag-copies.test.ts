import { describe, expect, test } from "bun:test";
import { placeDragCopies } from "@/actions/timeline-edits";
import type { SceneTracks, TimelineElement } from "@/timeline/types";

// ⌥-drag a short distance used to become a plain move with a "No room for a copy" toast: the copy left at the
// original place overlapped the moved clip. The original stays now and the copy makes room.
function el(id: string, start: number, duration: number, type = "video"): TimelineElement {
	return { id, name: id, type, mediaId: "m", startTime: start, duration, trimStart: 0, trimEnd: 0, params: {} } as unknown as TimelineElement;
}

function scene({ main = [] as TimelineElement[], overlay = [] as TimelineElement[], text = [] as TimelineElement[] }): SceneTracks {
	return {
		overlay: [
			{ id: "t1", name: "Text", type: "text", elements: text, hidden: false },
			{ id: "v1", name: "Video", type: "video", elements: overlay, muted: false, hidden: false },
		],
		main: { id: "main", name: "Main", type: "video", elements: main, muted: false, hidden: false },
		audio: [],
	} as unknown as SceneTracks;
}

const spans = (elements: TimelineElement[]) => elements.map((e) => [e.id, Number(e.startTime), Number(e.duration)]);

describe("⌥-drag copies", () => {
	test("a copy dropped clear of everything lands there; the original stays", () => {
		const before = scene({ main: [el("a", 0, 100), el("b", 100, 50)] });
		const moved = scene({ main: [el("a", 0, 100), el("b", 300, 50)] });
		let n = 0;
		const { tracks, copies } = placeDragCopies({
			before,
			moved,
			moves: [{ elementId: "b", sourceTrackId: "main", targetTrackId: "main" }],
			newId: () => `c${n++}`,
			magnetTrackId: "main",
		});
		expect(spans(tracks.main.elements)).toEqual([["a", 0, 100], ["b", 100, 50], ["c0", 300, 50]]);
		expect(copies).toEqual([{ trackId: "main", elementId: "c0" }]);
	});

	test("short drag on the magnetic track: the copy goes in at the next cut and pushes the rest and the titles", () => {
		const before = scene({ main: [el("a", 0, 100), el("b", 100, 50), el("c", 150, 50)], text: [el("title", 160, 20, "text")] });
		// b dragged 20 to the right: over itself and c
		const moved = scene({ main: [el("a", 0, 100), el("b", 120, 50), el("c", 150, 50)], text: [el("title", 160, 20, "text")] });
		const { tracks, copies } = placeDragCopies({
			before,
			moved,
			moves: [{ elementId: "b", sourceTrackId: "main", targetTrackId: "main" }],
			newId: () => "copy",
			magnetTrackId: "main",
		});
		expect(spans(tracks.main.elements)).toEqual([["a", 0, 100], ["b", 100, 50], ["copy", 150, 50], ["c", 200, 50]]);
		expect(spans(tracks.overlay[0].elements)).toEqual([["title", 210, 20]]);
		expect(copies).toEqual([{ trackId: "main", elementId: "copy" }]);
	});

	test("short drag on an overlay track: the copy goes to a new track above it", () => {
		const before = scene({ overlay: [el("x", 0, 100)] });
		const moved = scene({ overlay: [el("x", 30, 100)] });
		let n = 0;
		const { tracks, copies } = placeDragCopies({
			before,
			moved,
			moves: [{ elementId: "x", sourceTrackId: "v1", targetTrackId: "v1" }],
			newId: () => `id${n++}`,
			magnetTrackId: "main",
		});
		expect(tracks.overlay.map((t) => t.id)).toEqual(["t1", "id1", "v1"]);
		expect(spans(tracks.overlay[2].elements)).toEqual([["x", 0, 100]]);
		expect(spans(tracks.overlay[1].elements)).toEqual([["id0", 30, 100]]);
		expect(copies).toEqual([{ trackId: "id1", elementId: "id0" }]);
	});

	test("short drag on the main track without the magnet: the copy goes to a video track right above it", () => {
		const before = scene({ main: [el("a", 0, 100)] });
		const moved = scene({ main: [el("a", 40, 100)] });
		let n = 0;
		const { tracks } = placeDragCopies({
			before,
			moved,
			moves: [{ elementId: "a", sourceTrackId: "main", targetTrackId: "main" }],
			newId: () => `id${n++}`,
			magnetTrackId: null,
		});
		expect(spans(tracks.main.elements)).toEqual([["a", 0, 100]]);
		expect(tracks.overlay.at(-1)?.type).toBe("video");
		expect(spans(tracks.overlay.at(-1)?.elements ?? [])).toEqual([["id0", 40, 100]]);
	});
});
