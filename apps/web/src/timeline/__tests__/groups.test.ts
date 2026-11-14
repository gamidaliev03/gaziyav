import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SceneTracks, TimelineElement } from "@/timeline";

// CapCut groups (⌘G), frame ⌥-drag copies and locked tracks: the pure parts.
let G: typeof import("@/timeline/groups");
let withFrameDragCopies: typeof import("@/preview/drag-copies").withFrameDragCopies;
let withoutLockedClips: typeof import("@/timeline/track-lock").withoutLockedClips;
beforeAll(async () => {
	await installOpenCutWasm();
	G = await import("@/timeline/groups");
	({ withFrameDragCopies } = await import("@/preview/drag-copies"));
	({ withoutLockedClips } = await import("@/timeline/track-lock"));
});

const clip = (id: string, start: number, groupId?: string) =>
	({ id, name: id, type: "video", mediaId: "m", startTime: start, duration: 120000, trimStart: 0, trimEnd: 0, params: {}, ...(groupId ? { groupId } : {}) }) as unknown as TimelineElement;
const tracks = (main: TimelineElement[], text: TimelineElement[] = []): SceneTracks =>
	({
		overlay: [{ id: "t1", name: "Text", type: "text", hidden: false, elements: text }],
		main: { id: "main", name: "Main", type: "video", muted: false, hidden: false, elements: main },
		audio: [],
	}) as unknown as SceneTracks;

test("a grouped clip brings the rest of its group, an ungrouped one comes alone", () => {
	const t = tracks([clip("a", 0, "g"), clip("b", 120000), clip("c", 240000, "g")], [{ ...clip("x", 0, "g"), type: "text" } as TimelineElement]);
	const group = G.expandToGroups({ tracks: t, elements: [{ trackId: "main", elementId: "a" }] });
	expect(group.map((r) => r.elementId).sort()).toEqual(["a", "c", "x"]);
	expect(group.find((r) => r.elementId === "x")?.trackId).toBe("t1");
	expect(G.expandToGroups({ tracks: t, elements: [{ trackId: "main", elementId: "b" }] }).map((r) => r.elementId)).toEqual(["b"]);
});

test("copies made together form a new group; a lone copy is not grouped", () => {
	const copies = G.regroupCopies([clip("a2", 0, "g"), clip("c2", 1, "g"), clip("z2", 2, "h")]);
	expect(copies[0].groupId).toBeDefined();
	expect(copies[0].groupId).not.toBe("g");
	expect(copies[1].groupId).toBe(copies[0].groupId);
	expect(copies[2].groupId).toBeUndefined();
	const remap = G.groupRemapper();
	const [x, y] = [remap(clip("p", 0, "g")), remap(clip("q", 0, "g"))];
	expect(x.groupId).toBe(y.groupId);
	expect(x.groupId).not.toBe("g");
});

test("⌥-drag on the frame: the copy goes on a new track right above its own, the original stays", () => {
	let n = 0;
	const t = tracks([clip("a", 0)], [{ ...clip("x", 0), type: "text" } as TimelineElement]);
	const { tracks: after, copies } = withFrameDragCopies({
		tracks: t,
		elements: [{ trackId: "main", elementId: "a" }],
		newId: () => `n${++n}`,
	});
	expect(after.main.elements.map((e) => e.id)).toEqual(["a"]);
	expect(after.overlay.map((track) => track.id)).toEqual(["t1", copies[0].trackId]);
	expect(after.overlay[1].type).toBe("video");
	expect(after.overlay[1].elements[0].id).toBe(copies[0].elementId);
	const onText = withFrameDragCopies({ tracks: t, elements: [{ trackId: "t1", elementId: "x" }], newId: () => `m${++n}` });
	expect(onText.tracks.overlay[0].id).toBe(onText.copies[0].trackId);
	expect(onText.tracks.overlay[1].id).toBe("t1");
});

test("a locked track has no clips for edits at the playhead", () => {
	const t = tracks([clip("a", 0)], [{ ...clip("x", 0), type: "text" } as TimelineElement]);
	expect(withoutLockedClips(t)).toBe(t);
	const locked = { ...t, main: { ...t.main, locked: true } } as SceneTracks;
	const seen = withoutLockedClips(locked);
	expect(seen.main.elements).toEqual([]);
	expect(seen.overlay[0].elements.length).toBe(1);
});
