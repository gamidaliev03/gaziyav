import { beforeEach, describe, expect, test } from "bun:test";
import { falModel, price } from "@/fal/models";
import type { JobState } from "@/studio/server/jobs";
import { createWebLipsync } from "../adapter";
import { CONNECT_HOSTS, mayCarryKey } from "../hosts";
import { forgetKey, KEY_SLOT, readKey, saveKey } from "../key";
import { memoryPark, type Park } from "../park";
import { lipUsd, needsConfirm, runPrice, voiceUsd } from "../price";
import { queued, readStatus, uploadTicket } from "../provider";
import { keyForHttp, SENTENCES } from "../sentences";
import { clip, fakeMedia, fakeProvider, KEY, sound } from "./fake";

// a browser's localStorage, for the key
const kv = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v), removeItem: (k: string) => void kv.delete(k) };

const latent = falModel("fal-ai/latentsync")!;

function rig(park: Park = memoryPark(), fake = fakeProvider()) {
	const made = createWebLipsync({ fetch: fake.fetch, park, media: fakeMedia, pollMs: 2, lang: () => "ru" });
	const call = async (method: string, path: string, body?: unknown) => {
		const init: RequestInit = { method, ...(body instanceof Blob ? { body } : body ? { body: JSON.stringify(body) } : {}) };
		const r = await made.adapter.answer(path, init, new URL(`http://page.test${path}`));
		return { status: r.status, data: r.headers.get("Content-Type")?.includes("json") ? await r.json() : await r.blob() };
	};
	const upload = async (f: File) => (await call("POST", `/api/studio/upload?name=${f.name}`, f)).data as { fileId: string; duration: number };
	const until = async (id: string) => {
		for (let i = 0; i < 2000; i++) {
			const s = (await call("GET", `/api/studio/jobs/${id}`)).data as JobState;
			if (s.status !== "running") return s;
			await new Promise((r) => setTimeout(r, 2));
		}
		throw new Error("never ended");
	};
	return { ...made, fake, park, call, upload, until };
}

beforeEach(() => {
	kv.clear();
	saveKey(KEY);
});

describe("request shapes", () => {
	test("the ticket, the queue's request and its states are the desktop's", () => {
		expect(uploadTicket("video/mp4", "a.mp4")).toEqual({ url: "https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3", body: { content_type: "video/mp4", file_name: "a.mp4" } });
		expect(queued("fal-ai/qwen-3-tts/clone-voice/1.7b", { request_id: "r1" })).toEqual({ endpoint: "fal-ai/qwen-3-tts/clone-voice/1.7b", requestId: "r1", statusUrl: "https://queue.fal.run/fal-ai/qwen-3-tts/requests/r1/status", responseUrl: "https://queue.fal.run/fal-ai/qwen-3-tts/requests/r1", cancelUrl: "https://queue.fal.run/fal-ai/qwen-3-tts/requests/r1/cancel" });
		expect(readStatus({ status: "IN_QUEUE", queue_position: 3 })).toEqual({ state: "queued", position: 3 });
		expect(readStatus({ status: "COMPLETED", error: "flagged by a content checker" })).toEqual({ state: "failed", error: "flagged by a content checker", refused: true });
		expect(readStatus({ status: "COMPLETED" })).toEqual({ state: "done" });
	});
	test("the key goes only to the queue and the ticket desk, https", () => {
		expect(mayCarryKey("https://queue.fal.run/x")).toBe(true);
		expect(mayCarryKey("https://rest.fal.ai/storage")).toBe(true);
		expect(mayCarryKey("https://v3.fal.media/files/x")).toBe(false);
		expect(mayCarryKey("http://queue.fal.run/x")).toBe(false);
		expect(mayCarryKey("https://queue.fal.run.evil.example/x")).toBe(false);
		expect(CONNECT_HOSTS).toEqual(["queue.fal.run", "rest.fal.ai", "fal.run", "api.fal.ai", "v3.fal.media", "v3b.fal.media", "fal.media"]);
	});
	test("the key: one slot, forget removes it", () => {
		expect(readKey()).toBe(KEY);
		expect(kv.get(KEY_SLOT)).toBe(KEY);
		forgetKey();
		expect(readKey()).toBeNull();
		expect(kv.size).toBe(0);
	});
});

describe("price", () => {
	test("from fal/models.ts: voice + clone + one request on the whole span", () => {
		expect(voiceUsd(100, true)).toBeCloseTo(price(falModel("fal-ai/qwen-3-tts/text-to-speech/1.7b")!, 100) + 0.0008, 10);
		expect(lipUsd(latent, 6, 12)).toBe(0.2);
		expect(lipUsd(latent, 6, 50)).toBeCloseTo(0.2 + 10 * 0.005, 10);
		const sync = falModel("fal-ai/sync-lipsync/v2")!;
		expect(lipUsd(sync, 4, 10)).toBeCloseTo(0.5, 10);
		const p = runPrice({ model: latent, span: 12, estimateSeconds: 5, voice: { chars: 100, clone: true } });
		expect(p.total).toBeCloseTo(0.2 + 0.009 + 0.0008, 10);
		expect(p.label).toBe("21 ¢");
		expect(p.estimated).toBe(true);
		expect(needsConfirm(0.21)).toBe(false);
		expect(needsConfirm(1.01)).toBe(true);
		expect(needsConfirm(0.21, 0.1)).toBe(true);
	});
	test("the pre-flight states THE price and the quiet line", async () => {
		const r = rig();
		const v = await r.upload(clip(20));
		const a = await r.upload(sound(6));
		const pf = (await r.call("POST", "/api/studio/preflight", { video: { fileId: v.fileId, start: 2, length: 12 }, audioFileId: a.fileId, model: "fal-ai/latentsync", voice: { chars: 100, clone: true } })).data;
		expect(pf.usd).toBe(0.2);
		expect(pf.total).toBeCloseTo(0.2098, 10);
		expect(pf.estimated).toBe(false);
		expect(pf.checks.map((c: { text: string }) => c.text)).toContain("в приложении дешевле: платите только за речь");
		const est = (await r.call("POST", "/api/studio/preflight", { estimate: { seconds: 4, length: 50 }, voice: { chars: 60, clone: false }, model: "fal-ai/sync-lipsync/v2" })).data;
		expect(est.usd).toBeCloseTo(2.5, 10);
		expect(est.estimated).toBe(true);
		forgetKey();
		const none = (await r.call("POST", "/api/studio/preflight", { estimate: { seconds: 4, length: 8 }, model: "fal-ai/latentsync" })).data;
		expect(none.blocking).toBe(SENTENCES["web.no_key"].ru);
		expect((await r.call("POST", "/api/studio/preflight", { estimate: { seconds: 4, length: 8 }, model: "volcengine/video-to-video-lip-sync" })).data.blocking).toBe(SENTENCES["web.model_app_only"].ru);
	});
});

describe("the flow", () => {
	test("voice (clone from the clip + speech) → lipsync on the used span → the result file", async () => {
		const r = rig();
		const v = await r.upload(clip(20));
		const voice = (await r.call("POST", "/api/studio/jobs/voiceover", { source: { fileId: v.fileId, start: 2, length: 12 }, text: "Привет, это новые слова.", voiceName: "talk" })).data as JobState;
		const vs = await r.until(voice.id);
		expect(vs.status).toBe("done");
		expect(vs.stages.map((s) => `${s.id}:${s.status}`)).toEqual(["sample:done", "speech:done", "words:skipped"]);
		const vr = vs.result as { voiceId: string; fileId: string; name: string; duration: number };
		expect(vr.voiceId).toBe("webclone:https://v3.fal.media/files/embedding.safetensors");
		expect(vr.name).toBe("Voice.mp3");
		expect(vr.duration).toBe(3.2);
		// clone: the sample is the clip's own sound [2, 14); speech: the clone's embedding, Russian
		const clone = r.fake.calls.find((c) => /clone-voice/.test(c.url) && c.method === "POST")!;
		expect(clone.body).toEqual({ audio_url: expect.stringMatching(/^https:\/\/v3\.fal\.media\/files\/\d+-gz_sample_\w+\.wav$/) });
		const speech = r.fake.calls.find((c) => /text-to-speech/.test(c.url) && c.method === "POST")!.body as Record<string, unknown>;
		expect(speech).toMatchObject({ text: "Привет, это новые слова.", language: "Russian", speaker_voice_embedding_file_url: "https://v3.fal.media/files/embedding.safetensors" });
		// the voice comes back as a file, the client imports it
		const voiceFile = (await r.call("GET", `/api/studio/file/${vr.fileId}`)).data as Blob;
		expect(voiceFile.type).toBe("audio/mpeg");
		const a = await r.upload(new File([voiceFile], "Voice.mp3", { type: "audio/mpeg" }));
		const lip = (await r.call("POST", "/api/studio/jobs/lipsync", { video: { fileId: v.fileId, start: 2, length: 3.2 }, audioFileId: a.fileId, model: "fal-ai/latentsync", fit: "cut" })).data as JobState;
		const ls = await r.until(lip.id);
		expect(ls.status).toBe("done");
		expect(ls.stages.map((s) => `${s.id}:${s.status}`)).toEqual(["prepare:done", "lipsync:done"]);
		expect(ls.cost).toBe(0.2);
		const sub = r.fake.calls.find((c) => /latentsync/.test(c.url) && c.method === "POST")!.body as Record<string, unknown>;
		expect(sub).toEqual({ video_url: expect.stringMatching(/\.mp4$/), audio_url: expect.stringMatching(/\.mp3$/), loop_mode: "loop" });
		// the prepared span: [2, 5.2)
		const sentVideo = r.fake.files.get(String(sub.video_url).split("/").pop()!)!;
		expect(JSON.parse(await sentVideo.text())).toMatchObject({ d: 3.2, from: 2 });
		const res = (ls.result as { fileId: string; duration: number; name: string });
		expect(res.name).toBe("Lipsync LatentSync.mp4");
		expect(((await r.call("GET", `/api/studio/file/${res.fileId}`)).data as Blob).type).toBe("video/mp4");
		// requests per run: voice = 2 tickets + 2 PUTs… counted exactly
		const count = (re: RegExp, m: string) => r.fake.calls.filter((c) => c.method === m && re.test(c.url)).length;
		expect(r.fake.submits(/./)).toBe(3);
		expect(count(/rest\.fal\.ai/, "POST")).toBe(3);
		expect(count(/v3\.fal\.media\/upload/, "PUT")).toBe(3);
		// the key: in the Authorization header to queue / rest only, never in a URL, never to storage
		for (const c of r.fake.calls) {
			expect(c.url.includes(KEY)).toBe(false);
			expect(c.auth === `Key ${KEY}`).toBe(/^https:\/\/(queue\.fal\.run|rest\.fal\.ai)\//.test(c.url));
		}
		// a second voice of the same clip: no clone fee, no clone request
		const again = await r.until(((await r.call("POST", "/api/studio/jobs/voiceover", { source: { fileId: v.fileId, start: 2, length: 12 }, text: "Ещё раз." })).data as JobState).id);
		expect(again.stages[0].detail).toBe("the voice was cloned before — no clone fee");
		expect(r.fake.submits(/clone-voice/)).toBe(1);
	});

	test("a reload in the middle COLLECTS the parked request: one submission", async () => {
		const park = memoryPark();
		const fake = fakeProvider();
		fake.mode.polls = 6;
		const r1 = rig(park, fake);
		const v = await r1.upload(clip(10));
		const a = await r1.upload(sound(4));
		const lip = (await r1.call("POST", "/api/studio/jobs/lipsync", { video: { fileId: v.fileId, start: 0, length: 4 }, audioFileId: a.fileId, model: "fal-ai/latentsync" })).data as JobState;
		while (!(await park.getJob(lip.id))?.reqs.lipsync) await new Promise((x) => setTimeout(x, 1));
		// the tab dies: its page never answers again
		fake.mode.hang = true;
		const parked = await park.getJob(lip.id);
		expect(parked?.reqs.lipsync?.requestId).toMatch(/^req-/);
		fake.mode.hang = false;
		const r2 = rig(park, fake);
		const s = await r2.until(lip.id);
		expect(s.status).toBe("done");
		expect(fake.submits(/latentsync/)).toBe(1);
		expect(r2.engine.counts.collected).toBe(1);
		expect(r2.engine.counts.submits.lipsync ?? 0).toBe(0);
		// asked again: the finished state, nothing new
		expect(((await r2.call("GET", `/api/studio/jobs/${lip.id}`)).data as JobState).status).toBe("done");
		expect(r2.engine.counts.collected).toBe(1);
	});

	test("closed before anything was sent: failed, nothing paid", async () => {
		const park = memoryPark();
		const r1 = rig(park);
		const v = await r1.upload(clip(10));
		const a = await r1.upload(sound(4));
		r1.fake.mode.hang = true;
		const lip = (await r1.call("POST", "/api/studio/jobs/lipsync", { video: { fileId: v.fileId, start: 0, length: 4 }, audioFileId: a.fileId })).data as JobState;
		await new Promise((x) => setTimeout(x, 20));
		const r2 = rig(park);
		const s = await r2.until(lip.id);
		expect(s.status).toBe("failed");
		expect(s.error).toBe(SENTENCES["web.closed_before_send"].ru);
		expect(r2.fake.submits(/./)).toBe(0);
	});

	test("a failed download: Retry follows the paid request, never pays twice", async () => {
		const r = rig();
		const v = await r.upload(clip(10));
		const a = await r.upload(sound(4));
		r.fake.mode.failDownload = 1;
		const body = { video: { fileId: v.fileId, start: 1, length: 4 }, audioFileId: a.fileId, model: "fal-ai/latentsync" };
		const first = await r.until(((await r.call("POST", "/api/studio/jobs/lipsync", body)).data as JobState).id);
		expect(first.status).toBe("failed");
		expect(first.error).toBe(SENTENCES["web.no_file"].ru);
		const second = await r.until(((await r.call("POST", "/api/studio/jobs/lipsync", body)).data as JobState).id);
		expect(second.status).toBe("done");
		expect(r.fake.submits(/latentsync/)).toBe(1);
		expect(r.engine.counts.reusedPaid).toBe(1);
		// delivered: a third press is a new take (the desktop's rule)
		await r.until(((await r.call("POST", "/api/studio/jobs/lipsync", body)).data as JobState).id);
		expect(r.fake.submits(/latentsync/)).toBe(2);
	});

	test("the provider fails: one sentence, Retry submits again; cancel stops and says so", async () => {
		const r = rig();
		const v = await r.upload(clip(10));
		const a = await r.upload(sound(4));
		const body = { video: { fileId: v.fileId, start: 0, length: 4 }, audioFileId: a.fileId };
		r.fake.mode.failNext = 1;
		const failed = await r.until(((await r.call("POST", "/api/studio/jobs/lipsync", body)).data as JobState).id);
		expect(failed).toMatchObject({ status: "failed", error: SENTENCES["web.failed"].ru, errorKey: "web.failed" });
		expect((await r.until(((await r.call("POST", "/api/studio/jobs/lipsync", body)).data as JobState).id)).status).toBe("done");
		expect(r.fake.submits(/latentsync/)).toBe(2);
		r.fake.mode.polls = 10_000;
		const run = (await r.call("POST", "/api/studio/jobs/lipsync", body)).data as JobState;
		while (r.fake.submits(/latentsync/) < 3) await new Promise((x) => setTimeout(x, 1));
		await new Promise((x) => setTimeout(x, 10));
		expect((await r.call("DELETE", `/api/studio/jobs/${run.id}`)).data).toEqual({ cancelled: true });
		const s = (await r.call("GET", `/api/studio/jobs/${run.id}`)).data as JobState;
		expect(s).toMatchObject({ status: "cancelled", error: SENTENCES["web.cancelled"].ru });
		expect(r.fake.calls.filter((c) => c.method === "PUT" && /\/cancel$/.test(c.url))).toHaveLength(1);
		const polls = r.fake.calls.length;
		await new Promise((x) => setTimeout(x, 30));
		expect(r.fake.calls.length).toBe(polls);
	});

	test("above the agreed sum: nothing leaves the page", async () => {
		const r = rig();
		const v = await r.upload(clip(60));
		const a = await r.upload(sound(50));
		const s = await r.until(((await r.call("POST", "/api/studio/jobs/lipsync", { video: { fileId: v.fileId, start: 0, length: 50 }, audioFileId: a.fileId, maxUsd: 0.2 })).data as JobState).id);
		expect(s).toMatchObject({ status: "failed", errorKey: "web.over_limit" });
		expect(r.fake.calls).toHaveLength(0);
	});

	test("no key / an app-only model: refused before any request, in one sentence", async () => {
		const r = rig();
		const v = await r.upload(clip(10));
		forgetKey();
		const res = await r.call("POST", "/api/studio/jobs/voiceover", { source: { fileId: v.fileId, start: 0, length: 5 }, text: "x" });
		expect(res).toEqual({ status: 400, data: { error: SENTENCES["web.no_key"].ru, errorKey: "web.no_key" } });
		expect(r.fake.calls).toHaveLength(0);
		expect(r.adapter.handles("/api/studio/jobs/fragment", "POST")).toBe(false);
		expect(r.adapter.handles("/api/studio/jobs/lipsync", "POST")).toBe(true);
		expect(r.adapter.handles("/api/studio/settings", "GET")).toBe(false);
	});
});

describe("sentences", () => {
	test("every failure: Russian and English, one sentence each", () => {
		for (const [k, s] of Object.entries(SENTENCES)) {
			expect(s.ru.length).toBeGreaterThan(10);
			expect(s.en.length).toBeGreaterThan(10);
			expect(/\n/.test(s.ru + s.en)).toBe(false);
			expect(/[а-яё]/i.test(s.ru)).toBe(true);
			expect(/[а-яё]/i.test(s.en)).toBe(false);
			expect(k.startsWith("web.")).toBe(true);
		}
		expect(keyForHttp(403, "User is locked. Reason: Exhausted balance")).toBe("web.balance");
		expect(keyForHttp(401, "")).toBe("web.key_refused");
		expect(keyForHttp(422, "content_policy_violation")).toBe("web.refused");
		expect(keyForHttp(422, "credit card field")).toBe("web.invalid");
	});
});
