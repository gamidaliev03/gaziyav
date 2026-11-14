// Scene cuts of a piece of a video file: ffmpeg's scdet filter on a small copy of the picture (fast, offline).
// Returns cut times in seconds from the start of the piece. A job, so the panel shows progress and Cancel works.
import { StudioError } from "@/studio/server/errors";
import { getFile } from "@/studio/server/files";
import { type JobState, startJob } from "@/studio/server/jobs";
import { findTool, reason, run } from "@/studio/server/tools";

export interface ScenesResult {
	/** Seconds from the start of the piece. */
	cuts: number[];
	/** scdet scores (0–100) of the cuts, for the toast/tests. */
	scores: number[];
}

/** Scenes shorter than this are not split off (flashes, fast pans). */
const MIN_SCENE = 0.5;

/** 0 (only hard cuts) … 1 (every change of shot): scdet's threshold 14 … 6; default 0.5 = ffmpeg's default 10. */
export function thresholdFor(sensitivity: number): number {
	const s = Math.min(1, Math.max(0, Number.isFinite(sensitivity) ? sensitivity : 0.5));
	return Math.round((14 - 8 * s) * 10) / 10;
}

/** Parses scdet's log lines: "lavfi.scd.score: 28.7, lavfi.scd.time: 1.5". */
export function parseScdet(log: string): Array<{ time: number; score: number }> {
	const out: Array<{ time: number; score: number }> = [];
	for (const m of log.matchAll(/lavfi\.scd\.score:\s*([\d.]+),\s*lavfi\.scd\.time:\s*([\d.]+)/g)) {
		out.push({ score: Number(m[1]), time: Number(m[2]) });
	}
	return out;
}

/** Keeps cuts at least MIN_SCENE apart and away from the piece's ends. */
export function cleanCuts(found: Array<{ time: number; score: number }>, length: number): ScenesResult {
	const cuts: number[] = [];
	const scores: number[] = [];
	for (const c of [...found].sort((a, b) => a.time - b.time)) {
		if (!(c.time >= MIN_SCENE) || (length > 0 && c.time > length - MIN_SCENE)) continue;
		const last = cuts[cuts.length - 1];
		if (last !== undefined && c.time - last < MIN_SCENE) {
			// Two cuts close together: keep the stronger one.
			if (c.score > scores[scores.length - 1]) {
				cuts[cuts.length - 1] = c.time;
				scores[scores.length - 1] = c.score;
			}
			continue;
		}
		cuts.push(c.time);
		scores.push(c.score);
	}
	return { cuts, scores };
}

export function startScenes(body: { fileId?: string; start?: number; length?: number; sensitivity?: number }): JobState {
	const file = getFile(String(body.fileId ?? ""));
	const start = Math.max(0, Number(body.start) || 0);
	const length = Number(body.length);
	if (!(length > 0.2)) throw new StudioError("The clip is too short to look for scenes.");
	const threshold = thresholdFor(Number(body.sensitivity ?? 0.5));
	return startJob("scenes", [{ id: "detect", title: "Finding scene changes", timeout: Math.max(300, Math.ceil(length * 3)) }], async (job) =>
		job.step("detect", async (signal) => {
			// Collected line by line: a long file's log may be longer than what run() keeps of stderr.
			const found: Array<{ time: number; score: number }> = [];
			const r = await run(
				findTool("ffmpeg"),
				[
					"-hide_banner",
					"-nostats",
					"-loglevel",
					"info",
					"-ss",
					start.toFixed(3),
					"-t",
					length.toFixed(3),
					"-i",
					file.path,
					"-an",
					"-sn",
					"-dn",
					// A 160 px copy is plenty to see a cut and keeps a 4K hour-long file quick.
					"-vf",
					`scale=160:-2,scdet=threshold=${threshold}`,
					"-progress",
					"pipe:1",
					"-f",
					"null",
					"-",
				],
				{
					timeout: Math.max(300, Math.ceil(length * 3)),
					signal,
					onLine: (line) => {
						const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
						if (m) job.progress("detect", Number(m[1]) / 1e6 / length);
						else if (line.includes("lavfi.scd.")) found.push(...parseScdet(line));
					},
				},
			);
			if (r.status !== 0) {
				const why = reason(r);
				if (/matches no streams|does not contain any stream|Output file .* does not contain/i.test(why)) {
					throw new StudioError("This clip has no picture, so there are no scenes to find.");
				}
				throw new StudioError(`Couldn't read the clip's picture: ${why}`);
			}
			const result = cleanCuts(found, length);
			job.detail("detect", result.cuts.length ? `${result.cuts.length} scene changes` : "no scene changes");
			return result;
		}),
	);
}
