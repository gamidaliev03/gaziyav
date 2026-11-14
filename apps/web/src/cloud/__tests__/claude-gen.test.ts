// died with fal empty (K4/B5); fal's 402 was forgotten at once; a re-sent paid call paid again (C2); a typeless MP4 sound
// was sent as «.mp3» and refused «Audio format is invalid» (K9); a refused picture said nothing of what was flagged and
// was sent again (C13); every job was followed 30 min (B1); a text model's id with mode image ran another model (B4).
// The network is a fetch stand-in (fal, kie.ai); nothing leaves the Mac.
const ENV_BEFORE = { STUDIO_TEST: process.env.STUDIO_TEST, STUDIO_FAKE_TIMEOUT: process.env.STUDIO_FAKE_TIMEOUT, LIPSYNC_HOME: process.env.LIPSYNC_HOME };
process.env.STUDIO_TEST = "1";
process.env.STUDIO_FAKE_TIMEOUT = "5";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

setDefaultTimeout(60_000);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-gen-"));
process.env.LIPSYNC_HOME = dir;
const slots = globalThis as Record<string, unknown>;
slots.__gaziyavFalKey = "fake-fal-key-for-the-test";
slots.__gaziyavKieKey = "fake-kie-key-for-the-test";

type Server = typeof import("../server");
let S: Server;
let empty: typeof import("@/ai/empty");
let provider: typeof import("@/ai/provider").provider;

// ── media made here ──
const FF = (args: string[]) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);
const PNG = path.join(dir, "face.png");
const MP4 = path.join(dir, "mama-v5.mp4");
const MP3 = path.join(dir, "line.mp3");

// ── the stand-in ──
type Log = { method: string; host: string; path: string; body?: Buffer; json?: Record<string, unknown> };
const log: Log[] = [];
const realFetch = globalThis.fetch;
const net = {
	falEmpty: false,
	/** fal's answer to a submit: a 422 refusal of the picture, or a job */
	falRefuse: false,
	/** what fal's status says of a finished avatar job: the first n say «Audio format is invalid» */
	badAudio: 0,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let ids = 0;
const status_: Record<string, { error?: string }> = {};

async function fake(input: string | URL | Request, init?: RequestInit): Promise<Response> {
	const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
	const method = init?.method ?? "GET";
	const raw = init?.body;
	let body: Buffer | undefined;
	if (raw instanceof FormData) {
		const f = raw.get("file") as File | null;
		if (f) body = Buffer.from(await f.arrayBuffer());
	} else if (typeof raw === "string") body = Buffer.from(raw);
	else if (raw instanceof Uint8Array) body = Buffer.from(raw);
	else if (raw instanceof Blob) body = Buffer.from(await raw.arrayBuffer());
	let parsed: Record<string, unknown> | undefined;
	try {
		parsed = body && typeof raw === "string" ? JSON.parse(body.toString()) : undefined;
	} catch {}
	log.push({ method, host: u.host, path: u.pathname, body, json: parsed });
	// fal storage
	if (u.host === "rest.fal.ai" && u.pathname.endsWith("/storage/upload/initiate")) {
		if (net.falEmpty) return json({ detail: "User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing." }, 403);
		const n = ++ids;
		return json({ upload_url: `https://upload.fal.test/put/${n}`, file_url: `https://v3.fal.media/files/gz_${n}${path.extname(String((parsed as { file_name?: string })?.file_name ?? ""))}` });
	}
	if (u.host === "upload.fal.test") return new Response("", { status: 200 });
	// fal queue
	if (u.host === "queue.fal.run") {
		const m = /\/requests\/([^/]+)(\/status)?$/.exec(u.pathname);
		if (method === "POST" && !m) {
			if (net.falEmpty) return json({ detail: "Exhausted balance" }, 402);
			if (net.falRefuse) return json({ detail: [{ loc: ["body", "image_url"], msg: "The content could not be processed because it contained material flagged by a content checker.", type: "content_policy_violation" }] }, 422);
			const id = `req_${++ids}`;
			status_[id] = net.badAudio > 0 ? (net.badAudio--, { error: "Audio format is invalid" }) : {};
			const app = u.pathname.split("/").slice(1, 3).join("/");
			return json({ request_id: id, status_url: `https://queue.fal.run/${app}/requests/${id}/status`, response_url: `https://queue.fal.run/${app}/requests/${id}` });
		}
		if (m?.[2]) return json({ status: "COMPLETED", ...(status_[m[1]]?.error ? { error: status_[m[1]].error } : {}) });
		if (m) return json({ video: { url: "https://v3.fal.media/files/out.mp4" }, images: [{ url: "https://v3.fal.media/files/out.png" }] });
	}
	if (u.host === "v3.fal.media" || u.host === "files.kie.test") return new Response(fs.readFileSync(u.pathname.endsWith(".png") ? PNG : MP4), { status: 200 });
	// kie.ai
	if (u.host === "kieai.redpandaai.co") return json({ code: 200, data: { downloadUrl: `https://files.kie.test/up/${++ids}` } });
	if (u.host === "api.kie.ai" && u.pathname.endsWith("/createTask")) return json({ code: 200, data: { taskId: `task_${++ids}` } });
	if (u.host === "api.kie.ai" && u.pathname.endsWith("/recordInfo")) return json({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://files.kie.test/out.mp4"] }) } });
	return json({ error: `no stand-in for ${u.host}${u.pathname}` }, 404);
}

const calls = (host: string, p?: RegExp) => log.filter((l) => l.host === host && (!p || p.test(l.path)));
async function settled(id: string) {
	for (let i = 0; i < 400; i++) {
		const v = S.job(id);
		if (v.state === "succeeded" || v.state === "failed") return v;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error("the job never ended");
}

beforeAll(async () => {
	FF(["-f", "lavfi", "-i", "color=c=0x3366aa:s=96x128:d=1", "-frames:v", "1", PNG]);
	FF(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=2", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", MP4]);
	FF(["-f", "lavfi", "-i", "sine=frequency=330:duration=2", "-c:a", "libmp3lame", "-b:a", "128k", MP3]);
	S = await import("../server");
	empty = await import("@/ai/empty");
	({ provider } = await import("@/ai/provider"));
});
beforeEach(() => {
	globalThis.fetch = fake as unknown as typeof fetch;
	log.length = 0;
	Object.assign(net, { falEmpty: false, falRefuse: false, badAudio: 0 });
});
afterEach(() => {
	globalThis.fetch = realFetch;
});
afterAll(() => {
	fs.rmSync(dir, { recursive: true, force: true });
	delete slots.__gaziyavFalKey;
	delete slots.__gaziyavKieKey;
	for (const [k, v] of Object.entries(ENV_BEFORE)) v === undefined ? delete process.env[k] : (process.env[k] = v);
});

const KIE_I2V = "bytedance/v1-pro-image-to-video#image";
const picture = async (bytes = fs.readFileSync(PNG)) => (await S.uploadReference("image", "image/png", bytes)).assetId;

describe("K4/B5: a model's inputs go to its own API", () => {
	test("kie.ai image → video with fal empty: the picture goes to kie.ai, fal's storage is never asked", async () => {
		net.falEmpty = true;
		const id = await picture();
		const { jobId } = await S.generate({ kind: "video", mode: "image", model: KIE_I2V, prompt: "she turns to the camera", image_asset_ids: [id], duration_seconds: 5 });
		const v = await settled(jobId);
		expect(v.error).toBeNull();
		expect(v.state).toBe("succeeded");
		expect(calls("rest.fal.ai").length).toBe(0);
		expect(calls("kieai.redpandaai.co").length).toBe(1);
		const task = calls("api.kie.ai", /createTask$/)[0]?.json as { input?: { image_url?: string } };
		expect(task?.input?.image_url).toMatch(/^https:\/\/files\.kie\.test\/up\//);
		// A11: named from the prompt and the model (it was «AI Seedance 1.0 Pro 8ea949.mp4»)
		expect(v.files[0]?.name).toBe("AI she turns to the camera · Seedance 1.0 Pro.mp4");
		expect(S.resultName("", "Kling AI Avatar 2", "gen-x-abc123", 0, "mp4")).toBe("AI Kling AI Avatar 2 abc123.mp4");
	});

	test("fal's empty balance is remembered for 15 min, and forgotten when fal takes a job again", async () => {
		empty.clearEmpty("fal");
		net.falEmpty = true;
		const id = await picture();
		const { jobId } = await S.generate({ kind: "video", mode: "image", model: "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video", prompt: "waves", image_asset_ids: [id], duration_seconds: 5 }).catch((e) => ({ jobId: "", error: e as Error }));
		if (jobId) expect((await settled(jobId)).error).toMatch(/balance is empty/);
		const at = empty.emptySince("fal");
		expect(at).not.toBeNull();
		expect(empty.emptySince("fal", (at as number) + 14 * 60_000)).toBe(at);
		expect(empty.emptySince("fal", (at as number) + 16 * 60_000)).toBeNull();
		net.falEmpty = false;
		const again = await S.generate({ kind: "video", mode: "image", model: "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video", prompt: "waves", image_asset_ids: [id], duration_seconds: 5 });
		expect((await settled(again.jobId)).state).toBe("succeeded");
		expect(empty.emptySince("fal")).toBeNull();
	});
});

describe("C2: Claude's same paid call again is the same job", () => {
	test("joined while it runs, returned when done (nothing new started), again:true is a new take; the app's own button is not changed", async () => {
		const id = await picture();
		const g = { kind: "video" as const, mode: "image" as const, model: KIE_I2V, prompt: `the same shot ${Date.now()}`, image_asset_ids: [id], duration_seconds: 5 };
		const [a, b] = await Promise.all([S.generate(g, 1, { once: true }), S.generate(g, 1, { once: true })]);
		expect(b.jobId).toBe(a.jobId);
		expect(b.same?.state ?? a.same?.state).toBe("running");
		await settled(a.jobId);
		expect(calls("api.kie.ai", /createTask$/).length).toBe(1);
		const c = await S.generate(g, 1, { once: true });
		expect(c.jobId).toBe(a.jobId);
		expect(c.same?.state).toBe("succeeded");
		expect(calls("api.kie.ai", /createTask$/).length).toBe(1);
		const d = await S.generate(g, 1, { once: true, again: true });
		expect(d.jobId).not.toBe(a.jobId);
		await settled(d.jobId);
		expect(calls("api.kie.ai", /createTask$/).length).toBe(2);
		const e = await S.generate(g);
		expect(e.same).toBeUndefined();
		await settled(e.jobId);
		expect(calls("api.kie.ai", /createTask$/).length).toBe(3);
	});
});

describe("K9: a sound is sent as what its bytes are", () => {
	test("a typeless MP4 (an export of a song piece) becomes a real MP3; the format is part of the reference's name", async () => {
		const bytes = fs.readFileSync(MP4);
		// what the page sends for a file with no type (cloud/client.ts pointUpload): «audio/mpeg»
		const { assetId, seconds } = await S.uploadReference("audio", "audio/mpeg", bytes);
		expect(seconds).toBeGreaterThan(1.5);
		const mp3 = path.join(dir, "ai-results", "refs", `${assetId}.mp3`);
		expect(fs.existsSync(mp3)).toBe(true);
		expect(S.sniff(fs.readFileSync(mp3).subarray(0, 16))).toBe("mp3");
		const photo = await picture();
		const { jobId } = await S.generate({ kind: "video", mode: "avatar", model: "fal-ai/kling-video/ai-avatar/v2/standard", prompt: "", image_asset_ids: [photo], audio_asset_ids: [assetId] });
		expect((await settled(jobId)).state).toBe("succeeded");
		const sent = log.filter((l) => l.host === "upload.fal.test").map((l) => S.sniff((l.body ?? Buffer.alloc(0)).subarray(0, 16)));
		expect(sent).toContain("mp3");
		expect(sent).not.toContain("mp4");
	});

	test("magic bytes, not names", () => {
		const b = (...x: number[]) => new Uint8Array(x);
		expect(S.sniff(fs.readFileSync(MP4).subarray(0, 16))).toBe("mp4");
		expect(S.sniff(fs.readFileSync(MP3).subarray(0, 16))).toBe("mp3");
		expect(S.sniff(fs.readFileSync(PNG).subarray(0, 16))).toBe("png");
		expect(S.sniff(b(0xff, 0xf1, 0x50, 0x80))).toBe("aac");
		expect(S.sniff(b(0xff, 0xfb, 0x90, 0x64))).toBe("mp3");
		expect(S.sniff(b(0xff, 0xd8, 0xff, 0xe0))).toBe("jpg");
		expect(S.sniff(new TextEncoder().encode("OggS\0\x02"))).toBe("ogg");
		expect(S.sniff(new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt "))).toBe("wav");
	});

	test("«Audio format is invalid»: the sound is made an MP3 again and the job sent once more", async () => {
		const { assetId } = await S.uploadReference("audio", "audio/mpeg", fs.readFileSync(MP3));
		const photo = await picture();
		net.badAudio = 1;
		const { jobId } = await S.generate({ kind: "video", mode: "avatar", model: "fal-ai/kling-video/ai-avatar/v2/standard", prompt: `sing ${Date.now()}`, image_asset_ids: [photo], audio_asset_ids: [assetId] });
		const v = await settled(jobId);
		expect(v.error).toBeNull();
		expect(v.state).toBe("succeeded");
		expect(calls("queue.fal.run").filter((l) => l.method === "POST").length).toBe(2);
	});
});

describe("C13: a safety refusal says what was flagged, and the picture isn't sent to that model again", () => {
	test("fal's loc is in the error; Claude's same picture on the same model is refused before uploading", async () => {
		const id = await picture(Buffer.concat([fs.readFileSync(PNG), Buffer.from(`refused ${Date.now()}`)]));
		const g = { kind: "video" as const, mode: "image" as const, model: "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video", prompt: `a portrait ${Date.now()}`, image_asset_ids: [id], duration_seconds: 5 };
		net.falRefuse = true;
		const { jobId } = await S.generate(g, 1, { once: true });
		const v = await settled(jobId);
		expect(v.error).toMatch(/safety filter/);
		expect(v.error).toMatch(/flagged the picture \(image_url\)/);
		log.length = 0;
		await expect(S.generate({ ...g, prompt: "another try" }, 1, { once: true })).rejects.toThrow(/refused this picture/);
		expect(calls("rest.fal.ai").length + calls("queue.fal.run").length).toBe(0);
	});
});

describe("B1: time limits per kind", () => {
	test("a picture is followed 4 min, a video 15, an avatar 20 (it was 30 for all)", async () => {
		const kie = provider("kie");
		const run = kie.run;
		const seen: Record<string, number | undefined> = {};
		kie.run = async (endpoint, input, output, o) => {
			seen[output] = o?.timeoutSeconds;
			return run(endpoint, input, output, o);
		};
		try {
			const pic = await S.generate({ kind: "image", model: "google/nano-banana", prompt: `a cat ${Date.now()}`, aspect_ratio: "1:1" });
			await settled(pic.jobId);
			const id = await picture();
			const vid = await S.generate({ kind: "video", mode: "image", model: KIE_I2V, prompt: `limits ${Date.now()}`, image_asset_ids: [id], duration_seconds: 5 });
			await settled(vid.jobId);
		} finally {
			kie.run = run;
		}
		expect(seen).toEqual({ image: 240, video: 900 });
		expect(S.limitSeconds("video", "avatar")).toBe(1200);
	});
});

describe("B4: one resolver for a model id", () => {
	test("another mode's id maps to its family's model of this mode and says so; an unknown id is refused with the mode's ids", () => {
		const fal = S.resolveVideoModel("fal-ai/bytedance/seedance/v1/pro/fast/text-to-video", "image");
		expect(fal).toEqual({ id: "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video", note: expect.stringMatching(/used its image model/) });
		expect(S.resolveVideoModel("bytedance/v1-pro-text-to-video#text", "image")).toMatchObject({ id: KIE_I2V });
		expect(S.resolveVideoModel("bytedance/v1-pro-image-to-video", "image")).toEqual({ id: KIE_I2V });
		const nope = S.resolveVideoModel("nope/model", "image") as { error: string };
		expect(nope.error).toMatch(/no video model «nope\/model»/);
		expect(nope.error).toContain(KIE_I2V);
	});
});
