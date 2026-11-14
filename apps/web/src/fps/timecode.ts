import { formatTimecode, type FrameRate, type TimeCodeFormat } from "opencut-wasm";
import { type MediaTime, mediaTime, parseMediaTimecode, TICKS_PER_SECOND } from "@/wasm";

/**
 * SMPTE timecode, as Premiere, Final Cut and every camera write it: frames counted at the rate's whole-number timebase
 * (24 for 23.976, 30 for 29.97), drop-frame at 29.97 and 59.94 («;» before the frames: the numbers ;00 and ;01 — ;00 to
 * ;03 at 59.94 — are skipped at each minute except every tenth, so the timecode keeps up with the clock).
 *
 * The wasm «HH:MM:SS:FF» counts wall-clock seconds and the frame inside each one: equal to SMPTE at whole rates, off at
 * NTSC ones — frame 24000 at 23.976 read 00:16:41:00 (Premiere: 00:16:40:00), a minute at 29.97 read 00:01:00:01
 * (00:01:00;02), and some seconds had no frame 23 (29).
 */
export function isDropFrame(fps: FrameRate): boolean {
	return fps.denominator === 1001 && (fps.numerator === 30_000 || fps.numerator === 60_000);
}

/** Frames per timecode second: 24 for 23.976, 30 for 29.97. */
export function timecodeBase(fps: FrameRate): number {
	return Math.max(1, Math.round(fps.numerator / fps.denominator));
}

/** The frame a time lies in (a time between frames counts as the frame it shows). */
export function frameIndexAt({ time, fps }: { time: number; fps: FrameRate }): number {
	const frames = (Math.max(0, time) * fps.numerator) / (fps.denominator * TICKS_PER_SECOND);
	return Math.floor(frames + 1e-9);
}

const two = (n: number) => String(n).padStart(2, "0");

/** «HH:MM:SS:FF» (drop-frame «HH:MM:SS;FF») of frame `frame`. */
export function formatFrameNumber({ frame, fps }: { frame: number; fps: FrameRate }): string {
	const base = timecodeBase(fps);
	let n = Math.max(0, Math.floor(frame));
	const drop = isDropFrame(fps);
	if (drop) {
		const dropped = Math.round(base / 15); // 2 at 29.97, 4 at 59.94
		const perTenMinutes = base * 600 - dropped * 9;
		const perMinute = base * 60 - dropped;
		const tens = Math.floor(n / perTenMinutes);
		const rest = n % perTenMinutes;
		n += dropped * 9 * tens + (rest > dropped ? dropped * Math.floor((rest - dropped) / perMinute) : 0);
	}
	const ff = n % base;
	const totalSeconds = Math.floor(n / base);
	const ss = totalSeconds % 60;
	const mm = Math.floor(totalSeconds / 60) % 60;
	const hh = Math.floor(totalSeconds / 3600);
	return `${two(hh)}:${two(mm)}:${two(ss)}${drop ? ";" : ":"}${two(ff)}`;
}

export function formatFrameTimecode({ time, fps }: { time: number; fps: FrameRate }): string {
	return formatFrameNumber({ frame: frameIndexAt({ time, fps }), fps });
}

/**
 * The four fields of a typed timecode, filled from the right as Premiere, Resolve and Avid read them (polish3, 11.11):
 * «00:00:10:00», «10:00» (seconds and frames), «1:02:03» and a bare «1000» (pairs of digits from the right) all name
 * 00:00:10:00-style codes. Null when it is not a timecode at all.
 */
function timecodeFields(text: string): number[] | null {
	const typed = text.trim();
	if (/^\d{1,8}$/.test(typed)) {
		const digits = typed.padStart(8, "0");
		return [0, 2, 4, 6].map((at) => Number(digits.slice(at, at + 2)));
	}
	const parts = typed.split(/[:;.,]/);
	if (parts.length < 1 || parts.length > 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
	return [...Array(4 - parts.length).fill(0), ...parts.map(Number)];
}

/** The frame a typed «HH:MM:SS:FF» names («;», «.» or «,» before the frames too, or its short forms); null when it is not one. */
export function parseFrameNumber({ text, fps }: { text: string; fps: FrameRate }): number | null {
	const fields = timecodeFields(text);
	if (!fields) return null;
	const [hh, mm, ss, typed] = fields;
	const base = timecodeBase(fps);
	if (mm >= 60 || ss >= 60 || typed >= base) return null;
	let ff = typed;
	const minutes = hh * 60 + mm;
	let frame = (minutes * 60 + ss) * base;
	if (isDropFrame(fps)) {
		const dropped = Math.round(base / 15);
		// ;00 and ;01 do not exist at such a minute: the first frame that does (Premiere does the same).
		if (ss === 0 && mm % 10 !== 0 && ff < dropped) ff = dropped;
		frame -= dropped * (minutes - Math.floor(minutes / 10));
	}
	return frame + ff;
}

/** The start time of frame `frame`. */
export function frameStartTime({ frame, fps }: { frame: number; fps: FrameRate }): MediaTime {
	return mediaTime({ ticks: Math.round((frame * fps.denominator * TICKS_PER_SECOND) / fps.numerator) });
}

/** A time as the editor shows it: SMPTE for «HH:MM:SS:FF», the wasm formats for the others. */
export function formatEditorTimecode({ time, format, fps }: { time: MediaTime; format: TimeCodeFormat; fps: FrameRate }): string {
	if (format === "HH:MM:SS:FF") return formatFrameTimecode({ time, fps });
	return formatTimecode({ time, format, rate: fps }) ?? "";
}

/** A typed time in the editor's format (SMPTE for «HH:MM:SS:FF»); null when it reads as none. */
export function parseEditorTimecode({ text, format, fps }: { text: string; format: TimeCodeFormat; fps: FrameRate }): MediaTime | null {
	if (format === "HH:MM:SS:FF") {
		const frame = parseFrameNumber({ text, fps });
		return frame === null ? null : frameStartTime({ frame, fps });
	}
	return parseMediaTimecode({ timeCode: text, format, fps });
}
