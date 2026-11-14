// The library's level: every music track and sound carries the gain, in dB, that brings it to −14 LUFS (music by
// integrated loudness, sounds — too short for that — by their loudest 400 ms); a boost stops at −1 dBTP; within ±12 dB.
// scripts/library-gain.ts measures the files with ffmpeg into src/library/gains.json; the server puts each item's
// gain on it, and the Audio tab plays and places the item with it (the clip's volume carries it, so the export has it).
export const TARGET_LUFS = -14;
export const CEILING_DBTP = -1;
export const MAX_GAIN_DB = 12;

/** The gain for one file from its measurements (null = no signal found). */
export function gainFor({
	kind,
	integrated,
	momentaryMax,
	truePeak,
}: {
	kind: "music" | "sfx";
	integrated: number | null;
	momentaryMax: number | null;
	truePeak: number | null;
}): number {
	const level = kind === "music" ? integrated : momentaryMax;
	if (level === null || level <= -60) return 0;
	let gain = TARGET_LUFS - level;
	// a boost stops at the ceiling; a file already at level is not cut for its peaks (the export limiter holds them)
	if (truePeak !== null && gain > 0) gain = Math.min(gain, Math.max(0, CEILING_DBTP - truePeak));
	gain = Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, gain));
	// under half a dB is at level
	return Math.abs(gain) < 0.5 ? 0 : Math.round(gain * 10) / 10;
}

/** dB → the factor a gain node takes. */
export const gainFactor = (db: number) => 10 ** (db / 20);
