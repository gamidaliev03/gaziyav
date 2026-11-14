// CapCut's track lock (🔒 in the track header): the clips of a locked track can't be selected, moved, trimmed, split or
// deleted until it is unlocked. The lock is part of the edit (one ⌘Z) and saved with the project.
import { useEffect } from "react";
import { TracksEditCommand } from "@/actions/tracks-edit-command";
import type { EditorCore } from "@/core";
import type { ElementRef, SceneTracks, TimelineTrack } from "@/timeline/types";

export const isTrackLocked = (track: { locked?: boolean } | null | undefined): boolean => track?.locked === true;

const allTracks = (tracks: SceneTracks): TimelineTrack[] => [...tracks.overlay, tracks.main, ...tracks.audio];

/** The ids of the locked tracks (empty almost always: callers skip their work then). */
export function lockedTrackIds(tracks: SceneTracks): Set<string> {
	const ids = new Set<string>();
	for (const track of allTracks(tracks)) if (isTrackLocked(track)) ids.add(track.id);
	return ids;
}

/**
 * The locked tracks (locked before the step) whose clips the step changed: added, removed, moved, trimmed — any
 * element whose value changed. Empty when nothing is locked (the usual case costs one pass over tracks).
 * The history refuses such a step (core/managers/commands.ts): a locked track is never edited by any path (tlc2,
 * register A1: Q / W cut a locked clip).
 */
export function lockedTracksChanged(before: SceneTracks, after: SceneTracks): string[] {
	const locked = lockedTrackIds(before);
	if (locked.size === 0) return [];
	const now = new Map(allTracks(after).map((track) => [track.id, track] as const));
	const changed: string[] = [];
	for (const track of allTracks(before)) {
		if (!locked.has(track.id)) continue;
		const next = now.get(track.id);
		if (!next) continue; // a track removed whole is the track's own edit (its header's menu)
		// the very same objects, or (a step that rebuilt every track) the same values
		const same =
			next.elements.length === track.elements.length &&
			(next.elements.every((element, index) => element === track.elements[index]) || JSON.stringify(next.elements) === JSON.stringify(track.elements));
		if (!same) changed.push(track.id);
	}
	return changed;
}

/** The tracks as edits by the playhead see them: a locked track has no clips to split or trim. */
export function withoutLockedClips(tracks: SceneTracks): SceneTracks {
	if (lockedTrackIds(tracks).size === 0) return tracks;
	const strip = <T extends TimelineTrack>(track: T): T => (isTrackLocked(track) ? ({ ...track, elements: [] } as T) : track);
	return { overlay: tracks.overlay.map(strip), main: strip(tracks.main), audio: tracks.audio.map(strip) };
}

/** 🔒: locks or unlocks the track (one undo step); its clips leave the selection. */
export function toggleTrackLock(editor: EditorCore, trackId: string): void {
	const before = editor.scenes.getActiveScene().tracks;
	const flip = <T extends TimelineTrack>(track: T): T => {
		if (track.id !== trackId) return track;
		if (isTrackLocked(track)) {
			const { locked: _locked, ...rest } = track;
			return rest as T;
		}
		return { ...track, locked: true };
	};
	const after: SceneTracks = { overlay: before.overlay.map(flip), main: flip(before.main), audio: before.audio.map(flip) };
	const selection = editor.selection.getSelectedElements().filter((ref) => ref.trackId !== trackId);
	editor.command.execute({ command: new TracksEditCommand({ before, after, selection, noEngineRipple: true }) });
}

/**
 * Keeps clips of locked tracks out of the selection, whatever selected them (⌘A, [ ], a track header, a box): the
 * edits on the selection then never touch them.
 */
export function useLockedTrackSelectionGuard(editor: EditorCore): void {
	useEffect(() => {
		const guard = () => {
			const selected = editor.selection.getSelectedElements();
			if (selected.length === 0) return;
			const scene = editor.scenes.getActiveSceneOrNull();
			if (!scene) return;
			const locked = lockedTrackIds(scene.tracks);
			if (locked.size === 0) return;
			const kept: ElementRef[] = selected.filter((ref) => !locked.has(ref.trackId));
			if (kept.length !== selected.length) editor.selection.setSelectedElements({ elements: kept });
		};
		return editor.selection.subscribe(guard);
	}, [editor]);
}
