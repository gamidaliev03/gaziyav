// Composition clips — compound clips (CapCut / DaVinci) and the AI compositions of older projects (no new ones are
// made: they play, export and Flatten). A composition is a graphic element `ai.Composition`
// on the parent timeline that points (params.sceneId) to its own scene: the inner timeline with the nested clips and
// the AI layers (`ai.<Kind>` elements). For playback and export the parent's tracks are "flattened": every
// composition is replaced by its inner clips shifted into place; AI layers are drawn by the Remotion layer.
import { coveredGroups, prefetchRenderer, scheduleProxies, useLayerProxies, withProxies } from "./layer-proxies";
import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import type {
	ElementRef,
	GraphicElement,
	GraphicTrack,
	OverlayTrack,
	SceneTracks,
	TimelineElement,
	TimelineTrack,
	TScene,
	VideoTrack,
	AudioTrack,
} from "@/timeline/types";
import { buildDefaultScene } from "@/timeline/scenes";
import { buildEmptyTrack } from "@/timeline/placement";
import { generateUUID } from "@/utils/id";
import { TICKS_PER_SECOND, type MediaTime } from "@/wasm";
import { AI_PREFIX } from "./catalog";
import { COMPOSITION_DEF, configureTimebase, isAiLayer, isComposition, flattenCompositions, hasMotionLayers, showsUnderlay } from "./flatten";
import { styleOf } from "./styles";

export const AI_TRACK_NAME = "AI";
export * from "./flatten";
configureTimebase(TICKS_PER_SECOND);

const ticks = (s: number) => Math.round(s * TICKS_PER_SECOND) as MediaTime;

const allTracks = (t: SceneTracks): TimelineTrack[] => [...t.overlay, t.main, ...t.audio];

/** The composition element (and its parent scene) that opens `sceneId`. */
export function findCompositionOwner(scenes: TScene[], sceneId: string): { scene: TScene; element: GraphicElement } | null {
	for (const scene of scenes) {
		for (const track of allTracks(scene.tracks)) {
			for (const el of track.elements as TimelineElement[]) {
				if (isComposition(el) && el.params.sceneId === sceneId) return { scene, element: el };
			}
		}
	}
	return null;
}

/** Active scene's tracks as they play: compositions expanded, AI layers removed. Inside a composition only its own
 * contents play; with "Show video underneath" on, the clips under it play underneath, read-only (never in an
 * export). The SAME object when there is nothing to do; otherwise memoized by (tracks, scenes, canvas). */
export function playbackTracks(editor: EditorCore, tracks?: SceneTracks | null): SceneTracks {
	const base = tracks ?? editor.scenes.getActiveScene().tracks;
	const scenes = editor.scenes.getScenes();
	const exporting = editor.project.getExportState?.().isExporting ?? false;
	const owner = exporting ? null : contextOwner(editor, scenes);
	const layered = hasCompositionsOrLayers(base);
	if (!owner && !layered && !hasMotionCached(base)) return base;
	// Hand-made motion alone needs no Remotion renderer.
	if (owner || layered) prefetchRenderer();
	const settings = editor.project.getActiveOrNull()?.settings;
	const canvas = settings?.canvasSize;
	const fps = projectFps(settings?.fps);
	const proxies = useLayerProxies.getState().version;
	const hit = flatCache.get(base);
	if (hit && hit.scenes === scenes && hit.w === canvas?.width && hit.h === canvas?.height && hit.fps === fps && hit.context === !!owner && hit.proxies === proxies) return hit.tracks;
	const flattened = flattenCompositions({ tracks: base, scenes, canvas, fps });
	let flat = flattened.tracks;
	if (owner) flat = withContext(flat, owner, scenes, canvas, fps);
	else if (canvas?.width && canvas?.height) {
		// AI layers with clips above them: their transparent renders take their place in the stack (see layer-proxies).
		const groups = coveredGroups(flattened, { width: canvas.width, height: canvas.height }, fps);
		if (groups.length) {
			if (!exporting) scheduleProxies(groups);
			flat = withProxies(flat, groups);
		}
	}
	flatCache.set(base, { scenes, w: canvas?.width, h: canvas?.height, fps, context: !!owner, proxies, tracks: flat });
	return flat;
}

/** Frames per second of a project's rate (30 when unknown). */
export const projectFps = (rate?: { numerator: number; denominator: number } | null) => (rate && rate.denominator > 0 ? rate.numerator / rate.denominator : 30);

/** The composition being edited (when its output has alpha), else null. */
function contextOwner(editor: EditorCore, scenes: TScene[]) {
	const active = editor.scenes.getActiveSceneOrNull();
	if (!active || active.isMain) return null;
	const owner = findCompositionOwner(scenes, active.id);
	return owner && showsUnderlay(owner.element) ? owner : null;
}


/** Puts the parent's clips under the composition's range beneath its own tracks, in composition time. */
function withContext(
	inner: SceneTracks,
	owner: { scene: TScene; element: GraphicElement },
	scenes: TScene[],
	canvas?: { width?: number; height?: number },
	fps?: number,
): SceneTracks {
	const el = owner.element;
	const strip = <T extends TimelineTrack>(t: T): T => ({ ...t, elements: (t.elements as TimelineElement[]).filter((e) => e.id !== el.id) }) as T;
	const parent: SceneTracks = { overlay: owner.scene.tracks.overlay.map(strip), main: strip(owner.scene.tracks.main), audio: owner.scene.tracks.audio.map(strip) };
	const shift = el.startTime - el.trimStart;
	const ctx = flattenCompositions({ tracks: parent, scenes, canvas, window: { start: el.startTime, end: el.startTime + el.duration, offset: 0 }, fps }).tracks;
	const move = <T extends TimelineTrack>(t: T, suffix: string): T =>
		({ ...t, id: `${t.id}~ctx${suffix}`, elements: (t.elements as TimelineElement[]).map((e) => ({ ...e, id: `${e.id}~ctx`, startTime: (e.startTime - shift) as MediaTime })) }) as T;
	return {
		overlay: [...inner.overlay, { ...inner.main, id: `${inner.main.id}~inner` } as OverlayTrack, ...ctx.overlay.map((t) => move(t, ""))],
		main: move(ctx.main, "m"),
		audio: [...inner.audio, ...ctx.audio.map((t) => move(t, ""))],
	};
}

const flatCache = new WeakMap<SceneTracks, { scenes: TScene[]; w?: number; h?: number; fps: number; context: boolean; proxies: number; tracks: SceneTracks }>();

const motionCache = new WeakMap<SceneTracks, boolean>();
/** Clips with a hand-made In / Out motion (motion.ts) play through flattening, which bakes it into keyframes. */
function hasMotionCached(tracks: SceneTracks): boolean {
	const known = motionCache.get(tracks);
	if (known !== undefined) return known;
	const has = hasMotionLayers(tracks);
	motionCache.set(tracks, has);
	return has;
}

const hasCache = new WeakMap<SceneTracks, boolean>();
export function hasCompositionsOrLayers(tracks: SceneTracks): boolean {
	const known = hasCache.get(tracks);
	if (known !== undefined) return known;
	const has = allTracks(tracks).some((t) => (t.elements as TimelineElement[]).some((e) => e.type === "graphic" && e.definitionId.startsWith(AI_PREFIX)));
	hasCache.set(tracks, has);
	return has;
}

// ───────────────────────── commands (one ⌘Z each) ─────────────────────────

/** Swaps the whole scene list (and the open scene) — undo restores both. */
export class ScenesSnapshotCommand extends Command {
	constructor(
		private before: TScene[],
		private after: TScene[],
		private activeBefore: string,
		private activeAfter: string,
		private selection?: ElementRef[],
	) {
		super();
	}
	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		editor.scenes.setScenes({ scenes: this.after, activeSceneId: this.activeAfter });
		if (this.activeAfter !== this.activeBefore) void editor.scenes.switchToScene({ sceneId: this.activeAfter });
		return this.selection ? { selection: { selectedElements: this.selection, selectedKeyframes: [], keyframeSelectionAnchor: null, selectedMaskPoints: null } } : undefined;
	}
	undo(): void {
		const editor = EditorCore.getInstance();
		editor.scenes.setScenes({ scenes: this.before, activeSceneId: this.activeBefore });
		if (this.activeAfter !== this.activeBefore) void editor.scenes.switchToScene({ sceneId: this.activeBefore });
	}
}

function nextCompositionNumber(scenes: TScene[]): number {
	let n = 0;
	for (const s of scenes) {
		const m = /^Composition (\d+)$/.exec(s.name);
		if (m) n = Math.max(n, Number(m[1]));
	}
	return n + 1;
}


function afterOpen(editor: EditorCore) {
	editor.playback.pause();
	editor.selection.clearSelection();
	editor.playback.seek({ time: 0 as MediaTime });
}

/** Clips that open the same inner scene (a duplicated/pasted composition clip). */
function sharers(scenes: TScene[], sceneId: string): GraphicElement[] {
	const out: GraphicElement[] = [];
	for (const scene of scenes) for (const track of allTracks(scene.tracks)) for (const el of track.elements as TimelineElement[]) if (isComposition(el) && el.params.sceneId === sceneId) out.push(el);
	return out;
}

/** A copy of a scene under a new id: fresh track and element ids, nested compositions repointed through `sceneIds`. */
function cloneScene(source: TScene, id: string, sceneIds: Map<string, string>, idMap?: Map<string, string>): TScene {
	const fresh = <T extends TimelineTrack>(t: T): T =>
		({
			...t,
			id: generateUUID(),
			elements: (t.elements as TimelineElement[]).map((e) => {
				const next = generateUUID();
				idMap?.set(e.id, next);
				const nested = isComposition(e) ? sceneIds.get(String(e.params.sceneId)) : undefined;
				return { ...e, id: next, ...(nested ? { params: { ...e.params, sceneId: nested } } : {}) };
			}),
		}) as T;
	// a copy is its clip's inner timeline only: never a second Media compound, never a former timeline (tla3 B, F2); the
	// copy of a Media compound (stored not nested, F9) is marked nested as every inner timeline
	const { inMedia, formerTimeline: _former, ...rest } = source;
	return { ...rest, ...(inMedia && { nested: true }), id, tracks: { overlay: source.tracks.overlay.map(fresh), main: fresh(source.tracks.main), audio: source.tracks.audio.map(fresh) }, updatedAt: new Date() };
}

/**
 * A duplicated (⌥-drag, Duplicate) composition clip still points at the original's inner scene. Before one of
 * them is opened or edited, THAT one gets its own copy of the scene (new ids); the others keep the old content.
 * Pure: returns the new scene list (or null when the clip already owns its scene) and the old → new element ids.
 */
function withOwnScene(scenes: TScene[], elementId: string): { scenes: TScene[]; sceneId: string; idMap: Map<string, string> } | null {
	let element: GraphicElement | null = null;
	for (const sc of scenes) for (const t of allTracks(sc.tracks)) for (const e of t.elements as TimelineElement[]) if (e.id === elementId && isComposition(e)) element = e;
	if (!element) return null;
	const sceneId = String(element.params.sceneId ?? "");
	if (sharers(scenes, sceneId).length < 2) return null;
	const source = scenes.find((sc) => sc.id === sceneId);
	if (!source) return null;
	const idMap = new Map<string, string>();
	const copy = cloneScene(source, generateUUID(), new Map(), idMap);
	const repoint = <T extends TimelineTrack>(t: T): T =>
		({ ...t, elements: (t.elements as TimelineElement[]).map((e) => (e.id === elementId ? { ...e, params: { ...e.params, sceneId: copy.id } } : e)) }) as T;
	return {
		scenes: [...scenes.map((sc) => ({ ...sc, tracks: { overlay: sc.tracks.overlay.map(repoint), main: repoint(sc.tracks.main), audio: sc.tracks.audio.map(repoint) } })), copy],
		sceneId: copy.id,
		idMap,
	};
}

function ensureOwnScene(element: GraphicElement, editor: EditorCore): string {
	const scenes = editor.scenes.getScenes();
	const own = withOwnScene(scenes, element.id);
	if (!own) return String(element.params.sceneId ?? "");
	const active = editor.scenes.getActiveScene().id;
	editor.command.execute({ command: new ScenesSnapshotCommand(scenes, own.scenes, active, active) });
	return own.sceneId;
}

/**
 * Changes one AI layer's params wherever it lives (the open timeline or a composition shown flattened), in ONE
 * undo step. Editing a layer of a duplicated composition first gives that composition its own scene, so only
 * that copy changes.
 */
export function patchAiLayer({
	elementId,
	owner,
	patch,
	editor = EditorCore.getInstance(),
}: {
	elementId: string;
	owner?: string;
	patch: (params: GraphicElement["params"]) => GraphicElement["params"];
	editor?: EditorCore;
}): boolean {
	const before = editor.scenes.getScenes();
	let scenes = before;
	let id = elementId;
	if (owner) {
		const own = withOwnScene(scenes, owner);
		if (own) {
			scenes = own.scenes;
			id = own.idMap.get(elementId) ?? elementId;
		}
	}
	let found = false;
	const mapTrack = <T extends TimelineTrack>(t: T): T =>
		({
			...t,
			elements: (t.elements as TimelineElement[]).map((e) => {
				if (e.id !== id || !isAiLayer(e)) return e;
				found = true;
				return { ...e, params: patch(e.params) };
			}),
		}) as T;
	const after = scenes.map((sc) => {
		const next = { ...sc, tracks: { overlay: sc.tracks.overlay.map(mapTrack), main: mapTrack(sc.tracks.main), audio: sc.tracks.audio.map(mapTrack) } };
		return next;
	});
	if (!found) return false;
	const active = editor.scenes.getActiveScene().id;
	editor.command.execute({ command: new ScenesSnapshotCommand(before, after, active, active) });
	return true;
}

/** Finds an AI layer element by id anywhere in the project. */
export function findAiLayer(elementId: string, editor = EditorCore.getInstance()): GraphicElement | null {
	for (const sc of editor.scenes.getScenes()) for (const t of allTracks(sc.tracks)) for (const e of t.elements as TimelineElement[]) if (e.id === elementId && isAiLayer(e)) return e;
	return null;
}

// ───────────────────────── copy / paste as templates ─────────────────────────

/** Inner scenes captured when composition clips are copied (keyed by the clipboard entry; works across projects). */
const copiedScenes = new WeakMap<object, TScene[]>();

type ClipEntry = { type: string; items?: { element: { params?: Record<string, unknown> } & Record<string, unknown> }[] };

export function rememberCompositionScenes(value: unknown, editor = EditorCore.getInstance()): void {
	const entry = value as ClipEntry | null;
	if (!entry || entry.type !== "elements" || !entry.items) return;
	const scenes = editor.scenes.getScenes();
	const needed = new Map<string, TScene>();
	const visit = (sceneId: string) => {
		if (needed.has(sceneId)) return;
		const sc = scenes.find((x) => x.id === sceneId);
		if (!sc) return;
		needed.set(sceneId, sc);
		for (const t of allTracks(sc.tracks)) for (const e of t.elements as TimelineElement[]) if (isComposition(e)) visit(String(e.params.sceneId));
	};
	for (const it of entry.items) if (isComposition(it.element as unknown as TimelineElement)) visit(String(it.element.params?.sceneId ?? ""));
	if (needed.size) copiedScenes.set(entry, [...needed.values()]);
}

/** A pasted composition clip gets its own copy of the inner scene (and of nested ones): an independent template copy. */
export function prepareCompositionPaste<T>(value: T): { entry: T; scenes: TScene[] } {
	const entry = value as unknown as ClipEntry;
	const snap = copiedScenes.get(entry);
	if (!snap?.length || !entry.items) return { entry: value, scenes: [] };
	const ids = new Map(snap.map((sc) => [sc.id, generateUUID()]));
	// Each copy gets its own name (Composition N / AI Composition N), so copies are told apart everywhere.
	let n = nextCompositionNumber(EditorCore.getInstance().scenes.getScenes());
	const numbers = new Map(snap.map((sc) => [sc.id, n++]));
	const scenes = snap.map((sc) => ({ ...cloneScene(sc, ids.get(sc.id)!, ids), name: /^Composition \d+$/.test(sc.name) ? `Composition ${numbers.get(sc.id)}` : sc.name }));
	const items = entry.items.map((it) => {
		const old = String(it.element.params?.sceneId);
		if (!isComposition(it.element as unknown as TimelineElement) || !ids.has(old)) return it;
		const name = typeof it.element.name === "string" && /^AI Composition \d+$/.test(it.element.name) ? `AI Composition ${numbers.get(old)}` : it.element.name;
		return { ...it, element: { ...it.element, name, params: { ...it.element.params, sceneId: ids.get(old) } } };
	});
	return { entry: { ...entry, items } as unknown as T, scenes };
}

/** Adds scenes (the inner timelines of pasted compositions); undo removes them again. */
export class AddScenesCommand extends Command {
	constructor(private scenes: TScene[]) {
		super();
	}
	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const ids = new Set(this.scenes.map((sc) => sc.id));
		editor.scenes.setScenes({ scenes: [...editor.scenes.getScenes().filter((sc) => !ids.has(sc.id)), ...this.scenes] });
		return undefined;
	}
	undo(): void {
		const editor = EditorCore.getInstance();
		const ids = new Set(this.scenes.map((sc) => sc.id));
		editor.scenes.setScenes({ scenes: editor.scenes.getScenes().filter((sc) => !ids.has(sc.id)) });
	}
}

/** Double-click a composition → its inner timeline (navigation, not an undo step). */
export async function openComposition(element: TimelineElement, editor = EditorCore.getInstance()): Promise<void> {
	if (!isComposition(element)) return;
	const sceneId = ensureOwnScene(element, editor);
	if (!editor.scenes.getScenes().some((s) => s.id === sceneId)) return;
	editor.playback.pause();
	editor.selection.clearSelection();
	await editor.scenes.switchToScene({ sceneId });
	afterOpen(editor);
}

/** The open timeline is a compound clip's (or an AI composition's) own: Back / Esc / the breadcrumb lead out of it. */
export function insideCompound(editor = EditorCore.getInstance()): boolean {
	const active = editor.scenes.getActiveSceneOrNull();
	// a compound clip kept in Media (timeline/media-compounds.ts) has no clip that holds it: Back leads to the main timeline
	return !!active && !active.isMain && (!!active.inMedia || !!findCompositionOwner(editor.scenes.getScenes(), active.id));
}

/**
 * Back to the parent timeline exactly as it was left: its playhead (scenes-manager remembers it per timeline), zoom
 * and scroll (the timeline remembers them there too) — level by level for compounds inside compounds. Navigation
 * only: no undo step. A parent never left in this session (the project was opened inside the clip) gets the playhead
 * on the composition.
 */
export async function closeComposition(editor = EditorCore.getInstance()): Promise<void> {
	const active = editor.scenes.getActiveSceneOrNull();
	if (!active) return;
	const owner = findCompositionOwner(editor.scenes.getScenes(), active.id);
	const target = owner?.scene ?? editor.scenes.getScenes().find((s) => s.isMain);
	if (!target) return;
	editor.playback.pause();
	editor.selection.clearSelection();
	const left = editor.scenes.playheadOf(target.id);
	await editor.scenes.switchToScene({ sceneId: target.id });
	if (owner) {
		// a compound clip takes the length of what is in it now (timeline/compound.ts)
		const { syncCompoundLength } = await import("@/timeline/compound");
		syncCompoundLength(editor, owner.element.id, editor.scenes.getScenes().find((scene) => scene.id === active.id) ?? active);
		if (left === undefined) editor.playback.seek({ time: owner.element.startTime });
	}
}

// ───────────────────────── AI layers: generate, restyle, versions ─────────────────────────

/** A saved generation of a composition (restorable from the Versions menu). */
export interface CompositionVersion {
	n: number;
	prompt: string;
	style: string;
	at: number;
	layers: { definitionId: string; name: string; startTime: number; duration: number; params: Record<string, unknown> }[];
}

const MAX_VERSIONS = 12;
const MAX_CHAT = 24;

/** One turn of a composition's conversation with the AI (kept on the composition clip, saved with the project). */
export interface ChatTurn {
	role: "user" | "assistant";
	text: string;
	at: number;
	mode?: "quick" | "full";
}

export function readChat(owner: GraphicElement | null | undefined): ChatTurn[] {
	const raw = owner?.params.chat;
	if (typeof raw !== "string" || !raw.startsWith("[")) return [];
	try {
		const list = JSON.parse(raw) as ChatTurn[];
		return Array.isArray(list) ? list.filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string") : [];
	} catch {
		return [];
	}
}

export function readVersions(owner: GraphicElement | null | undefined): CompositionVersion[] {
	const raw = owner?.params.versions;
	if (typeof raw !== "string" || !raw.startsWith("[")) return [];
	try {
		return JSON.parse(raw) as CompositionVersion[];
	} catch {
		return [];
	}
}

function patchOwner(scenes: TScene[], sceneId: string, patch: (el: GraphicElement) => GraphicElement): TScene[] {
	const owner = findCompositionOwner(scenes, sceneId);
	if (!owner) return scenes;
	const mapTrack = <T extends TimelineTrack>(t: T): T => ({
		...t,
		elements: (t.elements as TimelineElement[]).map((e) => (e.id === owner.element.id ? patch(e as GraphicElement) : e)),
	}) as T;
	return scenes.map((s) =>
		s.id === owner.scene.id
			? { ...s, tracks: { overlay: s.tracks.overlay.map(mapTrack), main: mapTrack(s.tracks.main), audio: s.tracks.audio.map(mapTrack) }, updatedAt: new Date() }
			: s,
	);
}

function layoutAiTracks(scene: TScene, layers: GraphicElement[], sfx?: TimelineElement[]): SceneTracks {
	const overlay = scene.tracks.overlay
		.map((t) => (t.type === "graphic" ? ({ ...t, elements: t.elements.filter((e) => !isAiLayer(e)) } as GraphicTrack) : t))
		.filter((t) => t.elements.length > 0 || t.type !== "graphic" || t.name !== AI_TRACK_NAME);
	// Interval partitioning: overlapping layers go to separate «AI» tracks; earlier kinds stay on top.
	const lanes: GraphicElement[][] = [];
	for (const el of [...layers].sort((a, b) => a.startTime - b.startTime)) {
		const lane = lanes.find((l) => l.every((o) => o.startTime + o.duration <= el.startTime || el.startTime + el.duration <= o.startTime));
		if (lane) lane.push(el);
		else lanes.push([el]);
	}
	const aiTracks: GraphicTrack[] = lanes.map((elements) => ({ ...buildEmptyTrack({ id: generateUUID(), type: "graphic", name: AI_TRACK_NAME }), elements }));
	let audio = scene.tracks.audio;
	if (sfx?.length) {
		const lanesA: TimelineElement[][] = [];
		for (const el of [...sfx].sort((a, b) => a.startTime - b.startTime)) {
			const lane = lanesA.find((l) => l.every((o) => o.startTime + o.duration <= el.startTime));
			if (lane) lane.push(el);
			else lanesA.push([el]);
		}
		audio = [...audio, ...lanesA.map((elements) => ({ ...buildEmptyTrack({ id: generateUUID(), type: "audio", name: "AI SFX" }), elements }) as AudioTrack)];
	}
	return { ...scene.tracks, overlay: [...aiTracks, ...overlay], audio };
}

/**
 * Replaces the AI layers of a composition in one undo step; optionally records the generation as a version and
 * stores the style and the prompt on the composition clip.
 */
export function replaceAiLayers({
	sceneId,
	layers,
	sfx,
	version,
	chat,
	original,
	editor = EditorCore.getInstance(),
}: {
	sceneId: string;
	layers: GraphicElement[];
	sfx?: TimelineElement[];
	version?: { prompt: string; style: string };
	/** Turns to append to this composition's conversation (same undo step). */
	chat?: ChatTurn[];
	/** The user's own media the new layers animate: hidden or removed in the same undo step. */
	original?: { id: string; action: "hide" | "remove" }[];
	editor?: EditorCore;
}): void {
	const before = editor.scenes.getScenes();
	const scene = before.find((s) => s.id === sceneId);
	if (!scene) return;
	const acts = new Map((original ?? []).map((o) => [o.id, o.action]));
	const applyOriginal = (sc: TScene): TScene => {
		if (!acts.size) return sc;
		const mapTrack = <T extends TimelineTrack>(t: T): T =>
			({
				...t,
				elements: (t.elements as TimelineElement[])
					.filter((e) => acts.get(e.id) !== "remove")
					.map((e) => (acts.get(e.id) === "hide" ? ({ ...e, hidden: true } as TimelineElement) : e)),
			}) as T;
		return { ...sc, tracks: { overlay: sc.tracks.overlay.map(mapTrack), main: mapTrack(sc.tracks.main), audio: sc.tracks.audio.map(mapTrack) } };
	};
	let after = before.map((s) => (s.id === sceneId ? { ...s, tracks: layoutAiTracks(applyOriginal(s), layers, sfx), updatedAt: new Date() } : s));
	if (version) {
		after = patchOwner(after, sceneId, (el) => {
			const versions = readVersions(el);
			const n = (versions[versions.length - 1]?.n ?? 0) + 1;
			const entry: CompositionVersion = {
				n,
				prompt: version.prompt,
				style: version.style,
				at: Date.now(),
				layers: layers.map((l) => ({ definitionId: l.definitionId, name: l.name, startTime: l.startTime, duration: l.duration, params: l.params })),
			};
			const turns: Record<string, string> = chat?.length ? { chat: JSON.stringify([...readChat(el), ...chat].slice(-MAX_CHAT)) } : {};
			return {
				...el,
				params: { ...el.params, style: version.style, lastPrompt: version.prompt, version: n, versions: JSON.stringify([...versions, entry].slice(-MAX_VERSIONS)), ...turns },
			};
		});
	}
	const active = editor.scenes.getActiveScene().id;
	editor.command.execute({ command: new ScenesSnapshotCommand(before, after, active, active) });
}

/** Restores a saved version (one undo step). */
export function restoreVersion(sceneId: string, n: number, editor = EditorCore.getInstance()): boolean {
	const before = editor.scenes.getScenes();
	const owner = findCompositionOwner(before, sceneId);
	const v = readVersions(owner?.element).find((x) => x.n === n);
	const scene = before.find((s) => s.id === sceneId);
	if (!v || !scene) return false;
	const layers: GraphicElement[] = v.layers.map((l) => ({
		id: generateUUID(),
		type: "graphic",
		name: l.name,
		definitionId: l.definitionId,
		startTime: l.startTime as MediaTime,
		duration: l.duration as MediaTime,
		trimStart: 0 as MediaTime,
		trimEnd: 0 as MediaTime,
		params: l.params as GraphicElement["params"],
	}));
	let after = before.map((s) => (s.id === sceneId ? { ...s, tracks: layoutAiTracks(s, layers), updatedAt: new Date() } : s));
	after = patchOwner(after, sceneId, (el) => ({ ...el, params: { ...el.params, style: v.style, version: v.n } }));
	const active = editor.scenes.getActiveScene().id;
	editor.command.execute({ command: new ScenesSnapshotCommand(before, after, active, active) });
	return true;
}

/** Applies a style to the composition and restyles all its AI layers at once (one undo step). */
export function setCompositionStyle(sceneId: string, style: string, editor = EditorCore.getInstance()): void {
	const before = editor.scenes.getScenes();
	const restyle = (t: TimelineTrack) => ({
		...t,
		elements: (t.elements as TimelineElement[]).map((e) => {
			if (!isAiLayer(e)) return e;
			// The accent follows the style (shown as the real colour in Properties; editable there).
			return { ...e, params: { ...e.params, style, accent: styleOf(style).accent } };
		}),
	});
	let after = before.map((s) =>
		s.id === sceneId
			? { ...s, tracks: { overlay: s.tracks.overlay.map(restyle) as OverlayTrack[], main: restyle(s.tracks.main) as VideoTrack, audio: s.tracks.audio }, updatedAt: new Date() }
			: s,
	);
	after = patchOwner(after, sceneId, (el) => ({ ...el, params: { ...el.params, style } }));
	const active = editor.scenes.getActiveScene().id;
	editor.command.execute({ command: new ScenesSnapshotCommand(before, after, active, active) });
}
