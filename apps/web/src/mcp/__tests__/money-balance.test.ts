// an empty balance is shown EMPTY in every price_plan and blocks its paid steps for 15 min (B5); price_plan {kind, mode}
// lists that mode's models and a named id is resolved for its mode the way generate does (B4/A20); a generation handed
// back twice is counted once (C2). The window's fetch and stores are stand-ins.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

const status = { key: true, hint: "…ab12", choices: {}, models: [], spent: { total: 0, byTask: {} }, kie: { key: true, hint: "…cd34", spent: { total: 0, byTask: {} } }, argo: { key: false, hint: null, spent: { total: 0, byTask: {} } }, empty: {} as Record<string, number> };

type Budget = { limit: number; budget: number; own: boolean; spent: number; left: number; byApi: Record<string, number>; steps: unknown[]; mode?: string; capped?: boolean };
let budget: Budget;
/** What fal says of its balance (null: the key can't read it, the owner's case). */
let falBalance: number | null = null;
const posted: Array<Record<string, unknown>> = [];
const fetched: string[] = [];
const T2V = "fal-ai/bytedance/seedance/v1/pro/fast/text-to-video";
const I2V = "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video";
const model = (id: string, api = "fal", usd = 0.0216, extra: Record<string, unknown> = {}) => ({ id, title: id.split("/").slice(-2).join(" "), api, usd, limits: { supported_durations_seconds: [5, 10], supported_qualities: ["720p"], supported_aspect_ratios: ["9:16"] }, ...extra });
const realFetch = globalThis.fetch;

function stand(input: string | URL | Request, init?: RequestInit): Promise<Response> {
	const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
	fetched.push(url);
	const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
	if (url.startsWith("/api/mcp/budget")) {
		if (init?.method === "POST") posted.push(JSON.parse(String(init.body)));
		return ok(budget);
	}
	if (url.startsWith("/api/cloud/models/video")) {
		const q = new URL(url, "http://x").searchParams;
		const mode = q.get("mode") ?? "text";
		const models = mode === "image" ? [model(I2V, "fal", 0.0216, { default: true }), model("bytedance/v1-pro-image-to-video#image", "kie", 0.03)] : [model(T2V, "fal", 0.0216, { default: true }), model("bytedance/v1-pro-text-to-video#text", "kie", 0.03)];
		const named = q.get("model");
		return ok({ models, ...(named ? { resolved: named === T2V && mode === "image" ? { id: I2V, note: `${T2V} is the text model of Seedance; this call gives a start frame: used its image model ${I2V}` } : { id: named } } : {}) });
	}
	if (url.startsWith("/api/fal/status")) return ok(status);
	if (url.startsWith("/api/fal/balance")) return ok({ balance: falBalance });
	if (url.startsWith("/api/fal/kie-check")) return ok({ ok: true, credits: 2000 });
	if (url.startsWith("/api/fal/argo-check")) return ok({ ok: false, error: "no key" });
	if (url.startsWith("/api/cloud/estimate")) {
		const g = JSON.parse(String(init?.body)) as { model: string; duration_seconds?: number };
		return ok({ cost: (g.model.includes("kie") || g.model.startsWith("bytedance/") ? 0.03 : 0.0216) * (g.duration_seconds ?? 5) });
	}
	return ok({});
}

let M: typeof import("../money");
let core: typeof import("@/core");
beforeAll(async () => {
	globalThis.fetch = stand as unknown as typeof fetch;
	await installOpenCutWasm();
	core = await import("@/core");
	const { buildDefaultScene } = await import("@/timeline/scenes");
	core.EditorCore.reset();
	const editor = core.EditorCore.getInstance();
	editor.save.stop();
	const scene = buildDefaultScene({ name: "Main", isMain: true });
	editor.project.setActiveProject({ project: { metadata: { id: "p1", name: "p1", createdAt: new Date(0), updatedAt: new Date(0) }, scenes: [scene], currentSceneId: scene.id, settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1080, height: 1920 } }, version: 31 } as never });
	M = await import("../money");
}, 60_000); // (the WASM and the editor core load slowly on a loaded Mac: the 5-s default timed out)
afterAll(() => {
	core?.EditorCore.reset();
	globalThis.fetch = realFetch;
});
afterEach(() => {
	status.empty = {};
	posted.length = 0;
	fetched.length = 0;
});

describe("A7: the balance mode", () => {
	test("no per-video cap: a step dearer than the default budget runs; this video's own budget still caps it", async () => {
		budget = { limit: 1, budget: 1, own: false, spent: 2.38, left: 0, byApi: { fal: 1.2, kie: 1.18 }, steps: [], mode: "balance", capped: false };
		await expect(M.gate("a 5 s video", 0.6, "kie")).resolves.toBeDefined();
		expect(M.budgetLine(budget as never)).toMatch(/\$2\.38 spent \(fal\.ai \$1\.20, kie\.ai \$1\.18\) · no per-video cap/);
		budget = { ...budget, own: true, budget: 3, left: 0.62, capped: true };
		await expect(M.gate("a 5 s video", 0.7, "kie")).rejects.toThrow(/more than this video's budget has left/);
	});

	test("price_plan {} says this video's spend and the balances", async () => {
		budget = { limit: 1, budget: 1, own: false, spent: 0.4, left: 0.6, byApi: { kie: 0.4 }, steps: [], mode: "balance", capped: false };
		const text = await M.pricePlan({});
		expect(text).toMatch(/^Spent: this video: \$0\.40 spent/);
		expect(text).toMatch(/Balances: fal\.ai balance not reported · kie\.ai \$/);
	});
});

describe("B5: a provider that refused for an empty balance", () => {
	test("is EMPTY in every price_plan and blocks its paid steps, naming the alternative; model:'cheapest' passes over it", async () => {
		budget = { limit: 1, budget: 1, own: false, spent: 0, left: 1, byApi: {}, steps: [], mode: "balance", capped: false };
		status.empty = { fal: new Date(2026, 10, 10, 2, 9).getTime() };
		expect(await M.pricePlan({})).toContain("fal.ai: EMPTY (refused 02:09) — fal.ai models blocked");
		await expect(M.gate("a 5 s video", 0.1, "fal", '"bytedance/v1-pro-image-to-video#image" (kie.ai)')).rejects.toThrow(/Not run: fal\.ai: EMPTY \(refused 02:09\) — fal\.ai models blocked.*Use "bytedance\/v1-pro-image-to-video#image" \(kie\.ai\) instead/);
		const plan = await M.pricePlan({ items: [{ kind: "video", mode: "image", model: "cheapest", duration: 5 }] });
		expect(plan).toMatch(/\(kie\.ai\)/);
		expect(plan).not.toMatch(/Can't pay/);
		const named = await M.pricePlan({ items: [{ kind: "video", mode: "image", model: I2V, duration: 5 }] });
		expect(named).toMatch(/Can't pay on fal\.ai: EMPTY/);
		expect(named).not.toMatch(/Go ahead/);
	});
});

describe("a balance read at $0 is EMPTY too", () => {
	test("price_plan says so and model:'cheapest' passes over it", async () => {
		budget = { limit: 1, budget: 1, own: false, spent: 0, left: 1, byApi: {}, steps: [], mode: "balance", capped: false };
		falBalance = 0;
		try {
			expect(await M.pricePlan({})).toContain("fal.ai: EMPTY ($0) — fal.ai models blocked");
			const plan = await M.pricePlan({ items: [{ kind: "video", mode: "image", model: "cheapest", duration: 5 }] });
			expect(plan).toMatch(/\(kie\.ai\)/);
			await expect(M.gate("a 5 s video", 0.1, "fal")).rejects.toThrow(/fal\.ai has \$0 left/);
		} finally {
			falBalance = null;
		}
	});
});

describe("B4/A20: price_plan resolves ids and lists modes like generate", () => {
	test("{kind:'video', mode:'image'} lists the image-mode ids", async () => {
		budget = { limit: 1, budget: 1, own: false, spent: 0, left: 1, byApi: {}, steps: [], mode: "balance", capped: false };
		const text = await M.pricePlan({ kind: "video", mode: "image" });
		expect(fetched.some((u) => u.startsWith("/api/cloud/models/video?mode=image"))).toBe(true);
		expect(text).toContain(I2V);
		expect(text).not.toContain(T2V);
	});
	test("a text-mode id with mode image is priced as its image sibling, and the line says so", async () => {
		const text = await M.pricePlan({ items: [{ kind: "video", mode: "image", model: T2V, duration: 5 }] });
		expect(text).toContain(`[${I2V}]`);
		expect(text).toMatch(/used its image model/);
	});
});

describe("C2: a generation is counted once", () => {
	test("charged() names the job, so the server counts a joined or returned result once", async () => {
		budget = { limit: 1, budget: 1, own: false, spent: 0, left: 1, byApi: {}, steps: [], mode: "balance", capped: false };
		await M.charged("a 5 s video", 0.108, "fal", "gen-abc-123");
		expect((posted[0]?.spend as { job?: string })?.job).toBe("gen-abc-123");
	});
});

