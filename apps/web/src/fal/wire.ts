// The exact JSON of every fal call that isn't a video generation (those are in video.ts): pure functions, so the
// server's calls, the unit tests and test/fal-schema-audit.mjs all read the same request.
import { type FalModel, IMAGE_EDIT } from "./models";

/** The take's knobs the schemas have (test/fal-schemas.json): a new seed is another take of LatentSync; guidance 1–2 = lip strength. */
export interface LipOptions {
	seed?: number;
	guidance?: number;
	/** Sync's own length mode; the pipeline makes the lengths equal itself, so its default stays cut_off. */
	syncMode?: "cut_off" | "loop" | "bounce" | "silence" | "remap";
}

export const SYNC_MODES = ["cut_off", "loop", "bounce", "silence", "remap"] as const;

/** Request fields → options, whatever the page sent (numbers in range, known words only). */
export function lipOptions(body: { seed?: unknown; guidance?: unknown; syncMode?: unknown } | undefined): LipOptions {
	const out: LipOptions = {};
	const seed = Number(body?.seed);
	if (body?.seed != null && Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1) out.seed = seed;
	const g = Number(body?.guidance);
	if (body?.guidance != null && Number.isFinite(g)) out.guidance = Math.round(Math.min(2, Math.max(1, g)) * 10) / 10;
	if (SYNC_MODES.includes(body?.syncMode as (typeof SYNC_MODES)[number])) out.syncMode = body?.syncMode as LipOptions["syncMode"];
	return out;
}

/** The options as a part of a cache name: two takes with other knobs are two results. */
export const lipOptionsKey = (o: LipOptions) => [o.seed != null ? `seed${o.seed}` : "", o.guidance != null && o.guidance !== 1 ? `g${o.guidance}` : "", o.syncMode && o.syncMode !== "cut_off" ? o.syncMode : ""].filter(Boolean).join(":");

export function lipsyncInput(endpoint: string, video_url: string, audio_url: string, o: LipOptions = {}): Record<string, unknown> {
	const input: Record<string, unknown> = { video_url, audio_url };
	if (endpoint === "fal-ai/latentsync") {
		input.loop_mode = "loop";
		if (o.seed != null) input.seed = o.seed;
		if (o.guidance != null) input.guidance_scale = o.guidance;
	} else if (endpoint.startsWith("fal-ai/sync-lipsync")) input.sync_mode = o.syncMode ?? "cut_off";
	return input;
}

export const swapInput = (video_url: string, image_url: string): Record<string, unknown> => ({ video_url, image_url, mode: "person", resolution: "720p", original_sound_switch: true });

export const qwenCloneInput = (audio_url: string, referenceText?: string): Record<string, unknown> => ({ audio_url, ...(referenceText?.trim() ? { reference_text: referenceText.trim().slice(0, 2000) } : {}) });

export const minimaxCloneInput = (audio_url: string): Record<string, unknown> => ({ audio_url, noise_reduction: true, need_volume_normalization: true, text: "Ok.", model: "speech-02-hd" });

/** Room for the whole text: about 12 audio tokens a second (fal's default 200 stops after ~16 s; 8192 is its limit). */
export const qwenTokens = (chars: number) => Math.min(8192, Math.max(400, Math.ceil(chars * 1.8) + 120));

export function qwenSpeechInput(s: { text: string; language: string; voice: string; cloned?: boolean; reference?: string; style?: string }): Record<string, unknown> {
	return {
		text: s.text,
		language: s.language,
		max_new_tokens: qwenTokens(s.text.length),
		// the sample's transcript only in the text's own language: a foreign one gave the text that accent
		...(s.cloned ? { speaker_voice_embedding_file_url: s.voice, ...(s.reference ? { reference_text: s.reference } : {}) } : { voice: s.voice, ...(s.style ? { prompt: s.style } : {}) }),
	};
}

export function minimaxSpeechInput(s: { endpoint: string; text: string; voice: string; speed?: number; emotion?: string; boost: string }): Record<string, unknown> {
	// Speech 2.x takes the text as `prompt`, Speech-02 as `text`.
	const field = /speech-02/.test(s.endpoint) ? "text" : "prompt";
	const voice_setting: Record<string, unknown> = { voice_id: s.voice, speed: Math.min(2, Math.max(0.5, s.speed ?? 1)), vol: 1 };
	if (s.emotion && s.emotion !== "neutral") voice_setting.emotion = s.emotion;
	return { [field]: s.text, voice_setting, language_boost: s.boost, output_format: "url", audio_setting: { format: "mp3", sample_rate: 32000, bitrate: 128000, channel: 1 } };
}

/** fal's image_size for a shape (Seedream / FLUX). 4:5 has no name there: it was sent as portrait_4_3, a 3:4 picture. */
function imageSize(id: string, shape: string): string | { width: number; height: number } | undefined {
	if (shape === "4:5") return id.includes("flux") ? { width: 896, height: 1120 } : { width: 1536, height: 1920 };
	return ({ "9:16": "portrait_16_9", "16:9": "landscape_16_9", "1:1": "square_hd", "3:4": "portrait_4_3", "4:3": "landscape_4_3" } as Record<string, string>)[shape];
}

/** A picture from a description, or (with reference pictures) the model's edit endpoint. */
export function imageInput(m: FalModel, prompt: string, shape: string, refs: string[]): { endpoint: string; input: Record<string, unknown> } {
	if (refs.length) {
		const endpoint = IMAGE_EDIT[m.id] ?? "fal-ai/bytedance/seedream/v4/edit";
		return { endpoint, input: { prompt, image_urls: refs, num_images: 1, ...(endpoint.includes("nano-banana") ? { aspect_ratio: shape } : { image_size: imageSize(endpoint, shape) ?? "auto" }) } };
	}
	if (m.id === "fal-ai/nano-banana") return { endpoint: m.id, input: { prompt, num_images: 1, aspect_ratio: shape } };
	return { endpoint: m.id, input: { prompt, num_images: 1, image_size: imageSize(m.id, shape) ?? "portrait_16_9", ...(m.id.includes("flux") ? { num_inference_steps: 4 } : {}) } };
}
