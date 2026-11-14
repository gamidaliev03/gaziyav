// The timeline engine's invariants without the app (tlfix B, the start of stage 3, docs/TIMELINE.md): random command
// sequences through the editor's own entry points — the ones the timeline, the inspector and the keys call — and
// after EVERY step: no two clips of a track overlap, every clip inside its source, the magnetic main track without a
// gap, unique ids, the selection only on what is there (timeline/invariants.ts); every step that made an undo step
// gives the state before it back on ⌘Z and itself again on ⇧⌘Z, byte for byte.
// The first case is the shape of timeline-fuzz.mjs seed 71420 step 47: a speed made slower with the magnet off covered
// the next clip of its track.
// Covered: insert, split, delete, a move as the mouse drag plans it (resolveGroupMove), the keyboard edge trim
// (trimEdgeByFrames: the mouse trim's limits), a typed speed (updateElementRetime) and a dragged one (previewed, then committed as the slider does),
// the magnet on/off, ⌘Z / ⇧⌘Z. Not pure, so not here: the drag gestures themselves (pointer → plan: the controllers
// read the DOM), the main track's reorder by drag, transitions, compound clips, linkage with detached sound.
// FUZZ_SEEDS=n FUZZ_STEPS=m widen the run (default 40 seeds × 120 steps).
import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

let core: typeof import("@/core");
let elements: typeof import("@/timeline/element-utils");
let wasm: typeof import("@/wasm");
let inv: typeof import("@/timeline/invariants");
let trim: typeof import("@/actions/keyboard-trim");
let move: typeof import("@/timeline/group-move");
let pack: typeof import("@/timeline/placement/main-track");
let snapshot: typeof import("@/commands/timeline/tracks-snapshot");
let edit: typeof import("@/actions/tracks-edit-command");
let gaps: typeof import("@/timeline/gaps");
let lock: typeof import("@/timeline/track-lock");
/** How often each operation ran in this process (tlmove 14.11: the report names the group moves and magnet toggles). */
export const FUZZ_COUNTS: Record<string, number> = {};

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	elements = await import("@/timeline/element-utils");
	wasm = await import("@/wasm");
	inv = await import("@/timeline/invariants");
	trim = await import("@/actions/keyboard-trim");
	move = await import("@/timeline/group-move");
	pack = await import("@/timeline/placement/main-track");
	snapshot = await import("@/commands/timeline/tracks-snapshot");
	edit = await import("@/actions/tracks-edit-command");
	gaps = await import("@/timeline/gaps");
	lock = await import("@/timeline/track-lock");
	const storage = await import("@/services/storage/service");
	(storage.storageService as unknown as Record<string, unknown>).saveProject = async () => {};
});

const FPS = { numerator: 30, denominator: 1 };
const sec = (s: number) => wasm.mediaTime({ ticks: Math.round(s * wasm.TICKS_PER_SECOND) });
const onFrame = (s: number) => sec(Math.round(s * 30) / 30);

/** mulberry32, as timeline-fuzz.mjs: the same seed, the same run. */
function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function setup() {
	const { EditorCore } = core;
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const { buildDefaultScene } = require("@/timeline/scenes") as typeof import("@/timeline/scenes");
	const scene = buildDefaultScene({ name: "Main", isMain: true });
	editor.project.setActiveProject({
		project: {
			metadata: { id: "fz", name: "fz", createdAt: new Date(0), updatedAt: new Date(0) },
			scenes: [scene],
			currentSceneId: scene.id,
			settings: { fps: FPS, canvasSize: { width: 1080, height: 1920 }, background: { type: "color", color: "#000000" } },
			version: 1,
		} as unknown as import("@/project/types").TProject,
	});
	editor.scenes.setScenes({ scenes: [scene], activeSceneId: scene.id });
	editor.command.isRippleEnabled = false;
	// every clip's file has sound (detach / restore need it); the assets are what the tracks use
	(editor.media as unknown as { getAssets: () => unknown[] }).getAssets = () => {
		const t = editor.scenes.getActiveSceneOrNull()?.tracks;
		const ids = new Set(t ? [...t.overlay, t.main, ...t.audio].flatMap((track) => (track.elements as Array<{ mediaId?: string }>).flatMap((e) => (e.mediaId ? [e.mediaId] : []))) : []);
		return [...ids].map((id) => ({ id, type: "video", hasAudio: true, name: id }));
	};
	return editor;
}
type Editor = ReturnType<typeof setup>;
type El = import("@/timeline").TimelineElement;
type Track = import("@/timeline").TimelineTrack;

const tracksOf = (editor: Editor): Track[] => {
	const t = editor.scenes.getActiveScene().tracks;
	return [...t.overlay, t.main, ...t.audio] as Track[];
};
// what a hand can pick: clips of tracks that are not locked (the timeline lets nothing else be selected)
const clips = (editor: Editor) => tracksOf(editor).filter((track) => track.locked !== true).flatMap((track) => (track.elements as El[]).map((element) => ({ track, element })));
const stateKey = (editor: Editor) => inv.timelineStateKey(editor.scenes.getActiveScene());

type Lane = "main" | "overlay" | "audio";
/** The lane's first track, if there is one (empty tracks go: a lane may have none). */
function laneTrack(editor: Editor, lane: Lane): Track | undefined {
	const t = editor.scenes.getActiveScene().tracks;
	return (lane === "main" ? t.main : lane === "overlay" ? t.overlay[0] : t.audio[0]) as Track | undefined;
}

/** A clip of a 10 s file, `from` seconds in, `length` long, at `start` on the lane's track (a new one when it has none). */
function insertClip(editor: Editor, lane: Lane, start: number, from: number, length: number, name = "clip", asDrop = false) {
	const kind = lane === "audio" ? "audio" : "video";
	const element = elements.buildElementFromMedia({ mediaId: `m-${name}`, mediaType: kind, name, duration: onFrame(length), startTime: onFrame(start) });
	const source = sec(10);
	const trimStart = onFrame(from);
	const trimEnd = wasm.mediaTime({ ticks: Math.max(0, source - trimStart - onFrame(length)) });
	const found = laneTrack(editor, lane);
	// a locked track takes nothing (the timeline's drop and insert skip it): a new track of the kind then
	const track = found?.locked === true ? undefined : found;
	// at the track's end exactly (a clip may end between frames: a speed, a file's own length)
	if (!asDrop && track) element.startTime = wasm.mediaTime({ ticks: Math.max(0, ...(track.elements as El[]).filter((e) => e.startTime < onFrame(start) + 1).map((e) => e.startTime + e.duration), onFrame(start)) });
	editor.timeline.insertElement({
		element: { ...element, sourceDuration: source, trimStart, trimEnd } as never,
		// a drop names the track under the pointer and lets the command find room (insert-element.ts placementForDrop)
		placement: (asDrop && track ? { mode: "auto", trackType: kind, preferTrackId: track.id } : track ? { mode: "explicit", trackId: track.id } : { mode: "auto", trackType: kind, newTrack: true }) as never,
	});
}

function check(editor: Editor, where: string): string[] {
	const tracks = editor.scenes.getActiveScene().tracks;
	return inv
		.checkTimelineInvariants({ tracks, magnet: editor.command.isRippleEnabled, selection: editor.selection.getSnapshot?.() ?? undefined })
		.map((v) => `${where}: ${v.rule} — ${v.detail}`);
}

type Op = { name: string; run: (editor: Editor, r: () => number) => string | null };
const pick = <T,>(r: () => number, list: readonly T[]): T | undefined => list[Math.floor(r() * list.length)];

const OPS: Op[] = [
	{
		name: "insert",
		run: (editor, r) => {
			const lane = pick(r, ["main", "overlay", "audio"] as const) as Lane;
			const track = laneTrack(editor, lane);
			const end = Math.max(0, ...((track?.elements ?? []) as El[]).map((e) => (e.startTime + e.duration) / wasm.TICKS_PER_SECOND));
			// at the track's end or into a gap/clip: the command decides what an occupied place means
			const atEnd = r() < 0.6;
			const start = atEnd ? end : r() * end;
			insertClip(editor, lane, start, r() * 4, 0.5 + r() * 4, "clip", !atEnd);
			return `${atEnd ? "insert" : "drop"} on ${lane} at ${start.toFixed(2)}`;
		},
	},
	{
		name: "split",
		run: (editor, r) => {
			const c = pick(r, clips(editor));
			if (!c || c.element.duration < sec(0.2)) return null;
			const at = onFrame((c.element.startTime + c.element.duration * (0.2 + 0.6 * r())) / wasm.TICKS_PER_SECOND);
			editor.timeline.splitElements({ elements: [{ trackId: c.track.id, elementId: c.element.id }], splitTime: at });
			return `split ${c.element.id.slice(0, 6)}`;
		},
	},
	{
		name: "delete",
		run: (editor, r) => {
			const c = pick(r, clips(editor));
			if (!c) return null;
			editor.timeline.deleteElements({ elements: [{ trackId: c.track.id, elementId: c.element.id }] });
			return `delete ${c.element.id.slice(0, 6)}`;
		},
	},
	{
		name: "move",
		run: (editor, r) => {
			const c = pick(r, clips(editor));
			if (!c) return null;
			const tracks = editor.scenes.getActiveScene().tracks;
			const ref = { trackId: c.track.id, elementId: c.element.id };
			const group = move.buildMoveGroup({ anchorRef: ref, selectedElements: [ref], tracks });
			if (!group) return null;
			const to = Math.max(0, c.element.startTime / wasm.TICKS_PER_SECOND + (r() - 0.5) * 6);
			const plan = move.resolveGroupMove({
				group,
				tracks,
				anchorStartTime: onFrame(to),
				target: { kind: "existingTrack", anchorTargetTrackId: c.track.id, insertIndex: 0 },
				newTrackIds: [crypto.randomUUID()],
			});
			if (!plan || plan.moves.length === 0) return null;
			editor.timeline.moveElements({ moves: plan.moves, createTracks: plan.createTracks });
			return `move ${c.element.id.slice(0, 6)} to ${to.toFixed(2)}`;
		},
	},
	{
		name: "trim",
		run: (editor, r) => {
			const c = pick(r, clips(editor));
			if (!c) return null;
			const side = r() < 0.5 ? "left" : "right";
			const frames = Math.round((r() - 0.4) * 40);
			const tracks = editor.scenes.getActiveScene().tracks;
			const updates = trim.trimEdgeByFrames({
				tracks,
				selection: [{ trackId: c.track.id, elementId: c.element.id }],
				side,
				frames,
				fps: FPS,
				rippleTrackId: editor.command.isRippleEnabled ? tracks.main.id : null,
			});
			if (!updates) return null;
			editor.timeline.updateElements({ updates: updates.map((u) => ({ trackId: u.trackId, elementId: u.elementId, patch: u.patch as never })) });
			return `trim ${side} ${frames}f ${c.element.id.slice(0, 6)}`;
		},
	},
	{
		name: "speed",
		run: (editor, r) => {
			const c = pick(r, clips(editor).filter((x) => x.element.type === "video" || x.element.type === "audio"));
			if (!c) return null;
			const rate = Math.round((0.25 + r() * 2.75) * 100) / 100;
			const retime = { rate, maintainPitch: false, mode: "constant" } as never;
			if (r() < 0.5) {
				editor.timeline.updateElementRetime({ trackId: c.track.id, elementId: c.element.id, retime });
				return `speed ${rate}× ${c.element.id.slice(0, 6)}`;
			}
			// the inspector's slider: previewed while dragged, committed on release as a typed speed (speed-tab.tsx)
			editor.timeline.previewElements({ updates: [{ trackId: c.track.id, elementId: c.element.id, updates: { retime } as never }] });
			editor.timeline.updateElementRetime({ trackId: c.track.id, elementId: c.element.id, retime });
			return `speed (dragged) ${rate}× ${c.element.id.slice(0, 6)}`;
		},
	},
	{
		name: "magnet",
		run: (editor) => {
			if (editor.command.isRippleEnabled) {
				editor.command.isRippleEnabled = false;
				return "magnet off";
			}
			// as the editor's provider does it (MagnetOnCommand in components/providers/editor-provider.tsx, a React
			// effect — not importable here): on over gaps is one step that packs the main track; ⌘Z switches it off again
			const tracks = editor.scenes.getActiveScene().tracks;
			const packed = pack.packMainTrack({ tracks });
			if (packed === tracks) {
				editor.command.isRippleEnabled = true;
				return "magnet on";
			}
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
			editor.command.execute({ command: new MagnetOn({ before: tracks, after: packed }) });
			return "magnet on (packed)";
		},
	},
	{
		// a selection of several clips dragged together (blind3 F1): on the magnetic main row as the drag plans and
		// commits it (planMainTrackReorder → TracksEditCommand, use-element-interaction.ts magnet.commit), elsewhere as
		// resolveGroupMove plans a group; clicked clips need not touch each other
		name: "group",
		run: (editor, r) => {
			const tracks = editor.scenes.getActiveScene().tracks;
			const main = tracks.main as Track;
			if (editor.command.isRippleEnabled && main.locked !== true && main.elements.length >= 3) {
				const row = [...(main.elements as El[])].sort((a, b) => a.startTime - b.startTime);
				const picks = new Set<string>();
				const want = 2 + Math.floor(r() * 3);
				for (let k = 0; k < want; k++) picks.add((pick(r, row) as El).id);
				const end = Math.max(...row.map((e) => e.startTime + e.duration));
				const copy = r() < 0.2;
				const plan = move.planMainTrackReorder({
					elements: row,
					movingIds: picks,
					pointerTime: Math.floor(r() * (end + sec(1))),
					copyIds: copy ? new Map([...picks].map((id) => [id, crypto.randomUUID()])) : undefined,
				});
				if (!plan || plan.isNoop) return null;
				editor.command.execute({
					command: new edit.TracksEditCommand({
						before: tracks,
						after: { ...tracks, main: { ...tracks.main, elements: plan.elements } as typeof tracks.main },
						selection: plan.insertedIds.map((elementId) => ({ trackId: main.id, elementId })),
						noEngineRipple: true,
					}),
				});
				return `group ${copy ? "⌥copy " : ""}${picks.size} main clips to ${plan.insertIndex}`;
			}
			const all = clips(editor);
			const anchor = pick(r, all);
			if (!anchor) return null;
			const mates = all.filter((c) => c.track.id === anchor.track.id && c.element.id !== anchor.element.id && r() < 0.4);
			const refs = [anchor, ...mates].map((c) => ({ trackId: c.track.id, elementId: c.element.id }));
			const group = move.buildMoveGroup({ anchorRef: refs[0], selectedElements: refs, tracks });
			if (!group) return null;
			const to = Math.max(0, anchor.element.startTime / wasm.TICKS_PER_SECOND + (r() - 0.5) * 6);
			const plan = move.resolveGroupMove({
				group,
				tracks,
				anchorStartTime: onFrame(to),
				target: { kind: "existingTrack", anchorTargetTrackId: anchor.track.id, insertIndex: 0 },
				newTrackIds: group.members.map(() => crypto.randomUUID()),
			});
			if (!plan || plan.moves.length === 0) return null;
			editor.timeline.moveElements({ moves: plan.moves, createTracks: plan.createTracks });
			return `group ${refs.length} clips to ${to.toFixed(2)}`;
		},
	},
	{
		// I / O and Lift (;) or Extract (') — lift on the magnetic row leaves a gap clip (blind3 F6)
		name: "lift",
		run: (editor, r) => {
			const total = editor.timeline.getTotalDuration();
			if (total <= sec(0.2)) return null;
			const a = onFrame((r() * total) / wasm.TICKS_PER_SECOND);
			const b = onFrame(Math.min(total, a + sec(0.1) + r() * sec(3)) / wasm.TICKS_PER_SECOND);
			if (b <= a) return null;
			const closeGap = r() < 0.5;
			gaps.liftOrExtractRange({ editor, range: { start: a, end: b }, closeGap });
			return `${closeGap ? "extract" : "lift"} ${(a / wasm.TICKS_PER_SECOND).toFixed(2)}–${(b / wasm.TICKS_PER_SECOND).toFixed(2)}`;
		},
	},
	{
		name: "marker",
		run: (editor, r) => {
			const total = editor.timeline.getTotalDuration();
			const at = onFrame((r() * Math.max(total, sec(1))) / wasm.TICKS_PER_SECOND);
			editor.command.execute({ command: new (require("@/commands/scene/toggle-bookmark") as typeof import("@/commands/scene/toggle-bookmark")).ToggleBookmarkCommand(at) });
			return `marker at ${(at / wasm.TICKS_PER_SECOND).toFixed(2)}`;
		},
	},
	{
		// ⌃⇧S on a clip: detach its sound, or restore it (blind3 F3: one sound per clip, whatever moved since)
		name: "detach",
		run: (editor, r) => {
			const c = pick(r, clips(editor).filter((x) => x.element.type === "video"));
			if (!c) return null;
			editor.timeline.toggleSourceAudioSeparation({ trackId: c.track.id, elementId: c.element.id });
			return `detach/restore ${c.element.id.slice(0, 6)}`;
		},
	},
	{
		// a song fitted to the film (library/client.ts cutToVideoEnd, place rule D): it follows the film's end after every
		// step, and ⌘Z gives it back exactly (undofix 14.11: lift / extract / ripple over a fitted song)
		name: "song",
		run: (editor, r) => {
			const t = editor.scenes.getActiveScene().tracks;
			let end = 0;
			for (const track of [t.main, ...t.overlay]) for (const e of track.elements as El[]) end = Math.max(end, e.startTime + e.duration);
			const start = onFrame(r() * 0.5);
			if (end <= start + sec(0.2)) return null;
			const length = wasm.mediaTime({ ticks: Math.min(end - start, sec(20)) });
			const element = elements.buildElementFromMedia({ mediaId: "m-song", mediaType: "audio", name: "song", duration: length, startTime: start });
			const source = sec(20);
			editor.timeline.insertElement({
				element: { ...element, sourceDuration: source, trimStart: 0, trimEnd: wasm.mediaTime({ ticks: source - length }), params: { ...(element as { params?: object }).params, fadeOut: 1, fitFilm: true } } as never,
				placement: { mode: "auto", trackType: "audio", newTrack: true } as never,
			});
			return `song fitted ${(start / wasm.TICKS_PER_SECOND).toFixed(2)}–${(end / wasm.TICKS_PER_SECOND).toFixed(2)}`;
		},
	},
	{
		name: "lock",
		run: (editor, r) => {
			const t = editor.scenes.getActiveScene().tracks;
			const track = pick(r, [...t.overlay, ...t.audio] as Track[]);
			if (!track) return null;
			lock.toggleTrackLock(editor as never, track.id);
			return `lock/unlock ${track.id.slice(0, 6)}`;
		},
	},
];

/** The frames under the markers that sit over main clips: (clip, media, source tick) — a marker rides with its frame. */
type Marked = { clip: string; media: string; source: number; rate: number };
const rateOfClip = (clip: El): number => ("reversed" in clip && clip.reversed ? Number.NaN : "retime" in clip && clip.retime ? (clip.retime.mode === "curve" ? Number.NaN : clip.retime.rate) : 1);
function markedFrames(editor: Editor): Marked[] {
	const scene = editor.scenes.getActiveScene();
	const main = scene.tracks.main.elements as El[];
	return (scene.bookmarks ?? []).flatMap((b) => {
		const clip = main.find((e) => e.startTime <= b.time && b.time < e.startTime + e.duration);
		if (!clip || !("mediaId" in clip)) return [];
		const rate = rateOfClip(clip);
		if (!Number.isFinite(rate)) return [];
		return [{ clip: clip.id, media: clip.mediaId as string, source: clip.trimStart + (b.time - clip.startTime) * rate, rate }];
	});
}
/** The clips that show this frame now: the marker's own clip, or a piece new in this step (a split) of its media. */
function shownBy(editor: Editor, frame: Marked, knownBefore: ReadonlySet<string>): Set<string> {
	const out = new Set<string>();
	for (const e of editor.scenes.getActiveScene().tracks.main.elements as El[]) {
		if (!("mediaId" in e) || e.mediaId !== frame.media || (e.id !== frame.clip && knownBefore.has(e.id))) continue;
		const rate = rateOfClip(e);
		if (!Number.isFinite(rate)) continue;
		if (frame.source >= e.trimStart && frame.source < e.trimStart + e.duration * rate) out.add(e.id);
	}
	return out;
}
const WEIGHTS: Record<string, number> = { insert: 5, split: 3, delete: 2, move: 4, trim: 4, speed: 4, magnet: 2, group: 4, lift: 2, marker: 2, detach: 2, lock: 1, song: 1, undo: 2, redo: 1 };
const BAG = Object.entries(WEIGHTS).flatMap(([name, w]) => Array(w).fill(name) as string[]);


/** Runs one seed; returns the first broken rule with the steps that led to it, or null. */
function runSeed(seed: number, steps: number): string | null {
	const editor = setup();
	const r = rng(seed);
	const log: string[] = [];
	// the magnet each history step leaves behind (O1: ⌘Z / ⇧⌘Z bring the magnet of their state back with it)
	const madeWith: Array<{ before: boolean; after: boolean }> = [];
	let redoWith: Array<{ before: boolean; after: boolean }> = [];
	for (let i = 0; i < steps; i++) {
		const name = pick(r, BAG) as string;
		if (name === "undo" || name === "redo") {
			const d0 = editor.command.depth();
			if (name === "undo") editor.command.undo();
			else editor.command.redo();
			const moved = editor.command.depth() !== d0;
			const entry = moved ? (name === "undo" ? madeWith.pop() : redoWith.pop()) : undefined;
			if (moved && entry !== undefined) (name === "undo" ? redoWith : madeWith).push(entry);
			log.push(name);
			// O1 (docs/TIMELINE.md): the magnet comes back with the state — before the step on ⌘Z, after it on ⇧⌘Z
			const want = entry ? (name === "undo" ? entry.before : entry.after) : undefined;
			if (want !== undefined && editor.command.isRippleEnabled !== want) return [`seed ${seed} step ${i} ${name}: the magnet is ${editor.command.isRippleEnabled ? "on" : "off"}, its state had it ${want ? "on" : "off"}`, ...log.slice(-12)].join("\n");
			const bad = check(editor, `step ${i} ${name}`);
			if (bad.length) return [`seed ${seed}`, ...bad, ...log.slice(-12)].join("\n");
			continue;
		}
		const op = OPS.find((o) => o.name === name) as Op;
		const k0 = stateKey(editor);
		const m0 = editor.command.isRippleEnabled;
		const d0 = editor.command.depth();
		const dump = process.env.FUZZ_DEBUG === String(seed) ? JSON.stringify(tracksOf(editor).map((t) => [t.id.slice(0, 6), (t.elements as El[]).map((e) => [e.id.slice(0, 6), e.startTime, e.duration, e.trimStart, e.trimEnd])])) : "";
		const framesBefore = markedFrames(editor);
		const mainBefore = new Set((editor.scenes.getActiveScene().tracks.main.elements as El[]).map((e) => e.id));
		const markersBefore = (editor.scenes.getActiveScene().bookmarks ?? []).length;
		const lockedBefore = new Map(tracksOf(editor).filter((t) => t.locked === true).map((t) => [t.id, JSON.stringify(t.elements)]));
		const what = op.run(editor, r);
		if (!what) continue;
		FUZZ_COUNTS[name] = (FUZZ_COUNTS[name] ?? 0) + 1;
		if (name === "magnet") FUZZ_COUNTS[what] = (FUZZ_COUNTS[what] ?? 0) + 1;
		// markers ride with the film: none lost but by its own key, each frame still shown is still under a marker
		if (name !== "marker") {
			if ((editor.scenes.getActiveScene().bookmarks ?? []).length !== markersBefore) return [`seed ${seed} step ${i} ${what}: markers ${markersBefore} → ${(editor.scenes.getActiveScene().bookmarks ?? []).length}`, ...log.slice(-12)].join("\n");
			const after = markedFrames(editor);
			for (const frame of framesBefore) {
				const holders = shownBy(editor, frame, mainBefore);
				if (holders.size === 0) continue;
				const tol = Math.ceil(Math.max(frame.rate, ...after.map((x) => x.rate)) * 4000) + 2;
				if (!after.some((x) => holders.has(x.clip) && Math.abs(x.source - frame.source) <= tol)) {
					const detail = process.env.FUZZ_DEBUG === String(seed) ? ` ${JSON.stringify({ frame, holders: [...holders], after, marks: editor.scenes.getActiveScene().bookmarks, main: (editor.scenes.getActiveScene().tracks.main.elements as El[]).map((e) => [e.id.slice(0, 6), e.startTime, e.duration, e.trimStart, (e as { retime?: unknown }).retime]) })}` : "";
					return [`seed ${seed} step ${i} ${what}: the marker over ${frame.media} @${Math.round(frame.source)} lost its frame${detail}`, ...log.slice(-12)].join("\n");
				}
			}
		}
		// a locked track is moved by nothing but its own lock
		if (name !== "lock") {
			for (const [id, before] of lockedBefore) {
				const now = tracksOf(editor).find((t) => t.id === id);
				if (now && JSON.stringify(now.elements) !== before) return [`seed ${seed} step ${i} ${what}: locked track ${id.slice(0, 6)} changed`, ...log.slice(-12)].join("\n");
			}
		}
		if (dump && check(editor, "").length) console.log(`BEFORE ${what}\n${dump}\nAFTER\n${JSON.stringify(tracksOf(editor).map((t) => [t.id.slice(0, 6), (t.elements as El[]).map((e) => [e.id.slice(0, 6), e.startTime, e.duration])]))}`);
		log.push(what);
		const bad = check(editor, `step ${i} ${what}`);
		if (bad.length && process.env.FUZZ_DEBUG === String(seed)) console.log(`AV ${JSON.stringify(tracksOf(editor).map((t) => [t.id.slice(0, 6), t.locked ?? false, (t.elements as El[]).filter((e) => e.type === "video" || e.type === "audio").map((e) => [e.type, e.id.slice(0, 6), e.startTime, e.duration, e.trimStart, (e as { retime?: { rate: number } }).retime?.rate ?? 1, (e as { isSourceAudioEnabled?: boolean }).isSourceAudioEnabled, (e as { detachedFrom?: string }).detachedFrom?.slice(0, 6)])]))}`);
		if (bad.length) return [`seed ${seed}`, ...bad, ...log.slice(-12)].join("\n");
		if (editor.command.depth() > d0) {
			const m1 = editor.command.isRippleEnabled;
			madeWith.push({ before: m0, after: m1 });
			redoWith = [];
			const k1 = stateKey(editor);
			editor.command.undo();
			if (editor.command.isRippleEnabled !== m0) return [`seed ${seed} step ${i} ${what}: ⌘Z left the magnet ${m0 ? "off" : "on"}`, ...log.slice(-12)].join("\n");
			if (stateKey(editor) !== k0) return [`seed ${seed} step ${i} ${what}: ⌘Z did not give the state back — ${inv.describeStateDifference(k0, stateKey(editor))}`, ...log.slice(-12)].join("\n");
			editor.command.redo();
			if (editor.command.isRippleEnabled !== m1) return [`seed ${seed} step ${i} ${what}: ⇧⌘Z left the magnet ${m1 ? "off" : "on"}`, ...log.slice(-12)].join("\n");
			if (stateKey(editor) !== k1) return [`seed ${seed} step ${i} ${what}: ⇧⌘Z did not make it again — ${inv.describeStateDifference(k1, stateKey(editor))}`, ...log.slice(-12)].join("\n");
		}
	}
	return null;
}

describe("a slower speed never covers the next clip (timeline-fuzz seed 71420, step 47)", () => {
	for (const where of ["overlay", "audio", "main"] as const) {
		for (const path of ["typed", "dragged"] as const) {
			test(`${where}, magnet off, ${path}: keeps its start, fits the free space; ⌘Z / ⇧⌘Z exact`, () => {
				const editor = setup();
				insertClip(editor, where, 0, 1, 2, "A");
				insertClip(editor, where, 2.5, 0, 2, "B");
				const track = laneTrack(editor, where) as Track;
				const live = () => tracksOf(editor).find((t) => t.id === track.id) as Track;
				const [a, b] = [...(live().elements as El[])].sort((x, y) => x.startTime - y.startTime);
				const k0 = stateKey(editor);
				const retime = { rate: 0.5, maintainPitch: false, mode: "constant" } as never;
				if (path === "typed") editor.timeline.updateElementRetime({ trackId: track.id, elementId: a.id, retime });
				else {
					editor.timeline.previewElements({ updates: [{ trackId: track.id, elementId: a.id, updates: { retime } as never }] });
					editor.timeline.updateElementRetime({ trackId: track.id, elementId: a.id, retime });
				}
				expect(check(editor, "after")).toEqual([]);
				const a2 = (live().elements as El[]).find((e) => e.id === a.id) as El;
				expect(a2.startTime).toBe(a.startTime);
				expect(a2.startTime + a2.duration).toBe(b.startTime); // 2 s at 0.5× wants 4 s: 2.5 s fit
				expect((a2 as { retime?: { rate: number } }).retime?.rate).toBe(0.5);
				// it shows 1.25 s of its file now (2.5 s at 0.5×): the rest is trimmed off its tail
				expect(a2.trimStart).toBe(a.trimStart);
				expect(a2.trimStart + a2.duration * 0.5 + a2.trimEnd).toBe(sec(10));
				expect(((live().elements as El[]).find((e) => e.id === b.id) as El).startTime).toBe(b.startTime);
				const k1 = stateKey(editor);
				editor.command.undo();
				expect(stateKey(editor)).toBe(k0);
				editor.command.redo();
				expect(stateKey(editor)).toBe(k1);
			});
		}
	}

	test("main track, magnet on: the slower clip pushes the clips after it, no gap, no overlap", () => {
		const editor = setup();
		editor.command.isRippleEnabled = true;
		const main = editor.scenes.getActiveScene().tracks.main as Track;
		insertClip(editor, "main", 0, 1, 2, "A");
		insertClip(editor, "main", 2, 0, 2, "B");
		const [a, b] = [...(editor.scenes.getActiveScene().tracks.main.elements as El[])].sort((x, y) => x.startTime - y.startTime);
		editor.timeline.updateElementRetime({ trackId: main.id, elementId: a.id, retime: { rate: 0.5, maintainPitch: false, mode: "constant" } as never });
		expect(check(editor, "after")).toEqual([]);
		const now = editor.scenes.getActiveScene().tracks.main.elements as El[];
		const a2 = now.find((e) => e.id === a.id) as El;
		expect(a2.duration).toBe(sec(4));
		expect((now.find((e) => e.id === b.id) as El).startTime).toBe(sec(4));
		void b;
	});
});

describe("found by this fuzz (seed 2883516)", () => {
	test("a one-frame clip made faster stays one frame (it was a third of one), and its edge never grows into the next clip", () => {
		const editor = setup();
		insertClip(editor, "overlay", 1, 1, 1 / 30, "A");
		insertClip(editor, "overlay", 1 + 1 / 30, 0, 2, "B");
		const track = laneTrack(editor, "overlay") as Track;
		const live = () => (laneTrack(editor, "overlay") as Track).elements as El[];
		const [a] = [...live()].sort((x, y) => x.startTime - y.startTime);
		editor.timeline.updateElementRetime({ trackId: track.id, elementId: a.id, retime: { rate: 2.93, maintainPitch: false, mode: "constant" } as never });
		const a2 = live().find((e) => e.id === a.id) as El;
		expect(a2.duration).toBe(sec(1 / 30)); // a frame at 30 fps: 4000 ticks, not 1365
		expect(check(editor, "speed")).toEqual([]);
		// a clip a third of a frame long next to another (as older projects may hold): ⌥⌘→ leaves it where it is
		const tracks = editor.scenes.getActiveScene().tracks;
		const thin = { ...a2, duration: wasm.mediaTime({ ticks: 1365 }) } as El;
		const b = live().find((e) => e.id !== a.id) as El;
		const crafted = { ...tracks, overlay: tracks.overlay.map((t) => (t.id === track.id ? { ...t, elements: [thin, { ...b, startTime: wasm.mediaTime({ ticks: thin.startTime + 1365 }) }] } : t)) } as typeof tracks;
		const updates = trim.trimEdgeByFrames({ tracks: crafted, selection: [{ trackId: track.id, elementId: a.id }], side: "right", frames: 2, fps: FPS, rippleTrackId: null });
		const grown = updates?.find((u) => u.elementId === a.id);
		expect(grown === undefined || grown.patch.startTime + grown.patch.duration <= thin.startTime + 1365).toBe(true);
	});
});

describe("O1: the magnet switched on without a step, then ⌘Z / ⇧⌘Z (seed 3746687)", () => {
	test("the magnet comes back with the state: no gap under the magnet, no magnet step", () => {
		expect(runSeed(3746687, 300)).toBeNull();
	});
});

describe("random command sequences keep every invariant, ⌘Z / ⇧⌘Z exact after each step", () => {
	const seeds = Number(process.env.FUZZ_SEEDS ?? 40);
	const steps = Number(process.env.FUZZ_STEPS ?? 120);
	test(`${seeds} seeds × ${steps} steps (the first: 71420)`, () => {
		const failures: string[] = [];
		for (let s = 0; s < seeds; s++) {
			const seed = process.env.FUZZ_ONLY ? Number(process.env.FUZZ_ONLY) : s === 0 ? 71420 : 1000 + s * 7919;
			const broken = runSeed(seed, steps);
			if (broken) failures.push(broken);
			if (failures.length >= 3) break;
		}
		console.log(`fuzz operations: ${JSON.stringify(FUZZ_COUNTS)}`);
		expect(failures).toEqual([]);
	}, 6_000_000);
});
