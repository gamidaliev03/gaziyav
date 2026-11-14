// The one-timeline conversion of older projects (timeline/join-timelines.ts): documents in, documents out.
import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import { countsEqual, countTimeline, isDefaultTimelineName, joinTimelines, TIMELINE_MODEL, topLevelCount } from "@/timeline/join-timelines";
import type { TScene } from "@/timeline/types";

// the module itself imports nothing; only these two checks need the editor's modules (and so its wasm)
const COMPOSITION_DEF = "ai.Composition";
let settleNestedScenes: typeof import("@/timeline/scenes").settleNestedScenes;
let editorDef = "";
beforeAll(async () => {
	await installOpenCutWasm();
	settleNestedScenes = (await import("@/timeline/scenes")).settleNestedScenes;
	editorDef = (await import("@/montage/flatten")).COMPOSITION_DEF;
});

type Doc = Record<string, any>;
let seq = 0;
const id = (p: string) => `${p}-${++seq}`;

function clip(start: number, length: number, extra: Doc = {}): Doc {
	return {
		id: id("el"),
		type: "video",
		mediaId: id("media"),
		name: "clip.mp4",
		startTime: start,
		duration: length,
		trimStart: 0,
		trimEnd: 0,
		animations: { opacity: { keys: [{ id: id("k"), time: 0, value: 0 }, { id: id("k"), time: 1000, value: 1 }] } },
		...extra,
	};
}
function compoundEl(sceneId: string, start: number, length: number): Doc {
	return { id: id("el"), type: "graphic", name: "Compound clip 1", definitionId: COMPOSITION_DEF, startTime: start, duration: length, trimStart: 0, trimEnd: 0, params: { sceneId, compound: true } };
}
/** A timeline with `n` back-to-back clips on main (transitions on every cut), one title and one sound. */
function scene(name: string, n: number, extra: Doc = {}, mainExtra: Doc[] = []): Doc {
	const main = Array.from({ length: n }, (_, i) => clip(i * 120000, 120000));
	const transitions = main.slice(1).map((el, i) => ({ id: id("tr"), fromElementId: main[i].id, toElementId: el.id, duration: 15000 }));
	return {
		id: id("scene"),
		name,
		isMain: false,
		tracks: {
			overlay: n > 0 ? [{ id: id("tr"), type: "text", name: "T", elements: [{ id: id("el"), type: "text", content: "hi", startTime: 0, duration: 60000 }] }] : [],
			main: { id: id("track"), name: "Main", type: "video", elements: [...main, ...mainExtra], transitions },
			audio: n > 0 ? [{ id: id("track"), type: "audio", name: "A", elements: [clip(0, 90000, { type: "audio" })] }] : [],
		},
		bookmarks: [],
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-01T00:00:00.000Z",
		...extra,
	};
}
function project(scenes: Doc[], currentSceneId?: string): Doc {
	return { metadata: { id: "p1", name: "Old", createdAt: "x", updatedAt: "x" }, scenes, currentSceneId: currentSceneId ?? scenes[0]?.id ?? "", settings: {}, version: 31 };
}
const byId = (doc: Doc, sceneId: string) => (doc.scenes as Doc[]).find((s) => s.id === sceneId) as Doc;
const media = (doc: Doc) => (doc.scenes as Doc[]).filter((s) => s.inMedia === true);

/** Everything a conversion must keep: the tracks of every scene byte for byte, nothing added or lost. */
function expectNothingLost(before: Doc, after: Doc) {
	expect(after.scenes.length).toBe(before.scenes.length);
	for (const old of before.scenes as Doc[]) {
		const now = byId(after, old.id);
		expect(now).toBeDefined();
		expect(JSON.stringify(now.tracks)).toBe(JSON.stringify(old.tracks));
		expect(countTimeline(now)).toEqual(countTimeline(old));
		expect(JSON.stringify(now.bookmarks)).toBe(JSON.stringify(old.bookmarks));
	}
}

describe("join timelines", () => {
	test("the composition definition is the editor's", () => {
		expect(editorDef).toBe(COMPOSITION_DEF);
		const s = scene("Main scene", 1, { isMain: true }, [compoundEl("x", 120000, 1000)]);
		// a compound pointing at "x" is seen as its use: x would be inner
		const inner = scene("Timeline 02", 1, { id: "x" });
		expect(topLevelCount(project([s, inner]))).toBe(1);
	});

	test("FIRST: an extra timeline that is already a compound clip's inner one is no second timeline and no Media item", () => {
		const inner = scene("Timeline 02", 3);
		const main = scene("Main scene", 2, { isMain: true }, [compoundEl(inner.id, 240000, 360000)]);
		const doc = project([main, inner]);
		const r = joinTimelines(doc);
		expect(r.kind).toBe("marked");
		if (r.kind !== "marked") return;
		expect(r.report.timelines).toBe(1);
		expect(r.doc.scenes).toBe(doc.scenes); // scenes untouched (scenes.ts marks it nested on open, as before)
		expect(media(r.doc)).toHaveLength(0);
		expect(r.doc.timelineModel).toBe(TIMELINE_MODEL);
	});

	test("an inner timeline used by a tab: the tab goes to Media, the inner one is marked nested, never listed twice", () => {
		const inner = scene("Timeline 03", 2);
		const tab = scene("Timeline 02", 1, {}, [compoundEl(inner.id, 120000, 240000)]);
		const main = scene("Main scene", 2, { isMain: true });
		const doc = project([main, tab, inner], main.id);
		const r = joinTimelines(doc);
		expect(r.kind).toBe("joined");
		if (r.kind !== "joined") return;
		expect(r.report.timelines).toBe(2);
		expect(r.report.inner).toEqual([inner.id]);
		expect(media(r.doc).map((s) => s.id)).toEqual([tab.id]);
		expect(byId(r.doc, inner.id)).toMatchObject({ nested: true, name: "Compound clip 2" });
		expect(byId(r.doc, inner.id).inMedia).toBeUndefined();
		expect(topLevelCount(r.doc)).toBe(1);
		expectNothingLost(doc, r.doc);
		expect(countsEqual(r.report)).toBe(true);
	});

	test("1 timeline: only the mark", () => {
		const doc = project([scene("Main scene", 4, { isMain: true })]);
		const r = joinTimelines(doc);
		expect(r.kind).toBe("marked");
		if (r.kind === "marked") expect(r.doc.scenes).toBe(doc.scenes);
	});

	test("2 timelines, default names, saved on the main one: main stays, the other is «Compound clip 1» in Media", () => {
		const main = scene("Main scene", 3, { isMain: true });
		const two = scene("Timeline 02", 2);
		const doc = project([main, two], main.id);
		const r = joinTimelines(doc);
		expect(r.kind).toBe("joined");
		if (r.kind !== "joined") return;
		expect(r.report.stays).toBe(main.id);
		expect(byId(r.doc, main.id)).toBe(main); // the timeline itself: the same object
		const c = byId(r.doc, two.id);
		expect(c).toMatchObject({ name: "Compound clip 1", isMain: false, inMedia: true, formerTimeline: { name: "Timeline 02", isMain: false } });
		expect(c.nested).toBeUndefined(); // F9: an older build keeps it as the timeline it was
		expect(r.doc.currentSceneId).toBe(main.id);
		expectNothingLost(doc, r.doc);
	});

	test("3 timelines, saved on the second tab, user names: that tab stays (export and first open use it)", () => {
		const existing = scene("Compound clip 4", 1, { nested: true });
		const main = scene("Main scene", 3, { isMain: true }, [compoundEl(existing.id, 360000, 120000)]);
		const intro = scene("Интро для рилса", 2);
		const three = scene("Timeline 03", 0);
		const doc = project([main, intro, three, existing], intro.id);
		const r = joinTimelines(doc);
		expect(r.kind).toBe("joined");
		if (r.kind !== "joined") return;
		expect(r.report.stays).toBe(intro.id);
		expect(byId(r.doc, intro.id)).toMatchObject({ isMain: true, name: "Интро для рилса", formerTimeline: { isMain: false } });
		expect(byId(r.doc, intro.id).inMedia).toBeUndefined();
		// numbers go on after the compound clips there are
		expect(byId(r.doc, main.id)).toMatchObject({ isMain: false, inMedia: true, name: "Compound clip 5", formerTimeline: { name: "Main scene", isMain: true } });
		// the empty one is dropped (no remnant), the version before the join still has it
		expect(byId(r.doc, three.id)).toBeUndefined();
		expect(r.report.dropped).toEqual([{ id: three.id, was: "Timeline 03" }]);
		expect(byId(r.doc, existing.id)).toBe(existing);
		expect((r.doc.scenes as Doc[]).filter((s) => s.isMain)).toHaveLength(1);
		expect(countsEqual(r.report)).toBe(true);
		expectNothingLost({ ...doc, scenes: doc.scenes.filter((s: Doc) => s.id !== three.id) }, r.doc);
	});

	test("saved inside a compound clip: its top-level timeline stays", () => {
		const inner = scene("Compound clip 1", 1, { nested: true });
		const main = scene("Main scene", 1, { isMain: true });
		const tab = scene("Timeline 02", 1, {}, [compoundEl(inner.id, 120000, 120000)]);
		const r = joinTimelines(project([main, tab, inner], inner.id));
		expect(r.kind === "joined" && r.report.stays).toBe(tab.id);
		if (r.kind === "joined") expect(r.doc.currentSceneId).toBe(inner.id);
	});

	test("a saved current id that leads nowhere: the main one stays", () => {
		const main = scene("Main scene", 1, { isMain: true });
		const r = joinTimelines(project([scene("Timeline 02", 1), main], "gone"));
		expect(r.kind === "joined" && r.report.stays).toBe(main.id);
	});

	test("18 timelines with empty ones and every kind of name: the 5 empty ones dropped, 12 compounds, all counts equal", () => {
		const names = ["Main scene", "Timeline 02", "Timeline 03", "Timeline 03 copy", "Пустой свой", "", "  ", "Таймлайн 07", "Концовка", "Scene 2", "Timeline", "B-roll"];
		// i % 4 clips: 0, 4, 8, 12, 16 are empty (the main one too); 9 is the saved current one
		const scenes = Array.from({ length: 18 }, (_, i) => scene(names[i] ?? `Timeline ${String(i + 1).padStart(2, "0")}`, i % 4, i === 0 ? { isMain: true } : {}));
		const doc = project(scenes, scenes[9].id);
		const r = joinTimelines(doc);
		expect(r.kind).toBe("joined");
		if (r.kind !== "joined") return;
		expect(r.report.timelines).toBe(18);
		expect(r.report.dropped.map((d) => d.id)).toEqual([0, 4, 8, 12, 16].map((i) => scenes[i].id));
		expect(r.report.compounds).toHaveLength(12);
		expect(media(r.doc)).toHaveLength(12);
		expect(r.doc.scenes).toHaveLength(13);
		expect(topLevelCount(r.doc)).toBe(1);
		expect(byId(r.doc, scenes[9].id).isMain).toBe(true);
		expect(new Set(media(r.doc).map((s) => s.name)).size).toBe(12);
		expect(byId(r.doc, scenes[11].id).name).toBe("B-roll");
		expect(media(r.doc).filter((s) => /^Compound clip \d+$/.test(s.name))).toHaveLength(11);
		const kept = { ...doc, scenes: scenes.filter((_, i) => i % 4 !== 0) };
		expectNothingLost(kept, r.doc);
		expect(countsEqual(r.report)).toBe(true);
		const total = (d: Doc) => (d.scenes as Doc[]).reduce((n, s) => n + countTimeline(s).elements, 0);
		expect(total(r.doc)).toBe(total(doc));
	});

	test("an empty timeline with a bookmark is kept; an empty inner one is never dropped; countsEqual allows only empty drops", () => {
		const main = scene("Main scene", 1, { isMain: true });
		const marked = scene("Timeline 02", 0, { bookmarks: [{ time: 0 }] });
		const innerEmpty = scene("Timeline 03", 0);
		const tab = scene("Timeline 04", 1, {}, [compoundEl(innerEmpty.id, 120000, 1000)]);
		const r = joinTimelines(project([main, marked, innerEmpty, tab], main.id));
		if (r.kind !== "joined") throw new Error(r.kind);
		expect(r.report.dropped).toEqual([]);
		expect(media(r.doc).map((s) => s.id)).toEqual([marked.id, tab.id]);
		expect(byId(r.doc, innerEmpty.id).nested).toBe(true);
		// a report that says a scene with elements went is refused
		expect(countsEqual({ ...r.report, dropped: [{ id: tab.id, was: "" }] })).toBe(false);
	});

	test("idempotent: a converted document is never converted again; without its mark it changes nothing more", () => {
		const doc = project([scene("Main scene", 2, { isMain: true }), scene("Timeline 02", 2), scene("Timeline 03", 1)]);
		const first = joinTimelines(doc);
		expect(first.kind).toBe("joined");
		if (first.kind !== "joined") return;
		const again = joinTimelines(first.doc);
		expect(again.kind).toBe("already");
		expect(again.doc).toBe(first.doc);
		const { timelineModel: _mark, ...unmarked } = first.doc;
		const third = joinTimelines(unmarked);
		expect(third.kind).toBe("marked");
		if (third.kind === "marked") expect(third.doc.scenes).toBe(first.doc.scenes);
	});

	test("the input document is never changed", () => {
		const doc = project([scene("Main scene", 2, { isMain: true }), scene("Timeline 02", 2)]);
		const copy = JSON.stringify(doc);
		joinTimelines(doc);
		expect(JSON.stringify(doc)).toBe(copy);
	});

	test("unreadable documents are left as they are", () => {
		expect(joinTimelines(null).kind).toBe("skipped");
		expect(joinTimelines({ scenes: {} }).kind).toBe("skipped");
		expect(joinTimelines({ scenes: [{ id: "a" }] }).kind).toBe("skipped");
		const s = scene("Main scene", 1, { isMain: true });
		expect(joinTimelines({ scenes: [s, { ...s }] }).kind).toBe("skipped");
		expect(joinTimelines({ metadata: {}, version: 31 }).kind).toBe("marked");
	});

	test("default names", () => {
		for (const n of ["Timeline 02", "timeline 2", "Main scene", "", " ", "Timeline 02 copy 3", "Таймлайн 05", "Scene 3", "Timeline"]) expect(isDefaultTimelineName(n)).toBe(true);
		for (const n of ["Интро", "Timeline for Reels", "Compound clip 1x", "My timeline 2"]) expect(isDefaultTimelineName(n)).toBe(false);
	});

	test("on open the Media compounds are kept (scenes.ts settleNestedScenes drops nested scenes nothing opens)", () => {
		const doc = project([scene("Main scene", 2, { isMain: true }), scene("Timeline 02", 2), scene("Timeline 03", 1)]);
		const r = joinTimelines(doc);
		if (r.kind !== "joined") throw new Error(r.kind);
		const scenes = r.doc.scenes as unknown as TScene[];
		expect(settleNestedScenes({ scenes })).toBe(scenes);
	});
});
