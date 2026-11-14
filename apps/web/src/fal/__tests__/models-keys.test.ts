import { describe, expect, test } from "bun:test";
import { apiOf, chosenModel, KIE_MODELS, modelsFor } from "@/fal/models";
import { videoDefaultsOf, videoModel, videoModelsFor, videoModes, videoPrice } from "@/fal/video";
import { explain, StudioError } from "@/studio/server/errors";

const both = { fal: true, kie: true };
const falOnly = { fal: true, kie: false };
const kieOnly = { fal: false, kie: true };
const apis = (list: { api?: string }[]) => new Set(list.map((m) => apiOf(m as never)));

describe("one list from every API that has a key", () => {
	test("both keys: fal's and kie's models together; one key: that key's only; none: all", () => {
		for (const task of ["lipsync", "tts", "image", "video"] as const) {
			expect([...apis(modelsFor(task, both))].sort()).toEqual(["fal", "kie"]);
			expect([...apis(modelsFor(task, falOnly))]).toEqual(["fal"]);
			expect([...apis(modelsFor(task, kieOnly))]).toEqual(["kie"]);
			expect(modelsFor(task).length).toBe(modelsFor(task, { fal: true, kie: true, argo: true }).length);
		}
		// What kie.ai lacks stays on fal's list whichever key there is.
		expect(modelsFor("faceswap", kieOnly).length).toBeGreaterThan(0);
	});
	test("the pick alone decides the API; a pick whose API has no key gives the default of one that has", () => {
		const kie = KIE_MODELS.find((m) => m.task === "tts" && m.id.endsWith("multilingual-v2"));
		if (!kie) throw new Error("no kie voice model");
		const picks = { tts: kie.id };
		expect(chosenModel("tts", picks, both).id).toBe(kie.id);
		expect(chosenModel("tts", picks, kieOnly).id).toBe(kie.id);
		expect(apiOf(chosenModel("tts", picks, falOnly))).toBe("fal");
		expect(chosenModel("tts", picks, falOnly).id).toBe("fal-ai/qwen-3-tts/text-to-speech/1.7b");
		expect(apiOf(chosenModel("tts", {}, kieOnly))).toBe("kie");
		expect(apiOf(chosenModel("tts", {}, both))).toBe("fal");
	});
	test("clones and face swap stay on fal; the clone follows a fal voice", () => {
		expect(apiOf(chosenModel("faceswap", {}, kieOnly))).toBe("fal");
		expect(apiOf(chosenModel("clone", { tts: "elevenlabs/text-to-speech-turbo-2-5" }, both))).toBe("fal");
	});
	test("video tabs are the union; Extend only with a kie key", () => {
		expect(videoModes(both).some((m) => m.id === "extend")).toBe(true);
		expect(videoModes(falOnly).some((m) => m.id === "extend")).toBe(false);
		expect(videoModelsFor("text", both).length).toBe(videoModelsFor("text", falOnly).length + videoModelsFor("text", kieOnly).length);
		expect(videoDefaultsOf(falOnly).text).not.toBe(videoDefaultsOf(kieOnly).text);
		expect(videoDefaultsOf(kieOnly).extend).toBeDefined();
	});
});

describe("a kie.ai failure is kie's own sentence", () => {
	test("«timed out» in kie's text does not become a network problem", () => {
		const text = "kie.ai couldn't make this: The upstream API service timed out and no results were returned, please try again. Nothing was charged. Press Retry.";
		expect(explain(new StudioError(text, { plain: true }), "Voicing the text on kie.ai")).not.toMatch(/Can't reach the site|Details:/);
		expect(explain(new StudioError(text), "x")).toMatch(/Can't reach the site/);
	});
});

describe("settings from the time of the fal/kie switch", () => {
	const fs = require("node:fs") as typeof import("node:fs");
	const os = require("node:os") as typeof import("node:os");
	const path = require("node:path") as typeof import("node:path");
	const run = async (file: Record<string, unknown>) => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gz-picks-"));
		process.env.LIPSYNC_HOME = dir;
		fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify(file));
		const { modelChoices } = await import("@/fal/server");
		const picks = modelChoices();
		const saved = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"));
		fs.rmSync(dir, { recursive: true, force: true });
		return { picks, saved };
	};
	test("kie was on: kie's pick wins, a task without one goes back to the default; fal-only picks stay", async () => {
		const { picks, saved } = await run({ aiApi: "kie", falModels: { lipsync: "veed/lipsync", tts: "fal-ai/minimax/speech-2.8-hd", llm: "openai/gpt-5-mini" }, kieModels: { tts: "elevenlabs/text-to-speech-multilingual-v2" } });
		expect(picks).toEqual({ tts: "elevenlabs/text-to-speech-multilingual-v2", llm: "openai/gpt-5-mini" });
		expect(saved).toMatchObject({ aiApi: "fal", kieModels: {}, falModels: picks });
	});
	test("fal was on: fal's pick stays, kie's are dropped", async () => {
		const { picks } = await run({ aiApi: "fal", falModels: { tts: "fal-ai/minimax/speech-2.8-hd" }, kieModels: { tts: "elevenlabs/text-to-speech-turbo-2-5" } });
		expect(picks).toEqual({ tts: "fal-ai/minimax/speech-2.8-hd" });
	});
});

describe("lists are cheapest first", () => {
	test("by the price of one comparable unit, across APIs; the saved pick does not move; an unknown price is last", async () => {
		const { comparable, byPrice } = await import("@/fal/models");
		for (const task of ["tts", "image", "video", "lipsync"] as const) {
			const list = modelsFor(task, both);
			expect(list.map((m) => comparable(m))).toEqual([...list.map((m) => comparable(m))].sort((a, b) => a - b));
			expect(apis(list).size).toBe(2);
		}
		// the pick is the user's: the cheapest row is not forced on a task that has a pick
		expect(chosenModel("tts", { tts: "fal-ai/minimax/speech-2.8-hd" }, both).id).toBe("fal-ai/minimax/speech-2.8-hd");
		expect(byPrice([{ p: 0 }, { p: 3 }, { p: 1 }], (x) => (x.p > 0 ? x.p : Number.POSITIVE_INFINITY)).map((x) => x.p)).toEqual([1, 3, 0]);
	});
});

describe("ArgoLink joins the list and never hides another API's models", () => {
	const all = { fal: true, kie: true, argo: true };
	test("its Seedance 2.0 family is in the video list next to the others; with only its key, only its models", () => {
		expect([...apis(modelsFor("video", all))].sort()).toEqual(["argo", "fal", "kie"]);
		expect(modelsFor("video", { fal: false, kie: false, argo: true }).map((m) => m.title)).toEqual(["Seedance 2.0 Mini", "Seedance 2.0 Fast", "Seedance 2.0"]);
		expect(modelsFor("image", { fal: false, kie: false, argo: true }).length).toBeGreaterThan(0); // no ArgoLink pictures: the full list is shown, as with no key
		expect(videoModes({ fal: false, kie: false, argo: true }).map((m) => m.id)).toEqual(["text", "image", "frames", "reference"]);
		expect(videoModelsFor("text", all).length).toBe(videoModelsFor("text", both).length + 3);
		expect(apiOf(chosenModel("video", { video: "argolink/seedance-2.0-fast#text" }, all))).toBe("argo");
		expect(apiOf(chosenModel("video", { video: "argolink/seedance-2.0-fast#text" }, falOnly))).toBe("fal");
		expect(chosenModel("video", {}, { fal: false, kie: false, argo: true }).id).toBe("argolink/seedance-2.0-mini#text");
		expect(videoDefaultsOf({ fal: false, kie: false, argo: true }).image).toBe("argolink/seedance-2.0-mini#image");
	});
	test("the request is the documented form and the price is the page's rate × seconds", () => {
		const img = videoModel("argolink/seedance-2.0-mini#image");
		expect(img?.build({ prompt: " hi ", duration: 6, resolution: "480p", aspect: "adaptive", audio: false }, { image: "https://a/x.png" })).toEqual({ prompt: "hi", duration: 6, resolution: "480p", generate_audio: false, aspect_ratio: "adaptive", start_image: { url: "https://a/x.png" } });
		const ref = videoModel("argolink/seedance-2.0#reference");
		expect(ref?.build({ prompt: "p" }, { images: ["https://a/1.png", "https://a/2.png"] })).toEqual({ prompt: "p", duration: 5, resolution: "720p", generate_audio: true, reference_images: [{ url: "https://a/1.png" }, { url: "https://a/2.png" }] });
		const mini = videoModel("argolink/seedance-2.0-mini#text") as NonNullable<ReturnType<typeof videoModel>>;
		expect(videoPrice(mini, { duration: 5, resolution: "720p" })).toBeCloseTo(5 * 0.0643, 6);
		expect(videoPrice(videoModel("argolink/seedance-2.0#text") as typeof mini, { duration: 4, resolution: "4k" })).toBeCloseTo(4 * 0.661, 6);
	});
});
