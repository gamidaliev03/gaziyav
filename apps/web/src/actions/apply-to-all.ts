// «Apply to all»: an effect, a parameter, a text style or a transition, copied from one clip or cut onto the selected
// clips, every clip of the track, or every cut — as one ⌘Z.
import { buildEffectEntry, effectPastePatches } from "@/clipboard";
import { TracksSnapshotCommand } from "@/commands/timeline/tracks-snapshot";
import type { EditorCore } from "@/core";
import type { ParamValue } from "@/params";
import { getElementParams, readElementParamValue, writeElementParamValue } from "@/params/registry";
import type { ElementRef, SceneTracks, TimelineElement, TimelineTrack, VideoTrack } from "@/timeline";
import { type CutRef, findCut, getTransitions, listTrackCuts } from "@/transitions/commands";
import { generateUUID } from "@/utils/id";
import { buildAttributesPatch, captureAttributes } from "./timeline-edits";

export type ClipScope = "selected" | "track";
type Clip = { track: TimelineTrack; element: TimelineElement };

function allTracks(tracks: SceneTracks): TimelineTrack[] {
	return [...tracks.overlay, tracks.main, ...tracks.audio];
}

/** The selected clips, or every clip on the tracks the selected (or source) clips are on. */
export function clipsInScope(editor: EditorCore, scope: ClipScope, source?: ElementRef): Clip[] {
	const selected = editor.selection.getSelectedElements();
	const tracks = allTracks(editor.scenes.getActiveScene().tracks);
	if (scope === "selected") return editor.timeline.getElementsWithTracks({ elements: selected }) as Clip[];
	const trackIds = new Set([...selected.map((ref) => ref.trackId), ...(source ? [source.trackId] : [])]);
	return tracks.filter((track) => trackIds.has(track.id)).flatMap((track) => track.elements.map((element) => ({ track, element })));
}

/** The clip's values of these params (through their read hooks), or null when it lacks one. */
export function readParamValues(element: TimelineElement, keys: readonly string[]): Record<string, ParamValue> | null {
	const defs = getElementParams({ element });
	const values: Record<string, ParamValue> = {};
	for (const key of keys) {
		const def = defs.find((param) => param.key === key);
		const value = def ? readElementParamValue({ element, param: def }) : null;
		if (value === null || value === undefined) return null;
		values[key] = value;
	}
	return values;
}

/** The patch that gives a clip these param values (through their write hooks), or null when it lacks one. */
export function paramValuesPatch(element: TimelineElement, values: Record<string, ParamValue>): Partial<TimelineElement> | null {
	const defs = getElementParams({ element });
	let next = element;
	for (const [key, value] of Object.entries(values)) {
		const def = defs.find((param) => param.key === key);
		if (!def) return null;
		next = writeElementParamValue({ element: next, param: def, value });
	}
	const patch: Record<string, unknown> = {};
	for (const field of Object.keys(next) as Array<keyof TimelineElement>) {
		if (next[field] !== element[field]) patch[field] = next[field];
	}
	return Object.keys(patch).length > 0 ? (patch as Partial<TimelineElement>) : null;
}

function commitUpdates(editor: EditorCore, updates: Array<{ trackId: string; elementId: string; patch: Partial<TimelineElement> }>): number {
	if (updates.length > 0) editor.timeline.updateElements({ updates });
	return updates.length;
}

/** Param values onto the clips in scope that have those params. */
export function applyParamValues(editor: EditorCore, values: Record<string, ParamValue>, scope: ClipScope): number {
	return commitUpdates(
		editor,
		clipsInScope(editor, scope).flatMap(({ track, element }) => {
			const patch = paramValuesPatch(element, values);
			return patch ? [{ trackId: track.id, elementId: element.id, patch }] : [];
		}),
	);
}

/** How many clips in scope (besides the source) could take these values. */
export function countParamTargets(editor: EditorCore, keys: readonly string[], scope: ClipScope): number {
	return clipsInScope(editor, scope).filter(({ element }) => readParamValues(element, keys) !== null).length;
}

/** A copy of one effect (with its keys) onto the other clips in scope. */
export function applyEffect(editor: EditorCore, source: ElementRef & { effectId: string }, scope: ClipScope): number {
	const [origin] = editor.timeline.getElementsWithTracks({ elements: [source] });
	const entry = origin ? buildEffectEntry({ element: origin.element, effectId: source.effectId }) : null;
	if (!entry) return 0;
	const targets = clipsInScope(editor, scope, source).filter(({ element }) => element.id !== source.elementId);
	return commitUpdates(editor, effectPastePatches(entry, targets));
}

/** The text clip's look (font, stroke, shadow, box… not its words) onto the other text clips in scope. */
export function applyTextStyle(editor: EditorCore, source: ElementRef, scope: ClipScope): number {
	const [origin] = editor.timeline.getElementsWithTracks({ elements: [source] });
	if (!origin) return 0;
	const attributes = captureAttributes(origin.element);
	return commitUpdates(
		editor,
		clipsInScope(editor, scope, source)
			.filter(({ element }) => element.id !== source.elementId && element.type === origin.element.type)
			.flatMap(({ track, element }) => {
				const patch = buildAttributesPatch({ source: attributes, target: element, include: new Set(["style"]) });
				return patch ? [{ trackId: track.id, elementId: element.id, patch }] : [];
			}),
	);
}

export type CutScope = "track" | "all" | "selected";

/** The cut's transition (type, length, settings) onto the cuts of its track, every cut, or the cuts after the selected clips. */
export function applyTransitionToCuts(editor: EditorCore, cut: CutRef, scope: CutScope): number {
	const template = findCut(cut)?.transition;
	if (!template) return 0;
	const tracks = editor.scenes.getActiveScene().tracks;
	const selectedIds = new Set(editor.selection.getSelectedElements().map((ref) => ref.elementId));
	let count = 0;
	const patch = (track: VideoTrack): VideoTrack => {
		if (scope === "track" && track.id !== cut.trackId) return track;
		const targets = listTrackCuts(track).filter(
			(other) =>
				!(other.fromElementId === cut.fromElementId && other.toElementId === cut.toElementId) &&
				(scope !== "selected" || selectedIds.has(other.fromElementId)),
		);
		if (targets.length === 0) return track;
		count += targets.length;
		const kept = getTransitions(track).filter((t) => !targets.some((other) => other.fromElementId === t.fromElementId && other.toElementId === t.toElementId));
		const added = targets.map((other) => ({
			id: generateUUID(),
			type: template.type,
			duration: template.duration,
			params: structuredClone(template.params),
			fromElementId: other.fromElementId,
			toElementId: other.toElementId,
		}));
		return { ...track, transitions: [...kept, ...added] } as VideoTrack;
	};
	const after: SceneTracks = {
		...tracks,
		main: patch(tracks.main),
		overlay: tracks.overlay.map((track) => (track.type === "video" ? patch(track) : track)),
	};
	if (count > 0) editor.command.execute({ command: new TracksSnapshotCommand({ before: tracks, after }) });
	return count;
}
