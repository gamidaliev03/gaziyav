import type { FrameRate } from "opencut-wasm";
import type { TimelineElement } from "@/timeline/types";
import { TICKS_PER_SECOND } from "@/wasm";

/**
 * Clip edges on the project's frames (pro-core, 09.11). A clip lasted as long as its file, so its end — and the start of
 * the clip put after it — fell between frames whenever the file was not a whole number of frames: every NTSC clip (a
 * 23.976 file 6.0 s long in its container is 143.86 frames, its last «frame» a repeat of the one before), every sound
 * (5.0416 s = 120.88 frames), every speed change (6 s at 0.7× = 214.29 frames at 25). Premiere and Final Cut put both
 * edges on frames.
 */
const framesAt = (ticks: number, fps: FrameRate) => (ticks * fps.numerator) / (fps.denominator * TICKS_PER_SECOND);
const ticksAt = (frames: number, fps: FrameRate) => Math.round((frames * fps.denominator * TICKS_PER_SECOND) / fps.numerator);

export function isOnFrame(ticks: number, fps: FrameRate): boolean {
	return ticks === ticksAt(Math.round(framesAt(ticks, fps)), fps);
}

const rateOf = (element: TimelineElement): number | null => {
	if (!("retime" in element) || !element.retime) return 1;
	return element.retime.mode === "curve" ? null : element.retime.rate;
};

/**
 * A clip (video, sound, picture) with its end on the frame nearest to where it ends (a clip of a file: the nearest
 * frame its file still has, else the last whole one). Left exactly as it is when its start lies between frames (it lines
 * up with something that does: a replaced clip of an older project), when it is shorter than a frame or under a speed
 * ramp. Titles, captions and the rest keep their times: captions are laid end to end at the speech's times, and one
 * end moved onto a frame overlapped the next.
 */
export function endOnFrame<T extends TimelineElement>(element: T, fps: FrameRate): T {
	if (element.type !== "video" && element.type !== "audio" && element.type !== "image") return element;
	if (!isOnFrame(element.startTime, fps)) return element;
	const end = element.startTime + element.duration;
	if (isOnFrame(end, fps)) return element;
	const startFrame = Math.round(framesAt(element.startTime, fps));
	const exact = framesAt(end, fps);
	const ofFile = (element.type === "video" || element.type === "audio") && "trimEnd" in element;
	if (!ofFile) {
		const endFrame = Math.max(startFrame + 1, Math.round(exact));
		return { ...element, duration: ticksAt(endFrame, fps) - element.startTime };
	}
	const rate = rateOf(element);
	if (rate === null) return element;
	const nearest = Math.round(exact);
	const longer = ticksAt(nearest, fps) - end;
	// what the file has after the clip's end, in clip time
	const room = element.trimEnd / rate;
	const endFrame = longer > 0 && longer > room ? Math.floor(exact + 1e-9) : nearest;
	if (endFrame <= startFrame) {
		// Faster than the clip has frames (a one-frame clip at 2.93×): one frame, the file's next frames shown in it — it
		// was left a third of a frame long, and the trim's one-frame floor then pushed it over the next clip.
		const one = ticksAt(startFrame + 1, fps) - element.startTime;
		const need = Math.round((one - element.duration) * rate);
		if (need > element.trimEnd) return element;
		return { ...element, duration: one, trimEnd: element.trimEnd - need };
	}
	const duration = ticksAt(endFrame, fps) - element.startTime;
	const trimEnd = Math.max(0, element.trimEnd + Math.round((element.duration - duration) * rate));
	return { ...element, duration, trimEnd };
}
