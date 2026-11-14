import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { Bookmark, SceneTracks } from "@/timeline/types";
import type { ChapterState } from "../move-range";

type Engine = typeof import("../move-range");
let duplicateRange: Engine["duplicateRange"];
let extractRange: Engine["extractRange"];
let moveRange: Engine["moveRange"];
let removeRange: Engine["removeRange"];
let tracksLength: Engine["tracksLength"];
let applyLinkage: typeof import("@/timeline/linkage")["applyLinkage"];
const S = 120000;
beforeAll(async () => {
	await installOpenCutWasm();
	({ duplicateRange, extractRange, moveRange, removeRange, tracksLength } = await import("../move-range"));
	({ applyLinkage } = await import("@/timeline/linkage"));
	const { TICKS_PER_SECOND } = await import("@/wasm");
	if (TICKS_PER_SECOND !== S || (await import("../eps")).EDGE_EPS !== S / 100) throw new Error(`ticks ${TICKS_PER_SECOND}`);
});

// Five scenes of 10 s on the main track (one clip each), a title and a caption inside each, a music bed under all of it,
// an adjustment layer over the whole film and a transition on every cut.
let n = 0;
const ids = () => `n${n++}`;
const el = (id: string, type: string, start: number, duration: number, extra: Record<string, unknown> = {}) =>
	({ id, name: id, type, startTime: start * S, duration: duration * S, trimStart: 0, trimEnd: 0, params: {}, ...extra }) as never;
const clip = (i: number, start: number, duration = 10) => el(`c${i}`, "video", start, duration, { mediaId: `m${i}`, trimEnd: 20 * S });

function film(): ChapterState {
	const main = [1, 2, 3, 4, 5].map((i) => clip(i, (i - 1) * 10));
	const transitions = [1, 2, 3, 4].map((i) => ({ id: `t${i}`, type: "fade", fromElementId: `c${i}`, toElementId: `c${i + 1}`, duration: S / 2, params: {} }));
	const tracks: SceneTracks = {
		main: { id: "main", name: "Main", type: "video", elements: main, muted: false, hidden: false, transitions } as never,
		overlay: [
			{ id: "titles", name: "T", type: "text", hidden: false, elements: [1, 2, 3, 4, 5].map((i) => el(`title${i}`, "text", (i - 1) * 10 + 1, 3)) },
			{ id: "caps", name: "C", type: "text", hidden: false, elements: [1, 2, 3, 4, 5].map((i) => el(`cap${i}`, "text", (i - 1) * 10 + 5, 4)) },
			{ id: "fx", name: "FX", type: "effect", hidden: false, elements: [el("adjust", "effect", 0, 50, { effectType: "grade" })] },
		] as never,
		audio: [{ id: "music", name: "M", type: "audio", muted: false, elements: [el("bed", "audio", 0, 50, { sourceType: "upload", mediaId: "song", trimEnd: 30 * S })] }] as never,
	};
	const bookmarks: Bookmark[] = [1, 2, 3, 4, 5].map((i) => ({ time: ((i - 1) * 10 * S) as never, chapter: true, note: `S${i}` }));
	return { tracks, bookmarks };
}
const span = (a: number, b: number) => ({ start: a * S, end: b * S });
const at = (state: ChapterState, trackId: string) => {
	const all = [state.tracks.main, ...state.tracks.overlay, ...state.tracks.audio];
	const track = all.find((t) => t.id === trackId);
	return (track?.elements ?? []).map((e) => [e.id, e.startTime / S, (e.startTime + e.duration) / S]);
};
const marks = (state: ChapterState) => state.bookmarks.map((b) => [b.note, b.time / S]);
const mainMedia = (state: ChapterState) => state.tracks.main.elements.map((e) => (e as { mediaId: string }).mediaId);

describe("moving a scene", () => {
	test("scene 4 before scene 2: picture order 1 4 2 3 5, titles and captions go with it, bed and layer stay", () => {
		const before = film();
		const after = moveRange({ state: before, span: span(30, 40), to: 10 * S, newId: ids });
		expect(mainMedia(after)).toEqual(["m1", "m4", "m2", "m3", "m5"]);
		expect(at(after, "main").map((e) => e.slice(1))).toEqual([[0, 10], [10, 20], [20, 30], [30, 40], [40, 50]]);
		expect(at(after, "titles")).toEqual([["title1", 1, 4], ["title4", 11, 14], ["title2", 21, 24], ["title3", 31, 34], ["title5", 41, 44]]);
		expect(at(after, "caps")).toEqual([["cap1", 5, 9], ["cap4", 15, 19], ["cap2", 25, 29], ["cap3", 35, 39], ["cap5", 45, 49]]);
		expect(at(after, "music")).toEqual([["bed", 0, 50]]);
		expect(at(after, "fx")).toEqual([["adjust", 0, 50]]);
		expect(tracksLength(after.tracks)).toBe(tracksLength(before.tracks));
		expect(marks(after)).toEqual([["S1", 0], ["S4", 10], ["S2", 20], ["S3", 30], ["S5", 40]]);
	});

	test("a transition on a cut that no longer joins the same two clips is removed; one inside a scene stays", () => {
		const after = moveRange({ state: film(), span: span(30, 40), to: 10 * S, newId: ids });
		const kept = ((after.tracks.main as never as { transitions: { id: string }[] }).transitions ?? []).map((t) => t.id).sort();
		// c2→c3 still touch (2 then 3); c1→c2, c3→c4 and c4→c5 no longer do.
		expect(kept).toEqual(["t2"]);
	});

	test("a transition between two clips inside the moved scene travels with them", () => {
		const state = film();
		const main = state.tracks.main.elements.filter((e) => e.id !== "c4");
		main.splice(3, 0, el("c4a", "video", 30, 5, { mediaId: "m4" }), el("c4b", "video", 35, 5, { mediaId: "m4b" }));
		const transitions = [{ id: "inner", type: "fade", fromElementId: "c4a", toElementId: "c4b", duration: S / 2, params: {} }];
		state.tracks = { ...state.tracks, main: { ...state.tracks.main, elements: main, transitions } as never };
		const after = moveRange({ state, span: span(30, 40), to: 10 * S, newId: ids });
		const list = (after.tracks.main as never as { transitions: { id: string }[] }).transitions;
		expect(list.map((t) => t.id)).toEqual(["inner"]);
		expect(at(after, "main").slice(1, 3)).toEqual([["c4a", 10, 15], ["c4b", 15, 20]]);
	});

	test("moving a scene later (2 after 4) and the first scene to the end", () => {
		const later = moveRange({ state: film(), span: span(10, 20), to: 40 * S, newId: ids });
		expect(mainMedia(later)).toEqual(["m1", "m3", "m4", "m2", "m5"]);
		const first = moveRange({ state: film(), span: span(0, 10), to: 50 * S, newId: ids });
		expect(mainMedia(first)).toEqual(["m2", "m3", "m4", "m5", "m1"]);
		expect(marks(first)).toEqual([["S2", 0], ["S3", 10], ["S4", 20], ["S5", 30], ["S1", 40]]);
		expect(at(first, "music")).toEqual([["bed", 0, 50]]);
	});

	test("a clip crossing a scene edge is cut at the edge and its pieces go with their scenes", () => {
		const state = film();
		// One long recording 0–50 with the five scene marks in it.
		state.tracks = { ...state.tracks, main: { ...state.tracks.main, elements: [el("long", "video", 0, 50, { mediaId: "rec", trimEnd: 0 })], transitions: [] } as never };
		const after = moveRange({ state, span: span(30, 40), to: 10 * S, newId: ids });
		const pieces = after.tracks.main.elements.map((e) => [e.startTime / S, e.duration / S, e.trimStart / S]);
		expect(pieces).toEqual([[0, 10, 0], [10, 10, 30], [20, 20, 10], [40, 10, 40]]);
		expect(tracksLength(after.tracks)).toBe(50 * S);
	});

	test("a title across a scene edge is cut there, the bed that starts in the film and covers the scene stays", () => {
		const state = film();
		state.tracks.overlay[0] = { ...state.tracks.overlay[0], elements: [el("wide", "text", 25, 10)] } as never;
		state.tracks.audio[0] = { ...state.tracks.audio[0], elements: [el("bed", "audio", 5, 45, { sourceType: "upload", mediaId: "song" })] } as never;
		const after = moveRange({ state, span: span(30, 40), to: 10 * S, newId: ids });
		// «wide» 25–35: its 25–30 piece belongs to scene 3 (now 30–40 → 35–40), its 30–35 piece to scene 4 (now 10–15).
		expect(at(after, "titles").map((e) => e.slice(1))).toEqual([[10, 15], [35, 40]]);
		expect(at(after, "music")).toEqual([["bed", 5, 50]]);
	});

	test("a sound locked to a long main clip is cut with it, never left as a bed", () => {
		const state = film();
		state.tracks = {
			...state.tracks,
			main: { ...state.tracks.main, elements: [el("long", "video", 0, 50, { mediaId: "rec", isSourceAudioEnabled: false })], transitions: [] } as never,
			audio: [{ id: "voice", name: "V", type: "audio", muted: false, elements: [el("voice", "audio", 0, 50, { sourceType: "upload", mediaId: "rec" })] }] as never,
		};
		const after = moveRange({ state, span: span(30, 40), to: 10 * S, newId: ids });
		const v = after.tracks.audio[0].elements.map((e) => [e.startTime / S, e.trimStart / S]);
		const m = after.tracks.main.elements.map((e) => [e.startTime / S, e.trimStart / S]);
		expect(v).toEqual(m);
	});

	test("the timeline's own after-step passes (linkage, captions) leave the move as it is", () => {
		const before = film();
		const after = moveRange({ state: before, span: span(30, 40), to: 10 * S, newId: ids });
		for (const kinds of [new Set<never>(), new Set(["text", "audio", "graphic", "effect", "video"] as never[])]) {
			const linked = applyLinkage({ before: before.tracks, after: after.tracks, kinds });
			expect(at({ ...after, tracks: linked }, "caps")).toEqual(at(after, "caps"));
			expect(at({ ...after, tracks: linked }, "titles")).toEqual(at(after, "titles"));
			expect(at({ ...after, tracks: linked }, "music")).toEqual(at(after, "music"));
		}
	});

	test("an implicit first scene (no mark at 0) gets one, so it keeps being a scene after it moves", () => {
		const state = film();
		state.bookmarks = state.bookmarks.slice(1);
		const after = moveRange({ state, span: span(0, 10), to: 30 * S, newId: ids });
		expect(after.bookmarks.filter((b) => b.chapter).map((b) => b.time / S)).toEqual([0, 10, 20, 30, 40]);
	});

	test("a move onto its own edges changes nothing", () => {
		const state = film();
		expect(moveRange({ state, span: span(10, 20), to: 10 * S })).toBe(state);
		expect(moveRange({ state, span: span(10, 20), to: 20 * S })).toBe(state);
	});

	test("120 scenes over two hours: a move takes well under 200 ms", () => {
		const count = 120;
		const len = 60;
		const main = Array.from({ length: count }, (_, i) => el(`v${i}`, "video", i * len, len, { mediaId: `m${i}` }));
		const caps = Array.from({ length: count * 20 }, (_, i) => el(`k${i}`, "text", i * 3, 2.5));
		const state: ChapterState = {
			tracks: { main: { id: "main", type: "video", elements: main, transitions: [] } as never, overlay: [{ id: "caps", type: "text", elements: caps }] as never, audio: [{ id: "a", type: "audio", elements: [el("bed", "audio", 0, count * len, { sourceType: "upload", mediaId: "s" })] }] as never },
			bookmarks: Array.from({ length: count }, (_, i) => ({ time: (i * len * S) as never, chapter: true })),
		};
		const t0 = performance.now();
		const after = moveRange({ state, span: span(100 * len, 101 * len), to: 3 * len * S, newId: ids });
		const ms = performance.now() - t0;
		expect(after.tracks.main.elements[3].id).toBe("v100");
		expect(ms).toBeLessThan(200);
	});
});

describe("delete, duplicate, copy out", () => {
	test("delete scene 2: the gap closes, the bed is shortened by 10 s, the next mark takes its place", () => {
		const after = removeRange({ state: film(), span: span(10, 20), newId: ids });
		expect(mainMedia(after)).toEqual(["m1", "m3", "m4", "m5"]);
		expect(at(after, "main").map((e) => e.slice(1))).toEqual([[0, 10], [10, 20], [20, 30], [30, 40]]);
		expect(at(after, "titles").map((e) => e[0])).toEqual(["title1", "title3", "title4", "title5"]);
		expect(at(after, "music")).toEqual([["bed", 0, 40]]);
		expect(marks(after)).toEqual([["S1", 0], ["S3", 10], ["S4", 20], ["S5", 30]]);
		expect(tracksLength(after.tracks)).toBe(40 * S);
	});

	test("duplicate scene 3: a copy right after it with new ids, the rest moves on", () => {
		const after = duplicateRange({ state: film(), span: span(20, 30), newId: ids });
		expect(mainMedia(after)).toEqual(["m1", "m2", "m3", "m3", "m4", "m5"]);
		const titles = at(after, "titles");
		expect(titles.map((e) => e.slice(1))).toEqual([[1, 4], [11, 14], [21, 24], [31, 34], [41, 44], [51, 54]]);
		expect(new Set(titles.map((e) => e[0])).size).toBe(6);
		expect(marks(after)).toEqual([["S1", 0], ["S2", 10], ["S3", 20], ["S3", 30], ["S4", 40], ["S5", 50]]);
		expect(at(after, "music")).toEqual([["bed", 0, 50]]);
	});

	test("copy scene 4 out: only its pieces, from 0, the bed cut to it", () => {
		const out = extractRange({ state: film(), span: span(30, 40), newId: ids });
		expect(mainMedia(out)).toEqual(["m4"]);
		expect(at(out, "main").map((e) => e.slice(1))).toEqual([[0, 10]]);
		expect(at(out, "caps")).toEqual([["cap4", 5, 9]]);
		const bed = out.tracks.audio[0].elements[0];
		expect([bed.startTime / S, bed.duration / S, bed.trimStart / S]).toEqual([0, 10, 30]);
		expect(marks(out)).toEqual([["S4", 0]]);
	});
});
