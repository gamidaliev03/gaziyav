import { AddClipEffectCommand, BatchCommand, type Command, InsertElementCommand } from "@/commands";
import { EditorCore } from "@/core";
import { getSelectedVisualClips } from "@/effects/components/apply-effect";
import { MOGRAPH_BY_KIND } from "@/montage/mograph";
import { mographElement } from "@/montage/mograph-insert";
import type { TimelineElement, TimelineTrack } from "@/timeline";
import { isVisualElement } from "@/timeline/element-utils";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";
import { type EffectSet, placeSetLayers, setEffectType } from "./catalog";

const seconds = (ticks: number) => ticks / TICKS_PER_SECOND;

/** What one clip gets from the set: its shaders on the clip, its graphics over the clip's time, each on a track above. */
export function setCommandsFor({
	set,
	track,
	element,
}: {
	set: EffectSet;
	track: TimelineTrack;
	element: TimelineElement;
}): Command[] {
	const effects = set.effects.map(
		(effect) =>
			new AddClipEffectCommand({
				trackId: track.id,
				elementId: element.id,
				effectType: setEffectType(effect),
				params: typeof effect === "string" ? undefined : effect.params,
			}),
	);
	const layers = placeSetLayers({
		set,
		clipSeconds: seconds(element.duration),
		graphicSeconds: (kind) => MOGRAPH_BY_KIND.get(kind)?.dur ?? seconds(element.duration),
	}).flatMap(({ layer, from, seconds: length }) => {
		const kind = MOGRAPH_BY_KIND.get(layer.kind);
		if (!kind) return [];
		const graphic = mographElement(kind, seconds(element.startTime) + from);
		return [
			new InsertElementCommand({
				element: {
					...graphic,
					duration: mediaTime({ ticks: Math.round(length * TICKS_PER_SECOND) }),
					params: { ...graphic.params, ...layer.params },
				},
				placement: { mode: "auto" },
			}),
		];
	});
	return [...effects, ...layers];
}

/** The clips a set goes on: the selected visual clips, else the main-track clip under the playhead. */
function setTargets(): Array<{ track: TimelineTrack; element: TimelineElement }> {
	const selected = getSelectedVisualClips();
	if (selected.length > 0) return selected;
	const editor = EditorCore.getInstance();
	const main = editor.scenes.getActiveScene().tracks.main;
	const time = editor.playback.getCurrentTime();
	const under = main.elements.find((e) => e.startTime <= time && time < e.startTime + e.duration && isVisualElement(e));
	return under ? [{ track: main, element: under }] : [];
}

/** The set dropped on a clip: all of it on that clip, one undo step. */
export function applyEffectSetTo(set: EffectSet, clip: { trackId: string; elementId: string }): void {
	const editor = EditorCore.getInstance();
	const [target] = editor.timeline.getElementsWithTracks({ elements: [clip] });
	if (!target || !isVisualElement(target.element)) return;
	editor.command.execute({ command: new BatchCommand(setCommandsFor({ set, ...target })) });
}

/** The set on its clips as ONE undo step. Returns how many clips got it (0: no clip to put it on). */
export function applyEffectSet(set: EffectSet): number {
	const targets = setTargets();
	const commands = targets.flatMap(({ track, element }) => setCommandsFor({ set, track, element }));
	if (commands.length === 0) return 0;
	EditorCore.getInstance().command.execute({ command: new BatchCommand(commands) });
	return targets.length;
}
