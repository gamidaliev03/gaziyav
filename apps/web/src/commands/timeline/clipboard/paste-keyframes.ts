import { EditorCore } from "@/core";
import {
	getKeyframeAtTime,
	updateScalarKeyframeCurve,
	upsertPathKeyframe,
} from "@/animation";
import { Command, type CommandResult } from "@/commands/base-command";
import type { KeyframeClipboardItem } from "@/clipboard";
import type { SceneTracks, TimelineElement } from "@/timeline";
import { updateElementInSceneTracks } from "@/timeline";
import { resolveAnimationTarget } from "@/timeline/animation-targets";
import { generateUUID } from "@/utils/id";
import {
	addMediaTime,
	type MediaTime,
	maxMediaTime,
	subMediaTime,
	ZERO_MEDIA_TIME,
} from "@/wasm";

function pasteKeyframesIntoElement({
	element,
	time,
	clipboardItems,
}: {
	element: TimelineElement;
	time: MediaTime;
	clipboardItems: KeyframeClipboardItem[];
}): TimelineElement {
	let nextElement = element;
	// `time` is the playhead on the timeline; keys are timed from the clip's start. It was used as clip time, so a clip
	// further along the timeline got every pasted key squeezed onto its last frame.
	const start = maxMediaTime({ a: ZERO_MEDIA_TIME, b: subMediaTime({ a: time, b: element.startTime }) });

	for (const item of clipboardItems) {
		const target = resolveAnimationTarget({
			element: nextElement,
			path: item.propertyPath,
		});
		if (!target) {
			continue;
		}

		const keyframeTime = addMediaTime({ a: start, b: item.timeOffset });
		// Keys past the clip's end are left out: the intervals of the rest stay as copied.
		if (keyframeTime > nextElement.duration) {
			continue;
		}
		const nextAnimations = upsertPathKeyframe({
			animations: nextElement.animations,
			propertyPath: item.propertyPath,
			time: keyframeTime,
			value: item.value,
			interpolation: item.interpolation,
			keyframeId: generateUUID(),
			channelLayout: target.channelLayout,
			coerceValue: target.coerceValue,
		});
		const pastedKeyframe = getKeyframeAtTime({
			animations: nextAnimations,
			propertyPath: item.propertyPath,
			time: keyframeTime,
		});

		let patchedAnimations = nextAnimations;
		if (pastedKeyframe) {
			for (const curvePatch of item.curvePatches) {
				const nextPatchedAnimations = updateScalarKeyframeCurve({
					animations: patchedAnimations,
					propertyPath: item.propertyPath,
					componentKey: curvePatch.componentKey,
					keyframeId: pastedKeyframe.id,
					patch: curvePatch.patch,
				});
				patchedAnimations = nextPatchedAnimations ?? patchedAnimations;
			}
		}

		nextElement = {
			...nextElement,
			animations: patchedAnimations,
		};
	}

	return nextElement;
}

export class PasteKeyframesCommand extends Command {
	private savedState: SceneTracks | null = null;
	private readonly trackId: string;
	private readonly elementId: string;
	private readonly time: MediaTime;
	private readonly clipboardItems: KeyframeClipboardItem[];

	constructor({
		trackId,
		elementId,
		time,
		clipboardItems,
	}: {
		trackId: string;
		elementId: string;
		time: MediaTime;
		clipboardItems: KeyframeClipboardItem[];
	}) {
		super();
		this.trackId = trackId;
		this.elementId = elementId;
		this.time = time;
		this.clipboardItems = clipboardItems;
	}

	execute(): CommandResult | undefined {
		if (this.clipboardItems.length === 0) {
			return undefined;
		}

		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;

		const updatedTracks = updateElementInSceneTracks({
			tracks: this.savedState,
			trackId: this.trackId,
			elementId: this.elementId,
			update: (element) =>
				pasteKeyframesIntoElement({
					element,
					time: this.time,
					clipboardItems: this.clipboardItems,
				}),
		});

		editor.timeline.updateTracks(updatedTracks);
		return undefined;
	}

	undo(): void {
		if (!this.savedState) {
			return;
		}

		const editor = EditorCore.getInstance();
		editor.timeline.updateTracks(this.savedState);
	}
}
