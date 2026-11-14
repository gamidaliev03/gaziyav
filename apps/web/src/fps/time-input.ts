/**
 * What a person types into a time field, read forgivingly (timecode, 13.11). Pure: no wasm, ticks in and out.
 *
 *  - A leading + or − (or –) is RELATIVE to the playhead (`now`).
 *  - Digits only, no separators, read from the right as [H]H MM SS (seconds first):
 *    1–2 digits = seconds, 3–4 = M SS, 5–6 = H MM SS, 7–8 = HH MM SS FF (frames last). More than 8: nothing.
 *  - With separators (any of : ; . , or a space, mixed, repeated ones collapse): 2 parts = M:SS, 3 = H:MM:SS,
 *    4 = HH:MM:SS:FF; a part is 1–2 digits, an empty part is 0 («:30», «5:»). «1.5» is 1 min 5 s, never 1.5 s.
 *  - A number and f / F / к / К = frames («12f»; «+12f» relative).
 *  - Overflow carries (90 s = 1:30, frame ≥ fps carries into seconds); the result is clamped to 0 … max.
 *  - Nothing else reads as a time: null (the caller restores the old value, silently).
 * Drop-frame rates (29.97, 59.94) are counted as SMPTE, as fps/timecode.ts shows them.
 */
export const TICKS_PER_SECOND_DEFAULT = 120_000;

export interface TimeInputRate {
	numerator: number;
	denominator: number;
}

const isDrop = (fps: TimeInputRate) => fps.denominator === 1001 && (fps.numerator === 30_000 || fps.numerator === 60_000);
const baseOf = (fps: TimeInputRate) => Math.max(1, Math.round(fps.numerator / fps.denominator));

/** The typed text as a count: either an absolute frame, or frames to add to the playhead. */
function readTyped({ body, fps }: { body: string; fps: TimeInputRate }): { frames: number; nominal: number } | null {
	const base = baseOf(fps);
	const suffix = body.match(/^(\d{1,9})\s*[fFкК]$/);
	if (suffix) return { frames: Number(suffix[1]), nominal: Number(suffix[1]) };

	let h = 0;
	let m = 0;
	let s = 0;
	let f = 0;
	if (/^\d+$/.test(body)) {
		if (body.length > 8) return null;
		if (body.length <= 2) s = Number(body);
		else if (body.length <= 4) {
			const d = body.padStart(4, "0");
			m = Number(d.slice(0, 2));
			s = Number(d.slice(2));
		} else if (body.length <= 6) {
			const d = body.padStart(6, "0");
			h = Number(d.slice(0, 2));
			m = Number(d.slice(2, 4));
			s = Number(d.slice(4));
		} else {
			const d = body.padStart(8, "0");
			h = Number(d.slice(0, 2));
			m = Number(d.slice(2, 4));
			s = Number(d.slice(4, 6));
			f = Number(d.slice(6));
		}
	} else {
		if (!/\d/.test(body)) return null;
		const parts = body.split(/[:;.,\s]+/);
		if (parts.length < 2 || parts.length > 4 || parts.some((p) => !/^\d{0,2}$/.test(p))) return null;
		const n = parts.map((p) => (p === "" ? 0 : Number(p)));
		if (n.length === 2) [m, s] = n;
		else if (n.length === 3) [h, m, s] = n;
		else [h, m, s, f] = n;
	}
	const seconds = h * 3600 + m * 60 + s;
	const nominal = seconds * base + f;
	let frame = nominal;
	if (isDrop(fps)) {
		const dropped = Math.round(base / 15);
		const minutes = Math.floor(seconds / 60);
		// ;00 and ;01 do not exist at such a minute: the first frame that does.
		if (seconds % 60 === 0 && minutes % 10 !== 0 && f < dropped) frame += dropped - f;
		frame -= dropped * (minutes - Math.floor(minutes / 10));
	}
	return { frames: frame, nominal };
}

export function parseTimeInput({
	text,
	fps,
	now = 0,
	max,
	ticksPerSecond = TICKS_PER_SECOND_DEFAULT,
}: {
	text: string;
	fps: TimeInputRate;
	now?: number;
	max?: number;
	ticksPerSecond?: number;
}): number | null {
	if (typeof text !== "string") return null;
	let body = text.trim();
	let sign = 0;
	if (/^[+\-−–]/.test(body)) {
		sign = body[0] === "+" ? 1 : -1;
		body = body.slice(1).trim();
	}
	if (body === "") return null;
	const typed = readTyped({ body, fps });
	if (!typed) return null;
	const frameTicks = (ticksPerSecond * fps.denominator) / fps.numerator;
	let frame = typed.frames;
	if (sign !== 0) {
		const delta = typed.nominal; // relative: a second is `base` frames, no drop-frame skipping
		const nowFrame = Math.floor((Math.max(0, now) * fps.numerator) / (fps.denominator * ticksPerSecond) + 1e-9);
		frame = nowFrame + sign * delta;
	}
	let ticks = Math.round(Math.max(0, frame) * frameTicks);
	if (max !== undefined && max !== null && Number.isFinite(max)) ticks = Math.min(ticks, Math.max(0, max));
	return ticks;
}
