import { create } from "zustand";
import { EditorCore } from "@/core";
import { TracksSnapshotCommand } from "@/commands/timeline";
import type { SceneTracks, TimelineElement, VideoTrack } from "@/timeline";
import { generateUUID } from "@/utils/id";
import { warmShader } from "@/services/renderer/compositor/pipeline-warmup";
import { TICKS_PER_SECOND } from "@/wasm";
import { DEFAULT_TRANSITION_PARAMS, getTransitionDefinition } from "./definitions";
import type { TimelineTransition } from "./types";

/** Clips closer than this (ticks) count as touching. */
const ADJACENT_TOLERANCE = TICKS_PER_SECOND / 50;
export { MAX_TRANSITION_SECONDS, MIN_TRANSITION_SECONDS } from "./limits";
import { MAX_TRANSITION_SECONDS, MIN_TRANSITION_SECONDS } from "./limits";

export interface CutRef {
	trackId: string;
	fromElementId: string;
	toElementId: string;
}

export interface CutInfo extends CutRef {
	time: number;
	from: TimelineElement;
	to: TimelineElement;
	transition: TimelineTransition | null;
}

/** The cut the user clicked on the timeline (Transitions tab acts on it). */
export const useSelectedCut = create<{
	cut: CutRef | null;
	setCut: (cut: CutRef | null) => void;
}>((set) => ({
	cut: null,
	setCut: (cut) => {
		if (cut) watchClipSelection();
		set({ cut });
	},
}));

// CapCut: selecting a clip deselects the transition. The cut stayed selected under a later clip selection, and
// once the clips were deselected (Esc) or deleted the inspector showed «Transition» instead of the project.
let watchingClipSelection = false;
function watchClipSelection() {
	if (watchingClipSelection) return;
	watchingClipSelection = true;
	const selection = EditorCore.getInstance().selection;
	selection.subscribe(() => {
		if (useSelectedCut.getState().cut && selection.getSelectedElements().length > 0) useSelectedCut.setState({ cut: null });
	});
}

function getTracks(): SceneTracks | null {
	return EditorCore.getInstance().scenes.getActiveSceneOrNull()?.tracks ?? null;
}

function videoTracks(tracks: SceneTracks): VideoTrack[] {
	return [tracks.main, ...tracks.overlay.filter((t): t is VideoTrack => t.type === "video")];
}

export function getTransitions(track: VideoTrack): TimelineTransition[] {
	return (track as VideoTrack & { transitions?: TimelineTransition[] }).transitions ?? [];
}

/** Every cut (two touching clips) of a video track, in time order. */
export function listTrackCuts(track: VideoTrack): CutInfo[] {
	const elements = track.elements.slice().sort((a, b) => a.startTime - b.startTime);
	const transitions = getTransitions(track);
	const cuts: CutInfo[] = [];
	for (let i = 0; i + 1 < elements.length; i++) {
		const from = elements[i];
		const to = elements[i + 1];
		if (Math.abs(from.startTime + from.duration - to.startTime) > ADJACENT_TOLERANCE) continue;
		cuts.push({
			trackId: track.id,
			fromElementId: from.id,
			toElementId: to.id,
			time: to.startTime,
			from,
			to,
			transition:
				transitions.find((t) => t.fromElementId === from.id && t.toElementId === to.id) ?? null,
		});
	}
	return cuts;
}

export function findCut(cut: CutRef): CutInfo | null {
	const tracks = getTracks();
	if (!tracks) return null;
	const track = videoTracks(tracks).find((t) => t.id === cut.trackId);
	if (!track) return null;
	return (
		listTrackCuts(track).find(
			(c) => c.fromElementId === cut.fromElementId && c.toElementId === cut.toElementId,
		) ?? null
	);
}

/** Cut nearest to `time` — main track first, then other video tracks. */
export function findNearestCut(time: number): CutInfo | null {
	const tracks = getTracks();
	if (!tracks) return null;
	let best: CutInfo | null = null;
	for (const track of videoTracks(tracks)) {
		for (const cut of listTrackCuts(track)) {
			if (!best || Math.abs(cut.time - time) < Math.abs(best.time - time)) best = cut;
		}
		if (best && track === tracks.main) break;
	}
	return best;
}

function withTrackTransitions(
	tracks: SceneTracks,
	trackId: string,
	update: (list: TimelineTransition[]) => TimelineTransition[],
): SceneTracks {
	const patch = (track: VideoTrack): VideoTrack =>
		({ ...track, transitions: update(getTransitions(track)) }) as VideoTrack;
	if (tracks.main.id === trackId) return { ...tracks, main: patch(tracks.main) };
	return {
		...tracks,
		overlay: tracks.overlay.map((t) => (t.id === trackId && t.type === "video" ? patch(t) : t)),
	};
}

function commit(before: SceneTracks, after: SceneTracks) {
	EditorCore.getInstance().command.execute({
		command: new TracksSnapshotCommand({ before, after }),
	});
}

/** Applies (or replaces) a transition on a cut. One ⌘Z. */
export function applyTransition({ cut, type }: { cut: CutRef; type: string }): boolean {
	// Starts its compile now (the player shows the plain cut until it is ready, never a frozen frame).
	warmShader(type);
	const tracks = getTracks();
	const definition = getTransitionDefinition(type);
	const info = findCut(cut);
	if (!tracks || !definition || !info) return false;
	const existing = info.transition;
	// Never longer than the two clips allow: on short clips the default length ran past them (fuzz, 03.11).
	const duration = clampTransitionTicks(existing?.duration ?? Math.round(definition.defaultDuration * TICKS_PER_SECOND), info);
	const next: TimelineTransition = {
		id: existing?.id ?? generateUUID(),
		type,
		fromElementId: cut.fromElementId,
		toElementId: cut.toElementId,
		duration,
		params: existing?.type === type ? existing.params : DEFAULT_TRANSITION_PARAMS(definition),
	};
	const after = withTrackTransitions(tracks, cut.trackId, (list) => [
		...list.filter((t) => !(t.fromElementId === cut.fromElementId && t.toElementId === cut.toElementId)),
		next,
	]);
	commit(tracks, after);
	return true;
}

export function removeTransition(cut: CutRef): void {
	const tracks = getTracks();
	if (!tracks) return;
	const after = withTrackTransitions(tracks, cut.trackId, (list) =>
		list.filter((t) => !(t.fromElementId === cut.fromElementId && t.toElementId === cut.toElementId)),
	);
	commit(tracks, after);
}

const sameCut = (a: CutRef, b: CutRef) => a.trackId === b.trackId && a.fromElementId === b.fromElementId && a.toElementId === b.toElementId;

/**
 * A transition dragged from one cut to another: it leaves the first and lands on the second with its type, options
 * and length (clamped to what the new clips allow), in one undo step. Nothing changes when both are the same cut.
 */
export function moveTransition({ from, to }: { from: CutRef; to: CutRef }): boolean {
	const tracks = getTracks();
	const source = findCut(from);
	const target = findCut(to);
	if (!tracks || !source?.transition || !target || sameCut(from, to)) return false;
	const moved: TimelineTransition = {
		...source.transition,
		fromElementId: to.fromElementId,
		toElementId: to.toElementId,
		duration: clampTransitionTicks(source.transition.duration, target),
	};
	const without = withTrackTransitions(tracks, from.trackId, (list) =>
		list.filter((t) => !(t.fromElementId === from.fromElementId && t.toElementId === from.toElementId)),
	);
	const after = withTrackTransitions(without, to.trackId, (list) => [
		...list.filter((t) => !(t.fromElementId === to.fromElementId && t.toElementId === to.toElementId)),
		moved,
	]);
	commit(tracks, after);
	return true;
}

/**
 * Live edit (no history) — used while dragging the duration handle or a
 * slider; call `commitTransitionEdit` with the snapshot from the start.
 */
export function previewTransitionPatch(cut: CutRef, patch: Partial<Pick<TimelineTransition, "duration" | "params">>): void {
	const tracks = getTracks();
	if (!tracks) return;
	const after = withTrackTransitions(tracks, cut.trackId, (list) =>
		list.map((t) =>
			t.fromElementId === cut.fromElementId && t.toElementId === cut.toElementId ? { ...t, ...patch } : t,
		),
	);
	EditorCore.getInstance().timeline.updateTracks(after);
}

export function snapshotTracks(): SceneTracks | null {
	return getTracks();
}

export function commitTransitionEdit(before: SceneTracks | null): void {
	const after = getTracks();
	if (!before || !after || before === after) return;
	EditorCore.getInstance().command.push({ command: new TracksSnapshotCommand({ before, after }) });
}

export function clampTransitionTicks(ticks: number, info: CutInfo): number {
	const max = Math.min(MAX_TRANSITION_SECONDS * TICKS_PER_SECOND, info.from.duration, info.to.duration);
	return Math.round(Math.max(MIN_TRANSITION_SECONDS * TICKS_PER_SECOND, Math.min(max, ticks)));
}
