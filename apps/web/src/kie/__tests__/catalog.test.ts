import { describe, expect, test } from "bun:test";
import { isVideoMode, KIE_ONLY_MODES, VIDEO_MODES, videoDefaults, videoInput, videoModel, videoModelsFor, videoModes, videoPrice, videoProblem, type VideoModel, type VideoOptions } from "../../fal/video";
import { KIE_VIDEO_DEFAULTS, KIE_VIDEO_MODELS } from "../catalog";

const m = (id: string) => videoModel(id) as VideoModel;
const U = "https://files.kie.test/x";
const urls = { image: `${U}/a.png`, end: `${U}/b.png`, images: [`${U}/r1.png`, `${U}/r2.png`, `${U}/r3.png`], video: `${U}/c.mp4` };
const ask = (id: string, o: VideoOptions) => videoInput(m(id), o, urls) as Record<string, unknown>;

describe("kie.ai's catalog: Kling 3.0 Omni, the reference modes, Extend", () => {
	test("Kling 3.0 Omni has text, picture, first + last frame and reference forms, each on its own endpoint", () => {
		expect(["text", "image", "frames", "reference"].map((mode) => m(`kling-3.0-omni/${mode === "text" ? "text" : mode === "reference" ? "reference" : "image"}-to-video#${mode}`).mode)).toEqual(["text", "image", "frames", "reference"]);
		const text = ask("kling-3.0-omni/text-to-video#text", { prompt: " A fox ", duration: 7, aspect: "9:16", resolution: "1080p", audio: true });
		expect(text).toEqual({ prompt: "A fox", audio: true, resolution: "1080p", duration: 7, aspect_ratio: "9:16" });
		// One picture is the first frame, two are the first and the last; no shape goes with them (kie only takes «auto» there).
		expect(ask("kling-3.0-omni/image-to-video#image", { prompt: "go" })).toEqual({ prompt: "go", audio: false, resolution: "720p", duration: 5, image_urls: [urls.image] });
		expect(ask("kling-3.0-omni/image-to-video#frames", { prompt: "go" }).image_urls).toEqual([urls.image, urls.end]);
		expect(Object.keys(ask("kling-3.0-omni/image-to-video#frames", { prompt: "go" }))).not.toContain("aspect_ratio");
		expect(ask("kling-3.0-omni/reference-to-video#reference", { prompt: "go", aspect: "16:9" }).image_urls).toEqual(urls.images);
	});
	test("Omni: whole seconds as numbers, sound always sent, prices as on kie's page (sound dearer up to 1080p, none at 4K)", () => {
		const t = m("kling-3.0-omni/text-to-video#text");
		expect(typeof ask(t.id, { prompt: "x", duration: 3 }).duration).toBe("number");
		expect(t.durations).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
		expect(videoPrice(t, { duration: 10 })).toBeCloseTo(0.755, 4);
		expect(videoPrice(t, { duration: 10, audio: true })).toBeCloseTo(1.01, 4);
		expect(videoPrice(t, { duration: 10, resolution: "1080p" })).toBeCloseTo(1.01, 4);
		expect(videoPrice(t, { duration: 10, resolution: "1080p", audio: true })).toBeCloseTo(1.26, 4);
		expect(videoPrice(t, { duration: 2 + 3, resolution: "4k", audio: true })).toBe(videoPrice(t, { duration: 5, resolution: "4k" }));
	});
	test("HappyHorse and Wan 2.7 have a reference mode with their own field names", () => {
		const hh = ask("happyhorse-1-1/reference-to-video#reference", { prompt: "[Image 1] walks", duration: 6, aspect: "4:5", resolution: "1080p" });
		expect(hh).toEqual({ prompt: "[Image 1] walks", reference_image: urls.images, resolution: "1080p", duration: 6, aspect_ratio: "4:5" });
		expect(m("happyhorse-1-1/reference-to-video#reference").maxImages).toBe(9);
		const wan = ask("wan/2-7-r2v#reference", { prompt: "Image 1 dances", duration: 10, seed: 3, negative: " blur " });
		expect(wan).toEqual({ prompt: "Image 1 dances", reference_image: urls.images, resolution: "720p", duration: 10, aspect_ratio: "9:16", negative_prompt: "blur", seed: 3 });
		expect(m("wan/2-7-r2v#reference").maxImages).toBe(5);
		expect(m("wan/2-7-r2v#reference").durations).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(videoModelsFor("reference", { fal: false, kie: true }).map((x) => x.id)).toEqual(expect.arrayContaining(["kling-3.0-omni/reference-to-video#reference", "happyhorse-1-1/reference-to-video#reference", "wan/2-7-r2v#reference"]));
	});
	test("Extend exists on kie.ai only: PixVerse V6 takes the clip and goes on, priced for the new seconds", () => {
		expect(videoModes({ fal: false, kie: true }).map((x) => x.id)).toEqual([...VIDEO_MODES.map((x) => x.id), "extend"]);
		expect(videoModes({ fal: true, kie: false }).map((x) => x.id)).toEqual(VIDEO_MODES.map((x) => x.id));
		expect(KIE_ONLY_MODES.map((x) => x.id)).toEqual(["extend"]);
		expect(videoModelsFor("extend", { fal: true, kie: false })).toEqual([]);
		expect(isVideoMode("extend")).toBe(true);
		expect(KIE_VIDEO_DEFAULTS.extend).toBe("pixverse-v6/extend#extend");
		const x = m("pixverse-v6/extend#extend");
		const a = ask(x.id, { prompt: "The dog turns round", duration: 6, resolution: "720p" });
		expect(a).toMatchObject({ prompt: "The dog turns round", video_url: urls.video, duration: 6, quality: "720p", generate_audio_switch: false });
		expect(Number.isInteger(a.seed) && (a.seed as number) >= 0 && (a.seed as number) <= 2147483647).toBe(true);
		// The seed comes from the request itself: a Retry sends the same one (and comes back to the paid task), another text another seed.
		expect(ask(x.id, { prompt: "The dog turns round", duration: 6, resolution: "720p" }).seed).toBe(a.seed);
		expect(ask(x.id, { prompt: "The dog sits down", duration: 6, resolution: "720p" }).seed).not.toBe(a.seed);
		expect(ask(x.id, { prompt: "The dog turns round", duration: 6, resolution: "720p", seed: 42 }).seed).toBe(42);
		expect(videoPrice(x, { duration: 5 })).toBeCloseTo(0.18, 4);
		expect(videoPrice(x, { duration: 5, audio: true })).toBeCloseTo(0.24, 4);
	});
	test("Extend says what is missing in plain words", () => {
		const x = m("pixverse-v6/extend#extend");
		const o = { ...videoDefaults(x), prompt: "goes on" };
		expect(videoProblem(x, o, {})?.text).toBe("Pick the clip to continue.");
		expect(videoProblem(x, { ...o, prompt: "" }, { video: true })?.text).toBe("Describe what happens next.");
		expect(videoProblem(x, { ...o, prompt: "ab" }, { video: true })?.text).toBe("Describe what happens next.");
		expect(videoProblem(x, o, { video: true })).toBeNull();
	});
	test("every kie mode has a default that belongs to it, and ids stay unique", () => {
		for (const [mode, id] of Object.entries(KIE_VIDEO_DEFAULTS)) expect(videoModel(id)?.mode).toBe(mode as VideoModel["mode"]);
		expect(new Set(KIE_VIDEO_MODELS.map((x) => x.id)).size).toBe(KIE_VIDEO_MODELS.length);
	});
});
