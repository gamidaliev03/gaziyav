import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { TProject } from "@/project/types";
import type { SceneTracks, TimelineElement } from "@/timeline/types";
import type { TrimTarget } from "../types";

// A trim on the editor itself: shown live without a step, committed as ONE undo step with Linkage's followers (the
// detached sounds, the title), put back exactly by ⌘Z and by Esc, with every timeline rule still holding.
let core: typeof import("@/core");
let scenes: typeof import("@/timeline/scenes");
let session: typeof import("../session");
let invariants: typeof import("@/timeline/invariants");
let linkage: typeof import("@/timeline/linkage");

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	scenes = await import("@/timeline/scenes");
	session = await import("../session");
	invariants = await import("@/timeline/invariants");
	linkage = await import("@/timeline/linkage");
	const storage = await import("@/services/storage/service");
	(storage.storageService as unknown as Record<string, unknown>).saveProject = async () => {};
}, 120_000);

const F = 4800; // a frame at 25 fps
const KINDS = ["text", "sticker", "effect", "audio", "overlay"] as const;

function picture(id: string, start: number, length: number, trim: number): TimelineElement {
	return { id, name: id, type: "video", mediaId: `m-${id}`, isSourceAudioEnabled: false, sourceDuration: 400 * F, startTime: start * F, duration: length * F, trimStart: trim * F, trimEnd: (400 - trim - length) * F, params: {} } as unknown as TimelineElement;
}
const soundOf = (clip: TimelineElement): TimelineElement => ({ ...clip, id: `s${clip.id}`, name: `s${clip.id}`, type: "audio", sourceType: "upload", isSourceAudioEnabled: undefined }) as unknown as TimelineElement;

/** Three pictures on the main track, their sounds detached on a sound track, a title over the middle one. */
function open({ linkageOn = true }: { linkageOn?: boolean } = {}) {
	const { EditorCore } = core;
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const main = scenes.buildDefaultScene({ name: "Main", isMain: true });
	const project = {
		metadata: { id: "p", name: "p", createdAt: new Date(0), updatedAt: new Date(0) },
		scenes: [main],
		currentSceneId: main.id,
		settings: { fps: { numerator: 25, denominator: 1 }, canvasSize: { width: 1920, height: 1080 }, background: { type: "color", color: "#000000" } },
		version: 1,
	} as unknown as TProject;
	editor.project.setActiveProject({ project });
	editor.scenes.setScenes({ scenes: project.scenes, activeSceneId: main.id });
	const tracks = editor.scenes.getActiveScene().tracks;
	const clips = [picture("a", 0, 100, 10), picture("b", 100, 100, 50), picture("c", 200, 100, 20)];
	const title = { id: "x", name: "x", type: "text", startTime: 120 * F, duration: 40 * F, trimStart: 0, trimEnd: 0, params: { content: "x" } } as unknown as TimelineElement;
	editor.scenes.updateSceneTracks({
		tracks: {
			overlay: [{ id: "t", name: "Text", type: "text", elements: [title], hidden: false }],
			main: { ...tracks.main, elements: clips },
			audio: [{ id: "au", name: "Audio", type: "audio", elements: clips.map(soundOf), muted: false }],
		} as unknown as SceneTracks,
	});
	editor.command.isRippleEnabled = true;
	editor.command.linkage = { enabled: linkageOn, kinds: [...KINDS] };
	editor.command.clear();
	const mainId = editor.scenes.getActiveScene().tracks.main.id;
	return { editor, mainId };
}
type Editor = ReturnType<typeof open>["editor"];
const find = (tracks: SceneTracks, id: string) => [...tracks.overlay, tracks.main, ...tracks.audio].flatMap((track) => track.elements as TimelineElement[]).find((e) => e.id === id) as TimelineElement;
/** [start, length, first file frame] in frames. */
const at = (tracks: SceneTracks, id: string) => [find(tracks, id).startTime / F, find(tracks, id).duration / F, find(tracks, id).trimStart / F];
const committed = (editor: Editor) => editor.scenes.getActiveScene().tracks;
const state = (editor: Editor) => JSON.stringify(committed(editor));
const broken = (editor: Editor) => invariants.checkTimelineInvariants({ tracks: committed(editor), magnet: true }).map((v) => `${v.rule}: ${v.detail}`);
const inStep = (tracks: SceneTracks) => ["a", "b", "c"].every((id) => linkage.isLockstepPair(find(tracks, `s${id}`), find(tracks, id)));

describe("a trim on the editor", () => {
	const cases = (mainId: string): Array<{ name: string; target: TrimTarget; delta: number; want: Record<string, number[]> }> => [
		{
			name: "roll a|b 12 later",
			target: { kind: "roll", trackId: mainId, leftId: "a", rightId: "b" },
			delta: 12,
			want: { a: [0, 112, 10], b: [112, 88, 62], c: [200, 100, 20], sa: [0, 112, 10], sb: [112, 88, 62], sc: [200, 100, 20], x: [120, 40, 0] },
		},
		{
			name: "ripple a's tail 30 earlier",
			target: { kind: "ripple", trackId: mainId, elementId: "a", side: "right" },
			delta: -30,
			want: { a: [0, 70, 10], b: [70, 100, 50], c: [170, 100, 20], sa: [0, 70, 10], sb: [70, 100, 50], sc: [170, 100, 20], x: [90, 40, 0] },
		},
		{
			name: "ripple b's head 20 in",
			target: { kind: "ripple", trackId: mainId, elementId: "b", side: "left" },
			delta: 20,
			// the title sat 20 frames into b: its frame of the picture is now b's first, the title starts there
			want: { a: [0, 100, 10], b: [100, 80, 70], c: [180, 100, 20], sb: [100, 80, 70], sc: [180, 100, 20], x: [100, 40, 0] },
		},
		{
			name: "slip b 17 later",
			target: { kind: "slip", trackId: mainId, elementId: "b" },
			delta: 17,
			want: { a: [0, 100, 10], b: [100, 100, 33], c: [200, 100, 20], sb: [100, 100, 33], x: [137, 40, 0] },
		},
		{
			name: "slide b 15 earlier",
			target: { kind: "slide", trackId: mainId, elementId: "b" },
			delta: -15,
			want: { a: [0, 85, 10], b: [85, 100, 50], c: [185, 115, 5], sa: [0, 85, 10], sb: [85, 100, 50], sc: [185, 115, 5], x: [105, 40, 0] },
		},
	];

	test("shown live with what follows it, nothing committed; Esc puts everything back", () => {
		const { editor, mainId } = open();
		for (const { name, target, delta, want } of cases(mainId)) {
			const before = state(editor);
			const trim = session.TrimSession.start(editor, target);
			if (!trim) throw new Error(`${name}: no session`);
			expect([name, trim.update(delta * F)?.delta]).toEqual([name, delta * F]);
			const preview = editor.timeline.getPreviewTracks() as SceneTracks;
			for (const [id, frames] of Object.entries(want)) expect([name, id, at(preview, id)]).toEqual([name, id, frames]);
			expect([name, inStep(preview)]).toEqual([name, true]);
			expect([name, state(editor) === before, editor.command.depth()]).toEqual([name, true, 0]);
			// the hand goes back to where it started: every clip shown where it was
			trim.update(0);
			expect([name, JSON.stringify(editor.timeline.getPreviewTracks()) === before]).toEqual([name, true]);
			trim.update(delta * F);
			trim.cancel();
			expect([name, editor.timeline.isPreviewActive(), state(editor) === before, editor.command.depth()]).toEqual([name, false, true, 0]);
		}
	});

	test("committed as one undo step; ⌘Z gives the timeline back exactly, ⇧⌘Z the trim; no rule broken", () => {
		for (const index of [0, 1, 2, 3, 4]) {
			const { editor, mainId } = open();
			const { name, target, delta, want } = cases(mainId)[index];
			const before = state(editor);
			const trim = session.TrimSession.start(editor, target);
			if (!trim) throw new Error(`${name}: no session`);
			trim.update(delta * F);
			expect([name, trim.commit()]).toEqual([name, true]);
			expect([name, editor.command.depth(), editor.timeline.isPreviewActive()]).toEqual([name, 1, false]);
			for (const [id, frames] of Object.entries(want)) expect([name, id, at(committed(editor), id)]).toEqual([name, id, frames]);
			expect([name, inStep(committed(editor)), broken(editor)]).toEqual([name, true, []]);
			const after = state(editor);
			editor.command.undo();
			expect([name, state(editor) === before, editor.command.depth()]).toEqual([name, true, 0]);
			editor.command.redo();
			expect([name, state(editor) === after, editor.command.depth()]).toEqual([name, true, 1]);
		}
	});

	test("on a long film a move shows the trim and the sounds in step; the titles take their places when the hand rests", () => {
		const { editor, mainId } = open();
		const before = state(editor);
		const trim = session.TrimSession.start(editor, { kind: "slide", trackId: mainId, elementId: "b" });
		if (!trim) throw new Error("no session");
		// the pointer's fast path: no pass over the timeline's items
		trim.update(-15 * F, { linked: false });
		let preview = editor.timeline.getPreviewTracks() as SceneTracks;
		expect([at(preview, "a"), at(preview, "b"), at(preview, "c"), at(preview, "sa"), at(preview, "sb"), at(preview, "sc")]).toEqual([[0, 85, 10], [85, 100, 50], [185, 115, 5], [0, 85, 10], [85, 100, 50], [185, 115, 5]]);
		expect([inStep(preview), at(preview, "x")]).toEqual([true, [120, 40, 0]]);
		trim.settle();
		preview = editor.timeline.getPreviewTracks() as SceneTracks;
		expect([at(preview, "b"), at(preview, "sb"), at(preview, "x")]).toEqual([[85, 100, 50], [85, 100, 50], [105, 40, 0]]);
		// moving on: the clips and sounds follow the hand, the title waits where the rest put it
		trim.update(-5 * F, { linked: false });
		preview = editor.timeline.getPreviewTracks() as SceneTracks;
		expect([at(preview, "b"), at(preview, "sb"), inStep(preview), at(preview, "x")]).toEqual([[95, 100, 50], [95, 100, 50], true, [105, 40, 0]]);
		// back to where it started: the trim's own clips and sounds are where they were
		trim.update(0, { linked: false });
		preview = editor.timeline.getPreviewTracks() as SceneTracks;
		expect([at(preview, "a"), at(preview, "b"), at(preview, "c"), at(preview, "sb"), inStep(preview)]).toEqual([[0, 100, 10], [100, 100, 50], [200, 100, 20], [100, 100, 50], true]);
		trim.settle();
		expect(JSON.stringify(editor.timeline.getPreviewTracks()) === before).toBe(true);
		// released after a fast move: the committed step has everything, exactly as with Linkage shown live
		trim.update(-15 * F, { linked: false });
		expect(trim.commit()).toBe(true);
		expect([at(committed(editor), "b"), at(committed(editor), "sb"), at(committed(editor), "x"), inStep(committed(editor)), broken(editor), editor.command.depth()]).toEqual([[85, 100, 50], [85, 100, 50], [105, 40, 0], true, [], 1]);
		editor.command.undo();
		expect(state(editor) === before).toBe(true);
	});

	test("what a move costs is what the trim changes: a roll on a film of 2 000 clips hands the preview two clips and their sounds", () => {
		const { editor, mainId } = open();
		// the same three clips, then 2 000 more after them, and 600 titles over the film
		const tracks = committed(editor);
		const more = Array.from({ length: 2000 }, (_, i) => ({ ...picture(`m${i}`, 300 + i * 50, 50, 10), isSourceAudioEnabled: true }) as unknown as TimelineElement);
		const titles = Array.from({ length: 600 }, (_, i) => ({ ...find(tracks, "x"), id: `t${i}`, name: `t${i}`, startTime: (320 + i * 160) * F, duration: 40 * F }) as unknown as TimelineElement);
		editor.scenes.updateSceneTracks({
			tracks: { ...tracks, main: { ...tracks.main, elements: [...tracks.main.elements, ...more] }, overlay: tracks.overlay.map((track) => ({ ...track, elements: [...track.elements, ...titles] })) } as SceneTracks,
		});
		const trim = session.TrimSession.start(editor, { kind: "roll", trackId: mainId, leftId: "a", rightId: "b" });
		if (!trim) throw new Error("no session");
		expect(trim.linkageLoad).toBeGreaterThan(session.LIVE_LINKAGE_LOAD);
		const timeline = editor.timeline as unknown as { previewElements: (args: { updates: unknown[] }) => void };
		const real = timeline.previewElements.bind(editor.timeline);
		const sizes: number[] = [];
		timeline.previewElements = (args) => {
			sizes.push(args.updates.length);
			real(args);
		};
		for (const frames of [3, 7, 12, 7, 0, -4]) trim.update(frames * F, { linked: false });
		// a, b and their two sounds — also at 0, where they are put back
		expect(sizes).toEqual([4, 4, 4, 4, 4, 4]);
		const preview = editor.timeline.getPreviewTracks() as SceneTracks;
		expect([at(preview, "a"), at(preview, "b"), at(preview, "sa"), at(preview, "sb")]).toEqual([[0, 96, 10], [96, 104, 46], [0, 96, 10], [96, 104, 46]]);
		trim.cancel();
	});

	test("500 random trims of every kind: not a frame of sync lost, every edge on a frame, every rule kept; all undone gives the film back", () => {
		const { editor, mainId } = open();
		const before = state(editor);
		let seed = 20261111;
		const rnd = () => {
			seed = (seed * 16807) % 2147483647;
			return seed / 2147483647;
		};
		const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
		let made = 0;
		const kinds = { roll: 0, ripple: 0, slip: 0, slide: 0 };
		for (let i = 0; i < 500; i++) {
			const main = [...committed(editor).main.elements].sort((a, b) => a.startTime - b.startTime).map((e) => e.id);
			const kind = pick(["roll", "ripple", "slip", "slide"] as const);
			const at = Math.floor(rnd() * main.length);
			const target: TrimTarget =
				kind === "roll"
					? { kind, trackId: mainId, leftId: main[Math.min(at, main.length - 2)], rightId: main[Math.min(at, main.length - 2) + 1] }
					: kind === "ripple"
						? { kind, trackId: mainId, elementId: main[at], side: pick(["left", "right"] as const) }
						: { kind, trackId: mainId, elementId: main[at] };
			// mostly a few frames, sometimes far past every limit; between frames now and then (the pointer is)
			const frames = rnd() < 0.15 ? Math.round((rnd() - 0.5) * 900) : Math.round((rnd() - 0.5) * 60);
			const result = session.trimOnce(editor, target, frames * F + (rnd() < 0.3 ? Math.round((rnd() - 0.5) * F * 0.8) : 0));
			if (result && result.delta !== 0) {
				made++;
				kinds[kind]++;
			}
			const now = committed(editor);
			const offGrid = [...now.overlay, now.main, ...now.audio].flatMap((track) => track.elements as TimelineElement[]).filter((e) => e.startTime % F !== 0 || (e.startTime + e.duration) % F !== 0).map((e) => e.id);
			const ok = inStep(now) && offGrid.length === 0 && broken(editor).length === 0 && editor.command.depth() === made;
			if (!ok) throw new Error(`trim ${i} broke the film: ${JSON.stringify({ target, frames, inStep: inStep(now), offGrid, broken: broken(editor), depth: editor.command.depth(), made })}`);
		}
		expect(made).toBeGreaterThan(300);
		expect(Math.min(kinds.roll, kinds.ripple, kinds.slip, kinds.slide)).toBeGreaterThan(40);
		for (let i = 0; i < made; i++) editor.command.undo();
		expect([state(editor) === before, editor.command.depth()]).toEqual([true, 0]);
	});

	test("a transition on the cut keeps its place on the cut through a trim, and is shortened by the timeline's rule when a clip gets shorter than it", () => {
		const { editor, mainId } = open();
		const tracks = committed(editor);
		const transition = { id: "tr", type: "studio.transition.whip", fromElementId: "a", toElementId: "b", duration: 20 * F, params: {} };
		editor.scenes.updateSceneTracks({ tracks: { ...tracks, main: { ...tracks.main, transitions: [transition] } } as unknown as SceneTracks });
		const before = state(editor);
		const now = () => ((committed(editor).main as unknown as { transitions?: Array<{ id: string; fromElementId: string; toElementId: string; duration: number }> }).transitions ?? []).map((x) => [x.id, x.fromElementId, x.toElementId, x.duration / F]);
		// rolled, rippled, slipped, slid: still on the cut a|b, as long as it was
		const trims: Array<[TrimTarget, number]> = [
			[{ kind: "roll", trackId: mainId, leftId: "a", rightId: "b" }, 12],
			[{ kind: "ripple", trackId: mainId, elementId: "a", side: "right" }, -30],
			[{ kind: "ripple", trackId: mainId, elementId: "b", side: "left" }, 20],
			[{ kind: "slip", trackId: mainId, elementId: "b" }, 17],
			[{ kind: "slide", trackId: mainId, elementId: "b" }, -15],
		];
		for (const [target, frames] of trims) {
			session.trimOnce(editor, target, frames * F);
			expect([target.kind, now(), broken(editor)]).toEqual([target.kind, [["tr", "a", "b", 20]], []]);
			editor.command.undo();
			expect(state(editor) === before).toBe(true);
		}
		// the cut rolled until b is 8 frames long: the transition is 8 frames too (never longer than either clip)
		session.trimOnce(editor, { kind: "roll", trackId: mainId, leftId: "a", rightId: "b" }, 92 * F);
		expect([at(committed(editor), "b"), now(), broken(editor)]).toEqual([[192, 8, 142], [["tr", "a", "b", 8]], []]);
		// …and until b is one frame: shorter than the shortest transition (0.1 s), it goes — ⌘Z brings it back whole
		session.trimOnce(editor, { kind: "roll", trackId: mainId, leftId: "a", rightId: "b" }, 7 * F);
		expect([at(committed(editor), "b"), now(), broken(editor)]).toEqual([[199, 1, 149], [], []]);
		editor.command.undo();
		editor.command.undo();
		expect([state(editor) === before, now()]).toEqual([true, [["tr", "a", "b", 20]]]);
	});

	test("a trim that changes nothing leaves no undo step; a limit is told, not passed", () => {
		const { editor, mainId } = open();
		const before = state(editor);
		const still = session.TrimSession.start(editor, { kind: "roll", trackId: mainId, leftId: "a", rightId: "b" });
		still?.update(0.4 * F);
		expect([still?.commit(), editor.command.depth(), state(editor) === before]).toEqual([false, 0, true]);
		// b's file has 50 frames before its start: the cut a|b goes 50 earlier, no further
		const far = session.trimOnce(editor, { kind: "roll", trackId: mainId, leftId: "a", rightId: "b" }, -80 * F);
		expect([far?.delta, far?.limit, at(committed(editor), "b"), editor.command.depth()]).toEqual([-50 * F, "media", [50, 150, 0], 1]);
		const more = session.trimOnce(editor, { kind: "roll", trackId: mainId, leftId: "a", rightId: "b" }, -F);
		expect([more?.delta, more?.limit, editor.command.depth()]).toEqual([0, "media", 1]);
		expect(broken(editor)).toEqual([]);
	});

	test("with Linkage off the picture is trimmed alone (the user took the link off)", () => {
		const { editor, mainId } = open({ linkageOn: false });
		session.trimOnce(editor, { kind: "slip", trackId: mainId, elementId: "b" }, 17 * F);
		expect([at(committed(editor), "b"), at(committed(editor), "sb"), at(committed(editor), "x")]).toEqual([[100, 100, 33], [100, 100, 50], [120, 40, 0]]);
	});

	test("an edit that lands during the drag stays: the trim is made on the timeline as it is at the release", () => {
		const { editor, mainId } = open();
		const trim = session.TrimSession.start(editor, { kind: "roll", trackId: mainId, leftId: "b", rightId: "c" });
		trim?.update(10 * F);
		// a job renames the title meanwhile
		const tracks = committed(editor);
		editor.scenes.updateSceneTracks({ tracks: { ...tracks, overlay: tracks.overlay.map((track) => ({ ...track, elements: track.elements.map((e) => ({ ...e, name: "renamed" })) })) } as SceneTracks });
		expect(trim?.commit()).toBe(true);
		expect([find(committed(editor), "x").name, at(committed(editor), "b"), at(committed(editor), "c")]).toEqual(["renamed", [100, 110, 50], [210, 90, 30]]);
		editor.command.undo();
		expect([find(committed(editor), "x").name, at(committed(editor), "c")]).toEqual(["renamed", [200, 100, 20]]);
	});
});
