import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { TProject } from "@/project/types";
import type { SerializedProject } from "@/services/storage/types";
import type { TimelineElement, TimelineTrack } from "@/timeline/types";

// perf3, 14.11 — the guard of the save rule. The save manager no longer marks the project changed on every timeline
// notification (a preview step is not an edit); it rests on «every change of what is stored notifies the scenes (or
// marks the save itself)». Proven as an invariant: random edits through every public mutator of the timeline, scenes
// and project managers, undo / redo, previews, typed words, compound clips, track lock — and after EVERY step:
// «what a save would write now differs from what was written last ⇒ the save manager is dirty» (for the view's three
// numbers alone: dirty or the view pending). A step that breaks it is an edit that would sit unsaved.

let core: typeof import("@/core");
let scenesMod: typeof import("@/timeline/scenes");
let elements: typeof import("@/timeline/element-utils");
let cmds: typeof import("@/commands/timeline");
let wasm: typeof import("@/wasm");
let compound: typeof import("@/timeline/compound");
let lock: typeof import("@/timeline/track-lock");
let storage: typeof import("@/services/storage/service");
let SaveManager: typeof import("@/core/managers/save-manager").SaveManager;
const writes: SerializedProject[] = [];

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	scenesMod = await import("@/timeline/scenes");
	elements = await import("@/timeline/element-utils");
	cmds = await import("@/commands/timeline");
	wasm = await import("@/wasm");
	compound = await import("@/timeline/compound");
	lock = await import("@/timeline/track-lock");
	SaveManager = (await import("@/core/managers/save-manager")).SaveManager;
	storage = await import("@/services/storage/service");
	const service = storage.storageService as unknown as Record<string, unknown>;
	service.saveProject = async () => {};
	service.saveSerializedProject = async ({ serialized }: { serialized: SerializedProject }) => {
		writes.push(structuredClone(serialized));
	};
	const recovery = await import("@/services/storage/recovery");
	(recovery.projectBackups as unknown as Record<string, unknown>).add = async () => {};
});

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** What is stored, apart from the stamps a save sets itself, and the view (its own rule). */
function split(s: SerializedProject): { body: string; view: string } {
	const copy = JSON.parse(JSON.stringify(s)) as Record<string, unknown> & { metadata: Record<string, unknown> };
	const view = JSON.stringify(copy.timelineViewState ?? null);
	delete copy.timelineViewState;
	for (const k of ["updatedAt", "duration", "thumbnailAt"]) delete copy.metadata[k];
	return { body: JSON.stringify(copy), view };
}

function open() {
	const { EditorCore } = core;
	EditorCore.reset();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const main = scenesMod.buildDefaultScene({ name: "Main", isMain: true });
	const project = {
		metadata: { id: "guard", name: "guard", createdAt: new Date(0), updatedAt: new Date(0) },
		scenes: [main],
		currentSceneId: main.id,
		settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1920, height: 1080 }, background: { type: "color", color: "#000000" } },
		version: 1,
	} as unknown as TProject;
	editor.project.setActiveProject({ project });
	(editor.project as unknown as { isLoading: boolean }).isLoading = false;
	editor.scenes.setScenes({ scenes: project.scenes, activeSceneId: main.id });
	const save = new SaveManager({ editor, debounceMs: 5, maxWaitMs: 50, viewSaveMs: 60_000 });
	(editor as unknown as { save: unknown }).save = save;
	save.start();
	return { editor, save };
}

/** What a save would write now (ProjectManager.buildProjectForSave without its stamps). */
function wouldWrite(editor: ReturnType<typeof open>["editor"]): { body: string; view: string } {
	const pm = editor.project as unknown as { active: TProject; scenesForSave(): TProject["scenes"] };
	return split(storage.storageService.serializeProject({ project: { ...pm.active, scenes: pm.scenesForSave() } }));
}

async function run(seed: number, steps: number) {
	const { editor, save } = open();
	const random = mulberry32(seed);
	const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
	const sec = (s: number) => wasm.mediaTime({ ticks: Math.round(s * wasm.TICKS_PER_SECOND) });
	const tracks = () => {
		const t = editor.scenes.getActiveScene().tracks;
		return [...t.overlay, t.main, ...t.audio] as TimelineTrack[];
	};
	const refs = () => tracks().flatMap((track) => (track.elements as TimelineElement[]).map((e) => ({ trackId: track.id, elementId: e.id, track, element: e })));
	const ref = () => {
		const all = refs();
		return all.length ? pick(all) : null;
	};
	const texts = () => refs().filter((r) => r.element.type === "text");
	const visual = () => refs().filter((r) => r.element.type === "text" || r.element.type === "video");
	const T = editor.timeline;
	const S = editor.scenes;
	const P = editor.project;
	let typing: { trackId: string; elementId: string; content: string } | null = null;

	// every mutator, by name: each returns false when it had nothing to act on
	const ops: Record<string, () => unknown> = {
		"timeline.insertElement(text)": () =>
			T.insertElement({ element: elements.buildTextElement({ raw: { name: "t", duration: sec(1 + random() * 3) }, startTime: sec(random() * 20) }), placement: { mode: "auto" } }),
		"timeline.insertElement(media)": () =>
			T.insertElement({
				element: elements.buildElementFromMedia({ mediaId: "m1", mediaType: random() < 0.7 ? "video" : "audio", name: "v", duration: sec(2 + random() * 5), startTime: sec(random() * 20) }),
				placement: { mode: "auto" },
			}),
		"timeline.addTrack": () => T.addTrack({ type: pick(["text", "audio", "video"] as const) }),
		"timeline.removeTrack": () => {
			const t = tracks().filter((x) => x.id !== editor.scenes.getActiveScene().tracks.main.id);
			if (!t.length) return false;
			T.removeTrack({ trackId: pick(t).id });
		},
		"timeline.updateElementTrim": () => {
			const r = ref();
			if (!r) return false;
			T.updateElementTrim({ elementId: r.elementId, trimStart: sec(random() * 0.5), trimEnd: sec(random() * 0.5) });
		},
		"timeline.updateElementRetime": () => {
			const r = refs().find((x) => x.element.type === "video");
			if (!r) return false;
			T.updateElementRetime({ trackId: r.trackId, elementId: r.elementId, retime: { rate: pick([0.5, 2, 1.5]) } as never });
		},
		"timeline.moveElements": () => {
			const r = ref();
			if (!r) return false;
			const target = pick(tracks().filter((x) => x.type === r.track.type));
			T.moveElements({ moves: [{ sourceTrackId: r.trackId, targetTrackId: target.id, elementId: r.elementId, newStartTime: sec(random() * 25) }], createTracks: [] } as never);
		},
		"timeline.toggleTrackMute": () => {
			const t = tracks().filter((x) => x.type === "audio" || x.type === "video");
			if (!t.length) return false;
			T.toggleTrackMute({ trackId: pick(t).id });
		},
		"timeline.toggleTrackVisibility": () => T.toggleTrackVisibility({ trackId: pick(tracks()).id }),
		"timeline.splitElements": () => {
			const r = ref();
			if (!r) return false;
			T.splitElements({ elements: [r], splitTime: wasm.mediaTime({ ticks: Math.round(r.element.startTime + r.element.duration * (0.2 + random() * 0.6)) }) } as never);
		},
		"timeline.deleteElements": () => {
			const r = ref();
			if (!r) return false;
			T.deleteElements({ elements: [r] });
		},
		"timeline.toggleSourceAudioSeparation": () => {
			const r = refs().find((x) => x.element.type === "video");
			if (!r) return false;
			T.toggleSourceAudioSeparation({ trackId: r.trackId, elementId: r.elementId });
		},
		"timeline.updateElements": () => {
			const r = ref();
			if (!r) return false;
			T.updateElements({ updates: [{ trackId: r.trackId, elementId: r.elementId, patch: { name: `n${random()}` } as never }] });
		},
		"timeline.addClipEffect": () => {
			const r = pick(visual().length ? visual() : [null]);
			if (!r) return false;
			T.addClipEffect({ trackId: r.trackId, elementId: r.elementId, effectType: "blur" });
		},
		"timeline.updateClipEffectParams / toggle / reorder / remove": () => {
			const r = visual().find((x) => ((x.element as { effects?: unknown[] }).effects ?? []).length > 0);
			if (!r) return false;
			const fx = (r.element as unknown as { effects: Array<{ id: string; params: Record<string, unknown> }> }).effects;
			const one = pick(fx);
			const k = random();
			if (k < 0.3) T.updateClipEffectParams({ trackId: r.trackId, elementId: r.elementId, effectId: one.id, params: { intensity: random() } as never });
			else if (k < 0.55) T.toggleClipEffect({ trackId: r.trackId, elementId: r.elementId, effectId: one.id });
			else if (k < 0.75 && fx.length > 1) T.reorderClipEffects({ trackId: r.trackId, elementId: r.elementId, fromIndex: 0, toIndex: fx.length - 1 });
			else if (k < 0.85) T.upsertEffectParamKeyframe({ trackId: r.trackId, elementId: r.elementId, effectId: one.id, paramKey: "intensity", time: sec(random()), value: random() } as never);
			else T.removeClipEffect({ trackId: r.trackId, elementId: r.elementId, effectId: one.id });
		},
		"timeline.upsertKeyframes": () => {
			const r = pick(visual().length ? visual() : [null]);
			if (!r) return false;
			T.upsertKeyframes({ keyframes: [{ trackId: r.trackId, elementId: r.elementId, propertyPath: "opacity" as never, time: sec(random() * 0.9), value: random() }] });
		},
		"timeline.retimeKeyframe / removeKeyframes": () => {
			const r = visual().find((x) => JSON.stringify((x.element as { animations?: unknown }).animations ?? {}).includes('"id"'));
			if (!r) return false;
			const found = JSON.stringify((r.element as { animations?: unknown }).animations).match(/"id":"([^"]+)"/);
			if (!found) return false;
			if (random() < 0.5) T.retimeKeyframe({ trackId: r.trackId, elementId: r.elementId, propertyPath: "opacity" as never, keyframeId: found[1], time: sec(random() * 0.9) });
			else T.removeKeyframes({ keyframes: [{ trackId: r.trackId, elementId: r.elementId, propertyPath: "opacity" as never, keyframeId: found[1] }] });
		},
		"timeline.duplicateElements": () => {
			const r = ref();
			if (!r) return false;
			T.duplicateElements({ elements: [r] });
		},
		"timeline.toggleElementsVisibility": () => {
			const r = ref();
			if (!r) return false;
			T.toggleElementsVisibility({ elements: [r] });
		},
		"timeline.toggleElementsMuted": () => {
			const r = refs().find((x) => x.element.type === "video" || x.element.type === "audio");
			if (!r) return false;
			T.toggleElementsMuted({ elements: [r] });
		},
		"paste (PasteCommand)": () => {
			const r = ref();
			if (!r) return false;
			const { id: _id, ...rest } = r.element;
			editor.command.execute({ command: new cmds.PasteCommand({ time: sec(random() * 30), clipboardItems: [{ trackId: r.trackId, trackType: r.track.type, element: rest }] as never }) });
		},
		"timeline.previewElements + commitPreview (a drag)": () => {
			const r = ref();
			if (!r) return false;
			for (let i = 1; i <= 5; i++) T.previewElements({ updates: [{ trackId: r.trackId, elementId: r.elementId, updates: { startTime: sec(r.element.startTime / wasm.TICKS_PER_SECOND + i * 0.1) } }] });
			check("…during the drag");
			T.commitPreview();
		},
		"timeline.previewElements + discardPreview (Esc)": () => {
			const r = ref();
			if (!r) return false;
			T.previewElements({ updates: [{ trackId: r.trackId, elementId: r.elementId, updates: { startTime: sec(3) } }] });
			check("…during the preview");
			T.discardPreview();
		},
		"typed words (previewElements params.content)": () => {
			const r = typing ? texts().find((x) => x.elementId === typing?.elementId) : pick(texts().length ? texts() : [null]);
			if (!r) return false;
			const was = (r.element as unknown as { params: Record<string, unknown> }).params;
			const content = `${typing?.content ?? ""}${"abc"[Math.floor(random() * 3)]}`;
			typing = { trackId: r.trackId, elementId: r.elementId, content };
			T.previewElements({ updates: [{ trackId: r.trackId, elementId: r.elementId, updates: { params: { ...was, content } } as never }] });
		},
		"typed words: commit (⌘↵) or Esc": () => {
			if (!typing) return false;
			typing = null;
			if (random() < 0.6) T.commitPreview();
			else T.discardPreview();
		},
		"timeline.updateTracks": () => T.updateTracks({ ...editor.scenes.getActiveScene().tracks }),
		"toggleTrackLock": () => lock.toggleTrackLock(editor, pick(tracks()).id),
		"compound: createCompoundClip (⌥G)": () => {
			const all = refs().filter((x) => x.track.id === editor.scenes.getActiveScene().tracks.main.id);
			if (all.length < 2) return false;
			editor.selection.setSelectedElements({ elements: all.slice(0, 2).map(({ trackId, elementId }) => ({ trackId, elementId })) });
			compound.createCompoundClip(editor);
		},
		"compound: dismissCompoundClips": () => {
			const c = refs().find((x) => (x.element as { params?: { compound?: boolean } }).params?.compound === true);
			if (!c) return false;
			editor.selection.setSelectedElements({ elements: [{ trackId: c.trackId, elementId: c.elementId }] });
			compound.dismissCompoundClips(editor);
		},
		"scenes.switchToScene (enter a compound / another timeline)": async () => {
			const list = S.getScenes();
			if (list.length < 2) return false;
			await S.switchToScene({ sceneId: pick(list.filter((s) => s.id !== S.getActiveScene().id)).id });
		},
		"scenes.createScene": async () => S.createScene({ name: `Timeline ${Math.floor(random() * 99)}`, isMain: false }),
		"scenes.renameScene": async () => S.renameScene({ sceneId: S.getActiveScene().id, name: `R${Math.floor(random() * 99)}` }),
		"scenes.deleteScene": async () => {
			const others = S.getScenes().filter((s) => !s.isMain && s.id !== S.getActiveScene().id);
			if (!others.length) return false;
			await S.deleteScene({ sceneId: pick(others).id }).catch(() => {});
		},
		"scenes.toggleBookmark": async () => S.toggleBookmark({ time: sec(Math.floor(random() * 10)) }),
		"scenes.updateBookmark / moveBookmark / removeBookmark": async () => {
			const b = (S.getActiveScene().bookmarks ?? []) as Array<{ time: number }>;
			if (!b.length) return false;
			const time = pick(b).time as never;
			const k = random();
			if (k < 0.33) await S.updateBookmark({ time, updates: { note: `n${k}` } as never });
			else if (k < 0.66) await S.moveBookmark({ fromTime: time, toTime: sec(10 + Math.floor(random() * 5)) });
			else await S.removeBookmark({ time });
		},
		"project.updateSettings": async () => P.updateSettings({ settings: { background: { type: "color", color: pick(["#000000", "#ff0000", "#00ff00"]) } } as never }),
		"project.ratchetFpsForImportedMedia": () => P.ratchetFpsForImportedMedia({ importedAssets: [{ type: "video", fps: pick([30, 50, 60]) } as never] }),
		"project.updateThumbnail": async () => P.updateThumbnail({ thumbnail: `data:${random()}` }),
		"project.setTimelineViewState (zoom / scroll / playhead)": () =>
			P.setTimelineViewState({ viewState: { zoomLevel: 1 + Math.floor(random() * 5), scrollLeft: Math.floor(random() * 900), playheadTime: sec(random() * 10) } as never }),
		"command.undo": () => editor.command.undo(),
		"command.redo": () => editor.command.redo(),
	};

	let saved = split(writes.at(-1) ?? storage.storageService.serializeProject({ project: P.getActive() }));
	const failures: string[] = [];
	let checks = 0;
	let current = "";
	function check(when = "") {
		checks++;
		const now = wouldWrite(editor);
		const dirty = save.getIsDirty();
		if (now.body !== saved.body && !dirty) failures.push(`${current}${when}: content changed, nothing marked`);
		if (now.view !== saved.view && !dirty && !save.hasViewPending()) failures.push(`${current}${when}: view changed, nothing pending`);
	}
	// start from a saved project with a few clips
	for (let i = 0; i < 4; i++) ops["timeline.insertElement(media)"]();
	ops["timeline.insertElement(text)"]();
	await save.flush();
	saved = split(writes.at(-1) as SerializedProject);

	const used = new Map<string, number>();
	const names = Object.keys(ops);
	for (let step = 0; step < steps; step++) {
		// a pending typing session is either continued, ended or left while other things happen
		const name = typing && random() < 0.5 ? pick(["typed words (previewElements params.content)", "typed words: commit (⌘↵) or Esc"]) : pick(names);
		current = `seed ${seed} step ${step} ${name}`;
		if (typing && name !== "typed words (previewElements params.content)" && name !== "typed words: commit (⌘↵) or Esc" && name !== "project.setTimelineViewState (zoom / scroll / playhead)") {
			// the app ends typing before any other edit (the field loses the focus)
			typing = null;
			T.commitPreview();
			check(" (typing ended)");
		}
		let acted: unknown;
		try {
			acted = await ops[name]();
		} catch (error) {
			failures.push(`${current}: threw ${(error as Error).message}`);
			continue;
		}
		if (acted !== false) used.set(name, (used.get(name) ?? 0) + 1);
		check();
		// what is marked is written (the app's debounce), and that becomes the last saved state
		if (save.getIsDirty() || save.hasViewPending() || random() < 0.1) {
			await save.flush();
			const last = writes.at(-1);
			if (last) saved = split(last);
			const now = wouldWrite(editor);
			if (now.body !== saved.body) failures.push(`${current}: a save did not write what the editor holds`);
		}
	}
	return { failures, checks, used };
}

test("every change of what is stored marks the save (random edits through every mutator, undo / redo, previews)", async () => {
	const used = new Map<string, number>();
	let checks = 0;
	const failures: string[] = [];
	for (const seed of [1, 7, 42, 1234, 99991]) {
		const r = await run(seed, 400);
		checks += r.checks;
		failures.push(...r.failures);
		for (const [k, v] of r.used) used.set(k, (used.get(k) ?? 0) + v);
	}
	console.log(`save-guard: ${checks} checks, ${used.size} mutators driven: ${[...used].map(([k, v]) => `${k} ×${v}`).join("; ")}`);
	expect(failures.slice(0, 20)).toEqual([]);
	expect(used.size).toBeGreaterThanOrEqual(35);
}, 120_000);
