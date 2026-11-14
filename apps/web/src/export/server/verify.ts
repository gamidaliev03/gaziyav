// The exported file is looked at before the editor says «Done» (IDEAL reliable §4): not empty, its length within a
// frame of the timeline's (and a little for the container's rounding), a sound stream when the timeline has sound, and
// its first and last second decode. A mismatch is said in words instead of «Done».
import fs from "node:fs";
import { findTool, run } from "@/studio/server/tools";

export interface VerifyExpect {
	/** the timeline's (or the range's) length in seconds; 0 = unknown */
	seconds?: number;
	fps?: number | null;
	/** the export carries sound */
	audio?: boolean;
	/** the export carries picture (false: an audio file) */
	video?: boolean;
}
/** What is wrong, as an English template and its values (the page says it in its language). */
export type Issue = { text: string; vars?: Record<string, string | number> };
export interface VerifyResult {
	ok: boolean;
	problems: Issue[];
	seconds: number | null;
	streams: { video: boolean; audio: boolean };
	bytes: number;
}

const STILL = /\.(png|jpe?g|webp|gif|heic|avif|bmp|tiff?)$/i;

export async function verifyExport(file: string, expect: VerifyExpect = {}): Promise<VerifyResult> {
	const problems: Issue[] = [];
	let bytes = 0;
	try {
		bytes = fs.statSync(file).size;
	} catch {
		return { ok: false, problems: [{ text: "the file isn't there" }], seconds: null, streams: { video: false, audio: false }, bytes: 0 };
	}
	if (bytes === 0) return { ok: false, problems: [{ text: "the file is empty (0 bytes)" }], seconds: null, streams: { video: false, audio: false }, bytes };
	if (STILL.test(file)) return { ok: true, problems, seconds: null, streams: { video: true, audio: false }, bytes };
	const probe = await run(findTool("ffprobe"), ["-v", "error", "-show_entries", "format=duration:stream=codec_type,duration", "-of", "json", file], { timeout: 60 }).catch(() => null);
	let info: { format?: { duration?: string }; streams?: { codec_type?: string; duration?: string }[] } = {};
	try {
		info = JSON.parse(probe?.stdout || "{}");
	} catch {}
	const streams = { video: !!info.streams?.some((s) => s.codec_type === "video"), audio: !!info.streams?.some((s) => s.codec_type === "audio") };
	const seconds = Number.parseFloat(info.format?.duration ?? "") || null;
	if (!probe || probe.status !== 0 || (!streams.video && !streams.audio)) {
		problems.push({ text: "the file can't be read as a video or sound file" });
		return { ok: false, problems, seconds, streams, bytes };
	}
	if (expect.video !== false && !streams.video) problems.push({ text: "it has no picture" });
	if (expect.audio && !streams.audio) problems.push({ text: "it has no sound, but the timeline has sound" });
	if (expect.seconds && expect.seconds > 0 && seconds) {
		// a frame, plus the container's rounding and an AAC frame of padding
		const frame = 1 / Math.max(1, expect.fps || 30);
		const slack = frame + 0.05;
		const diff = seconds - expect.seconds;
		if (Math.abs(diff) > slack) problems.push({ text: diff < 0 ? "it is {diff} s shorter than the timeline ({got} s instead of {want} s)" : "it is {diff} s longer than the timeline ({got} s instead of {want} s)", vars: { diff: Math.abs(diff).toFixed(2), got: seconds.toFixed(2), want: expect.seconds.toFixed(2) } });
	}
	// the first and the last second decode: frames (or sound) come out of them, not just a header that says so
	const len = seconds ?? expect.seconds ?? 0;
	const stream = streams.video ? "v:0" : "a:0";
	for (const [label, at] of [["first", 0], ["last", Math.max(0, len - 1)]] as const) {
		const r = await run(findTool("ffprobe"), ["-v", "error", "-select_streams", stream, "-read_intervals", `${at.toFixed(3)}%+1`, "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file], { timeout: 60 }).catch(() => null);
		const frames = Number.parseInt((r?.stdout ?? "").trim().split("\n")[0] ?? "", 10);
		if (!r || r.status !== 0 || !(frames > 0)) {
			problems.push({ text: label === "first" ? "its first second doesn't decode" : "its last second doesn't decode" });
		}
		if (len <= 1) break;
	}
	return { ok: problems.length === 0, problems, seconds, streams, bytes };
}
