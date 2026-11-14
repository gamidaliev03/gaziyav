/**
 * Pure timeline edits behind the hotkeys (tracks in → tracks out). No editor access here,
 * so every rule is unit-tested; `use-editor-actions.ts` commits the result as one command.
 */
import { applyRippleAdjustments, computeRippleAdjustments } from "@/ripple";
import { buildEffectParamPath, parseEffectParamPath, parseGraphicParamPath } from "@/animation/param-paths";
import type { ElementAnimations } from "@/animation/types";
import type { Effect } from "@/effects/types";
import type { ParamValues } from "@/params";
import type {
	ElementRef,
	ElementType,
	RetimeConfig,
	SceneTracks,
	TimelineElement,
	TimelineTrack,
} from "@/timeline/types";
import { generateUUID } from "@/utils/id";
import type { MediaTime } from "@/wasm";
import { buildEmptyTrack } from "@/timeline/placement/track-factory";

export function listTracks(tracks: SceneTracks): TimelineTrack[] {
	return [...tracks.overlay, tracks.main, ...tracks.audio];
}

function mapTrackElements<TTrack extends TimelineTrack>({
	track,
	map,
}: {
	track: TTrack;
	map: (elements: TimelineElement[], track: TimelineTrack) => TimelineElement[];
}): TTrack {
	const elements = map(track.elements, track);
	if (elements === track.elements) return track;
	// Elements keep their own type; the track's element union is preserved.
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
	return { ...track, elements } as TTrack;
}

export function mapSceneElements({
	tracks,
	map,
}: {
	tracks: SceneTracks;
	map: (elements: TimelineElement[], track: TimelineTrack) => TimelineElement[];
}): SceneTracks {
	return {
		overlay: tracks.overlay.map((track) => mapTrackElements({ track, map })),
		main: mapTrackElements({ track: tracks.main, map }),
		audio: tracks.audio.map((track) => mapTrackElements({ track, map })),
	};
}

function refKey({ trackId, elementId }: ElementRef): string {
	return `${trackId}\u0000${elementId}`;
}

/** Closes the gaps an edit left on the edited tracks (the engine's ripple rule). */
export function rippleTracks({
	before,
	after,
}: {
	before: SceneTracks;
	after: SceneTracks;
}): SceneTracks {
	const adjustments = computeRippleAdjustments({
		beforeTracks: before,
		afterTracks: after,
	});
	return applyRippleAdjustments({ tracks: after, adjustments });
}

export function removeElements({
	tracks,
	elements,
}: {
	tracks: SceneTracks;
	elements: ElementRef[];
}): SceneTracks {
	const keys = new Set(elements.map(refKey));
	return mapSceneElements({
		tracks,
		map: (list, track) => {
			const kept = list.filter(
				(element) => !keys.has(refKey({ trackId: track.id, elementId: element.id })),
			);
			return kept.length === list.length ? list : kept;
		},
	});
}

/** ⇧⌫: delete and pull later clips on the same track left to close the gap. */
export function rippleDeleteElements({
	tracks,
	elements,
}: {
	tracks: SceneTracks;
	elements: ElementRef[];
}): SceneTracks {
	return rippleTracks({
		before: tracks,
		after: removeElements({ tracks, elements }),
	});
}

/** Sorted unique cut points: 0, every clip start and end. */
export function getEditPoints(tracks: SceneTracks): number[] {
	const points = new Set<number>([0]);
	for (const track of listTracks(tracks)) {
		for (const element of track.elements) {
			points.add(element.startTime);
			points.add(element.startTime + element.duration);
		}
	}
	return [...points].sort((a, b) => a - b);
}

/** ↑ / ↓: the nearest edit point strictly before / after `time`. */
export function findAdjacentEditPoint({
	tracks,
	time,
	direction,
}: {
	tracks: SceneTracks;
	time: number;
	direction: "previous" | "next";
}): number | null {
	const points = getEditPoints(tracks);
	if (direction === "next") {
		return points.find((point) => point > time) ?? null;
	}
	for (let index = points.length - 1; index >= 0; index--) {
		if (points[index] < time) return points[index];
	}
	return null;
}

/** Elements whose span contains `time` (start inclusive, end exclusive). */
export function getElementsUnderPlayhead({
	tracks,
	time,
}: {
	tracks: SceneTracks;
	time: number;
}): ElementRef[] {
	const result: ElementRef[] = [];
	for (const track of listTracks(tracks)) {
		for (const element of track.elements) {
			if (time >= element.startTime && time < element.startTime + element.duration) {
				result.push({ trackId: track.id, elementId: element.id });
			}
		}
	}
	return result;
}

/**
 * , / . (⌥← / ⌥→ in Kadr): move the selected clips by `delta` ticks on their tracks.
 * Clamped at 0; returns null when nothing can move (start of timeline or a clip in the way).
 */
export function nudgeElements({
	tracks,
	elements,
	delta,
}: {
	tracks: SceneTracks;
	elements: ElementRef[];
	delta: number;
}): SceneTracks | null {
	if (elements.length === 0 || delta === 0) return null;
	const keys = new Set(elements.map(refKey));
	let effectiveDelta = delta;
	for (const track of listTracks(tracks)) {
		for (const element of track.elements) {
			if (!keys.has(refKey({ trackId: track.id, elementId: element.id }))) continue;
			if (element.startTime + effectiveDelta < 0) effectiveDelta = -element.startTime;
		}
	}
	if (effectiveDelta === 0) return null;

	let blocked = false;
	const next = mapSceneElements({
		tracks,
		map: (list, track) => {
			const moving = list.filter((element) =>
				keys.has(refKey({ trackId: track.id, elementId: element.id })),
			);
			if (moving.length === 0) return list;
			const staying = list.filter((element) => !moving.includes(element));
			for (const element of moving) {
				const start = element.startTime + effectiveDelta;
				const end = start + element.duration;
				const overlaps = staying.some(
					(other) =>
						start < other.startTime + other.duration && end > other.startTime,
				);
				if (overlaps) blocked = true;
			}
			return list.map((element) =>
				moving.includes(element)
					? { ...element, startTime: (element.startTime + effectiveDelta) as typeof element.startTime }
					: element,
			);
		},
	});
	return blocked ? null : next;
}

// ---------------------------------------------------------------------------------
// Copy / paste attributes (⌥⌘C / ⌥⌘V)

/** Params that are the clip's content, not its look: never pasted. */
const CONTENT_PARAM_KEYS: ReadonlySet<string> = new Set(["content", "highlight.index"]);

/** Clip types that carry an effect stack. */
const EFFECT_ELEMENT_TYPES: ReadonlySet<ElementType> = new Set([
	"video",
	"image",
	"text",
	"sticker",
	"graphic",
]);

export interface ElementAttributes {
	type: ElementType;
	params: ParamValues;
	effects?: Effect[];
	animations?: ElementAnimations;
	/** The clip's speed (none = normal); only clips with a picture or sound have one. */
	retime?: RetimeConfig;
	hasRetime?: boolean;
}

export function captureAttributes(element: TimelineElement): ElementAttributes {
	return {
		type: element.type,
		params: { ...element.params },
		effects:
			"effects" in element && element.effects
				? element.effects.map((effect) => ({ ...effect, params: { ...effect.params } }))
				: undefined,
		animations: element.animations ? structuredClone(element.animations) : undefined,
		hasRetime: "trimStart" in element,
		retime: "retime" in element && element.retime ? structuredClone(element.retime) : undefined,
	};
}

/** What «Paste Attributes…» can paste, each on its own checkbox. */
export type AttributeGroup = "transform" | "color" | "effects" | "speed" | "sound" | "keyframes" | "style";
export const ATTRIBUTE_GROUPS: ReadonlyArray<{ id: AttributeGroup; label: string; hint: string }> = [
	{ id: "transform", label: "Transform", hint: "Position, scale, rotation, opacity, blend" },
	{ id: "color", label: "Color", hint: "Color corrections and looks" },
	{ id: "effects", label: "Effects", hint: "The other effects of the clip" },
	{ id: "speed", label: "Speed", hint: "Speed and speed ramps" },
	{ id: "sound", label: "Sound", hint: "Volume, mute, fades, ducking" },
	{ id: "keyframes", label: "Keyframes", hint: "The animation of what is pasted" },
	{ id: "style", label: "Style", hint: "Text and caption look: font, stroke, shadow…" },
];
export const ALL_ATTRIBUTE_GROUPS: ReadonlySet<AttributeGroup> = new Set(ATTRIBUTE_GROUPS.map((group) => group.id));

const SOUND_PARAM_KEYS: ReadonlySet<string> = new Set(["volume", "muted", "fadeIn", "fadeOut", "duckUnderVoice", "voiceRole"]);

/** The checkbox a clip param belongs to. */
export function attributeGroupOfParam(key: string): AttributeGroup {
	if (key.startsWith("transform.") || key === "opacity" || key === "blendMode") return "transform";
	if (SOUND_PARAM_KEYS.has(key)) return "sound";
	return "style";
}



/** Same channels with the same keys, whatever order the channels are listed in. */
function isSameAnimations(a: ElementAnimations | undefined, b: ElementAnimations | undefined): boolean {
	const channels = (x: ElementAnimations | undefined) =>
		JSON.stringify(Object.entries(x ?? {}).filter(([, channel]) => channel).sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0)));
	return channels(a) === channels(b);
}

/** The param an animation path keys ("opacity", "params.size" → "size"); null for an effect's param. */
function animatedParamKey(path: string): string | null {
	if (parseEffectParamPath({ propertyPath: path })) return null;
	return parseGraphicParamPath({ propertyPath: path })?.paramKey ?? path;
}

/**
 * The target's animations after a paste. Keyframes are part of the look (Premiere pastes them too): every pasted
 * param takes the source's keys, or none when the source holds it still (the target's own keys would hide the
 * pasted value). Pasted effects bring their keys under their new ids; the replaced effects' keys go. Animations
 * of anything not pasted stay. Undefined when nothing is animated.
 */
function pasteAnimations({
	source,
	target,
	pastedKeys,
	effectIds,
}: {
	source: ElementAttributes;
	target: TimelineElement;
	pastedKeys: ReadonlySet<string>;
	effectIds: ReadonlyMap<string, string> | null;
}): ElementAnimations | undefined {
	const next: ElementAnimations = {};
	for (const [path, channel] of Object.entries(target.animations ?? {})) {
		if (!channel) continue;
		const key = animatedParamKey(path);
		if (key === null ? effectIds !== null : pastedKeys.has(key)) continue;
		next[path] = channel;
	}
	for (const [path, channel] of Object.entries(source.animations ?? {})) {
		if (!channel) continue;
		const key = animatedParamKey(path);
		if (key !== null) {
			if (pastedKeys.has(key)) next[path] = structuredClone(channel);
			continue;
		}
		const effect = parseEffectParamPath({ propertyPath: path });
		const effectId = effect ? effectIds?.get(effect.effectId) : undefined;
		if (effect && effectId) next[buildEffectParamPath({ effectId, paramKey: effect.paramKey })] = structuredClone(channel);
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * Patch that gives `target` the look of `source`: every param both clips have
 * (except content) with its keyframes, plus the effect stack for visual clips. Null when nothing applies.
 */
export function buildAttributesPatch({
	source,
	target,
	newId = generateUUID,
	include = ALL_ATTRIBUTE_GROUPS,
	isColorEffect = () => false,
}: {
	source: ElementAttributes;
	target: TimelineElement;
	newId?: () => string;
	/** The checked groups of «Paste Attributes…» (all by default). */
	include?: ReadonlySet<AttributeGroup>;
	/** Color effects (corrections, looks) go with «Color», the rest with «Effects» (the app passes the registry's category). */
	isColorEffect?: (effect: Effect) => boolean;
}): Partial<TimelineElement> | null {
	const params: ParamValues = {};
	const pastedKeys = new Set<string>();
	let changed = false;
	for (const [key, value] of Object.entries(source.params)) {
		if (CONTENT_PARAM_KEYS.has(key)) continue;
		// A clip of the same kind takes the param even if it never stored it (the default stood in for it).
		if (!(key in target.params) && target.type !== source.type) continue;
		if (!include.has(attributeGroupOfParam(key))) continue;
		pastedKeys.add(key);
		if (target.params[key] === value) continue;
		params[key] = value;
		changed = true;
	}
	const patch: Partial<TimelineElement> = {};
	if (changed) patch.params = { ...target.params, ...params };
	let effectIds: Map<string, string> | null = null;
	const pasteColor = include.has("color");
	const pasteOther = include.has("effects");
	if (source.effects && EFFECT_ELEMENT_TYPES.has(target.type) && (pasteColor || pasteOther)) {
		// Each pasted effect gets its own id so the clips stay independent. A group left unchecked keeps the
		// target's own effects of that kind.
		const pasted = (effect: Effect) => (isColorEffect(effect) ? pasteColor : pasteOther);
		effectIds = new Map();
		const kept = (("effects" in target && target.effects) || []).filter((effect) => !pasted(effect));
		const incoming = source.effects.filter(pasted).map((effect) => {
			const id = newId();
			effectIds?.set(effect.id, id);
			return { ...effect, id, params: { ...effect.params } };
		});
		Object.assign(patch, { effects: [...kept, ...incoming] });
		changed = true;
	}
	if (include.has("speed") && source.hasRetime && "trimStart" in target) {
		const current = "retime" in target ? target.retime : undefined;
		if (JSON.stringify(current ?? null) !== JSON.stringify(source.retime ?? null)) {
			Object.assign(patch, { retime: source.retime ? structuredClone(source.retime) : undefined });
			changed = true;
		}
	}
	// Without «Keyframes» the target keeps its own animation (pasted values sit under it where it has keys).
	if (include.has("keyframes")) {
		const animations = pasteAnimations({ source, target, pastedKeys, effectIds });
		if (!isSameAnimations(animations, target.animations)) {
			patch.animations = animations;
			changed = true;
		}
	}
	return changed ? patch : null;
}

/**
 * ⌥-drag: the dragged clips stay where they were and copies land at the drop point (`moved` is the scene after a plain
 * move: the dragged clips at the drop point, new tracks included). A copy that would overlap a clip on its track —
 * its own original after a short drag — makes room instead of turning the copy into a move: on the magnetic track
 * the copies go in at the next cut and push the rest right (titles after the cut follow, as with the magnet's other
 * edits); on any other track they go to a new track beside it.
 */
export function placeDragCopies({
	before,
	moved,
	moves,
	newId,
	magnetTrackId,
	copyElement = (element, id) => ({ ...element, id }),
}: {
	before: SceneTracks;
	moved: SceneTracks;
	moves: ReadonlyArray<{ elementId: string; sourceTrackId: string; targetTrackId: string }>;
	newId: () => string;
	/** The main track while the magnet is on, else null. */
	magnetTrackId: string | null;
	/** Makes the copy (the editor gives it fresh keyframe ids too). */
	copyElement?: (element: TimelineElement, id: string) => TimelineElement;
}): { tracks: SceneTracks; copies: ElementRef[] } {
	const copyIds = new Map(moves.map((move) => [move.elementId, newId()]));
	const originalsByTrack = new Map<string, TimelineElement[]>();
	for (const move of moves) {
		const original = listTracks(before)
			.find((track) => track.id === move.sourceTrackId)
			?.elements.find((element) => element.id === move.elementId);
		if (!original) continue;
		const list = originalsByTrack.get(move.sourceTrackId) ?? [];
		list.push(original);
		originalsByTrack.set(move.sourceTrackId, list);
	}

	const byStart = (a: TimelineElement, b: TimelineElement) => a.startTime - b.startTime;
	const overlaps = (a: TimelineElement, b: TimelineElement) =>
		a.startTime < b.startTime + b.duration && a.startTime + a.duration > b.startTime;

	const copiesByTrack = new Map<string, TimelineElement[]>();
	const baseByTrack = new Map<string, TimelineElement[]>();
	for (const track of listTracks(moved)) {
		const copies: TimelineElement[] = [];
		const rest: TimelineElement[] = [];
		for (const element of track.elements) {
			const copyId = copyIds.get(element.id);
			if (copyId) copies.push(copyElement(element, copyId));
			else rest.push(element);
		}
		if (copies.length > 0) copiesByTrack.set(track.id, copies);
		baseByTrack.set(track.id, [...rest, ...(originalsByTrack.get(track.id) ?? [])].sort(byStart));
	}

	// Where each track's copies go: the same track, an insert on the magnetic track, or a new track.
	let insert: { cut: number; length: number } | null = null;
	const toNewTrack: string[] = [];
	for (const [trackId, copies] of copiesByTrack) {
		const base = baseByTrack.get(trackId) ?? [];
		if (!copies.some((copy) => base.some((other) => overlaps(copy, other)))) {
			baseByTrack.set(trackId, [...base, ...copies].sort(byStart));
			continue;
		}
		if (trackId === magnetTrackId) {
			const blockStart = Math.min(...copies.map((copy) => copy.startTime));
			const blockEnd = Math.max(...copies.map((copy) => copy.startTime + copy.duration));
			// The next cut at or after the drop point: the end of the clip the copies landed in.
			const landedIn = base.find((other) => other.startTime < blockStart && other.startTime + other.duration > blockStart);
			const cut = landedIn ? landedIn.startTime + landedIn.duration : blockStart;
			const length = blockEnd - blockStart;
			const shift = cut - blockStart;
			baseByTrack.set(
				trackId,
				[
					...base.map((other) => (other.startTime >= cut ? { ...other, startTime: (other.startTime + length) as MediaTime } : other)),
					...copies.map((copy) => ({ ...copy, startTime: (copy.startTime + shift) as MediaTime })),
				].sort(byStart),
			);
			insert = { cut, length };
			continue;
		}
		toNewTrack.push(trackId);
	}

	const withElements = <TTrack extends TimelineTrack>(track: TTrack): TTrack => {
		let elements = baseByTrack.get(track.id) ?? track.elements;
		// Titles after an insert on the magnetic track move with the clips they belong to.
		if (insert && track.type === "text" && track.id !== magnetTrackId) {
			const { cut, length } = insert;
			elements = elements.map((other) => (other.startTime >= cut ? { ...other, startTime: (other.startTime + length) as MediaTime } : other));
		}
		return { ...track, elements } as TTrack;
	};
	let tracks: SceneTracks = {
		overlay: moved.overlay.map(withElements),
		main: withElements(moved.main),
		audio: moved.audio.map(withElements),
	};

	const copies: ElementRef[] = [];
	for (const [trackId, list] of copiesByTrack) {
		if (toNewTrack.includes(trackId)) continue;
		for (const copy of list) copies.push({ trackId, elementId: copy.id });
	}
	for (const trackId of toNewTrack) {
		const source = listTracks(tracks).find((track) => track.id === trackId);
		const list = copiesByTrack.get(trackId) ?? [];
		if (!source) continue;
		const track = { ...buildEmptyTrack({ id: newId(), type: source.type }), elements: [...list].sort(byStart) } as TimelineTrack;
		if (source.type === "audio") {
			const at = tracks.audio.findIndex((candidate) => candidate.id === trackId);
			tracks = { ...tracks, audio: [...tracks.audio.slice(0, at + 1), track as never, ...tracks.audio.slice(at + 1)] };
		} else {
			// Above the track (the main track's copies go to a video track right above it).
			const at = trackId === tracks.main.id ? tracks.overlay.length : tracks.overlay.findIndex((candidate) => candidate.id === trackId);
			tracks = { ...tracks, overlay: [...tracks.overlay.slice(0, at), track as never, ...tracks.overlay.slice(at)] };
		}
		for (const copy of list) copies.push({ trackId: track.id, elementId: copy.id });
	}
	return { tracks, copies };
}
