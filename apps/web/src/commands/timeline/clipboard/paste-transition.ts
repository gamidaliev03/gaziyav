// ⌘V of a copied transition (clipboard/handlers/transition.ts): on the selected cut, or at the cut of every selected
// clip — where it meets the next one (a clip with nothing after it: where the previous one meets it) — and onto every
// selected adjustment layer. Each copy is as long as the copied one, never longer than its two clips allow (on a layer:
// the layer's length). One TracksSnapshotCommand: one ⌘Z for all.
import type { SceneTracks, VideoTrack } from "@/timeline";
import { type CutInfo, type CutRef, clampTransitionTicks, getTransitions, listTrackCuts } from "@/transitions/commands";
import type { TimelineTransition } from "@/transitions/types";
import { generateUUID } from "@/utils/id";
import { findLayer, type LayerRef, layerTransitionFor, withLayerTransition } from "@/transitions/layer-commands";
import { TracksSnapshotCommand } from "../tracks-snapshot";

export type CopiedTransition = Pick<TimelineTransition, "type" | "duration" | "params">;

const sameCut = (a: CutRef, b: CutRef) =>
	a.trackId === b.trackId && a.fromElementId === b.fromElementId && a.toElementId === b.toElementId;

function videoTracks(tracks: SceneTracks): VideoTrack[] {
	return [tracks.main, ...tracks.overlay.filter((track): track is VideoTrack => track.type === "video")];
}

/** The cuts a paste lands on, in timeline order per track. */
export function transitionPasteCuts({
	tracks,
	selectedElementIds,
	selectedCut,
}: {
	tracks: SceneTracks;
	selectedElementIds: Iterable<string>;
	selectedCut: CutRef | null;
}): CutInfo[] {
	const selected = new Set(selectedElementIds);
	const out: CutInfo[] = [];
	for (const track of videoTracks(tracks)) {
		const cuts = listTrackCuts(track);
		if (selected.size === 0) {
			const cut = selectedCut ? cuts.find((c) => sameCut(c, selectedCut)) : undefined;
			if (cut) out.push(cut);
			continue;
		}
		const picked: CutInfo[] = [];
		for (const element of track.elements) {
			if (!selected.has(element.id)) continue;
			const cut = cuts.find((c) => c.fromElementId === element.id) ?? cuts.find((c) => c.toElementId === element.id);
			if (cut && !picked.includes(cut)) picked.push(cut);
		}
		out.push(...picked.sort((a, b) => a.time - b.time));
	}
	return out;
}

/** The tracks with the copied transition at those cuts (an existing one there is replaced, keeping its id). */
export function pasteTransitionAtCuts({
	tracks,
	transition,
	cuts,
	newId = generateUUID,
}: {
	tracks: SceneTracks;
	transition: CopiedTransition;
	cuts: readonly CutInfo[];
	newId?: () => string;
}): SceneTracks {
	const patch = (track: VideoTrack): VideoTrack => {
		const mine = cuts.filter((cut) => cut.trackId === track.id);
		if (mine.length === 0) return track;
		const existing = getTransitions(track);
		const kept = existing.filter((t) => !mine.some((cut) => cut.fromElementId === t.fromElementId && cut.toElementId === t.toElementId));
		const added: TimelineTransition[] = mine.map((cut) => ({
			id: cut.transition?.id ?? newId(),
			fromElementId: cut.fromElementId,
			toElementId: cut.toElementId,
			type: transition.type,
			duration: clampTransitionTicks(transition.duration, cut),
			params: structuredClone(transition.params),
		}));
		return { ...track, transitions: [...kept, ...added] } as VideoTrack;
	};
	return {
		...tracks,
		main: patch(tracks.main),
		overlay: tracks.overlay.map((track) => (track.type === "video" ? patch(track) : track)),
	};
}

/** The paste as one undoable step, or null when no cut takes it. */
export function buildTransitionPasteCommand({
	tracks,
	transition,
	selectedElementIds,
	selectedCut,
}: {
	tracks: SceneTracks;
	transition: CopiedTransition;
	selectedElementIds: Iterable<string>;
	selectedCut: CutRef | null;
}): TracksSnapshotCommand | null {
	const ids = [...selectedElementIds];
	const cuts = transitionPasteCuts({ tracks, selectedElementIds: ids, selectedCut });
	const layers = transitionPasteLayers({ tracks, selectedElementIds: ids });
	if (cuts.length === 0 && layers.length === 0) return null;
	let after = cuts.length > 0 ? pasteTransitionAtCuts({ tracks, transition, cuts }) : tracks;
	// Selected adjustment layers take it too (transitions/layer.ts): its length is the layer's, so only type and settings.
	for (const layer of layers) {
		const next = layerTransitionFor({ type: transition.type, params: transition.params, existing: findLayer(after, layer)?.transition ?? undefined });
		if (next) after = withLayerTransition(after, layer, next);
	}
	return new TracksSnapshotCommand({ before: tracks, after });
}

/** The selected adjustment layers (effect elements) a paste lands on. */
export function transitionPasteLayers({ tracks, selectedElementIds }: { tracks: SceneTracks; selectedElementIds: Iterable<string> }): LayerRef[] {
	const selected = new Set(selectedElementIds);
	const out: LayerRef[] = [];
	for (const track of tracks.overlay) {
		if (track.type !== "effect") continue;
		for (const element of track.elements) if (selected.has(element.id)) out.push({ trackId: track.id, elementId: element.id });
	}
	return out;
}
