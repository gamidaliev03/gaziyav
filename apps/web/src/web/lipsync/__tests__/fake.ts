// An in-process stand-in of the provider (the protocol of GaziyavShell/test/fake-fal.mjs) and of the page's media,
// for the unit tests: every call recorded, nothing leaves the process.
import type { Media, Probe } from "../media";

export const KEY = "test-key-0000-not-real-abcd";

export interface Call {
	method: string;
	url: string;
	auth: string | null;
	body?: unknown;
}

export function fakeProvider() {
	const calls: Call[] = [];
	const files = new Map<string, Blob>();
	const jobs = new Map<string, { endpoint: string; input: Record<string, unknown>; polls: number; cancelled: boolean }>();
	const mode = { polls: 2, failNext: 0, failDownload: 0, hang: false };
	let n = 0;
	const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "Content-Type": "application/json" } });
	const result = (endpoint: string) =>
		/clone-voice/.test(endpoint)
			? { speaker_embedding: { url: "https://v3.fal.media/files/embedding.safetensors" } }
			: /text-to-speech/.test(endpoint)
				? { audio: { url: "https://v3.fal.media/files/speech.mp3" } }
				: { video: { url: "https://v3.fal.media/files/result.mp4" } };
	files.set("speech.mp3", new Blob([JSON.stringify({ d: 3.2, a: true })], { type: "audio/mpeg" }));
	files.set("result.mp4", new Blob([JSON.stringify({ d: 3.2, v: true, a: true })], { type: "video/mp4" }));
	const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
		if (mode.hang) return new Promise<Response>(() => {});
		const url = String(input);
		const headers = (init.headers ?? {}) as Record<string, string>;
		const method = (init.method ?? "GET").toUpperCase();
		const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
		calls.push({ method, url, auth: headers.Authorization ?? null, body });
		const u = new URL(url);
		const keyed = headers.Authorization === `Key ${KEY}`;
		if (u.hostname === "v3.fal.media") {
			if (method === "PUT") return files.set(u.pathname.split("/").pop() as string, init.body as Blob), json({});
			if (mode.failDownload > 0) return mode.failDownload--, json({ detail: "unavailable" }, 503);
			const f = files.get(u.pathname.split("/").pop() as string);
			return f ? new Response(f) : json({ detail: "not found" }, 404);
		}
		if (!keyed) return json({ detail: "Authentication is required" }, 401);
		if (u.hostname === "rest.fal.ai") {
			const name = `${++n}-${(body as { file_name: string }).file_name}`;
			return json({ upload_url: `https://v3.fal.media/upload/${name}`, file_url: `https://v3.fal.media/files/${name}` });
		}
		const m = /^\/(.+?)\/requests\/([\w-]+)(\/status|\/cancel)?$/.exec(u.pathname);
		if (method === "POST" && !m) {
			const id = `req-${++n}`;
			jobs.set(id, { endpoint: u.pathname.slice(1), input: body as Record<string, unknown>, polls: 0, cancelled: false });
			const at = `https://queue.fal.run/${u.pathname.slice(1).split("/").slice(0, 2).join("/")}/requests/${id}`;
			return json({ request_id: id, status_url: `${at}/status`, response_url: at, cancel_url: `${at}/cancel` });
		}
		const job = m && jobs.get(m[2]);
		if (!job || !m) return json({ status: "NOT_FOUND" }, 404);
		if (m[3] === "/cancel") return (job.cancelled = true), json({ status: "CANCELLATION_REQUESTED" }, 202);
		if (m[3] === "/status") {
			job.polls++;
			if (job.polls === 1) return json({ status: "IN_QUEUE", queue_position: 1 });
			if (job.polls <= mode.polls) return json({ status: "IN_PROGRESS" });
			if (mode.failNext > 0) return mode.failNext--, json({ status: "COMPLETED", error: "Stand-in failure", error_type: "internal_error" });
			return json({ status: "COMPLETED" });
		}
		return json(result(job.endpoint));
	}) as typeof globalThis.fetch;
	const submits = (re: RegExp) => calls.filter((c) => c.method === "POST" && c.url.startsWith("https://queue.fal.run/") && re.test(c.url)).length;
	return { fetch, calls, files, jobs, mode, submits };
}

/** Test media: a blob is JSON {d: seconds, v: has video, a: has sound}; preparing a span gives {d: length}. */
export async function readFake(blob: Blob): Promise<{ d: number; v?: boolean; a?: boolean; hdr?: boolean }> {
	try {
		return JSON.parse(await blob.text());
	} catch {
		return { d: 0 };
	}
}

export const fakeMedia: Media = {
	async probe(blob): Promise<Probe> {
		const f = await readFake(blob);
		return { duration: f.d, hasVideo: !!f.v, hasAudio: !!f.a, width: 1080, height: 1920, fps: 30, hdr: !!f.hdr };
	},
	async prepareSpan(blob, start, length) {
		const f = await readFake(blob);
		const d = Math.min(f.d, start + length) - start;
		return { file: new Blob([JSON.stringify({ d, v: true, a: true, from: start })], { type: "video/mp4" }), info: { duration: f.d, hasVideo: true, hasAudio: true, width: 1080, height: 1920, fps: 30, hdr: false } };
	},
	async voiceSample(blob, start, length) {
		const f = await readFake(blob);
		return { file: new Blob([JSON.stringify({ d: Math.min(f.d - start, length), a: true })], { type: "audio/wav" }), seconds: Math.min(f.d - start, length) };
	},
};

export const clip = (seconds: number, name = "talk.mp4") => new File([JSON.stringify({ d: seconds, v: true, a: true })], name, { type: "video/mp4", lastModified: 1 });
export const sound = (seconds: number, name = "voice.m4a") => new File([JSON.stringify({ d: seconds, a: true })], name, { type: "audio/mp4", lastModified: 1 });
