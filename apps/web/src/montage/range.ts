// Pure helpers for the export of AI layers (no wasm imports: unit-testable in bun).
import type { MontageInput } from "./types";

/** Moves layers into an In→Out range: time 0 = In, cut at the edges (the head goes to `skip`). */
export function shiftToRange(items: MontageInput["items"], start: number, length: number): MontageInput["items"] {
	const out: MontageInput["items"] = [];
	for (const it of items) {
		let from = it.from - start;
		let dur = it.dur;
		let skip = it.skip ?? 0;
		if (from + dur <= 0 || from >= length) continue;
		if (from < 0) {
			skip += -from;
			dur += from;
			from = 0;
		}
		dur = Math.min(dur, length - from);
		out.push({ ...it, from, dur, skip, len: it.len ?? it.dur + (it.skip ?? 0) });
	}
	return out;
}
