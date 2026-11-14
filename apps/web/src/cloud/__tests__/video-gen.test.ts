import { describe, expect, test } from "bun:test";
import { VIDEO_DEFAULTS } from "@/fal/video";
import { estimate, type GenerateInput, models } from "../server";

const video = (g: Partial<GenerateInput>): GenerateInput => ({ kind: "video", prompt: "Waves at sunrise", model: VIDEO_DEFAULTS.text, ...g });
const cost = async (g: Partial<GenerateInput>) => (await estimate(video(g))).cost;

describe("AI video on the server: prices before anything runs", () => {
	test("text: Seedance 1.0 Pro Fast 5 s 720p ≈ $0.11 (the agent's old request still works)", async () => {
		expect(await cost({ duration_seconds: 5, quality: "720p", aspect_ratio: "9:16" })).toBeCloseTo(0.108, 3);
		expect(await cost({ duration_seconds: 5, quality: "1080p" })).toBeCloseTo(0.243, 3);
	});
	test("a text model with a start picture is priced as its picture endpoint (the agent's way)", async () => {
		expect(await cost({ model: "fal-ai/kling-video/v3/standard/text-to-video", image_asset_ids: ["x"], duration_seconds: 10 })).toBeCloseTo(0.84, 5);
		await expect(estimate(video({ model: "decart/lucy-restyle", mode: "image", image_asset_ids: ["x"] }))).rejects.toThrow();
	});
	test("each mode is checked for its inputs, with the sentence the page shows", async () => {
		await expect(estimate(video({ mode: "image", model: VIDEO_DEFAULTS.image }))).rejects.toThrow("Pick the start frame.");
		await expect(estimate(video({ mode: "frames", model: VIDEO_DEFAULTS.frames, reference_count: 1 }))).rejects.toThrow("Pick the first and the last frame.");
		await expect(estimate(video({ mode: "motion", model: VIDEO_DEFAULTS.motion, reference_count: 1 }))).rejects.toThrow("Pick the photo of the character.");
		await expect(estimate(video({ mode: "edit", model: VIDEO_DEFAULTS.edit, prompt: "" }))).rejects.toThrow("Pick the clip to change.");
		await expect(estimate(video({ mode: "avatar", model: VIDEO_DEFAULTS.avatar, prompt: "" }))).rejects.toThrow("Pick the photo of the person.");
		await expect(estimate(video({ model: "nope/model" }))).rejects.toThrow("There is no video model");
	});
	test("motion, edit and avatar are priced by the clip's / sound's seconds before upload", async () => {
		expect(await cost({ mode: "motion", model: VIDEO_DEFAULTS.motion, prompt: "", image_asset_ids: ["p"], reference_video_duration_seconds: 8 })).toBeCloseTo(0.56, 5);
		expect(await cost({ mode: "motion", model: VIDEO_DEFAULTS.motion, prompt: "", image_asset_ids: ["p"], reference_video_duration_seconds: 8, character_orientation: "image" })).toBeCloseTo(0.56, 5);
		await expect(estimate(video({ mode: "motion", model: VIDEO_DEFAULTS.motion, image_asset_ids: ["p"], reference_video_duration_seconds: 14, character_orientation: "image" }))).rejects.toThrow("10 s at most");
		expect(await cost({ mode: "edit", model: VIDEO_DEFAULTS.edit, prompt: "anime", reference_video_duration_seconds: 20 })).toBeCloseTo(0.2, 5);
		expect(await cost({ mode: "avatar", model: VIDEO_DEFAULTS.avatar, prompt: "", image_asset_ids: ["p"], reference_audio_duration_seconds: 30 })).toBeCloseTo(1.686, 3);
	});
	test("reference: MiniMax H3 counts the pictures past five", async () => {
		expect(await cost({ mode: "reference", model: "minimax/h3/reference-to-video", reference_count: 7, duration_seconds: 5 })).toBeCloseTo(0.46, 5);
		// the mode's default is the cheapest adequate reference model (Vidu Q4 540p): $0.0315/s × 5 s
		expect(await cost({ mode: "reference", model: VIDEO_DEFAULTS.reference, reference_count: 2, duration_seconds: 5 })).toBeCloseTo(0.1575, 4);
	});
	test("sound and resolution change the price as fal bills them", async () => {
		expect(await cost({ model: "fal-ai/veo3.1/fast", duration_seconds: 8, generate_audio: true })).toBeCloseTo(1.2, 5);
		expect(await cost({ model: "fal-ai/veo3.1/fast", duration_seconds: 8, generate_audio: false })).toBeCloseTo(0.8, 5);
		expect(await cost({ model: "minimax/h3/text-to-video", duration_seconds: 5, quality: "2K" })).toBeCloseTo(0.65, 5);
	});
});

describe("the model lists", () => {
	test("the agent's list: text models, the cheap default first, with lengths, shapes and resolutions", () => {
		const list = models("video").models;
		expect(list.map((m) => m.id)).toContain(VIDEO_DEFAULTS.text);
		expect(list.every((m) => m.mode === "text" && m.kind === "video")).toBe(true);
		// The list is cheapest first by the price of a second (Grok Imagine on kie is first), the default is flagged: it is the row to look at.
		const start = list.find((m) => m.id === VIDEO_DEFAULTS.text);
		expect(start?.default).toBe(true);
		expect(start?.limits.supported_durations_seconds).toContain(5);
		expect(start?.limits.supported_aspect_ratios).toContain("9:16");
	});
	test("a mode's list", () => {
		const motion = models("video", "motion").models;
		expect(motion.map((m) => m.id)).toContain(VIDEO_DEFAULTS.motion);
		expect(motion.every((m) => m.mode === "motion")).toBe(true);
		expect(models("image").models.length).toBeGreaterThan(0);
	});
});
