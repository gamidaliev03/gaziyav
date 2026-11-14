// A stand-in for fal.ai with the same wire format (queue API, storage uploads, pricing, the OpenAI-compatible LLM),
// for the app's self-tests: the app is started with STUDIO_FAKE_NET=<this server>, so every request to the internet
// arrives here as /<host>/<path>. Nothing is paid, nothing leaves the Mac.
//   const fal = await startFakeFal({ ffmpeg }); … fal.log (every request), fal.mode.fail = 1 (next job fails once),
//   fal.mode.slow = true (jobs stay IN_PROGRESS until cancelled), fal.close()
// Requests are held to fal's own schemas (test/fal-schemas.json, made by fal-schema-audit.mjs): one fal would refuse is
// answered 422 as fal does and noted in fal.rejected. Failures on request: fal.mode.balance = 1 (the next job is refused:
// no money), fal.mode.refuse = 1 (the next job's answer: its safety filter), fal.mode.failDownload = true (result files
// don't come; the job itself is finished and paid), fal.mode.empty = true (the account is empty: its storage and every job
// are refused «Exhausted balance», as fal did on 10.11 02:09), fal.mode.admin = false (the key can't read the balance).
// Lipsync pieces (lipb, 14.11): fal.mode.lipPolls = (n) => polls (the n-th lipsync job, from 1, stays IN_PROGRESS that many
// polls: per-job delays), fal.mode.lipFail = [2] (the 2nd lipsync job fails, once), fal.mode.lipSilent = { 2: 4000 } (the
// 2nd lipsync job's status polls get no answer for 4 s: the connection is dropped), fal.mode.negate = true (the «lipsynced»
// clip is the sent one in negative: what came from the answer can be told from our own frames). fal.lip = { submitted,
// inFlight, maxInFlight, done } counts the lipsync jobs.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { checkInput } from "./fal-schema-check.mjs";

const SCHEMAS = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fal-schemas.json"), "utf8"));

export const FAKE_KEY = "fake-fal-key-0123456789abcdef";

export async function startFakeFal({ ffmpeg = "ffmpeg", dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-fal-")) } = {}) {
	const log = [];
	const mode = { fail: 0, slow: false, delayPolls: 2, balance: 0, refuse: 0, failDownload: false, credit: 25.5, empty: false, admin: true, lipPolls: null, lipFail: [], lipSilent: {}, negate: false };
	const rejected = [];
	const others = [];
	const uploads = new Map(); // name → { file, type }
	const jobs = new Map(); // id → { endpoint, input, polls, cancelled, fail }
	let n = 0;
	const lip = { submitted: 0, inFlight: 0, maxInFlight: 0, done: 0 };
	const isLip = (e) => /latentsync|sync-lipsync|lipsync|veed/.test(e);
	// Results the stand-in hands back: a tone for speech, a PNG for pictures, a test clip for video.
	const speech = path.join(dir, "speech.mp3");
	execFileSync(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=3.2", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "96k", speech]);
	const picture = path.join(dir, "picture.png");
	execFileSync(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=720x1280:d=1", "-frames:v", "1", picture]);
	const clip = path.join(dir, "clip.mp4");
	execFileSync(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=720x1280:r=30:d=5", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip]);

	const json = (res, status, body) => {
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(body));
	};
	const read = (req) => new Promise((resolve) => {
		const chunks = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks)));
	});
	const base = (host) => `https://${host}`;

	const resultOf = (job) => {
		const e = job.endpoint;
		if (/minimax\/voice-clone/.test(e)) return { custom_voice_id: `fake-clone-${job.id}` };
		if (/qwen-3-tts\/clone-voice/.test(e)) return { speaker_embedding: { url: `${base("v3.fal.media")}/files/embedding-${job.id}.safetensors`, content_type: "application/octet-stream" } };
		if (/qwen-3-tts\/text-to-speech/.test(e)) return { audio: { url: `${base("v3.fal.media")}/files/speech.mp3`, duration: 3.2 } };
		if (/minimax\/speech/.test(e)) return { audio: { url: `${base("v3.fal.media")}/files/speech.mp3` }, duration_ms: 3200 };
		if (/latentsync|sync-lipsync|lipsync|veed/.test(e)) {
			// The «lipsynced» clip: the very video that was sent (the stand-in can't move lips) — cut to whole 16-frame
			// chunks at 25 fps like the real LatentSync, which drops the rest (it took the last word, 05.11).
			const name = String(job.input.video_url ?? "").split("/").pop();
			if (!uploads.has(name)) return { video: { url: `${base("v3.fal.media")}/files/clip.mp4` } };
			if (!/latentsync/.test(e) && !mode.negate) return { video: { url: `${base("v3.fal.media")}/files/${name}` } };
			if (!/latentsync/.test(e)) {
				// (negate: a new picture, lossless, so the composite can be counted to the bit; the sound is the one sent)
				const out = `negated-${job.id}.mp4`;
				execFileSync(ffmpeg, ["-y", "-v", "error", "-i", uploads.get(name).file, "-vf", "negate", "-c:v", "libx264", "-preset", "veryfast", "-qp", "0", "-c:a", "copy", path.join(dir, out)]);
				uploads.set(out, { file: path.join(dir, out), type: "video/mp4" });
				return { video: { url: `${base("v3.fal.media")}/files/${out}` } };
			}
			const src = uploads.get(name).file;
			const seconds = Number(execFileSync(ffmpeg.replace(/ffmpeg$/, "ffprobe"), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src], { encoding: "utf8" }));
			const chunked = (Math.floor((seconds * 25) / 16) * 16) / 25;
			const out = `chunked-${job.id}.mp4`;
			execFileSync(ffmpeg, ["-y", "-v", "error", "-i", src, "-t", chunked.toFixed(3), ...(mode.negate ? ["-vf", "negate", "-c:v", "libx264", "-preset", "veryfast", "-qp", "0", "-c:a", "copy"] : ["-c", "copy"]), path.join(dir, out)]);
			uploads.set(out, { file: path.join(dir, out), type: "video/mp4" });
			return { video: { url: `${base("v3.fal.media")}/files/${out}` } };
		}
		if (/pixverse\/swap/.test(e)) {
			// The swapped clip: the very video that was sent (as long as it).
			const name = String(job.input.video_url ?? "").split("/").pop();
			return { video: { url: `${base("v3.fal.media")}/files/${uploads.has(name) ? name : "clip.mp4"}` } };
		}
		if (/seedance|kling-video\/v2/.test(e)) return { video: { url: `${base("v3.fal.media")}/files/clip.mp4` } };
		// AI video's other modes and models (src/fal/video.ts): a test clip, as fal's { video: File }.
		if (/minimax\/h3\/|veo3\.1|kling-video\/(v3|o3|ai-avatar)|omnihuman|wan\/v2\.[67]|vidu\/q4|lucy-restyle/.test(e)) return { video: { url: `${base("v3.fal.media")}/files/clip.mp4`, content_type: "video/mp4" } };
		if (/seedream|flux|nano-banana|face-swap/.test(e)) return { images: [{ url: `${base("v3.fal.media")}/files/picture.png` }] };
		return { ok: true };
	};

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url, "http://x");
		const [, host, ...rest] = url.pathname.split("/");
		const p = `/${rest.join("/")}`;
		const auth = req.headers.authorization ?? "";
		const body = await read(req);
		// Another API's stand-in on the same port (fake-kie.mjs): STUDIO_FAKE_NET takes one address.
		const other = others.find((o) => o.hosts.test(host));
		if (other) return other.handle(req, res, host, p, url, body);
		const entry = { method: req.method, host, path: p, auth: auth.startsWith("Key ") ? (auth === `Key ${FAKE_KEY}` ? "key-ok" : "key-wrong") : auth ? "other" : "none", at: Date.now() };
		log.push(entry);
		try {
			if (host === "v3.fal.media") {
				if (req.method === "PUT" && p.startsWith("/upload/")) {
					const name = p.slice("/upload/".length);
					const file = path.join(dir, name);
					fs.writeFileSync(file, body);
					uploads.set(name, { file, type: req.headers["content-type"] });
					entry.bytes = body.length;
					return json(res, 200, {});
				}
				if (req.method === "GET" && p.startsWith("/files/")) {
					if (mode.failDownload) return json(res, 503, { detail: "Stand-in: the file is not available" });
					const name = p.slice("/files/".length);
					const file = uploads.get(name)?.file ?? path.join(dir, name);
					if (!fs.existsSync(file)) return json(res, 404, { detail: "not found" });
					res.writeHead(200, { "Content-Length": fs.statSync(file).size });
					return fs.createReadStream(file).pipe(res);
				}
			}
			// Everything else needs the key.
			if (entry.auth !== "key-ok") return json(res, 401, { detail: "Authentication is required" });
			if (host === "rest.fal.ai" && p === "/storage/upload/initiate") {
				if (mode.empty) return json(res, 403, { detail: "User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing." });
				const ask = JSON.parse(body.toString() || "{}");
				const name = `${++n}-${String(ask.file_name ?? "file.bin").replace(/[^\w.-]/g, "_")}`;
				entry.upload = ask;
				return json(res, 200, { upload_url: `${base("v3.fal.media")}/upload/${name}`, file_url: `${base("v3.fal.media")}/files/${name}` });
			}
			// fal's account billing (an admin key reads it): the balance in dollars
			// (a key without the admin scope can't read it — the owner's on 10.11: the balance is «not reported»)
			if (host === "api.fal.ai" && p === "/v1/account/billing" && !mode.admin) return json(res, 403, { detail: "Admin key required" });
			if (host === "api.fal.ai" && p === "/v1/account/billing") return json(res, 200, { username: "stand-in", credits: { current_balance: mode.empty ? 0 : mode.credit, currency: "USD" } });
			if (host === "api.fal.ai" && p === "/v1/models/pricing") {
				const ids = url.searchParams.getAll("endpoint_id").flatMap((x) => x.split(","));
				return json(res, 200, { prices: ids.map((id) => ({ endpoint_id: id, unit_price: /latentsync/.test(id) ? 0.2 : /speech/.test(id) ? 0.06 : 0.03, unit: /speech/.test(id) ? "1000 characters" : /latentsync/.test(id) ? "request" : "image", currency: "USD" })), next_cursor: null, has_more: false });
			}
			if (host === "fal.run" && p === "/openrouter/router/openai/v1/chat/completions") {
				const ask = JSON.parse(body.toString() || "{}");
				entry.model = ask.model;
				return json(res, 200, { id: "chatcmpl-fake", object: "chat.completion", model: ask.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: ask.response_format ? JSON.stringify({ text: "Привет! Это тест." }) : "Привет! Это короткий текст для озвучки." } }], usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 } });
			}
			if (host === "queue.fal.run") {
				const m = /^\/(.+?)\/requests\/([\w-]+)(\/status|\/cancel)?$/.exec(p);
				if (req.method === "POST" && !m) {
					const endpoint = p.slice(1);
					const id = `req-${++n}`;
					const input = JSON.parse(body.toString() || "{}");
					entry.endpoint = endpoint;
					entry.input = input;
					if (mode.empty || mode.balance > 0) {
						if (!mode.empty) mode.balance--;
						return json(res, 403, { detail: "User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing." });
					}
					const problems = SCHEMAS[endpoint] ? checkInput(SCHEMAS[endpoint].input, input) : [`${endpoint}: no such endpoint`];
					if (problems.length) {
						rejected.push({ endpoint, problems, input });
						entry.rejected = problems;
						return json(res, 422, { detail: problems.map((msg) => ({ loc: ["body", msg.split(":")[0]], msg, type: "value_error", input })) });
					}
					const ord = isLip(endpoint) ? ++lip.submitted : 0;
					const failOnce = ord > 0 && mode.lipFail.includes(ord);
					if (failOnce) mode.lipFail = mode.lipFail.filter((k) => k !== ord);
					jobs.set(id, { id, endpoint, input, polls: 0, cancelled: false, fail: failOnce || (mode.fail > 0 ? mode.fail-- > 0 : false), refuse: mode.refuse > 0 ? mode.refuse-- > 0 : false, ord, silentUntil: ord && mode.lipSilent[ord] ? Date.now() + mode.lipSilent[ord] : 0 });
					entry.ord = ord;
					if (ord) {
						lip.inFlight++;
						lip.maxInFlight = Math.max(lip.maxInFlight, lip.inFlight);
					}
					const app = endpoint.split("/").slice(0, 2).join("/");
					const at = `${base("queue.fal.run")}/${app}/requests/${id}`;
					return json(res, 200, { request_id: id, response_url: at, status_url: `${at}/status`, cancel_url: `${at}/cancel`, queue_position: 0 });
				}
				if (m) {
					const job = jobs.get(m[2]);
					if (!job) return json(res, 404, { status: "NOT_FOUND" });
					entry.endpoint = job.endpoint;
					if (m[3] === "/cancel" && req.method === "PUT") {
						job.cancelled = true;
						return json(res, 202, { status: "CANCELLATION_REQUESTED" });
					}
					if (m[3] === "/status") {
						// gone silent: no answer at all (the connection dropped), the job keeps running here
						if (job.silentUntil && Date.now() < job.silentUntil) return req.socket.destroy();
						job.polls++;
						const settle = () => {
							if (job.ord && !job.settled) {
								job.settled = true;
								lip.inFlight--;
								lip.done++;
							}
						};
						if (job.cancelled) {
							settle();
							return json(res, 200, { status: "COMPLETED", request_id: job.id, error: "Cancelled by the user", error_type: "cancelled" });
						}
						if (job.polls === 1) return json(res, 200, { status: "IN_QUEUE", queue_position: 1, request_id: job.id });
						const hold = job.ord && typeof mode.lipPolls === "function" ? mode.lipPolls(job.ord) : mode.delayPolls;
						if (mode.slow || job.polls <= hold) return json(res, 200, { status: "IN_PROGRESS", request_id: job.id, logs: [] });
						settle();
						if (job.fail) return json(res, 200, { status: "COMPLETED", request_id: job.id, error: "Stand-in failure for the Retry test", error_type: "internal_error" });
						return json(res, 200, { status: "COMPLETED", request_id: job.id, logs: [], metrics: { inference_time: 1.2 } });
					}
					if (job.fail) return json(res, 500, { detail: "Stand-in failure for the Retry test" });
					// fal's own shape: the request is echoed under `input`, so words of the prompt are in this body too.
					if (job.refuse) return json(res, 422, { detail: [{ loc: ["body", "prompt"], msg: "The content could not be processed because it was flagged by a content checker.", type: "content_policy_violation", url: "https://docs.fal.ai/errors#content_policy_violation", input: job.input }] });
					return json(res, 200, resultOf(job));
				}
			}
			return json(res, 404, { detail: `the stand-in doesn't know ${host}${p}` });
		} catch (error) {
			return json(res, 500, { detail: String(error?.message ?? error) });
		}
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const port = server.address().port;
	return {
		url: `http://127.0.0.1:${port}`,
		/** Where the uploads land (a file_url's last part is the file's name here). */
		dir,
		log,
		mode,
		jobs,
		/** Lipsync jobs: submitted, running now, the most at once, finished. */
		lip,
		/** Requests fal would have refused (fal's own schema): must stay empty. */
		rejected,
		/** Puts another stand-in on these hosts (kie.ai's, ArgoLink's: any number). */
		mount: (next) => {
			others.push(next);
		},
		calls: (re) => log.filter((e) => e.host === "queue.fal.run" && e.method === "POST" && re.test(e.path)),
		close: () => new Promise((r) => server.close(() => r())),
	};
}
