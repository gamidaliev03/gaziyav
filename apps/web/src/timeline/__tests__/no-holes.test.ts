// tlmove (14.11): blind3's steps for the rules «the film never gets a hole it was not asked for», on the editor core in
// bun — the same entry points the timeline calls. A 20-min talk cut every 30 s (40 clips, 25 fps), the magnet on.
import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

let core: typeof import("@/core");
let wasm: typeof import("@/wasm");
let inv: typeof import("@/timeline/invariants");
let move: typeof import("@/timeline/group-move");
let edit: typeof import("@/actions/tracks-edit-command");
let gaps: typeof import("@/timeline/gaps");
let lock: typeof import("@/timeline/track-lock");
let pack: typeof import("@/timeline/placement/main-track");
let snapshot: typeof import("@/commands/timeline/tracks-snapshot");
let bookmark: typeof import("@/commands/scene/toggle-bookmark");

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	wasm = await import("@/wasm");
	inv = await import("@/timeline/invariants");
	move = await import("@/timeline/group-move");
	edit = await import("@/actions/tracks-edit-command");
	gaps = await import("@/timeline/gaps");
	lock = await import("@/timeline/track-lock");
	pack = await import("@/timeline/placement/main-track");
	snapshot = await import("@/commands/timeline/tracks-snapshot");
	bookmark = await import("@/commands/scene/toggle-bookmark");
	const storage = await import("@/services/storage/service");
	(storage.storageService as unknown as Record<string, unknown>).saveProject = async () => {};
}, 120_000);

const FPS = { numerator: 25, denominator: 1 };
const frame = () => wasm.TICKS_PER_SECOND / 25;
const f = (n: number) => wasm.mediaTime({ ticks: Math.round(n * frame()) });
type El = import("@/timeline").TimelineElement;

/** The talk: 40 clips of 750 frames (30 s) of one 20-min file, back to back on the main track; the magnet on. */
function talk() {
	const { EditorCore } = core;
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const { buildDefaultScene } = require("@/timeline/scenes") as typeof import("@/timeline/scenes");
	const scene = buildDefaultScene({ name: "Main", isMain: true });
	const main = scene.tracks.main;
	const clips = Array.from({ length: 40 }, (_, i) => ({
		id: `c${i}`,
		type: "video",
		name: `talk ${i}`,
		mediaId: "talk",
		startTime: f(i * 750),
		duration: f(750),
		trimStart: f(i * 750),
		trimEnd: f((39 - i) * 750),
		sourceDuration: f(30000),
		params: {},
	}));
	const withTalk = { ...scene, tracks: { ...scene.tracks, main: { ...main, elements: clips } } } as typeof scene;
	editor.project.setActiveProject({
		project: {
			metadata: { id: "nh", name: "nh", createdAt: new Date(0), updatedAt: new Date(0) },
			scenes: [withTalk],
			currentSceneId: withTalk.id,
			settings: { fps: FPS, canvasSize: { width: 480, height: 270 }, background: { type: "color", color: "#000000" } },
			version: 1,
		} as unknown as import("@/project/types").TProject,
	});
	editor.scenes.setScenes({ scenes: [withTalk], activeSceneId: withTalk.id });
	(editor.media as unknown as { getAssets: () => unknown[] }).getAssets = () => [{ id: "talk", type: "video", hasAudio: true, name: "talk" }];
	editor.command.isRippleEnabled = true;
	return editor;
}
type Editor = ReturnType<typeof talk>;
const tracks = (editor: Editor) => editor.scenes.getActiveScene().tracks;
const row = (editor: Editor) => [...(tracks(editor).main.elements as El[])].sort((a, b) => a.startTime - b.startTime);
const frames = (ticks: number) => Math.round(ticks / frame());
const total = (editor: Editor) => frames(Math.max(...row(editor).map((e) => e.startTime + e.duration)));
const broken = (editor: Editor) => inv.checkTimelineInvariants({ tracks: tracks(editor), magnet: editor.command.isRippleEnabled }).map((v) => `${v.rule}: ${v.detail}`);
const key = (editor: Editor) => inv.timelineStateKey(editor.scenes.getActiveScene());
/** The source frame the film shows at a timeline frame (one video file: the talk). */
const shownAt = (editor: Editor, at: number) => {
	const clip = row(editor).find((e) => frames(e.startTime) <= at && at < frames(e.startTime + e.duration));
	return clip && clip.type === "video" ? frames(clip.trimStart) + at - frames(clip.startTime) : null;
};

describe("rule 1 — a non-contiguous selection dragged on the magnetic row lands as one block (blind3 F1)", () => {
	test("clip 10, ⇧ clip 12, ⌘ clip 15 dropped over clip 30: no black frame, order exact, total 30000 frames, one ⌘Z", () => {
		const editor = talk();
		const k0 = key(editor);
		const before = tracks(editor);
		const plan = move.planMainTrackReorder({ elements: before.main.elements as El[], movingIds: new Set(["c10", "c11", "c12", "c15"]), pointerTime: f(30 * 750 + 600) });
		expect(plan).not.toBeNull();
		editor.command.execute({
			command: new edit.TracksEditCommand({ before, after: { ...before, main: { ...before.main, elements: plan?.elements ?? [] } as typeof before.main }, selection: [], noEngineRipple: true }),
		});
		expect(broken(editor)).toEqual([]);
		expect(total(editor)).toBe(30000);
		for (let at = 0; at < 30000; at++) expect(shownAt(editor, at) === null).toBe(false);
		const order = row(editor).map((e) => e.id);
		expect(order.slice(26, 31)).toEqual(["c30", "c10", "c11", "c12", "c15"]);
		expect(row(editor).map((e) => frames(e.startTime))).toEqual(Array.from({ length: 40 }, (_, i) => i * 750));
		editor.command.undo();
		expect(key(editor)).toBe(k0);
	});
});

describe("rule 2 — the magnet back on closes the gaps as ONE step (blind3 F5)", () => {
	test("P off, lift 50 frames, P on: 1 gap closed, total −50 frames; one ⌘Z brings the gap back and the magnet off", () => {
		const editor = talk();
		editor.command.isRippleEnabled = false;
		gaps.liftOrExtractRange({ editor, range: { start: f(5000), end: f(5050) }, closeGap: false });
		expect(gaps.mainHoles(tracks(editor).main)).toEqual([{ start: f(5000), end: f(5050) }]);
		const withGap = key(editor);
		// as EditorRuntimeBindings switches it on: MagnetOnCommand (the count is the toast «Закрыто промежутков: N»)
		const t0 = tracks(editor);
		expect(gaps.mainHoles(t0.main).length).toBe(1);
		const packed = pack.packMainTrack({ tracks: t0 });
		class MagnetOn extends snapshot.TracksSnapshotCommand {
			execute() {
				editor.command.isRippleEnabled = true;
				return super.execute();
			}
			undo() {
				super.undo();
				editor.command.isRippleEnabled = false;
			}
		}
		const depth = editor.command.depth();
		editor.command.execute({ command: new MagnetOn({ before: t0, after: packed }) });
		expect(editor.command.depth()).toBe(depth + 1);
		expect(broken(editor)).toEqual([]);
		expect(total(editor)).toBe(29950);
		editor.command.undo();
		expect(key(editor)).toBe(withGap);
		expect(editor.command.isRippleEnabled).toBe(false);
	});
});

describe("rule 3 — lift on the magnetic row leaves a gap clip of the same length (blind3 F6)", () => {
	test("I/O over 50 frames, `;`: the film keeps its length, the 50 frames are a gap clip, no hole; one ⌘Z", () => {
		const editor = talk();
		const k0 = key(editor);
		gaps.liftOrExtractRange({ editor, range: { start: f(5000), end: f(5050) }, closeGap: false });
		expect(broken(editor)).toEqual([]);
		expect(total(editor)).toBe(30000);
		const gap = row(editor).find((e) => gaps.isGapClip(e as never)) as El;
		expect([frames(gap.startTime), frames(gap.duration)]).toEqual([5000, 50]);
		expect((gap as { hidden?: boolean }).hidden).toBe(true);
		expect(shownAt(editor, 4999)).toBe(4999);
		expect(shownAt(editor, 5050)).toBe(5050);
		expect(editor.command.depth()).toBe(1);
		editor.command.undo();
		expect(key(editor)).toBe(k0);
	});
	test("`'` extract closes the row: −50 frames, no gap clip", () => {
		const editor = talk();
		gaps.liftOrExtractRange({ editor, range: { start: f(5000), end: f(5050) }, closeGap: true });
		expect(broken(editor)).toEqual([]);
		expect(total(editor)).toBe(29950);
		expect(row(editor).some((e) => gaps.isGapClip(e as never))).toBe(false);
		expect(shownAt(editor, 5000)).toBe(5050);
	});
});

describe("rule 4 — markers ride with the film (blind3 F4)", () => {
	test("M at 00:03:20:00 over talk frame 5000; ripple-delete a clip before it: the marker still marks frame 5000; ⌘Z restores", () => {
		const editor = talk();
		editor.command.execute({ command: new bookmark.ToggleBookmarkCommand(f(5000)) });
		editor.command.execute({ command: new bookmark.ToggleBookmarkCommand(f(1600)) }); // inside the clip that goes
		const k0 = key(editor);
		const main = tracks(editor).main;
		editor.timeline.deleteElements({ elements: [{ trackId: main.id, elementId: "c2" }] });
		const marks = editor.scenes.getActiveScene().bookmarks.map((b) => frames(b.time));
		expect(marks).toEqual([1500, 4250]); // the one inside goes to the cut; the other moves −750
		expect(shownAt(editor, 4250)).toBe(5000);
		editor.command.undo();
		expect(key(editor)).toBe(k0);
		editor.command.redo();
		expect(editor.scenes.getActiveScene().bookmarks.map((b) => frames(b.time))).toEqual([1500, 4250]);
	});
	test("a group dragged on the row takes its markers along; one after the drop place moves with the row", () => {
		const editor = talk();
		editor.command.execute({ command: new bookmark.ToggleBookmarkCommand(f(10 * 750 + 100)) });
		const before = tracks(editor);
		const plan = move.planMainTrackReorder({ elements: before.main.elements as El[], movingIds: new Set(["c10", "c15"]), pointerTime: f(30 * 750 + 600) });
		editor.command.execute({ command: new edit.TracksEditCommand({ before, after: { ...before, main: { ...before.main, elements: plan?.elements ?? [] } as typeof before.main }, noEngineRipple: true }) });
		const at = frames(editor.scenes.getActiveScene().bookmarks[0].time);
		expect(shownAt(editor, at)).toBe(10 * 750 + 100);
	});
});

describe("rule 5 — detach, move, restore: one sound (blind3 F3)", () => {
	test("⌃⇧S, the sound moved 25 frames, ⌃⇧S again: the detached piece is gone, the clip plays its own sound; ⌘Z", () => {
		const editor = talk();
		const main = tracks(editor).main;
		editor.timeline.toggleSourceAudioSeparation({ trackId: main.id, elementId: "c3" });
		const sound = tracks(editor).audio.flatMap((t) => t.elements.map((e) => ({ t, e })))[0];
		expect(sound).toBeDefined();
		editor.timeline.moveElements({ moves: [{ sourceTrackId: sound.t.id, targetTrackId: sound.t.id, elementId: sound.e.id, newStartTime: wasm.mediaTime({ ticks: sound.e.startTime + f(25) }) }] } as never);
		const k1 = key(editor);
		editor.timeline.toggleSourceAudioSeparation({ trackId: main.id, elementId: "c3" });
		expect(tracks(editor).audio.flatMap((t) => t.elements).length).toBe(0);
		expect((row(editor).find((e) => e.id === "c3") as { isSourceAudioEnabled?: boolean }).isSourceAudioEnabled).toBe(true);
		expect(broken(editor)).toEqual([]);
		editor.command.undo();
		expect(key(editor)).toBe(k1);
	});
	test("the invariant: a clip's own sound and its detached copy both heard is a violation", () => {
		const editor = talk();
		const main = tracks(editor).main;
		editor.timeline.toggleSourceAudioSeparation({ trackId: main.id, elementId: "c3" });
		const t = tracks(editor);
		const doubled = { ...t, main: { ...t.main, elements: t.main.elements.map((e) => (e.id === "c3" ? { ...e, isSourceAudioEnabled: true } : e)) } } as typeof t;
		expect(inv.checkTimelineInvariants({ tracks: doubled, magnet: true }).map((v) => v.rule)).toContain("one-sound");
	});
});

describe("rule 7 — a ripple never moves a locked track, and says how many stayed behind", () => {
	test("V2 cutaway over clip 20, V2 locked, ripple-delete clip 5 with Linkage on: the cutaway stays, the note says 1", () => {
		const editor = talk();
		editor.command.linkage = { enabled: true, kinds: ["overlay", "audio", "text", "sticker", "effect"] };
		const t = tracks(editor);
		const cut = { id: "v2a", type: "video", name: "cutaway", mediaId: "cut", startTime: f(20 * 750 + 100), duration: f(150), trimStart: 0, trimEnd: 0, sourceDuration: f(150), params: {} };
		const v2 = { id: "v2", name: "V2", type: "video", elements: [cut], muted: false, hidden: false };
		editor.command.execute({ command: new edit.TracksEditCommand({ before: t, after: { ...t, overlay: [v2 as never, ...t.overlay] }, noEngineRipple: true }) });
		// unlocked: the cutaway follows its clip (Linkage)
		const probe = tracks(editor);
		editor.timeline.deleteElements({ elements: [{ trackId: probe.main.id, elementId: "c5" }] });
		expect(frames((tracks(editor).overlay[0].elements[0] as El).startTime)).toBe(20 * 750 + 100 - 750);
		editor.command.undo();
		lock.toggleTrackLock(editor as never, "v2");
		let note = 0;
		const off = editor.command.onLockedLeftBehind((n) => {
			note = n;
		});
		editor.timeline.deleteElements({ elements: [{ trackId: probe.main.id, elementId: "c5" }] });
		off();
		expect(frames((tracks(editor).overlay[0].elements[0] as El).startTime)).toBe(20 * 750 + 100);
		expect(total(editor)).toBe(29250);
		expect(note).toBe(1);
	});
});
