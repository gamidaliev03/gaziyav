// CapCut compound clips (⌥G / ⌥⇧G): the selected clips become one clip that plays them; a double-click opens its own
// timeline; «Dismiss» puts the clips back where they play. Built on the composition clips of src/montage: a composition
// element on this timeline points to a scene that holds the clips, and playback / export flatten it.
// Both edits are one undo step and never ripple or carry linked clips: the result is exactly what was on screen.
import type { EditorCore } from "@/core";
import {
	COMPOSITION_DEF,
	flattenCompositions,
	isComposition,
	projectFps,
	ScenesSnapshotCommand,
} from "@/montage/compositions";
import { expandToGroups } from "@/timeline/groups";
import { buildEmptyTrack } from "@/timeline/placement";
import { buildDefaultScene } from "@/timeline/scenes";
import type {
	AudioTrack,
	ElementRef,
	GraphicElement,
	GraphicTrack,
	OverlayTrack,
	SceneTracks,
	TimelineElement,
	TimelineTrack,
	TScene,
	VideoTrack,
} from "@/timeline/types";
import { generateUUID } from "@/utils/id";
import type { MediaTime } from "@/wasm";

type WithTransitions = { transitions?: { fromElementId: string; toElementId: string }[] };

const tracksOf = (tracks: SceneTracks): TimelineTrack[] => [...tracks.overlay, tracks.main, ...tracks.audio];
const endOf = (element: TimelineElement) => element.startTime + element.duration;

/** The edit as one undo step, as computed: no magnet ripple, no linkage on top. */
function commitScenes(editor: EditorCore, before: TScene[], after: TScene[], activeId: string, selection: ElementRef[]): void {
	editor.scenes.setScenes({ scenes: after, activeSceneId: activeId });
	editor.command.push({ command: new ScenesSnapshotCommand(before, after, activeId, activeId, selection) });
	editor.selection.setSelectedElements({ elements: selection });
}

function nextNumber(scenes: TScene[]): number {
	let n = 0;
	for (const scene of scenes) {
		const match = /^Compound clip (\d+)$/.exec(scene.name);
		if (match) n = Math.max(n, Number(match[1]));
	}
	return n + 1;
}

/** `track` with only the elements `keep` accepts, its transitions between kept clips only. */
function filterTrack<T extends TimelineTrack>(track: T, keep: (element: TimelineElement) => boolean): T {
	const elements = (track.elements as TimelineElement[]).filter(keep);
	const ids = new Set(elements.map((element) => element.id));
	const transitions = (track as WithTransitions).transitions;
	return {
		...track,
		elements,
		...(transitions ? { transitions: transitions.filter((t) => ids.has(t.fromElementId) && ids.has(t.toElementId)) } : {}),
	} as T;
}

/**
 * ⌥G: the selected clips (with their groups) become «Compound clip N» at their place in time: on the main track when
 * main-track clips were picked (CapCut), else on a new track right above the highest track they came from.
 */
export function createCompoundClip(editor: EditorCore): boolean {
	const scenes = editor.scenes.getScenes();
	const active = editor.scenes.getActiveScene();
	const refs = expandToGroups({ tracks: active.tracks, elements: editor.selection.getSelectedElements() });
	const ids = new Set(refs.map((ref) => ref.elementId));
	const picked = tracksOf(active.tracks).flatMap((track) => (track.elements as TimelineElement[]).filter((element) => ids.has(element.id)));
	if (picked.length === 0) return false;
	const start = Math.min(...picked.map((element) => element.startTime));
	const end = Math.max(...picked.map(endOf));
	const toInner = (track: TimelineTrack) =>
		({
			...filterTrack(track, (element) => ids.has(element.id)),
			id: generateUUID(),
			elements: (track.elements as TimelineElement[])
				.filter((element) => ids.has(element.id))
				.map((element) => ({ ...element, startTime: (element.startTime - start) as MediaTime })),
		}) as TimelineTrack;

	const n = nextNumber(scenes);
	const inner = buildDefaultScene({ name: `Compound clip ${n}`, isMain: false, nested: true });
	inner.tracks = {
		overlay: active.tracks.overlay.map((track) => toInner(track) as OverlayTrack).filter((track) => track.elements.length > 0),
		main: { ...(toInner(active.tracks.main) as VideoTrack), id: inner.tracks.main.id, name: inner.tracks.main.name },
		audio: active.tracks.audio.map((track) => toInner(track) as AudioTrack).filter((track) => track.elements.length > 0),
	};

	const compound: GraphicElement = {
		id: generateUUID(),
		type: "graphic",
		name: `Compound clip ${n}`,
		definitionId: COMPOSITION_DEF,
		startTime: start as MediaTime,
		duration: (end - start) as MediaTime,
		trimStart: 0 as MediaTime,
		trimEnd: 0 as MediaTime,
		params: { sceneId: inner.id, alpha: true, style: "clean", compound: true },
	};
	const mainPicked = (active.tracks.main.elements as TimelineElement[]).filter((element) => ids.has(element.id));
	const mainRest = filterTrack(active.tracks.main, (element) => !ids.has(element.id));
	// CapCut: a compound made of main-track clips takes their place ON the main track (no hole, nothing else moves,
	// unless a layer in the pick reaches past the clips: then the clips after it move on by that much). Only when
	// an unpicked main clip sits between the picked ones does it go to a layer track as any other pick.
	const mainEnd = mainPicked.length > 0 ? Math.max(...mainPicked.map(endOf)) : start;
	const onMain = mainPicked.length > 0 && !(mainRest.elements as TimelineElement[]).some((element) => element.startTime < mainEnd && endOf(element) > start);
	const selection: ElementRef[] = [];
	let main = mainRest;
	const overlay: OverlayTrack[] = [];
	if (onMain) {
		const extra = Math.max(0, end - mainEnd);
		const elements = [...(mainRest.elements as TimelineElement[]).map((element) => (element.startTime >= mainEnd ? { ...element, startTime: (element.startTime + extra) as MediaTime } : element)), compound].sort(
			(a, b) => a.startTime - b.startTime,
		);
		main = { ...mainRest, elements: elements as VideoTrack["elements"] };
		selection.push({ trackId: main.id, elementId: compound.id });
		for (const track of active.tracks.overlay) {
			const rest = filterTrack(track, (element) => !ids.has(element.id));
			if (rest.elements.length > 0) overlay.push(rest);
		}
	} else {
		const compoundTrack: GraphicTrack = { ...buildEmptyTrack({ id: generateUUID(), type: "graphic" }), elements: [compound] };
		const highest = active.tracks.overlay.findIndex((track) => (track.elements as TimelineElement[]).some((element) => ids.has(element.id)));
		active.tracks.overlay.forEach((track, index) => {
			if (index === highest) overlay.push(compoundTrack);
			const rest = filterTrack(track, (element) => !ids.has(element.id));
			if (rest.elements.length > 0) overlay.push(rest);
		});
		if (highest < 0) overlay.push(compoundTrack);
		selection.push({ trackId: compoundTrack.id, elementId: compound.id });
	}
	const tracks: SceneTracks = {
		overlay,
		main,
		audio: active.tracks.audio.map((track) => filterTrack(track, (element) => !ids.has(element.id))).filter((track) => track.elements.length > 0),
	};

	const after = [...scenes.map((scene) => (scene.id === active.id ? { ...scene, tracks, updatedAt: new Date() } : scene)), inner];
	commitScenes(editor, scenes, after, active.id, selection);
	return true;
}

export type DismissResult = "done" | "none" | "ai";

/** A nested compound clip while its parent is dismissed: an ordinary graphic to the flattening, so it stays closed. */
const HELD_COMPOSITION = "timeline.compound-held";

function holdCompositions(scene: TScene): TScene {
	const hold = <T extends TimelineTrack>(track: T): T =>
		({
			...track,
			elements: (track.elements as TimelineElement[]).map((e) => (isComposition(e) ? { ...e, definitionId: HELD_COMPOSITION } : e)),
		}) as T;
	return { ...scene, tracks: { overlay: scene.tracks.overlay.map(hold), main: hold(scene.tracks.main), audio: scene.tracks.audio.map(hold) } };
}

const release = <T extends TimelineElement>(element: T): T =>
	element.type === "graphic" && element.definitionId === HELD_COMPOSITION ? ({ ...element, definitionId: COMPOSITION_DEF } as T) : element;

/**
 * ⌥⇧G, and «Flatten» on an old AI composition: each selected compound clip / composition is replaced by the clips it
 * plays — trimmed to it, at the same times, with its position / scale applied — main-track clips back on the main track
 * when their place there is free. An AI composition's AI layers come out as ordinary AI layers (their fields in the
 * Template tab), its black backdrop (no alpha) as a rectangle layer.
 */
export function dismissCompoundClips(editor: EditorCore): DismissResult {
	const scenes = editor.scenes.getScenes();
	const active = editor.scenes.getActiveScene();
	const selected = new Set(editor.selection.getSelectedElements().map((ref) => ref.elementId));
	const compounds = tracksOf(active.tracks).flatMap((track) =>
		(track.elements as TimelineElement[]).filter((element) => selected.has(element.id) && isComposition(element)).map((element) => ({ track, element: element as GraphicElement })),
	);
	if (compounds.length === 0) return "none";

	const settings = editor.project.getActiveOrNull()?.settings;
	const fps = projectFps(settings?.fps);
	const usedIds = new Set(tracksOf(active.tracks).flatMap((track) => track.elements.map((element) => element.id)));
	const freshIds = <T extends TimelineElement>(element: T): T => {
		if (!usedIds.has(element.id)) {
			usedIds.add(element.id);
			return element;
		}
		const id = generateUUID();
		usedIds.add(id);
		return { ...element, id };
	};

	let tracks = active.tracks;
	const selection: ElementRef[] = [];
	for (const { track, element } of compounds) {
		// Compound clips inside it come out as compound clips (CapCut), not opened up as well.
		const flat = flattenCompositions({
			tracks: { overlay: [], main: { ...tracks.main, elements: [element] } as unknown as VideoTrack, audio: [] },
			scenes: scenes.map((scene) => (scene.id === element.params.sceneId ? holdCompositions(scene) : scene)),
			canvas: settings?.canvasSize,
			fps,
			keepAiLayers: true,
		});
		const innerMainId = flat.tracks.overlay.find((t) => t.id.endsWith(`~${element.id}`))?.id;
		const remove = <T extends TimelineTrack>(t: T): T => filterTrack(t, (e) => e.id !== element.id);
		let main = remove(tracks.main);
		const placed: OverlayTrack[] = [];
		for (const innerTrack of flat.tracks.overlay) {
			const elements = (innerTrack.elements as TimelineElement[]).map((e) => freshIds(release(e)));
			if (elements.length === 0) continue;
			// Clips of the compound's own main track go back to the main track when nothing is there now.
			const mainIsFree =
				innerTrack.id === innerMainId &&
				elements.every((e) => !(main.elements as TimelineElement[]).some((m) => m.startTime < endOf(e) && e.startTime < endOf(m)));
			if (mainIsFree) {
				main = { ...main, elements: [...main.elements, ...elements].sort((a, b) => a.startTime - b.startTime) } as VideoTrack;
				for (const e of elements) selection.push({ trackId: main.id, elementId: e.id });
				continue;
			}
			const restored = { ...innerTrack, id: generateUUID(), elements } as OverlayTrack;
			placed.push(restored);
			for (const e of elements) selection.push({ trackId: restored.id, elementId: e.id });
		}
		const audio = flat.tracks.audio
			.map((t) => ({ ...t, id: generateUUID(), elements: (t.elements as TimelineElement[]).map((e) => freshIds(release(e))) }) as AudioTrack)
			.filter((t) => t.elements.length > 0);
		for (const t of audio) for (const e of t.elements) selection.push({ trackId: t.id, elementId: e.id });
		// The compound's own track: the restored tracks take its place, in their stacking order.
		const overlay: OverlayTrack[] = [];
		for (const t of tracks.overlay) {
			if (t.id === track.id) {
				overlay.push(...placed);
				const rest = remove(t);
				if (rest.elements.length > 0) overlay.push(rest);
			} else {
				overlay.push(t);
			}
		}
		if (track.id === tracks.main.id) overlay.push(...placed);
		tracks = { overlay, main, audio: [...tracks.audio.map(remove), ...audio] };
	}

	// A composition scene nothing points to any more goes with its compound clip — also one nested inside it, which
	// playback flattening opened up as well (⌘Z brings them all back). Left alone, it showed up as a timeline tab.
	const referenced = (list: TScene[]) =>
		new Set(
			list.flatMap((scene) =>
				tracksOf(scene.tracks).flatMap((t) =>
					(t.elements as TimelineElement[]).flatMap((e) => (isComposition(e) && typeof e.params.sceneId === "string" ? [e.params.sceneId] : [])),
				),
			),
		);
	const compositionScenes = referenced(scenes);
	let after = scenes.map((scene) => (scene.id === active.id ? { ...scene, tracks, updatedAt: new Date() } : scene));
	for (;;) {
		const used = referenced(after);
		const kept = after.filter((scene) => scene.isMain || scene.inMedia || scene.id === active.id || !compositionScenes.has(scene.id) || used.has(scene.id));
		if (kept.length === after.length) break;
		after = kept;
	}
	commitScenes(editor, scenes, after, active.id, selection);
	return "done";
}

/**
 * Back on the parent timeline, a compound clip is as long as what is in it now (CapCut, Final Cut): edits inside left it
 * at its old length — after a 6 s cut inside, 6 s of nothing played on the parent (pro-core, 09.11). A compound trimmed on
 * the parent keeps its trim; it only never runs past the end of its content. One undo step; the magnet closes or opens
 * the main track after it. `compoundLength` remembers the content's length it was last made to fit.
 */
export function syncCompoundLength(editor: EditorCore, compoundId: string, inner: TScene): boolean {
	const parent = editor.scenes.getActiveSceneOrNull();
	if (!parent) return false;
	const track = [parent.tracks.main, ...parent.tracks.overlay].find((t) => (t.elements as TimelineElement[]).some((e) => e.id === compoundId));
	const element = (track?.elements as TimelineElement[] | undefined)?.find((e) => e.id === compoundId);
	if (!track || !element || element.type !== "graphic" || element.params?.compound !== true) return false;
	const contentEnd = Math.max(0, ...tracksOf(inner.tracks).flatMap((t) => (t.elements as TimelineElement[]).map(endOf)));
	if (contentEnd <= element.trimStart) return false;
	const fitted = typeof element.params.compoundLength === "number" ? element.params.compoundLength : element.trimStart + element.duration;
	const whole = element.trimStart + element.duration >= fitted;
	const duration = whole ? contentEnd - element.trimStart : Math.min(element.duration, contentEnd - element.trimStart);
	if (duration === element.duration && fitted === contentEnd) return false;
	editor.timeline.updateElements({
		updates: [
			{
				trackId: track.id,
				elementId: element.id,
				patch: { duration: duration as MediaTime, params: { ...element.params, compoundLength: contentEnd } } as Partial<TimelineElement>,
			},
		],
	});
	return true;
}
