import { describe, expect, test } from "bun:test";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline";
import { elementIndex, findElementById, findElementOnTrack } from "@/timeline/element-index";
import { planMainTrackReorder } from "@/timeline/group-move/main-reorder";
import type { MediaTime } from "@/wasm";

// speed, 11.11: the lookups and the reorder plan were made linear; these tests hold them to the answers of the code
// they replace (kept here as the reference), on many random timelines.

function el(id: string, start: number, duration: number): TimelineElement {
	return { id, name: id, type: "video", mediaId: "m", startTime: start, duration, trimStart: 0, trimEnd: 0, params: {} } as unknown as TimelineElement;
}

/** The reorder plan as it was before 11.11 (a sum per clip, a search per clip). */
function referenceReorder({
	elements,
	movingIds,
	pointerTime,
	copyIds,
	incomingIds,
}: {
	elements: readonly TimelineElement[];
	movingIds: ReadonlySet<string>;
	incomingIds?: ReadonlySet<string>;
	pointerTime: number;
	copyIds?: ReadonlyMap<string, string>;
}) {
	const sorted = [...elements].sort((a, b) => a.startTime - b.startTime);
	const moving = sorted.filter((element) => movingIds.has(element.id));
	if (moving.length === 0) return null;
	const stay = copyIds ? sorted.filter((element) => !incomingIds?.has(element.id)) : sorted.filter((element) => !movingIds.has(element.id));
	const closed = stay.map((element) => {
		if (copyIds) return element;
		const removedBefore = moving
			.filter((other) => !incomingIds?.has(other.id) && other.startTime + other.duration <= element.startTime)
			.reduce((sum, other) => sum + other.duration, 0);
		return removedBefore === 0 ? element : { ...element, startTime: (element.startTime - removedBefore) as MediaTime };
	});
	let insertIndex = 0;
	while (insertIndex < stay.length && stay[insertIndex].startTime + stay[insertIndex].duration / 2 < pointerTime) insertIndex++;
	const cut = insertIndex > 0 ? closed[insertIndex - 1].startTime + closed[insertIndex - 1].duration : (closed[0]?.startTime ?? 0);
	// one block, back to back in timeline order (blind3 F1, 14.11)
	let at = cut;
	const inserted = moving.map((element) => {
		const copyId = copyIds?.get(element.id);
		const startTime = at as MediaTime;
		at += element.duration;
		return { ...(copyId ? { ...element, id: copyId } : element), startTime };
	});
	const blockLength = at - cut;
	const next = [
		...closed.slice(0, insertIndex),
		...inserted,
		...closed.slice(insertIndex).map((element) => ({ ...element, startTime: (element.startTime + blockLength) as MediaTime })),
	];
	const isNoop =
		!copyIds &&
		next.every((element) => {
			const before = sorted.find((candidate) => candidate.id === element.id);
			return before !== undefined && before.startTime === element.startTime;
		});
	return { insertIndex, elements: next, insertedIds: inserted.map((element) => element.id), isNoop };
}

function random(seed: number) {
	let state = seed;
	return () => {
		state = (state * 16807) % 2147483647;
		return state / 2147483647;
	};
}

describe("the main-track reorder plan, linear", () => {
	test("gives the old plan on 400 random drags (packed tracks, gaps, several clips, ⌥ copies, clips from a layer)", () => {
		const rnd = random(11);
		for (let round = 0; round < 400; round++) {
			const count = 2 + Math.floor(rnd() * 40);
			const elements: TimelineElement[] = [];
			let at = 0;
			for (let i = 0; i < count; i++) {
				if (rnd() < 0.2) at += Math.floor(rnd() * 50);
				const duration = 10 + Math.floor(rnd() * 90);
				elements.push(el(`e${i}`, at, duration));
				at += duration;
			}
			const movingIds = new Set<string>();
			const picks = 1 + Math.floor(rnd() * 3);
			for (let k = 0; k < picks; k++) movingIds.add(`e${Math.floor(rnd() * count)}`);
			const pointerTime = Math.floor(rnd() * (at + 40)) - 20;
			const mode = rnd();
			const copyIds = mode < 0.2 ? new Map([...movingIds].map((id) => [id, `${id}-copy`])) : undefined;
			// a picture brought down from a layer: it overlaps the main track's clips in time
			const fromLayer = mode > 0.8 ? el("layer", Math.floor(rnd() * at), 20 + Math.floor(rnd() * 60)) : null;
			const all = fromLayer ? [...elements, fromLayer] : elements;
			const args = fromLayer
				? { elements: all, movingIds: new Set(["layer"]), incomingIds: new Set(["layer"]), pointerTime, copyIds: copyIds ? new Map([["layer", "layer-copy"]]) : undefined }
				: { elements: all, movingIds, pointerTime, copyIds };
			const plan = planMainTrackReorder(args);
			const reference = referenceReorder(args);
			expect(plan === null).toBe(reference === null);
			if (!plan || !reference) continue;
			expect(plan.insertIndex).toBe(reference.insertIndex);
			expect(plan.isNoop).toBe(reference.isNoop);
			expect(plan.insertedIds).toEqual(reference.insertedIds);
			expect(plan.elements).toEqual(reference.elements);
		}
	});

	test("a clip that ends up where it is stays the same object", () => {
		const elements = [el("a", 0, 100), el("b", 100, 50), el("c", 150, 80), el("d", 230, 20)];
		const plan = planMainTrackReorder({ elements, movingIds: new Set(["b"]), pointerTime: 200 });
		// a (before both places) and d (after both) do not move
		expect(plan?.elements[0]).toBe(elements[0]);
		expect(plan?.elements[3]).toBe(elements[3]);
		expect(plan?.elements[1]).not.toBe(elements[2]);
	});
});

describe("elements by id", () => {
	const track = (id: string, type: string, elements: TimelineElement[]) => ({ id, name: id, type, elements }) as unknown as TimelineTrack;
	const tracks = {
		main: track("main", "video", [el("m1", 0, 10), el("m2", 10, 10)]),
		overlay: [track("o1", "text", [el("t1", 0, 5)]), track("o2", "video", [el("v1", 3, 5)])],
		audio: [track("a1", "audio", [el("s1", 0, 20)])],
	} as unknown as SceneTracks;

	test("every element is found on its own track, and on no other", () => {
		expect(elementIndex(tracks).size).toBe(5);
		for (const t of [tracks.main, ...tracks.overlay, ...tracks.audio]) {
			for (const element of t.elements) {
				expect(findElementOnTrack({ tracks, trackId: t.id, elementId: element.id })?.element).toBe(element as TimelineElement);
				expect(findElementById({ tracks, elementId: element.id })?.track).toBe(t);
				expect(findElementOnTrack({ tracks, trackId: "nowhere", elementId: element.id })).toBeUndefined();
			}
		}
		expect(findElementOnTrack({ tracks, trackId: "main", elementId: "t1" })).toBeUndefined();
		expect(findElementById({ tracks, elementId: "gone" })).toBeUndefined();
	});

	test("the index is built once per tracks object and again for a new one", () => {
		const first = elementIndex(tracks);
		expect(elementIndex(tracks)).toBe(first);
		const next = { ...tracks, main: { ...tracks.main, elements: [el("m3", 0, 4)] } } as unknown as SceneTracks;
		expect(elementIndex(next)).not.toBe(first);
		expect(findElementById({ tracks: next, elementId: "m1" })).toBeUndefined();
		expect(findElementById({ tracks: next, elementId: "m3" })?.track.id).toBe("main");
	});
});
