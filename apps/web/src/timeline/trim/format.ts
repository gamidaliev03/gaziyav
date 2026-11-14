// The words and numbers of the trim readout, and the numbers an editor types to trim («+12», «-1:05»).
import type { FrameRate } from "opencut-wasm";
import { formatFrameNumber, timecodeBase } from "@/fps/timecode";
import type { TrimKind, TrimLimit, TrimTarget } from "./types";

/**
 * The readout's words; English is the key of the Russian line (i18n/ru-pro.ts). The number is part of the phrase:
 * «Ripple» and «Slide» alone already name an effect and a transition in the dictionary.
 */
export const TRIM_READOUT: Record<TrimKind, string> = { roll: "Roll {n} f", ripple: "Ripple {n} f", slip: "Slip {n} f", slide: "Slide {n} f" };

/** The picked edge's name: which trim, which side. */
export function pickedLabel(target: Extract<TrimTarget, { kind: "roll" | "ripple" }>): string {
	if (target.kind === "roll") return "Roll: both sides";
	return target.side === "right" ? "Ripple: clip's end" : "Ripple: clip's start";
}

export const TRIM_LIMIT_LABEL: Record<TrimLimit, string> = {
	media: "media ends",
	length: "one frame left",
	neighbour: "next clip",
	start: "timeline start",
	linked: "linked sound",
};

const MINUS = "−";

/** «+12», «−7», «0»; a slip stopped by the file between frames shows one decimal. */
export function formatFrames(delta: number, frame: number): string {
	const frames = delta / frame;
	const shown = Number.isInteger(frames) ? String(Math.abs(frames)) : Math.abs(frames).toFixed(1);
	return frames > 0 ? `+${shown}` : frames < 0 ? `${MINUS}${shown}` : "0";
}

/** The change as a timecode: «+00:12», «−01:05:10» (minutes and hours only when there are any; «;» at drop-frame rates). */
export function formatDeltaTimecode(delta: number, frame: number, fps: FrameRate): string {
	const frames = Math.round(Math.abs(delta) / frame);
	const full = formatFrameNumber({ frame: frames, fps });
	const short = full.replace(/^(?:00:){1,2}/, "");
	return `${delta > 0 ? "+" : delta < 0 ? MINUS : ""}${short}`;
}

/**
 * A typed change in frames: «12» or «+12» is 12 frames, «-1:05» one second and five frames back, «1:00:00» a minute
 * (pairs from the right: frames, seconds, minutes, hours; «:» «;» «.» «,» all separate). A second counts the rate's
 * timecode frames (24 at 23.976, 30 at 29.97), as every editor's number entry does. Null when it reads as no number.
 */
export function parseTypedFrames(text: string, fps: FrameRate): number | null {
	const match = /^\s*([+\-−])?\s*([\d:;.,\s]+?)\s*$/.exec(text);
	if (!match) return null;
	const parts = match[2].split(/[:;.,\s]+/).filter((part) => part.length > 0);
	if (parts.length === 0 || parts.length > 4 || parts.some((part) => !/^\d{1,6}$/.test(part))) return null;
	const base = timecodeBase(fps);
	const [ff = 0, ss = 0, mm = 0, hh = 0] = parts.map(Number).reverse();
	const frames = ((hh * 60 + mm) * 60 + ss) * base + ff;
	if (!Number.isFinite(frames) || frames > 24 * 3600 * base) return null;
	return match[1] && match[1] !== "+" ? -frames : frames;
}
