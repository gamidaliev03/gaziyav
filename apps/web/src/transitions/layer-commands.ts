// Putting a transition on an adjustment layer, swapping and removing it (transitions/layer.ts): one ⌘Z each.
import { EditorCore } from "@/core";
import { TracksSnapshotCommand } from "@/commands/timeline/tracks-snapshot";
import type { EffectElement, SceneTracks } from "@/timeline";
import { generateUUID } from "@/utils/id";
import { warmShader } from "@/services/renderer/compositor/pipeline-warmup";
import { DEFAULT_TRANSITION_PARAMS, getTransitionDefinition } from "./definitions";
import type { LayerTransition } from "./types";

export interface LayerRef {
	trackId: string;
	elementId: string;
}

/** The adjustment layer (effect element) `ref` points at, or null. */
export function findLayer(tracks: SceneTracks, ref: LayerRef): EffectElement | null {
	const track = tracks.overlay.find((t) => t.id === ref.trackId);
	if (!track || track.type !== "effect") return null;
	return track.elements.find((e) => e.id === ref.elementId) ?? null;
}

/** The tracks with `transition` on the layer (undefined removes it). Unchanged tracks when the layer isn't there. */
export function withLayerTransition(tracks: SceneTracks, ref: LayerRef, transition: LayerTransition | undefined): SceneTracks {
	return {
		...tracks,
		overlay: tracks.overlay.map((track) => {
			if (track.id !== ref.trackId || track.type !== "effect") return track;
			return {
				...track,
				elements: track.elements.map((element) => {
					if (element.id !== ref.elementId) return element;
					const { transition: _old, ...rest } = element;
					return transition ? { ...rest, transition } : rest;
				}),
			};
		}),
	};
}

/** The transition a layer gets for `type`: a new one replaces the old (one per layer), keeping its id. */
export function layerTransitionFor({
	type,
	params,
	existing,
	newId = generateUUID,
}: {
	type: string;
	params?: LayerTransition["params"];
	existing?: LayerTransition;
	newId?: () => string;
}): LayerTransition | null {
	const definition = getTransitionDefinition(type);
	if (!definition) return null;
	return {
		id: existing?.id ?? newId(),
		type,
		params: params ? structuredClone(params) : existing?.type === type ? existing.params : DEFAULT_TRANSITION_PARAMS(definition),
	};
}

function activeTracks(): SceneTracks | null {
	return EditorCore.getInstance().scenes.getActiveSceneOrNull()?.tracks ?? null;
}

/** Drops (or swaps) a transition onto an adjustment layer. One ⌘Z. */
export function applyLayerTransition({ layer, type, params }: { layer: LayerRef; type: string; params?: LayerTransition["params"] }): boolean {
	warmShader(type);
	const tracks = activeTracks();
	const element = tracks ? findLayer(tracks, layer) : null;
	const transition = layerTransitionFor({ type, params, existing: element?.transition });
	if (!tracks || !element || !transition) return false;
	EditorCore.getInstance().command.execute({
		command: new TracksSnapshotCommand({ before: tracks, after: withLayerTransition(tracks, layer, transition) }),
	});
	return true;
}

/** Takes the transition off the layer (the layer and its own effect stay). One ⌘Z. */
export function removeLayerTransition(layer: LayerRef): boolean {
	const tracks = activeTracks();
	if (!tracks || !findLayer(tracks, layer)?.transition) return false;
	EditorCore.getInstance().command.execute({
		command: new TracksSnapshotCommand({ before: tracks, after: withLayerTransition(tracks, layer, undefined) }),
	});
	return true;
}
