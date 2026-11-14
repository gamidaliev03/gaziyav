// CapCut groups (⌘G / ⇧⌘G): grouped clips are selected, moved and deleted together. Each member carries the same
// `groupId`; a split keeps both parts in the group, a copy (⌘C ⌘V, ⌥-drag) makes a group of its own.
import { TracksEditCommand } from "@/actions/tracks-edit-command";
import type { EditorCore } from "@/core";
import type { ElementRef, SceneTracks, TimelineElement, TimelineTrack } from "@/timeline/types";
import { generateUUID } from "@/utils/id";

const allTracks = (tracks: SceneTracks): TimelineTrack[] => [...tracks.overlay, tracks.main, ...tracks.audio];

/** `elements` plus every other member of the groups they are in (the same array back when none is grouped). */
export function expandToGroups({
	tracks,
	elements,
}: {
	tracks: SceneTracks;
	elements: readonly ElementRef[];
}): ElementRef[] {
	if (elements.length === 0) return [...elements];
	const ids = new Set(elements.map((ref) => ref.elementId));
	const groups = new Set<string>();
	for (const track of allTracks(tracks)) {
		for (const element of track.elements as TimelineElement[]) {
			if (element.groupId && ids.has(element.id)) groups.add(element.groupId);
		}
	}
	if (groups.size === 0) return [...elements];
	const out = [...elements];
	for (const track of allTracks(tracks)) {
		for (const element of track.elements as TimelineElement[]) {
			if (element.groupId && groups.has(element.groupId) && !ids.has(element.id)) {
				ids.add(element.id);
				out.push({ trackId: track.id, elementId: element.id });
			}
		}
	}
	return out;
}

/** The group ids of `elements` (none for ungrouped clips). */
export function groupIdsOf({ tracks, elements }: { tracks: SceneTracks; elements: readonly ElementRef[] }): Set<string> {
	const ids = new Set(elements.map((ref) => ref.elementId));
	const groups = new Set<string>();
	for (const track of allTracks(tracks)) {
		for (const element of track.elements as TimelineElement[]) {
			if (element.groupId && ids.has(element.id)) groups.add(element.groupId);
		}
	}
	return groups;
}

function mapElements(tracks: SceneTracks, fn: (element: TimelineElement) => TimelineElement): SceneTracks {
	const mapTrack = <T extends TimelineTrack>(track: T): T => {
		let changed = false;
		const elements = (track.elements as TimelineElement[]).map((element) => {
			const next = fn(element);
			if (next !== element) changed = true;
			return next;
		});
		return changed ? ({ ...track, elements } as T) : track;
	};
	return { overlay: tracks.overlay.map(mapTrack), main: mapTrack(tracks.main), audio: tracks.audio.map(mapTrack) };
}

/** ⌘G: the selected clips (and the groups they were in) become one group. False when fewer than two are selected. */
export function groupSelection(editor: EditorCore): boolean {
	const before = editor.scenes.getActiveScene().tracks;
	const selected = expandToGroups({ tracks: before, elements: editor.selection.getSelectedElements() });
	if (selected.length < 2) return false;
	const ids = new Set(selected.map((ref) => ref.elementId));
	const groupId = generateUUID();
	const after = mapElements(before, (element) => (ids.has(element.id) ? { ...element, groupId } : element));
	editor.command.execute({ command: new TracksEditCommand({ before, after, selection: selected, noEngineRipple: true }) });
	return true;
}

/** ⇧⌘G: the groups of the selected clips come apart (the clips stay selected). False when none is grouped. */
export function ungroupSelection(editor: EditorCore): boolean {
	const before = editor.scenes.getActiveScene().tracks;
	const selected = editor.selection.getSelectedElements();
	const groups = groupIdsOf({ tracks: before, elements: selected });
	if (groups.size === 0) return false;
	const after = mapElements(before, (element) => {
		if (!element.groupId || !groups.has(element.groupId)) return element;
		const { groupId: _groupId, ...rest } = element;
		return rest as TimelineElement;
	});
	editor.command.execute({
		command: new TracksEditCommand({ before, after, selection: expandToGroups({ tracks: before, elements: selected }), noEngineRipple: true }),
	});
	return true;
}

/** For one batch of copies (a ⌥-drag of whole groups): each original group gets one new group id. */
export function groupRemapper(): <T extends TimelineElement>(copy: T) => T {
	const fresh = new Map<string, string>();
	return (copy) => {
		if (!copy.groupId) return copy;
		let id = fresh.get(copy.groupId);
		if (!id) {
			id = generateUUID();
			fresh.set(copy.groupId, id);
		}
		return { ...copy, groupId: id };
	};
}

/**
 * Copies of grouped clips made together (a paste, a ⌥-drag) form a new group each, never the original's; a copy that
 * is alone from its group is not grouped. `copies` are the new elements in one batch.
 */
export function regroupCopies<T extends TimelineElement>(copies: readonly T[]): T[] {
	const counts = new Map<string, number>();
	for (const copy of copies) if (copy.groupId) counts.set(copy.groupId, (counts.get(copy.groupId) ?? 0) + 1);
	if (counts.size === 0) return [...copies];
	const fresh = new Map<string, string>();
	return copies.map((copy) => {
		if (!copy.groupId) return copy;
		if ((counts.get(copy.groupId) ?? 0) < 2) {
			const { groupId: _groupId, ...rest } = copy;
			return rest as T;
		}
		let id = fresh.get(copy.groupId);
		if (!id) {
			id = generateUUID();
			fresh.set(copy.groupId, id);
		}
		return { ...copy, groupId: id };
	});
}
