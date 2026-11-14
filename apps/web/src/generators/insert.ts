// - ground (solid, gradient, background): «+» puts it IN the main row at the cut after the clip under the playhead, as
//   a picture (rule B; an empty film: at 0), the playhead to its end; dropped over the main row it goes in at the cut
//   nearer the cursor (rule A); dropped on a layer track it stays there.
// - overlay (particles, light, camera, grain): on a layer above the film, at the playhead / the cursor.
// One undo step either way.
import { BatchCommand } from "@/commands";
import type { Command } from "@/commands/base-command";
import { InsertElementCommand } from "@/commands/timeline";
import { autoPlacement } from "@/commands/timeline/element/insert-element";
import { TracksEditCommand } from "@/actions/tracks-edit-command";
import type { EditorCore } from "@/core";
import { t } from "@/i18n";
import type { CreateTimelineElement, TimelineElement } from "@/timeline";
import type { DropHint } from "@/timeline/drag";
import { buildGraphicElement } from "@/timeline/element-utils";
import { endOnFrame } from "@/timeline/frame-grid";
import { insertIntoRow, rowCutAtCursor, rowCutAtPlayhead, withMainElements } from "@/timeline/placement/row";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";
import { buildDefaultEffectInstance, effectsRegistry } from "@/effects";
import type { Effect } from "@/effects/types";
import { generatorSpec, presetParams } from "./catalog";
import { buildGeneratorParams, CARRIER_DEFINITION } from "./document";
import type { GeneratorPreset } from "./types";

/** A new generator clip's length, seconds. */
export const GENERATOR_DURATION = 5;

export function buildGeneratorElement({
	preset,
	canvas,
	startSeconds,
}: {
	preset: GeneratorPreset;
	canvas: { width: number; height: number };
	startSeconds: number;
}): CreateTimelineElement {
	const spec = generatorSpec(preset.generator);
	if (!spec) throw new Error(`Unknown generator: ${preset.generator}`);
	const params = buildGeneratorParams({ spec, params: presetParams(preset), canvas });
	const element = buildGraphicElement({
		definitionId: CARRIER_DEFINITION,
		name: preset.proper ? preset.name : t(preset.name),
		startTime: mediaTime({ ticks: Math.round(startSeconds * TICKS_PER_SECOND) }),
		// a ready overlay says how it lies over the film (library.ts: black + «screen», grey + «overlay»…)
		params: preset.blend ? { ...params, blendMode: preset.blend } : params,
	});
	const effects = presetEffects(preset);
	return { ...element, duration: mediaTime({ ticks: GENERATOR_DURATION * TICKS_PER_SECOND }), ...(effects.length ? { effects } : {}) };
}

/** The ready effects of a preset as clip effects (library.ts); one this build does not know is left out. */
export function presetEffects(preset: GeneratorPreset): Effect[] {
	return (preset.effects ?? []).flatMap((entry) => {
		const type = typeof entry === "string" ? entry : entry.type;
		if (!effectsRegistry.has(type)) return [];
		const effect = buildDefaultEffectInstance({ effectType: type });
		return [typeof entry === "string" ? effect : { ...effect, params: { ...effect.params, ...entry.params } }];
	});
}

/** Into the row (a ground) or a layer above (an overlay): the preset's own word, else its generator's. */
export const presetRole = (preset: GeneratorPreset): "ground" | "overlay" => preset.role ?? generatorSpec(preset.generator)?.role ?? "ground";

/**
 * Puts the preset's generator on the timeline. `startSeconds` + `hint`: a drop (the time and the track under the
 * cursor); none: «+» at the playhead. Returns the clip's start, seconds.
 */
export function insertGenerator(editor: EditorCore, preset: GeneratorPreset, startSeconds?: number, hint?: DropHint): number {
	const spec = generatorSpec(preset.generator);
	const scene = editor.scenes.getActiveSceneOrNull();
	const project = editor.project.getActiveOrNull();
	if (!spec || !scene || !project) return 0;
	const tracks = scene.tracks;
	const fps = project.settings.fps;
	const canvas = project.settings.canvasSize;
	const playhead = editor.playback.getCurrentTime();
	const dropped = typeof startSeconds === "number";
	const overMain = !dropped || hint?.trackId === tracks.main.id || tracks.main.elements.length === 0;
	if (presetRole(preset) === "ground" && overMain && typeof hint?.newTrackIndex !== "number") {
		const half = fps ? Math.floor((TICKS_PER_SECOND * fps.denominator) / fps.numerator / 2) : 0;
		const cut = dropped
			? rowCutAtCursor({ elements: tracks.main.elements, time: Math.round(startSeconds * TICKS_PER_SECOND) })
			: rowCutAtPlayhead({ elements: tracks.main.elements, time: playhead, tolerance: half });
		let element = buildGeneratorElement({ preset, canvas, startSeconds: cut / TICKS_PER_SECOND });
		if (fps) element = endOnFrame(element as TimelineElement, fps) as unknown as CreateTimelineElement;
		const commands: Command[] = [];
		const { moved } = insertIntoRow({ elements: tracks.main.elements, at: cut, items: [{ startTime: element.startTime, duration: element.duration ?? 0 }] });
		if (moved.some((e, i) => e !== tracks.main.elements[i])) commands.push(new TracksEditCommand({ before: tracks, after: withMainElements(tracks, moved) }));
		commands.push(new InsertElementCommand({ element, placement: { mode: "explicit", trackId: tracks.main.id } }));
		editor.command.execute({ command: commands.length === 1 ? commands[0] : new BatchCommand(commands) });
		if (!dropped) editor.playback.seek({ time: mediaTime({ ticks: cut + (element.duration ?? 0) }) });
		return cut / TICKS_PER_SECOND;
	}
	const at = dropped ? startSeconds : playhead / TICKS_PER_SECOND;
	const element = buildGeneratorElement({ preset, canvas, startSeconds: at });
	editor.timeline.insertElement({ element, placement: dropped ? autoPlacement(hint) : { mode: "auto" } });
	return at;
}
