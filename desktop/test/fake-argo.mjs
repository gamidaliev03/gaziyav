// A stand-in for ArgoLink, shaped from what argolink.io/en/models/<id> and /en/docs print (06.11.2026): POST
// /v1/videos/generations → { request_id }; GET /v1/videos/{id} → { status: pending|done|failed|expired, video.url, usage.billed_seconds,
// error }; POST /v1/media/uploads { model, type, content_type, size_bytes } → { upload_url, media_url } then PUT; GET /v1/account/balance
// → { available, held, total }. Mounted on fake-fal.mjs's port (STUDIO_FAKE_NET takes one address). Nothing is paid and nothing
// leaves the Mac; NO live call was made (no key): every field here is as documented, not as observed.
//   const argo = await mountFakeArgo(fal, { ffmpeg }); argo.log, argo.rejected (requests the documented form refuses, with why),
//   argo.mode.fail = 1 (the next job ends `failed`), argo.mode.queue = true (jobs stay `pending`), argo.mode.balance (dollars),
//   argo.mode.billed (seconds a done job reports; default: the duration asked for)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const FAKE_ARGO_KEY = "fake-argo-key-0123456789abcdef";
const FORM = {
	"seedance-2.0-mini": { resolutions: ["480p", "720p"] },
	"seedance-2.0-fast": { resolutions: ["480p", "720p"] },
	"seedance-2.0": { resolutions: ["480p", "720p", "1080p", "4k"] },
};
const SHAPES = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const RATE = { "seedance-2.0-mini": { "480p": 0.0299, "720p": 0.0643 }, "seedance-2.0-fast": { "480p": 0.0478, "720p": 0.103 }, "seedance-2.0": { "480p": 0.0598, "720p": 0.129, "1080p": 0.318, "4k": 0.661 } };

/** The problems the documented form finds in a request body (empty: it is accepted). */
export function checkVideo(b) {
	const f = FORM[b.model];
	if (!f) return [`model: ${b.model} is not one of ${Object.keys(FORM).join(", ")}`];
	const problems = [];
	const allowed = new Set(["model", "prompt", "duration", "resolution", "aspect_ratio", "size", "start_image", "end_image", "reference_images", "reference_videos", "reference_audios", "n", "generate_audio"]);
	for (const k of Object.keys(b)) if (!allowed.has(k)) problems.push(`${k}: not a field of the form`);
	if (typeof b.prompt !== "string" || !b.prompt.trim()) problems.push("prompt: required");
	if (b.duration !== undefined && !(Number.isInteger(b.duration) && b.duration >= 4 && b.duration <= 15)) problems.push(`duration: whole seconds 4–15, got ${JSON.stringify(b.duration)}`);
	if (b.resolution !== undefined && !f.resolutions.includes(b.resolution)) problems.push(`resolution: ${b.resolution} not in ${f.resolutions.join("/")}`);
	const first = !!b.start_image;
	if (b.aspect_ratio !== undefined && !(SHAPES.includes(b.aspect_ratio) || (first && b.aspect_ratio === "adaptive"))) problems.push(`aspect_ratio: ${b.aspect_ratio}`);
	const img = (x) => x && typeof x === "object" && /^https:\/\//.test(x.url ?? "");
	if (b.start_image !== undefined && !img(b.start_image)) problems.push("start_image: {url: <HTTPS image>}");
	if (b.end_image !== undefined && (!img(b.end_image) || !b.start_image)) problems.push("end_image: {url} and needs start_image");
	if (b.reference_images !== undefined && !(Array.isArray(b.reference_images) && b.reference_images.length <= 9 && b.reference_images.every(img))) problems.push("reference_images: up to 9 of {url}");
	if (b.start_image && (b.reference_images?.length || b.reference_videos?.length || b.reference_audios?.length)) problems.push("start_image cannot be combined with reference assets");
	if (b.generate_audio !== undefined && typeof b.generate_audio !== "boolean") problems.push("generate_audio: boolean");
	return problems;
}

export async function mountFakeArgo(fal, { ffmpeg = "ffmpeg", dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-argo-")) } = {}) {
	const log = [];
	const rejected = [];
	const jobs = new Map();
	const uploads = [];
	const mode = { fail: 0, queue: false, balance: 40.25, billed: undefined, failDownload: false };
	let n = 0;
	execFileSync(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=720x1280:r=25:d=6", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(dir, "clip.mp4")]);
	const json = (res, body, status = 200) => {
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(body));
	};
	const handle = (req, res, host, p, url, body) => {
		const entry = { method: req.method, host, path: p, auth: req.headers.authorization === `Bearer ${FAKE_ARGO_KEY}` ? "key-ok" : req.headers.authorization ? "key-wrong" : "none", at: Date.now() };
		log.push(entry);
		if (host === "files.argo.test") {
			if (req.method === "PUT") {
				uploads.push({ path: p, bytes: body.length, type: req.headers["content-type"] });
				return json(res, { ok: true });
			}
			if (mode.failDownload) return json(res, { detail: "not available" }, 503);
			const file = path.join(dir, p.slice(1));
			if (!fs.existsSync(file)) return json(res, { detail: "not found" }, 404);
			res.writeHead(200, { "Content-Length": fs.statSync(file).size });
			return fs.createReadStream(file).pipe(res);
		}
		if (url.search.includes("key=") || url.search.includes("api_key")) return json(res, { error: { message: "a key in a URL is refused" } }, 400);
		if (entry.auth !== "key-ok") return json(res, { error: { code: "INVALID_API_KEY", message: "Unauthorized" } }, 401);
		if (p === "/v1/account/balance") return json(res, { object: "account.balance", currency: "USD", available: mode.balance - heldNow(), held: heldNow(), total: mode.balance, observed_at: new Date().toISOString() });
		if (p === "/v1/media/uploads" && req.method === "POST") {
			const b = JSON.parse(body.toString() || "{}");
			const problems = [];
			for (const k of ["model", "type", "content_type", "size_bytes"]) if (b[k] === undefined) problems.push(`${k}: required`);
			if (problems.length) {
				rejected.push({ path: p, problems, body: b });
				return json(res, { error: { message: problems.join("; ") } }, 400);
			}
			const id = ++n;
			return json(res, { upload_url: `https://files.argo.test/up/${id}`, media_url: `https://files.argo.test/media/${id}` });
		}
		if (p === "/v1/videos/generations" && req.method === "POST") {
			const b = JSON.parse(body.toString() || "{}");
			entry.model = b.model;
			entry.input = b;
			const problems = checkVideo(b);
			if (problems.length) {
				rejected.push({ path: p, problems, body: b });
				return json(res, { error: { code: "invalid_input", message: problems.join("; ") } }, 400);
			}
			if (mode.balance < 1) return json(res, { error: { code: "insufficient_balance", message: "Insufficient balance" } }, 402);
			const id = `req_${++n}`;
			jobs.set(id, { polls: 0, b, fail: mode.fail > 0 ? mode.fail-- > 0 : false, queue: mode.queue, billed: mode.billed ?? b.duration ?? 5, settled: false });
			return json(res, { request_id: id });
		}
		const poll = /^\/v1\/videos\/([\w-]+)$/.exec(p);
		if (poll && req.method === "GET") {
			const job = jobs.get(poll[1]);
			if (!job) return json(res, { error: { message: "no such job" } }, 404);
			job.polls++;
			if (job.queue || job.polls < 3) return json(res, { request_id: poll[1], status: "pending" });
			if (job.fail) return json(res, { request_id: poll[1], status: "failed", error: { code: "generation_failed", message: "The stand-in failed this job." } });
			if (!job.settled) {
				job.settled = true;
				mode.balance -= job.billed * (RATE[job.b.model]?.[job.b.resolution ?? "720p"] ?? 0);
			}
			return json(res, { request_id: poll[1], status: "done", video: { url: "https://files.argo.test/clip.mp4" }, usage: { billed_seconds: job.billed } });
		}
		return json(res, { error: { message: `the stand-in doesn't know ${host}${p}` } }, 404);
	};
	const heldNow = () => [...jobs.values()].filter((j) => !j.settled && !j.fail).length * 0.5;
	fal.mount({ hosts: /^(argolink\.io|files\.argo\.test)$/, handle });
	return { log, mode, rejected, uploads, jobs, calls: (re) => log.filter((e) => e.path === "/v1/videos/generations" && e.model && re.test(e.model)) };
}
