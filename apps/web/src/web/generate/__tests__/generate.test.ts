import { describe, expect, test } from "bun:test";
import { memoryPark } from "../../lipsync/park";
import type { Provider, QueuedRequest, QueueState } from "../../lipsync/provider";
import { createGenerateAdapter } from "../adapter";
import { createGenerator, resultName } from "../engine";

/** A provider that answers like fal.ai's queue, in memory: what was asked is kept for the checks. */
function fakeProvider(o: { states?: QueueState[]; answer?: Record<string, unknown> } = {}) {
	const asked: Array<{ endpoint: string; input: Record<string, unknown> }> = [];
	const uploads: string[] = [];
	const states = [...(o.states ?? [{ state: "queued" } as QueueState, { state: "working" } as QueueState, { state: "done" } as QueueState])];
	let cancelled = 0;
	const provider = {
		upload: async (_blob: Blob, name: string) => {
			uploads.push(name);
			return `https://v3.fal.media/files/up-${uploads.length}-${name}`;
		},
		submit: async (endpoint: string, input: Record<string, unknown>): Promise<QueuedRequest> => {
			asked.push({ endpoint, input });
			return { endpoint, requestId: `r${asked.length}`, statusUrl: "https://queue.fal.run/s", responseUrl: "https://queue.fal.run/r", cancelUrl: "https://queue.fal.run/c" };
		},
		status: async (): Promise<QueueState> => (states.length > 1 ? (states.shift() as QueueState) : states[0]),
		answer: async () => o.answer ?? { images: [{ url: "https://v3.fal.media/files/picture.png" }] },
		cancel: async () => void cancelled++,
		download: async (url: unknown) => new Blob([`bytes of ${String(url)}`], { type: String(url).endsWith(".mp4") ? "video/mp4" : "image/png" }),
	} as unknown as Provider;
	return { provider, asked, uploads, cancelled: () => cancelled };
}

const until = async (check: () => Promise<boolean>) => {
	for (let i = 0; i < 200; i++) {
		if (await check()) return;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error("it never happened");
};

describe("AI image and AI video in the browser edition (the visitor's own fal.ai key)", () => {
	test("the catalog is fal.ai's alone, cheapest first, one model marked as the start", () => {
		const { provider } = fakeProvider();
		const g = createGenerator({ provider, park: memoryPark(), hasKey: () => true });
		const images = g.models("image").models;
		expect(images.length).toBeGreaterThan(1);
		expect(images.every((m) => m.api === "fal" && m.kind === "image")).toBe(true);
		expect(images.filter((m) => m.default).length).toBe(1);
		const videos = g.models("video", "text").models;
		expect(videos.length).toBeGreaterThan(1);
		expect(videos.every((m) => m.api === "fal" && m.mode === "text")).toBe(true);
		expect([...videos].sort((a, b) => a.usd - b.usd).map((m) => m.id)).toEqual(videos.map((m) => m.id));
		expect(g.models("audio").models).toEqual([]);
	});

	test("without a key nothing is sent; the status says where the key goes", async () => {
		const fake = fakeProvider();
		const g = createGenerator({ provider: fake.provider, park: memoryPark(), hasKey: () => false });
		expect(g.status().connected).toBe(false);
		const model = g.models("image").models[0].id;
		await expect(g.generate({ kind: "image", prompt: "a red kite", model })).rejects.toThrow(/key/i);
		expect(fake.asked.length).toBe(0);
	});

	test("a picture: priced before it runs, sent once, followed to its file, kept in this browser", async () => {
		const fake = fakeProvider();
		const park = memoryPark();
		const g = createGenerator({ provider: fake.provider, park, hasKey: () => true, pollMs: 1 });
		const model = g.models("image").models.find((m) => m.default)?.id as string;
		const { cost } = await g.estimate({ kind: "image", prompt: "a red kite over the sea", model, aspect_ratio: "9:16" });
		expect(cost).toBeGreaterThan(0);
		const started = await g.generate({ kind: "image", prompt: "a red kite over the sea", model, aspect_ratio: "9:16" });
		expect(started.cost).toBe(cost);
		expect(fake.asked.length).toBe(1);
		expect(JSON.stringify(fake.asked[0].input)).toContain("a red kite over the sea");
		await until(async () => (await g.job(started.jobId))?.state === "succeeded");
		const view = await g.job(started.jobId);
		expect(view?.files.length).toBe(1);
		expect(view?.files[0].name).toMatch(/^a red kite over the sea — .+\.png$/);
		const file = await g.file(started.jobId, 0);
		expect(await file?.blob.text()).toContain("picture.png");
		// a reload: another page object over the same store finds the finished job and its file, and asks nobody
		const again = createGenerator({ provider: fake.provider, park, hasKey: () => true, pollMs: 1 });
		expect((await again.job(started.jobId))?.state).toBe("succeeded");
		expect(fake.asked.length).toBe(1);
	});

	test("a reload while the provider still works: the same paid request is followed, never sent again", async () => {
		const park = memoryPark();
		const slow = fakeProvider({ states: [{ state: "working" }] });
		const first = createGenerator({ provider: slow.provider, park, hasKey: () => true, pollMs: 1 });
		const model = first.models("image").models[0].id;
		const { jobId } = await first.generate({ kind: "image", prompt: "a kite", model });
		await until(async () => (await first.job(jobId))?.state === "running");
		const done = fakeProvider();
		const second = createGenerator({ provider: done.provider, park, hasKey: () => true, pollMs: 1 });
		await until(async () => (await second.job(jobId))?.state === "succeeded");
		expect(slow.asked.length).toBe(1);
		expect(done.asked.length).toBe(0);
	});

	test("a clip from a start picture: the picture is uploaded when the job starts, and the request names its link", async () => {
		const fake = fakeProvider({ answer: { video: { url: "https://v3.fal.media/files/clip.mp4" } } });
		const g = createGenerator({ provider: fake.provider, park: memoryPark(), hasKey: () => true, pollMs: 1 });
		const model = g.models("video", "image").models[0];
		const ref = await g.reference(new Blob(["png"], { type: "image/png" }), "image", "start.png");
		expect(fake.uploads.length).toBe(0);
		const input = { kind: "video" as const, prompt: "the kite flies up", model: model.id, mode: "image" as const, image_asset_ids: [ref.assetId] };
		expect((await g.estimate(input)).cost).toBeGreaterThan(0);
		const { jobId } = await g.generate(input);
		expect(fake.uploads).toEqual(["start.png"]);
		expect(JSON.stringify(fake.asked[0].input)).toContain("up-1-start.png");
		await until(async () => (await g.job(jobId))?.state === "succeeded");
		expect((await g.file(jobId, 0))?.type).toBe("video/mp4");
	});

	test("the provider's refusal and Cancel end the job in words, with no file", async () => {
		const refused = fakeProvider({ states: [{ state: "failed", error: "content_policy_violation", refused: true }] });
		const g = createGenerator({ provider: refused.provider, park: memoryPark(), hasKey: () => true, pollMs: 1 });
		const model = g.models("image").models[0].id;
		const a = await g.generate({ kind: "image", prompt: "x", model });
		await until(async () => (await g.job(a.jobId))?.state === "failed");
		expect((await g.job(a.jobId))?.error).toMatch(/safety filter/);
		const slow = fakeProvider({ states: [{ state: "working" }] });
		const h = createGenerator({ provider: slow.provider, park: memoryPark(), hasKey: () => true, pollMs: 1 });
		const b = await h.generate({ kind: "image", prompt: "x", model });
		expect(await h.cancel(b.jobId)).toBe(true);
		await until(async () => (await h.job(b.jobId))?.state === "failed");
		expect((await h.job(b.jobId))?.error).toBe("Cancelled");
		expect(slow.cancelled()).toBe(1);
	});

	test("what a model cannot do is refused in words before anything is sent", async () => {
		const fake = fakeProvider();
		const g = createGenerator({ provider: fake.provider, park: memoryPark(), hasKey: () => true });
		const model = g.models("image").models[0].id;
		await expect(g.estimate({ kind: "image", prompt: "  ", model })).rejects.toThrow("Describe what to generate.");
		await expect(g.estimate({ kind: "image", prompt: "x", model: "no/such-model" })).rejects.toThrow(/no image model/);
		await expect(g.estimate({ kind: "audio", prompt: "x", model })).rejects.toThrow(/Music/);
		expect(fake.asked.length).toBe(0);
	});

	test("the adapter answers the app's client in the server's own shapes", async () => {
		const fake = fakeProvider();
		const g = createGenerator({ provider: fake.provider, park: memoryPark(), hasKey: () => true, pollMs: 1 });
		const adapter = createGenerateAdapter(g);
		const at = (path: string) => new URL(`https://page.test${path}`);
		const get = async (path: string) => (await adapter.answer(path, { method: "GET" }, at(path))).json();
		expect(adapter.handles("/api/cloud/status", "GET")).toBe(true);
		expect(adapter.handles("/api/studio/upload", "POST")).toBe(false);
		expect(await get("/api/cloud/status")).toEqual({ connected: true, name: "fal.ai" });
		const list = (await get("/api/cloud/models/image")) as { models: Array<{ id: string }> };
		const model = list.models[0].id;
		const post = async (path: string, body: unknown) => adapter.answer(path, { method: "POST", body: JSON.stringify(body) }, at(path));
		expect(((await (await post("/api/cloud/estimate", { kind: "image", prompt: "a kite", model })).json()) as { cost: number }).cost).toBeGreaterThan(0);
		const bad = await post("/api/cloud/estimate", { kind: "image", prompt: "", model });
		expect(bad.status).toBe(400);
		expect(((await bad.json()) as { error: string }).error).toBe("Describe what to generate.");
		const { jobId } = (await (await post("/api/cloud/generate", { kind: "image", prompt: "a kite", model })).json()) as { jobId: string };
		await until(async () => ((await get(`/api/cloud/job/${jobId}`)) as { state: string }).state === "succeeded");
		const file = await adapter.answer(`/api/cloud/file/${jobId}/0`, { method: "GET" }, at(`/api/cloud/file/${jobId}/0`));
		expect(file.headers.get("Content-Type")).toBe("image/png");
		const ref = await adapter.answer("/api/cloud/reference?kind=image&type=image/png", { method: "POST", body: new Blob(["png"]) }, at("/api/cloud/reference?kind=image&type=image/png"));
		expect(((await ref.json()) as { assetId: string }).assetId).toMatch(/^ref-/);
		expect((await adapter.answer("/api/cloud/job/nope", { method: "GET" }, at("/api/cloud/job/nope"))).status).toBe(404);
	});

	test("a result is named by its first words and its model", () => {
		expect(resultName("a red kite over the sea at dawn, wide", "Seedream", 0, "png")).toBe("a red kite over the sea — Seedream.png");
		expect(resultName("", "Flux", 1, "png")).toBe("AI — Flux 2.png");
	});
});
