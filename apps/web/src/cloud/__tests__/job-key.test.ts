// Review of stage 9, items 1 and 6: a generation with a picture or a clip is named by what it carries, not by the upload
// links (new on every upload, and every reference is uploaded again after a restart), so the same press after a relaunch
// comes back to the paid job; a result read from disk after a restart says its price and model, and the price is
// counted in «Spent» when the old process did not get to it.
process.env.STUDIO_TEST = "1";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-key-"));
process.env.LIPSYNC_HOME = dir;

let jobKey: typeof import("../server").jobKey;
let job: typeof import("../server").job;
let spent: typeof import("@/fal/server").spent;
beforeAll(async () => {
	({ jobKey, job } = await import("../server"));
	({ spent } = await import("@/fal/server"));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("the key of a paid job", () => {
	const ENDPOINT = "fal-ai/bytedance/seedream/v4/edit";
	test("the same picture under two upload links (before and after a relaunch) is one key", () => {
		const a = jobKey(ENDPOINT, { prompt: "a cat", image_urls: ["https://v3.fal.media/files/gz_aaa1.png"], num_images: 1 }, new Map([["https://v3.fal.media/files/gz_aaa1.png", "sha-of-the-cat"]]));
		const b = jobKey(ENDPOINT, { prompt: "a cat", image_urls: ["https://v3.fal.media/files/gz_zzz9.png"], num_images: 1 }, new Map([["https://v3.fal.media/files/gz_zzz9.png", "sha-of-the-cat"]]));
		expect(a).toBe(b);
		// a different picture, or different words, is another job
		const c = jobKey(ENDPOINT, { prompt: "a cat", image_urls: ["https://v3.fal.media/files/gz_zzz9.png"], num_images: 1 }, new Map([["https://v3.fal.media/files/gz_zzz9.png", "sha-of-a-dog"]]));
		const d = jobKey(ENDPOINT, { prompt: "a dog", image_urls: ["https://v3.fal.media/files/gz_aaa1.png"], num_images: 1 }, new Map([["https://v3.fal.media/files/gz_aaa1.png", "sha-of-the-cat"]]));
		expect(new Set([a, c, d]).size).toBe(3);
		// links in a nested place (a video request's {url}) count too
		const e = jobKey("argolink/seedance-2.0#image", { prompt: "x", start_image: { url: "https://files.argo.test/media/1" } }, new Map([["https://files.argo.test/media/1", "h1"]]));
		const f = jobKey("argolink/seedance-2.0#image", { prompt: "x", start_image: { url: "https://files.argo.test/media/2" } }, new Map([["https://files.argo.test/media/2", "h1"]]));
		expect(e).toBe(f);
	});
	test("without uploads it is the hash the APIs make themselves (nothing changes for a text job)", () => {
		const input = { prompt: "waves", image_size: "square" };
		expect(jobKey("fal-ai/flux/schnell", input, new Map())).toBe(crypto.createHash("sha1").update(`fal-ai/flux/schnell\n${JSON.stringify(input)}`).digest("hex"));
	});
});

describe("a result read from disk after a restart", () => {
	test("says its price and model, and counts the price once when the old process did not", () => {
		const results = path.join(dir, "ai-results");
		fs.mkdirSync(results, { recursive: true });
		fs.writeFileSync(path.join(results, "gen-tst-abc-0.png"), "png");
		fs.writeFileSync(path.join(results, "gen-tst-abc.json"), JSON.stringify({ kind: "image", model: "Test model", api: "fal", task: "image", cost: 0.12, spent: false }));
		const before = spent().total;
		const v = job("gen-tst-abc");
		expect(v.state).toBe("succeeded");
		expect(v.files.length).toBe(1);
		expect(v.cost).toBeCloseTo(0.12, 6);
		expect(v.model).toBe("Test model");
		expect(spent().total - before).toBeCloseTo(0.12, 6);
		expect(job("gen-tst-abc").cost).toBeCloseTo(0.12, 6);
		expect(spent().total - before).toBeCloseTo(0.12, 6);
		// a result whose price was counted by the process that made it: not counted again
		fs.writeFileSync(path.join(results, "gen-tst-def-0.png"), "png");
		fs.writeFileSync(path.join(results, "gen-tst-def.json"), JSON.stringify({ kind: "image", model: "Other", api: "fal", task: "image", cost: 0.5, spent: true }));
		expect(job("gen-tst-def").cost).toBeCloseTo(0.5, 6);
		expect(spent().total - before).toBeCloseTo(0.12, 6);
		// an unknown id is still said plainly
		expect(job("gen-nope-000").state).toBe("failed");
	});
});
