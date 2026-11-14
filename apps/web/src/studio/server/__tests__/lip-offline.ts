// Offline check of the pieces' cut + stitch (no app): plan → cut each request → a stand-in answer (the sent video
// negated) → stitch with the composite → bar codes in order, outside the face equal to the source (lossless).
//   bun src/studio/server/__tests__/lip-offline.ts <clip.mp4> <work dir>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { falModel } from "@/fal/models";
import { analyse, planFor } from "../lip-run";
import { cutRequest, faceMarks, partsOf, stitch } from "../lip-media";
import { maskOf, trustedBoxes } from "../lip-compose";

const [clip, dir] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
const t0 = Date.now();
const audio = path.join(dir, "sound.m4a");
execFileSync("ffmpeg", ["-y", "-v", "error", "-i", clip, "-vn", "-c:a", "copy", audio]);
const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", clip], { encoding: "utf8" }));
const a = await analyse({ source: clip, start: 0, pieceSeconds: dur, audio, fit: "loop", dir, scan: true, chroma444: false, build: true });
const model = falModel(process.env.MODEL || "fal-ai/latentsync")!;
const plan = planFor(a, model, { pieces: true, composite: true, pack: true, parallel: 3, chroma444: false, lossless: true });
console.log("cuts", a.cuts, "speech", a.speech.length, "plan", plan.mode, plan.requests.length, "req", plan.secondsSent.toFixed(1), "s", (plan.usd * 100).toFixed(1), "¢ of", (plan.wholeUsd * 100).toFixed(1));
const answers = new Map();
for (const [ri, r] of plan.requests.entries()) {
	const video = path.join(dir, `send-${ri}.mp4`);
	const sound = path.join(dir, `send-${ri}.m4a`);
	await cutRequest({ base: a.base.file, k0: a.base.k0, fps: a.info.fps, segments: r.segments, audio: a.lengths.audio, picture: a.picture, tail: 0.8, video, sound });
	const answer = path.join(dir, `answer-${ri}.mp4`);
	execFileSync("ffmpeg", ["-y", "-v", "error", "-i", video, "-vf", "negate", "-c:v", "libx264", "-qp", "0", answer]);
	const marks = await faceMarks(video);
	answers.set(ri, { file: answer, marks });
	const t = marks ? trustedBoxes(marks) : [];
	console.log("request", ri, r.segments.length, "segments", r.frames, "frames; marks", marks?.length, "trusted", t.filter(Boolean).length);
}
const out = path.join(dir, "result.mp4");
const stats = await stitch({ base: a.base.file, k0: a.base.k0, fps: a.info.fps, frames: Math.round(a.lengths.wanted * a.info.fps), width: a.info.width, height: a.info.height, picture: a.picture, parts: partsOf(plan, answers), audio: a.lengths.audio, seconds: a.lengths.wanted, composite: true, lossless: true, out });
console.log("stitch", stats, ((Date.now() - t0) / 1000).toFixed(1), "s");
// the count: decode source and result, compare
const W = a.info.width, H = a.info.height, size = W * H * 3 / 2;
const src = execFileSync("ffmpeg", ["-v", "error", "-i", clip, "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"], { maxBuffer: 2 ** 31 });
const res = execFileSync("ffmpeg", ["-v", "error", "-i", out, "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"], { maxBuffer: 2 ** 31 });
const n = res.length / size;
const parts = partsOf(plan, answers);
let codeBad = 0, outsideDiff = 0, outsidePix = 0, coreOk = 0, coreN = 0, coreOff = 0, nearest = 0, faced = 0;
for (let f = 0; f < n; f++) {
	let v = 0;
	for (let k = 0; k < 16; k++) if (res[f * size + 13 * W + 8 + k * 10 + 5] > 128) v |= 1 << k;
	if (v !== f) codeBad++;
	const p = parts.find((q) => f >= q.a && f < q.b);
	const boxes = p?.marks ? trustedBoxes(p.marks) : null;
	const box = p && boxes ? boxes[p.at + f - p.a] : null;
	const m = box ? maskOf(box, W, H) : null;
	if (m && f > 0 && f + 1 < n) {
		// which source frame's negative is the answer here: this one, or one off?
		const d = [0, -1, 1].map((k) => { let e = 0; for (let y = m.y0 + m.f; y < m.y1 - m.f; y += 2) for (let x = m.x0 + m.f; x < m.x1 - m.f; x += 2) e += Math.abs(res[f * size + y * W + x] - (255 - src[(f + k) * size + y * W + x])); return e; });
		faced++;
		if (d[0] < d[1] && d[0] < d[2]) nearest++;
	}
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		const i = f * size + y * W + x;
		const inside = m && x >= m.x0 && x < m.x1 && y >= m.y0 && y < m.y1;
		if (!inside && !(p && !m)) { outsidePix++; if (res[i] !== src[i]) outsideDiff++; }
		if (m && x >= m.x0 + m.f && x < m.x1 - m.f && y >= m.y0 + m.f && y < m.y1 - m.f && (x + y) % 7 === 0) {
			coreN++;
			if (Math.abs(res[i] - (255 - src[i])) <= 3) coreOk++;
			if (f > 0 && Math.abs(res[i] - (255 - src[i - size])) <= 3) coreOff++;
		}
	}
}
console.log({ frames: n, faced, rightFrameInside: nearest, codeBad, outsidePix, outsideDiff, coreN, coreOk, coreOneFrameOff: coreOff });
