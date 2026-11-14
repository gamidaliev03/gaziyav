import { describe, expect, test } from "bun:test";
import { falModel, type FalModel } from "../models";
import { imageInput, lipsyncInput, minimaxSpeechInput, qwenSpeechInput, qwenTokens, swapInput } from "../wire";

const model = (id: string) => falModel(id) as FalModel;
const SEEDREAM = "fal-ai/bytedance/seedream/v4/text-to-image";

describe("what fal gets", () => {
	test("lipsync: each family's own length field", () => {
		expect(lipsyncInput("fal-ai/latentsync", "v", "a")).toEqual({ video_url: "v", audio_url: "a", loop_mode: "loop" });
		expect(lipsyncInput("fal-ai/sync-lipsync/v2", "v", "a")).toEqual({ video_url: "v", audio_url: "a", sync_mode: "cut_off" });
		expect(lipsyncInput("veed/lipsync", "v", "a")).toEqual({ video_url: "v", audio_url: "a" });
		expect(lipsyncInput("fal-ai/kling-video/lipsync/audio-to-video", "v", "a")).toEqual({ video_url: "v", audio_url: "a" });
	});
	test("a 4:5 picture is really 4:5 (it was sent as portrait_4_3, a 3:4 picture)", () => {
		expect(imageInput(model(SEEDREAM), "p", "4:5", []).input.image_size).toEqual({ width: 1536, height: 1920 });
		expect(imageInput(model("fal-ai/flux/schnell"), "p", "4:5", []).input.image_size).toEqual({ width: 896, height: 1120 });
		expect(imageInput(model("fal-ai/nano-banana"), "p", "4:5", []).input.aspect_ratio).toBe("4:5");
		expect(imageInput(model(SEEDREAM), "p", "3:4", []).input.image_size).toBe("portrait_4_3");
	});
	test("reference pictures go to the model's edit endpoint", () => {
		expect(imageInput(model(SEEDREAM), "p", "9:16", ["u"]).endpoint).toBe("fal-ai/bytedance/seedream/v4/edit");
		expect(imageInput(model("fal-ai/nano-banana"), "p", "9:16", ["u"])).toEqual({ endpoint: "fal-ai/nano-banana/edit", input: { prompt: "p", image_urls: ["u"], num_images: 1, aspect_ratio: "9:16" } });
	});
	test("Qwen gets room for the whole text, up to fal's limit (the old cap of 4096 cut the longest texts)", () => {
		expect(qwenTokens(10)).toBe(400);
		expect(qwenTokens(1000)).toBe(1920);
		expect(qwenTokens(5000)).toBe(8192);
	});
	test("a clone speaks by its embedding, a ready voice by name; the style goes only with a ready voice", () => {
		expect(qwenSpeechInput({ text: "t", language: "Russian", voice: "Ryan", style: "calm" })).toEqual({ text: "t", language: "Russian", max_new_tokens: 400, voice: "Ryan", prompt: "calm" });
		expect(qwenSpeechInput({ text: "t", language: "Auto", voice: "url", cloned: true, reference: "r", style: "calm" })).toEqual({ text: "t", language: "Auto", max_new_tokens: 400, speaker_voice_embedding_file_url: "url", reference_text: "r" });
	});
	test("MiniMax: Speech 2.x reads `prompt`, Speech-02 `text`; a neutral emotion isn't sent", () => {
		const a = minimaxSpeechInput({ endpoint: "fal-ai/minimax/speech-2.8-turbo", text: "t", voice: "v", boost: "Russian", emotion: "neutral" });
		expect(a.prompt).toBe("t");
		expect((a.voice_setting as Record<string, unknown>).emotion).toBeUndefined();
		const b = minimaxSpeechInput({ endpoint: "fal-ai/minimax/speech-02-hd", text: "t", voice: "v", boost: "auto", emotion: "happy" });
		expect(b.text).toBe("t");
		expect((b.voice_setting as Record<string, unknown>).emotion).toBe("happy");
	});
	test("face swap: the person, at 720p, keeping the sound", () => {
		expect(swapInput("v", "i")).toEqual({ video_url: "v", image_url: "i", mode: "person", resolution: "720p", original_sound_switch: true });
	});
});
