// A stand-in for kie.ai with its wire format (createTask → recordInfo, the upload host, the balance), mounted on
// fake-fal.mjs's port: STUDIO_FAKE_NET takes one address. Nothing is paid, nothing leaves the Mac. Requests are held to the
// record of kie's own model forms (test/kie-schemas.json): one kie would refuse gets its `code` 422 and lands in .rejected.
//   const kie = await mountFakeKie(fal, { ffmpeg }); kie.log, kie.mode.limit = 2 (the next 2 requests answer code 429),
//   kie.mode.fail = 1 (the next task fails), kie.mode.stuck = true (tasks never end), kie.mode.credits = true (no credits)
//   kie.uploads: what was uploaded ({ url, bytes, bitrate of a video }); a lipsync video outside 1–30 Mbit/s is refused like kie does
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkInput } from "./fal-schema-check.mjs";

const SCHEMAS = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "kie-schemas.json"), "utf8"));
export const FAKE_KIE_KEY = "fake-kie-key-0123456789abcdef";

export async function mountFakeKie(fal, { ffmpeg = "ffmpeg", dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-kie-")) } = {}) {
	const log = [];
	const rejected = [];
	const tasks = new Map();
	const uploads = [];
	const ffprobe = path.join(path.dirname(ffmpeg), "ffprobe");
	/** A video's mean bit rate (size over length), as kie's page states its rule. */
	const bitrateOf = (file) => {
		try {
			const f = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration,size", "-of", "json", file]).toString()).format;
			return Math.round((Number(f.size) * 8) / Number(f.duration));
		} catch {
			return 0;
		}
	};
	/** The file part of a multipart upload. */
	const filePart = (req, body) => {
		const boundary = /boundary=(.+)$/.exec(req.headers["content-type"] ?? "")?.[1];
		if (!boundary) return null;
		const start = body.indexOf("\r\n\r\n", body.indexOf('name="file"'));
		const end = body.lastIndexOf(`\r\n--${boundary}`);
		return start > 0 && end > start ? body.subarray(start + 4, end) : null;
	};
	// stuck: true = started and never ends ("generating"); "queue" = never leaves "waiting". charge: credits a finished task reports as really used.
	const mode = { limit: 0, fail: 0, stuck: false, credits: false, balance: 1234.5, failDownload: false, charge: undefined };
	let n = 0;
	const files = {
		"clip.mp4": ["-f", "lavfi", "-i", "testsrc2=s=720x1280:r=25:d=6", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"],
		"picture.png": ["-f", "lavfi", "-i", "testsrc2=s=720x1280:d=1", "-frames:v", "1"],
		"speech.mp3": ["-f", "lavfi", "-i", "sine=frequency=300:duration=3.2", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "96k"],
	};
	for (const [name, args] of Object.entries(files)) execFileSync(ffmpeg, ["-y", "-v", "error", ...args, path.join(dir, name)]);
	const json = (res, body, status = 200) => {
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(body));
	};
	const output = (model) => (/text-to-speech/.test(model) ? "speech.mp3" : /image|banana|seedream|flux|qwen/.test(model) && !/to-video|avatar|omnihuman|infinitalk/.test(model) ? "picture.png" : "clip.mp4");
	const handle = (req, res, host, p, url, body) => {
		const entry = { method: req.method, host, path: p, auth: req.headers.authorization === `Bearer ${FAKE_KIE_KEY}` ? "key-ok" : req.headers.authorization ? "key-wrong" : "none", at: Date.now() };
		log.push(entry);
		if (host === "files.kie.test") {
			if (mode.failDownload) return json(res, { detail: "not available" }, 503);
			const file = path.join(dir, p.slice(1));
			if (!fs.existsSync(file)) return json(res, { detail: "not found" }, 404);
			res.writeHead(200, { "Content-Length": fs.statSync(file).size });
			return fs.createReadStream(file).pipe(res);
		}
		if (entry.auth !== "key-ok") return json(res, { code: 401, msg: "Unauthorized" });
		if (mode.limit > 0) {
			mode.limit--;
			entry.limited = true;
			return json(res, { code: 429, msg: "Rate limit exceeded" });
		}
		if (p === "/api/v1/chat/credit") return json(res, { code: 200, msg: "success", data: mode.balance });
		if (host === "kieai.redpandaai.co" && p === "/api/file-stream-upload") {
			entry.bytes = body.length;
			entry.multipart = /multipart\/form-data/.test(req.headers["content-type"] ?? "");
			const name = `upload-${++n}`;
			const part = filePart(req, body);
			const up = { url: `https://files.kie.test/${name}`, bytes: body.length };
			if (part) {
				const file = path.join(dir, `${name}.bin`);
				fs.writeFileSync(file, part);
				if (/filename="[^"]*\.(mp4|mov)"/.test(body.subarray(0, 600).toString("latin1"))) up.bitrate = bitrateOf(file);
			}
			uploads.push(up);
			return json(res, { success: true, code: 200, msg: "ok", data: { downloadUrl: up.url, fileSize: body.length } });
		}
		if (p === "/api/v1/jobs/createTask") {
			const ask = JSON.parse(body.toString() || "{}");
			entry.model = ask.model;
			entry.input = ask.input;
			if (mode.credits) return json(res, { code: 402, msg: "Credits insufficient" });
			const problems = SCHEMAS[ask.model] ? checkInput(SCHEMAS[ask.model].input, ask.input ?? {}) : [`${ask.model}: no such model`];
			// kie's page for ByteDance lipsync: video of 1–30 Mbit/s (a still picture cut at a normal quality is far under).
			if (ask.model === "volcengine/video-to-video-lip-sync") {
				const rate = uploads.find((u) => u.url === ask.input?.video_url)?.bitrate;
				if (rate !== undefined && (rate < 1e6 || rate > 30e6)) problems.push(`video_url: bitrate ${(rate / 1e6).toFixed(2)} Mbps, 1–30 Mbps accepted`);
			}
			if (problems.length) {
				rejected.push({ model: ask.model, problems, input: ask.input });
				return json(res, { code: 422, msg: problems.join("; ") });
			}
			const taskId = `task_${++n}`;
			tasks.set(taskId, { model: ask.model, polls: 0, fail: mode.fail > 0 ? mode.fail-- > 0 : false, stuck: mode.stuck, charge: mode.charge });
			return json(res, { code: 200, msg: "success", data: { taskId } });
		}
		if (p === "/api/v1/jobs/recordInfo") {
			const task = tasks.get(url.searchParams.get("taskId"));
			if (!task) return json(res, { code: 404, msg: "No such task" });
			task.polls++;
			if (task.stuck || task.polls < 3) return json(res, { code: 200, data: { state: task.stuck === "queue" || task.polls < 2 ? "waiting" : "generating" } });
			if (task.fail) return json(res, { code: 200, data: { state: "fail", failCode: "501", failMsg: "The upstream API service timed out and no results were returned, please try again.", creditsConsumed: 0 } });
			if (task.charge !== undefined && !task.billed) {
				task.billed = true;
				mode.balance -= task.charge;
			}
			return json(res, { code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: [`https://files.kie.test/${output(task.model)}`] }), ...(task.charge === undefined ? {} : { creditsConsumed: task.charge }) } });
		}
		return json(res, { code: 404, msg: `the stand-in doesn't know ${host}${p}` });
	};
	fal.mount({ hosts: /^(api\.kie\.ai|kieai\.redpandaai\.co|files\.kie\.test)$/, handle });
	return { log, mode, rejected, tasks, uploads, calls: (re) => log.filter((e) => e.path === "/api/v1/jobs/createTask" && e.model && re.test(e.model)) };
}
