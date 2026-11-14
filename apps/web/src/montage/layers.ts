// The layers of a Remotion AI Composition as the user edits them by hand (After Effects for beginners): every
// visual clip of the composition's timeline — what the AI made (ai.<Kind>) and what the user added (text, shapes,
// pictures) — top of the stack first. Z-order is track order: a layer moves up or down by going onto its own track
// right above or below its neighbour. Pure (no editor core): the panel and the tests share it.
import type { OverlayTrack, SceneTracks, TimelineElement, TimelineTrack } from "@/timeline/types";
import { buildEmptyTrack } from "@/timeline/placement/track-factory";
import { getTrackTypeForElementType } from "@/timeline/placement/compatibility";
import { AI_PREFIX, KIND_BY_ID } from "./catalog";
import { COMPOSITION_DEF } from "./flatten";

export type LayerKind = "text" | "rect" | "circle" | "shape" | "image" | "video" | "sticker" | "ai" | "composition";

export interface LayerRow {
	trackId: string;
	id: string;
	kind: LayerKind;
	/** What the row shows: the text, the AI layer's kind, the clip's name. */
	label: string;
	/** Timeline seconds inside the composition. */
	from: number;
	to: number;
	hidden: boolean;
	/** On the composition's main track: always the bottom of the stack, it doesn't move up or down. */
	main: boolean;
}

const VISUAL = new Set(["text", "graphic", "image", "video", "sticker"]);
export const SHAPE_DEFINITIONS = new Set(["rectangle", "ellipse", "polygon", "star"]);

export function layerKind(el: TimelineElement): LayerKind {
	if (el.type === "text") return "text";
	if (el.type === "image") return "image";
	if (el.type === "video") return "video";
	if (el.type === "sticker") return "sticker";
	if (el.type === "graphic") {
		if (el.definitionId === COMPOSITION_DEF) return "composition";
		if (el.definitionId.startsWith(AI_PREFIX)) return "ai";
		if (el.definitionId === "rectangle") return "rect";
		if (el.definitionId === "ellipse") return "circle";
	}
	return "shape";
}

const firstLine = (v: unknown) => (typeof v === "string" ? v.replace(/[*]+/g, "").split("\n").find((l) => l.trim())?.trim() ?? "" : "");

/**
 * The name the user typed in the layer list (After Effects: a renamed text layer no longer follows its words). Kept
 * in params, next to the motion keys, because a text or AI layer's row shows its words, not the clip's name.
 */
export const LAYER_NAME = "layer.name";

export function layerLabel(el: TimelineElement): string {
	const p = (el as { params?: Record<string, unknown> }).params ?? {};
	const own = typeof p[LAYER_NAME] === "string" ? p[LAYER_NAME].trim() : "";
	if (own) return own;
	if (el.type === "text") return firstLine(p.content) || el.name;
	if (el.type === "graphic" && el.definitionId.startsWith(AI_PREFIX) && el.definitionId !== COMPOSITION_DEF) {
		const kind = KIND_BY_ID.get(el.definitionId.slice(AI_PREFIX.length))?.label ?? el.definitionId.slice(AI_PREFIX.length);
		const text = [p.text, p.title, p.name, p.label, p.emoji].map(firstLine).find(Boolean);
		return text ? `${kind} · ${text}` : kind;
	}
	return el.name;
}

/**
 * The patch that renames a layer (one ⌘Z): the clip's name and the list's own name. Null when nothing changes —
 * the same name, or an empty one (an emptied field is a cancel, the row keeps its name).
 */
export function renameLayerPatch(el: TimelineElement, typed: string): Partial<TimelineElement> | null {
	const name = typed.replace(/\s+/g, " ").trim();
	if (!name || name === layerLabel(el)) return null;
	const params = (el as { params?: Record<string, unknown> }).params ?? {};
	return { name, params: { ...params, [LAYER_NAME]: name } } as Partial<TimelineElement>;
}

/** Every visual layer, top of the stack first (overlay tracks top-first, then the main track; by time inside one). */
export function listLayers(tracks: SceneTracks, ticksPerSecond: number): LayerRow[] {
	const rows: LayerRow[] = [];
	const add = (t: TimelineTrack, main: boolean) => {
		const els = [...(t.elements as TimelineElement[])].filter((e) => VISUAL.has(e.type)).sort((a, b) => a.startTime - b.startTime);
		for (const el of els) {
			rows.push({
				trackId: t.id,
				id: el.id,
				kind: layerKind(el),
				label: layerLabel(el),
				from: el.startTime / ticksPerSecond,
				to: (el.startTime + el.duration) / ticksPerSecond,
				hidden: ("hidden" in el && !!el.hidden) || ("hidden" in t && !!t.hidden),
				main,
			});
		}
	};
	for (const t of tracks.overlay) add(t, false);
	add(tracks.main, true);
	return rows;
}

const withoutElement = <T extends TimelineTrack>(t: T, id: string): T => ({ ...t, elements: (t.elements as TimelineElement[]).filter((e) => e.id !== id) }) as T;

/**
 * The layer one step up (`up`) or down the stack: it goes onto a new track of its own right above the next track
 * up (or right below the next one down); a track it leaves empty goes. Null when it can't move that way (already
 * on top / at the bottom of the overlay tracks, or on the main track).
 */
export function reorderLayer(tracks: SceneTracks, elementId: string, dir: "up" | "down", newTrackId: string): SceneTracks | null {
	const from = tracks.overlay.findIndex((t) => (t.elements as TimelineElement[]).some((e) => e.id === elementId));
	if (from < 0) return null;
	const target = dir === "up" ? from - 1 : from + 1;
	if (target < 0 || target >= tracks.overlay.length) return null;
	const source = tracks.overlay[from];
	const el = (source.elements as TimelineElement[]).find((e) => e.id === elementId)!;
	const type = getTrackTypeForElementType({ elementType: el.type });
	const own = { ...buildEmptyTrack({ id: newTrackId, type: type as "graphic", name: source.name }), elements: [el] } as unknown as OverlayTrack;
	const overlay: OverlayTrack[] = [];
	tracks.overlay.forEach((t, i) => {
		if (dir === "up" && i === target) overlay.push(own);
		if (i === from) {
			const rest = withoutElement(t, elementId);
			if (rest.elements.length) overlay.push(rest);
		} else overlay.push(t);
		if (dir === "down" && i === target) overlay.push(own);
	});
	return { ...tracks, overlay };
}

/**
 * The layer dragged onto another layer's row: step by step up or down until it sits right above (dragged up) or
 * right below (dragged down) that layer. Null when nothing moves (same layer, a main-track one, already there).
 */
export function reorderLayerTo(tracks: SceneTracks, elementId: string, targetId: string, newId: () => string): { tracks: SceneTracks } | null {
	const at = (t: SceneTracks, id: string) => t.overlay.findIndex((tr) => (tr.elements as TimelineElement[]).some((e) => e.id === id));
	const from = at(tracks, elementId);
	const to = at(tracks, targetId);
	if (from < 0 || to < 0 || elementId === targetId) return null;
	const dir = to < from ? "up" : "down";
	let cur = tracks;
	let moved = false;
	for (let i = 0; i <= tracks.overlay.length + 1; i++) {
		const a = at(cur, elementId);
		const b = at(cur, targetId);
		if (dir === "up" ? a < b : a > b) break;
		const next = reorderLayer(cur, elementId, dir, newId());
		if (!next) break;
		cur = next;
		moved = true;
	}
	return moved ? { tracks: cur } : null;
}

/** A new layer on a new track on top of the stack (After Effects puts a new layer on top). */
export function addLayerOnTop(tracks: SceneTracks, element: TimelineElement, newTrackId: string, trackName?: string): SceneTracks {
	const type = getTrackTypeForElementType({ elementType: element.type });
	const track = { ...buildEmptyTrack({ id: newTrackId, type: type as "graphic", ...(trackName ? { name: trackName } : {}) }), elements: [element] } as unknown as OverlayTrack;
	return { ...tracks, overlay: [track, ...tracks.overlay] };
}

// ───────────────────────── sizes ─────────────────────────

/** A shape (graphic) at scale 1 is a square of the canvas's short side (the 512 px tile fitted into the frame). */
export const shapeBase = (canvas: { width: number; height: number }) => Math.min(canvas.width, canvas.height);

/** The layer's size in canvas px at scale 1: a shape's square, a picture or clip fitted into the frame. */
export function baseSize(
	el: TimelineElement,
	canvas: { width: number; height: number },
	media?: { width?: number; height?: number } | null,
): { width: number; height: number } | null {
	if (el.type === "graphic") {
		const b = shapeBase(canvas);
		return { width: b, height: b };
	}
	if ((el.type === "image" || el.type === "video") && media?.width && media?.height) {
		const k = Math.min(canvas.width / media.width, canvas.height / media.height);
		return { width: media.width * k, height: media.height * k };
	}
	return null;
}
