// CapCut «Mark beat» (⌘J): a beat mark on the selected clip with sound at the playhead, or off again when there is one
// there. Marks are kept from the clip's start, travel with the clip and are snap targets (element-snap-source.ts).
import type { EditorCore } from "@/core";
import { getEffectiveRateAt } from "@/retime/resolve";
import type { RetimeConfig } from "@/timeline/types";
import type { TimelineElement } from "@/timeline/types";

/** True when it marked or unmarked a beat; false when no clip with sound is selected under the playhead. */
export function toggleBeatMark(editor: EditorCore): boolean {
	const time = editor.playback.getCurrentTime();
	const fps = editor.project.getActiveOrNull()?.settings.fps;
	const frame = fps ? (120000 * fps.denominator) / fps.numerator : 4000;
	const target = editor.timeline
		.getElementsWithTracks({ elements: editor.selection.getSelectedElements() })
		.find(({ element }) => hasSound(element) && time >= element.startTime && time <= element.startTime + element.duration);
	if (!target) return false;
	const { track, element } = target;
	const at = Math.round((time - element.startTime) / frame) * frame;
	const beats = element.beats ?? [];
	const near = beats.findIndex((beat) => Math.abs(beat - at) < frame / 2);
	const next = near >= 0 ? beats.filter((_, i) => i !== near) : [...beats, at].sort((a, b) => a - b);
	editor.timeline.updateElements({
		updates: [{ trackId: track.id, elementId: element.id, patch: { beats: next } as Partial<TimelineElement> }],
	});
	return true;
}

function hasSound(element: TimelineElement): boolean {
	return element.type === "audio" || element.type === "video";
}

/**
 * Beat marks for the two halves of a clip cut at `at` ticks: each half's marks are offsets from its own
 * start. Copying the original list to both halves left the right half's marks pointing at the wrong frames
 * (and past its end when the cut was late in the clip).
 */
export function splitBeats({
	beats,
	at,
	duration,
}: {
	beats: number[] | undefined;
	at: number;
	duration: number;
}): { left: number[] | undefined; right: number[] | undefined } {
	const left = beats?.filter((beat) => beat >= 0 && beat < at);
	const right = beats?.filter((beat) => beat >= at && beat < duration).map((beat) => beat - at);
	return {
		left: left?.length ? left : undefined,
		right: right?.length ? right : undefined,
	};
}

/**
 * Beat marks after a trim: a mark stays on its frame of the picture. Trimming the left edge moves the clip's
 * start, so the marks slide by the same clip time; the right edge leaves them where they are. Marks cut off
 * by the new end (or before the new start) go.
 */
export function resizeBeats({
	beats,
	side,
	clipDelta,
	newDuration,
}: {
	beats: number[] | undefined;
	side: "left" | "right";
	/** The clip-time change of the dragged edge (the same value the resize applies to start/duration). */
	clipDelta: number;
	newDuration: number;
}): number[] | undefined {
	if (!beats?.length) return undefined;
	const shifted = side === "left" ? beats.map((beat) => beat - clipDelta) : beats;
	const kept = shifted.filter((beat) => beat >= 0 && beat < newDuration);
	return kept.length ? kept : undefined;
}

type BeatTiming = {
	trimStart: number;
	retime?: RetimeConfig;
};

/**
 * Beat marks after the clip's trim start or speed changed: a mark stays on its frame of the picture, the same
 * remap the keyframes get (source time = trimStart + clipTime × rate). Without it a speed change left every
 * mark at its old clip time, and the timeline snapped and drew them on the wrong frames.
 */
export function remapBeats({
	beats,
	before,
	after,
	duration,
}: {
	beats: number[] | undefined;
	before: BeatTiming;
	after: BeatTiming;
	/** The clip's new duration. */
	duration: number;
}): number[] | undefined {
	if (!beats?.length) return beats;
	const rateBefore = getEffectiveRateAt({ retime: before.retime });
	const rateAfter = getEffectiveRateAt({ retime: after.retime });
	const scale = rateBefore / rateAfter;
	const offset = (before.trimStart - after.trimStart) / rateAfter;
	if (Math.abs(scale - 1) < 1e-9 && Math.abs(offset) < 0.5) return beats;
	const next = beats
		.map((beat) => Math.round(beat * scale + offset))
		.filter((beat) => beat >= 0 && beat < duration);
	return next.length ? next : undefined;
}
