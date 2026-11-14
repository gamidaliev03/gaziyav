// kie.ai's models as Gaziyav offers them: each id, field, option and price is read from kie's own model pages
// (their form definition and pricing text, 05.11.2026; Kling 3.0 Omni, the HappyHorse and Wan reference modes and the
// PixVerse extension 06.11.2026) — test/kie-schemas.json keeps that record, test/kie-schema-audit.mjs checks these
// builders against it. A model whose fields couldn't be confirmed isn't here. Every price was read again from kie.ai/pricing
// on 06.11.2026 (docs/PRICES.md has the table, src/fal/__tests__/prices-read.json holds it for the machine check).
import type { VideoMode, VideoModel, VideoOptions, VideoUrls } from "../fal/video";

/**
 * One credit is $0.005 at kie's list price (kie.ai/pricing: «1 credit ≈ $0.005»). Its own pages add that big top-ups carry bonus
 * credits («a $1,250 top-up adds 10%», effective ≈ $0.0045 a credit); the packages in between sit behind kie's login (billing),
 * so the list rate is used everywhere: what a job costs here is never less than what it costs the user. The amount a finished
 * job really charged is kie's own `creditsConsumed` × this rate (kie/server.ts), so the Spent total follows the credits.
 */
export const CREDIT_USD = 0.005;
const cr = (credits: number) => Math.round(credits * 500) / 100000;
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const opt = (key: string, value: unknown): Record<string, unknown> => (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length) ? {} : { [key]: value });
const text = (o: VideoOptions) => (o.prompt ?? "").trim();

const SEEDANCE_SHAPES = ["adaptive", "9:16", "16:9", "1:1", "4:3", "3:4", "21:9"];
const THREE = ["9:16", "16:9", "1:1"];
const FIVE = ["9:16", "16:9", "1:1", "4:3", "3:4"];
const HAPPY_SHAPES = ["9:16", "16:9", "1:1", "4:3", "3:4", "4:5", "5:4", "9:21", "21:9"];

// Seedance 2.x: integer seconds; sound is `generate_audio`, included in the price.
const seedance = (o: VideoOptions, u: VideoUrls) => ({ prompt: text(o), generate_audio: o.audio ?? true, resolution: o.resolution || "720p", duration: o.duration ?? 5, ...opt("aspect_ratio", o.aspect), ...opt("first_frame_url", u.image), ...opt("last_frame_url", u.end), ...opt("reference_image_urls", u.images) });
// Kling 3.0: `sound`, seconds as a string, and `mode` for the resolution; one or two `image_urls` are the first/last frames.
const KLING_MODE: Record<string, string> = { "720p": "std", "1080p": "pro", "4K": "4K" };
const kling3 = (o: VideoOptions, u: VideoUrls) => ({ prompt: text(o), sound: !!o.audio, duration: String(o.duration ?? 5), mode: KLING_MODE[o.resolution ?? "720p"] ?? "std", multi_shots: false, ...opt("aspect_ratio", o.aspect), ...opt("image_urls", [u.image, u.end].filter(Boolean)) });
// Kling 3.0 Omni (text, one picture, a first and a last one, reference pictures): whole seconds, resolution in lower case, and
// `audio` is always sent (kie's page asks for it set on every request). The pictures are `image_urls` in every mode; the
// start-picture forms take no shape of their own (kie only accepts «auto» there), so none is sent.
const omni = (o: VideoOptions, u: VideoUrls) => ({ prompt: text(o), audio: !!o.audio, resolution: o.resolution || "720p", duration: o.duration ?? 5, ...opt("aspect_ratio", o.aspect), ...opt("image_urls", u.images ?? [u.image, u.end].filter(Boolean)) });
const OMNI = { "720p": cr(15.1), "1080p": cr(20.2), "4k": cr(75.5) };
const OMNI_SOUND = { "720p": cr(20.2), "1080p": cr(25.2), "4k": cr(75.5) };
// Veo 3.1: `model` here is the tier; generation_type picks the mode.
const veo = (tier: string, type: string) => (o: VideoOptions, u: VideoUrls) => ({ prompt: text(o), model: tier, generation_type: type, resolution: o.resolution || "720p", duration: o.duration ?? 8, ...opt("aspect_ratio", o.aspect), ...opt("image_urls", u.images ?? [u.image, u.end].filter(Boolean)) });
const VEO_LITE = { "720p": 0.15, "1080p": 0.175, "4k": 0.75 };
const VEO_FAST = { "720p": 0.3, "1080p": 0.325, "4k": 0.9 };
const perVideo = (table: Record<string, number>) => (o: VideoOptions) => table[o.resolution ?? "720p"] ?? Object.values(table)[0];
// Grok: text-to-video's schema says a number (its example shows '6'), image-to-video's says a string, and both agree there.
const grok = (o: VideoOptions) => ({ prompt: text(o), mode: "normal", duration: o.duration ?? 6, resolution: o.resolution || "480p", ...opt("aspect_ratio", o.aspect) });
const grokImage = (o: VideoOptions, u: VideoUrls) => ({ ...grok(o), duration: String(o.duration ?? 6), image_urls: [u.image] });
const GROK_RATE = { "480p": cr(2.4), "720p": cr(4.5), "1080p": cr(8) };
const pixverseAudio = (o: VideoOptions) => ({ generate_audio_switch: !!o.audio });
// The extension asks for a seed. Made from the request itself (not at random), so pressing Retry sends the same request and
// comes back to the paid task instead of paying for another; a different clip or text gives another seed.
const stableSeed = (s: string) => {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return (h >>> 0) % 2147483648;
};
const PIX = { "360p": cr(4), "540p": cr(5.6), "720p": cr(7.2), "1080p": cr(14.4) };
const PIX_SOUND = { "360p": cr(5.6), "540p": cr(7.2), "720p": cr(9.6), "1080p": cr(18.4) };
const WAN27 = { "720p": cr(16), "1080p": cr(24) };
const HAPPY = { "720p": cr(22.5), "1080p": cr(29) };
const VIDU = { "540p": cr(7.2), "720p": cr(15.2), "1080p": cr(19.2), "2k": cr(30.4), "4k": cr(62.4) };
const KLING3_RATE = { "720p": cr(15.1), "1080p": cr(20.2), "4K": cr(75.5) };
const KLING3_SOUND = { "720p": cr(22.7), "1080p": cr(30.2), "4K": cr(75.5) };
const motion = (o: VideoOptions, u: VideoUrls) => ({ input_urls: [u.image], video_urls: [u.video], character_orientation: o.orientation ?? "video", mode: o.resolution || "720p", ...opt("prompt", text(o)) });
const seconds2 = range(4, 15);
// Seedance 1.0: seconds as a string, 5 or 10.
const SEEDANCE_LITE = { "480p": cr(2), "720p": cr(4.5), "1080p": cr(10) };
const seedance1 = (o: VideoOptions, u: VideoUrls) => ({ prompt: text(o), resolution: o.resolution || "720p", duration: String(o.duration ?? 5), ...opt("aspect_ratio", o.aspect), ...opt("image_url", u.image), ...opt("end_image_url", u.end), ...opt("seed", o.seed) });
// Kling Turbo: seconds as a string (its form shows a slider, its schema says string).
const klingTurbo = (o: VideoOptions, u: VideoUrls) => ({ prompt: text(o), duration: String(o.duration ?? 5), resolution: o.resolution || "720p", ...opt("aspect_ratio", o.aspect), ...opt("image_urls", u.image ? [u.image] : undefined) });
// Kling 4.0: integer seconds; frames by name.
const kling4 = (o: VideoOptions, u: VideoUrls) => ({ prompt: text(o), duration: o.duration ?? 5, resolution: o.resolution || "720p", ...opt("aspect_ratio", o.aspect), ...opt("first_frame_url", u.image), ...opt("last_frame_url", u.end) });
const KLING4 = ["auto", "9:16", "16:9", "1:1", "21:9"];
const LONG = [5, 10, 15, 20, 30];
// Wan 3.0: resolutions in capitals; sound is free.
const wan3 = (o: VideoOptions, u: VideoUrls) => ({ prompt: text(o), resolution: o.resolution || "720P", duration: o.duration ?? 5, audio: o.audio ?? true, ...opt("aspect_ratio", o.aspect), ...opt("first_frame_url", u.image), ...opt("seed", o.seed) });
const WAN3 = { "480P": cr(8), "720P": cr(16), "1080P": cr(32) };
// Wan 2.6: billed per clip; always 16:9, kie's page says so.
const wan26 = (o: VideoOptions, u: VideoUrls) => ({ prompt: text(o), duration: String(o.duration ?? 5), resolution: o.resolution || "720p", ...opt("image_urls", u.image ? [u.image] : undefined) });
const wan26Price = (o: VideoOptions) => cr(((o.resolution === "1080p" ? 105 : 70) * (o.duration ?? 5)) / 5);
const hailuoSeconds = (o: VideoOptions) => (o.resolution === "1080P" ? 6 : (o.duration ?? 6));
const hailuo = (o: VideoOptions, u: VideoUrls) => ({ prompt: text(o), image_url: u.image, duration: String(hailuoSeconds(o)), resolution: o.resolution || "768P" });

const base = (over: Omit<VideoModel, "family" | "title" | "maker"> & Partial<VideoModel> & { family: string; title: string; maker: string }): VideoModel => ({ api: "kie", ...over });
const shared = {
	s2fast: { family: "k-seedance-2-fast", title: "Seedance 2.0 Fast", maker: "ByteDance", note: "ByteDance's best, with sound", rate: { "480p": cr(11.7), "720p": cr(24.8) }, durations: seconds2, resolutions: ["720p", "480p"], sound: { default: true }, maxPrompt: 20000, build: seedance },
	s2: { family: "k-seedance-2", title: "Seedance 2.0", maker: "ByteDance", note: "Full quality, up to 4K", rate: { "480p": cr(19), "720p": cr(41), "1080p": cr(102), "4k": cr(208) }, durations: seconds2, resolutions: ["720p", "480p", "1080p", "4k"], sound: { default: true }, maxPrompt: 20000, build: seedance },
	mini: { family: "k-seedance-2-mini", title: "Seedance 2.0 Mini", maker: "ByteDance", note: "The cheapest Seedance 2.0", rate: { "480p": cr(3.8), "720p": cr(8.2) }, durations: seconds2, resolutions: ["720p", "480p"], sound: { default: true }, maxPrompt: 20000, build: seedance },
	kling: { family: "k-kling-3", title: "Kling 3.0", maker: "Kuaishou", note: "Smooth, cinematic motion, 3–15 s", rate: KLING3_RATE, soundRate: KLING3_SOUND, durations: range(3, 15), resolutions: ["720p", "1080p", "4K"], sound: { default: false }, maxPrompt: 2500, build: kling3 },
	wan27: { family: "k-wan-27", title: "Wan 2.7", maker: "Alibaba", note: "Sharp 720p and 1080p, 2–15 s", rate: WAN27, durations: range(2, 15), resolutions: ["720p", "1080p"], seed: true, negative: true, maxPrompt: 5000 },
	pix: { family: "k-pixverse-6", title: "PixVerse V6", maker: "PixVerse", note: "Cheap and quick, with sound if you want", rate: PIX, soundRate: PIX_SOUND, durations: range(1, 15), resolutions: ["720p", "360p", "540p", "1080p"], sound: { default: false }, seed: true, maxPrompt: 5000 },
	omni: { family: "k-kling-omni", title: "Kling 3.0 Omni", maker: "Kuaishou", note: "Kling with references and sound, 3–15 s", rate: OMNI, soundRate: OMNI_SOUND, durations: range(3, 15), resolutions: ["720p", "1080p", "4k"], sound: { default: false }, maxPrompt: 3072, build: omni },
	happy: { family: "k-happyhorse-11", title: "HappyHorse 1.1", maker: "Alibaba", note: "Lively motion, 3–15 s", rate: HAPPY, durations: range(3, 15), resolutions: ["720p", "1080p"], maxPrompt: 5000 },
};

const mode = (id: string, m: VideoMode, s: Partial<VideoModel> & { family: string; title: string; maker: string; note: string; rate: Record<string, number> }, over: Partial<VideoModel> & { build?: VideoModel["build"] } = {}): VideoModel => base({ id: `${id}#${m}`, mode: m, build: seedance, ...s, ...over });

export const KIE_VIDEO_MODELS: VideoModel[] = [
	// ── Text → video
	mode("bytedance/seedance-2-mini", "text", shared.mini, { aspects: SEEDANCE_SHAPES }),
	mode("grok-imagine/text-to-video", "text", { family: "k-grok", title: "Grok Imagine", maker: "xAI", note: "Very cheap at 480p, up to 30 s", rate: GROK_RATE, durations: [6, 10, 15, 20, 30], resolutions: ["480p", "720p", "1080p"], maxPrompt: 5000 }, { aspects: ["9:16", "16:9", "1:1", "2:3", "3:2"], build: grok }),
	mode("bytedance/seedance-2-fast", "text", shared.s2fast, { aspects: SEEDANCE_SHAPES }),
	mode("bytedance/seedance-2", "text", shared.s2, { aspects: SEEDANCE_SHAPES }),
	mode("bytedance/seedance-2-5", "text", { family: "k-seedance-25", title: "Seedance 2.5", maker: "ByteDance", note: "ByteDance's newest, up to 30 s", rate: { "480p": cr(28), "720p": cr(63), "1080p": cr(158) }, durations: [5, 10, 15, 20, 30], resolutions: ["720p", "480p", "1080p"], sound: { default: true }, maxPrompt: 20000 }, { aspects: SEEDANCE_SHAPES }),
	mode("kling-3.0/video", "text", shared.kling, { aspects: THREE }),
	mode("kling-3.0-omni/text-to-video", "text", shared.omni, { aspects: THREE }),
	mode("veo-3-1", "text", { family: "k-veo-fast", title: "Veo 3.1 Fast", maker: "Google", note: "Google's video, priced per clip", rate: { "720p": 0.0375, "1080p": 0.0406, "4k": 0.1125 }, durations: [4, 6, 8], resolutions: ["720p", "1080p", "4k"], priceOf: perVideo(VEO_FAST) }, { aspects: ["9:16", "16:9"], build: veo("veo3_fast", "TEXT_2_VIDEO") }),
	mode("wan/2-7-text-to-video", "text", shared.wan27, { aspects: FIVE, build: (o) => ({ prompt: text(o), resolution: o.resolution || "720p", duration: o.duration ?? 5, ...opt("ratio", o.aspect), ...opt("negative_prompt", o.negative?.trim()), ...opt("seed", o.seed) }) }),
	mode("pixverse-v6/text-to-video", "text", shared.pix, { aspects: ["9:16", "16:9", "1:1", "4:3", "3:4", "2:3", "3:2", "21:9"], build: (o) => ({ prompt: text(o), duration: o.duration ?? 5, quality: o.resolution || "720p", aspect_ratio: o.aspect ?? "9:16", ...pixverseAudio(o), ...opt("seed", o.seed) }) }),
	mode("bytedance/v1-lite-text-to-video", "text", { family: "k-seedance-1-lite", title: "Seedance 1.0 Lite", maker: "ByteDance", note: "The cheapest clip, 5 or 10 s", rate: SEEDANCE_LITE, durations: [5, 10], resolutions: ["720p", "480p", "1080p"], seed: true, maxPrompt: 10000 }, { aspects: ["9:16", "16:9", "1:1", "4:3", "3:4", "9:21"], build: seedance1 }),
	mode("bytedance/v1-pro-text-to-video", "text", { family: "k-seedance-1-pro", title: "Seedance 1.0 Pro", maker: "ByteDance", note: "Older, cheap, 5 or 10 s", rate: { "480p": cr(2.8), "720p": cr(6), "1080p": cr(14) }, durations: [5, 10], resolutions: ["720p", "480p", "1080p"], seed: true, maxPrompt: 10000 }, { aspects: ["9:16", "16:9", "1:1", "4:3", "3:4", "21:9"], build: seedance1 }),
	mode("kling/v3-turbo-text-to-video", "text", { family: "k-kling-turbo", title: "Kling 3.0 Turbo", maker: "Kuaishou", note: "Kling, faster", rate: { "720p": cr(20.2), "1080p": cr(25.2) }, durations: range(3, 15), resolutions: ["720p", "1080p"], maxPrompt: 2500 }, { aspects: THREE, build: klingTurbo }),
	mode("wan/3-0-video", "text", { family: "k-wan-3", title: "Wan 3.0", maker: "Alibaba", note: "Newest Wan, sound for free, up to 30 s", rate: WAN3, durations: LONG, resolutions: ["720P", "480P", "1080P"], sound: { default: true }, seed: true, maxPrompt: 20000 }, { aspects: ["adaptive", "9:16", "16:9", "1:1", "4:3", "3:4"], build: wan3 }),
	mode("wan/2-6-text-to-video", "text", { family: "k-wan-26", title: "Wan 2.6", maker: "Alibaba", note: "Always 16:9, priced per clip", rate: { "720p": cr(14), "1080p": cr(21) }, durations: [5, 10, 15], resolutions: ["720p", "1080p"], maxPrompt: 5000, priceOf: wan26Price }, { build: wan26 }),
	mode("happyhorse-1-1/text-to-video", "text", shared.happy, { aspects: FIVE, build: (o) => ({ prompt: text(o), resolution: o.resolution || "720p", duration: o.duration ?? 5, ...opt("aspect_ratio", o.aspect) }) }),

	// ── Image → video
	mode("bytedance/seedance-2-mini", "image", shared.mini, { aspects: SEEDANCE_SHAPES }),
	mode("grok-imagine/image-to-video", "image", { family: "k-grok", title: "Grok Imagine", maker: "xAI", note: "Very cheap at 480p, up to 30 s", rate: GROK_RATE, durations: [6, 10, 15, 20, 30], resolutions: ["480p", "720p", "1080p"], maxPrompt: 5000 }, { aspects: ["9:16", "16:9", "1:1", "2:3", "3:2"], build: grokImage }),
	mode("bytedance/seedance-2-fast", "image", shared.s2fast, { aspects: SEEDANCE_SHAPES }),
	mode("bytedance/seedance-2", "image", shared.s2, { aspects: SEEDANCE_SHAPES }),
	mode("bytedance/v1-pro-image-to-video", "image", { family: "k-seedance-1-pro", title: "Seedance 1.0 Pro", maker: "ByteDance", note: "Older, cheap, 5 or 10 s", rate: { "480p": cr(2.8), "720p": cr(6), "1080p": cr(14) }, durations: [5, 10], resolutions: ["720p", "480p", "1080p"], seed: true, maxPrompt: 10000 }, { build: (o, u) => ({ prompt: text(o), image_url: u.image, resolution: o.resolution || "720p", duration: String(o.duration ?? 5), ...opt("seed", o.seed) }) }),
	mode("kling-3.0/video", "image", shared.kling),
	mode("kling-3.0-omni/image-to-video", "image", shared.omni),
	mode("veo-3-1", "image", { family: "k-veo-fast", title: "Veo 3.1 Fast", maker: "Google", note: "Google's video, priced per clip", rate: { "720p": 0.0375, "1080p": 0.0406, "4k": 0.1125 }, durations: [4, 6, 8], resolutions: ["720p", "1080p", "4k"], priceOf: perVideo(VEO_FAST) }, { aspects: ["9:16", "16:9"], build: veo("veo3_fast", "FIRST_AND_LAST_FRAMES_2_VIDEO") }),
	mode("wan/2-7-image-to-video", "image", shared.wan27, { build: (o, u) => ({ prompt: text(o), first_frame_url: u.image, resolution: o.resolution || "720p", duration: o.duration ?? 5, ...opt("negative_prompt", o.negative?.trim()), ...opt("seed", o.seed) }) }),
	mode("pixverse-v6/image-to-video", "image", shared.pix, { build: (o, u) => ({ prompt: text(o), image_urls: [u.image], duration: o.duration ?? 5, quality: o.resolution || "720p", ...pixverseAudio(o), ...opt("seed", o.seed) }) }),
	mode("vidu-q4/image-to-video", "image", { family: "k-vidu-q4", title: "Vidu Q4", maker: "Vidu", note: "Sound for free, up to 4K", rate: VIDU, durations: range(3, 16), resolutions: ["720p", "540p", "1080p", "2k", "4k"], sound: { default: true }, maxPrompt: 20000 }, { build: (o, u) => ({ prompt: text(o), image_url: u.image, duration: o.duration ?? 5, resolution: o.resolution || "720p", audio: o.audio ?? true }) }),
	mode("hailuo/2-3-image-to-video-standard", "image", { family: "k-hailuo-23", title: "Hailuo 2.3", maker: "MiniMax", note: "Priced per clip; 1080P is 6 s", rate: { "768P": cr(5), "1080P": cr(8.3) }, durations: [6, 10], resolutions: ["768P", "1080P"], maxPrompt: 5000, priceOf: (o) => (o.resolution === "1080P" ? cr(50) : o.duration === 10 ? cr(50) : cr(30)), clipSeconds: hailuoSeconds }, { build: hailuo }),
	mode("hailuo/2-3-image-to-video-pro", "image", { family: "k-hailuo-23-pro", title: "Hailuo 2.3 Pro", maker: "MiniMax", note: "Priced per clip; 1080P is 6 s", rate: { "768P": cr(7.5), "1080P": cr(13.3) }, durations: [6, 10], resolutions: ["768P", "1080P"], maxPrompt: 5000, priceOf: (o) => (o.resolution === "1080P" ? cr(80) : o.duration === 10 ? cr(90) : cr(45)), clipSeconds: hailuoSeconds }, { build: hailuo }),
	mode("bytedance/v1-lite-image-to-video", "image", { family: "k-seedance-1-lite", title: "Seedance 1.0 Lite", maker: "ByteDance", note: "The cheapest clip, 5 or 10 s", rate: SEEDANCE_LITE, durations: [5, 10], resolutions: ["720p", "480p", "1080p"], seed: true, maxPrompt: 10000 }, { build: seedance1 }),
	mode("kling/v3-turbo-image-to-video", "image", { family: "k-kling-turbo", title: "Kling 3.0 Turbo", maker: "Kuaishou", note: "Kling, faster", rate: { "720p": cr(20.2), "1080p": cr(25.2) }, durations: range(3, 15), resolutions: ["720p", "1080p"], maxPrompt: 2500 }, { build: klingTurbo }),
	mode("kling-4.0/flash-keyframe-to-video", "image", { family: "k-kling-4-flash", title: "Kling 4.0 Flash", maker: "Kuaishou", note: "Newest Kling, quick, 720p", rate: { "720p": cr(17) }, durations: [3, 5, 8, 10, 15, 20], resolutions: ["720p"], maxPrompt: 8000 }, { build: kling4 }),
	mode("wan/3-0-video", "image", { family: "k-wan-3", title: "Wan 3.0", maker: "Alibaba", note: "Newest Wan, sound for free, up to 30 s", rate: WAN3, durations: LONG, resolutions: ["720P", "480P", "1080P"], sound: { default: true }, seed: true, maxPrompt: 20000 }, { build: wan3 }),
	mode("wan/2-6-image-to-video", "image", { family: "k-wan-26", title: "Wan 2.6", maker: "Alibaba", note: "Priced per clip", rate: { "720p": cr(14), "1080p": cr(21) }, durations: [5, 10, 15], resolutions: ["720p", "1080p"], maxPrompt: 5000, priceOf: wan26Price }, { build: wan26 }),
	mode("happyhorse-1-1/image-to-video", "image", shared.happy, { build: (o, u) => ({ prompt: text(o), image_urls: [u.image], resolution: o.resolution || "720p", duration: o.duration ?? 5 }) }),

	// ── First + last frame
	mode("bytedance/seedance-2-mini", "frames", shared.mini, { aspects: SEEDANCE_SHAPES }),
	mode("bytedance/seedance-2-fast", "frames", shared.s2fast, { aspects: SEEDANCE_SHAPES }),
	mode("bytedance/seedance-2", "frames", shared.s2, { aspects: SEEDANCE_SHAPES }),
	mode("kling-3.0/video", "frames", shared.kling),
	mode("kling-3.0-omni/image-to-video", "frames", shared.omni),
	mode("veo-3-1", "frames", { family: "k-veo-fast", title: "Veo 3.1 Fast", maker: "Google", note: "Google's video, priced per clip", rate: { "720p": 0.0375, "1080p": 0.0406, "4k": 0.1125 }, durations: [4, 6, 8], resolutions: ["720p", "1080p", "4k"], priceOf: perVideo(VEO_FAST) }, { aspects: ["9:16", "16:9"], build: veo("veo3_fast", "FIRST_AND_LAST_FRAMES_2_VIDEO") }),
	mode("wan/2-7-image-to-video", "frames", shared.wan27, { build: (o, u) => ({ prompt: text(o), first_frame_url: u.image, last_frame_url: u.end, resolution: o.resolution || "720p", duration: o.duration ?? 5, ...opt("negative_prompt", o.negative?.trim()), ...opt("seed", o.seed) }) }),
	mode("bytedance/v1-lite-image-to-video", "frames", { family: "k-seedance-1-lite", title: "Seedance 1.0 Lite", maker: "ByteDance", note: "The cheapest clip, 5 or 10 s", rate: SEEDANCE_LITE, durations: [5, 10], resolutions: ["720p", "480p", "1080p"], seed: true, maxPrompt: 10000 }, { build: seedance1 }),
	mode("kling-4.0/keyframe-to-video", "frames", { family: "k-kling-4", title: "Kling 4.0", maker: "Kuaishou", note: "Newest Kling, 3–30 s", rate: { "720p": cr(28.5), "1080p": cr(42.5) }, durations: [3, 5, 8, 10, 15, 20, 30], resolutions: ["720p", "1080p"], maxPrompt: 8000 }, { aspects: KLING4, build: kling4 }),
	mode("pixverse-v6/transition", "frames", shared.pix, { build: (o, u) => ({ prompt: text(o), first_frame_image_url: u.image, last_frame_image_url: u.end, duration: o.duration ?? 5, quality: o.resolution || "720p", ...pixverseAudio(o), ...opt("seed", o.seed) }) }),

	// ── Reference pictures
	mode("bytedance/seedance-2-mini", "reference", shared.mini, { aspects: SEEDANCE_SHAPES, maxImages: 9, refName: "@image{n}" }),
	mode("bytedance/seedance-2-fast", "reference", shared.s2fast, { aspects: SEEDANCE_SHAPES, maxImages: 9, refName: "@image{n}" }),
	mode("bytedance/seedance-2-5", "reference", { family: "k-seedance-25", title: "Seedance 2.5", maker: "ByteDance", note: "ByteDance's newest, up to 30 pictures", rate: { "480p": cr(28), "720p": cr(63), "1080p": cr(158) }, durations: [5, 10, 15, 20, 30], resolutions: ["720p", "480p", "1080p"], sound: { default: true }, maxPrompt: 20000 }, { aspects: SEEDANCE_SHAPES, maxImages: 30, refName: "@image{n}" }),
	mode("vidu-q4/reference-to-video", "reference", { family: "k-vidu-q4", title: "Vidu Q4", maker: "Vidu", note: "Up to 15 pictures, sound for free", rate: VIDU, durations: range(3, 16), resolutions: ["720p", "540p", "1080p", "2k", "4k"], sound: { default: true }, maxPrompt: 20000 }, { aspects: FIVE, maxImages: 15, refName: "[@reference_image_{n}]", build: (o, u) => ({ prompt: text(o), reference_image_urls: u.images, duration: o.duration ?? 5, resolution: o.resolution || "720p", audio: o.audio ?? true, ...opt("aspect_ratio", o.aspect) }) }),
	mode("kling-3.0-omni/reference-to-video", "reference", { ...shared.omni, note: "Kling with up to 7 reference pictures and sound" }, { aspects: THREE, maxImages: 7 }),
	mode("happyhorse-1-1/reference-to-video", "reference", { ...shared.happy, note: "Up to 9 reference pictures, 3–15 s" }, { aspects: HAPPY_SHAPES, maxImages: 9, refName: "[Image {n}]", build: (o, u) => ({ prompt: text(o), reference_image: u.images, resolution: o.resolution || "720p", duration: o.duration ?? 5, ...opt("aspect_ratio", o.aspect) }) }),
	mode("wan/2-7-r2v", "reference", { ...shared.wan27, note: "Up to 5 reference pictures, 2–10 s", durations: range(2, 10) }, { aspects: FIVE, maxImages: 5, refName: "Image {n}", build: (o, u) => ({ prompt: text(o), reference_image: u.images, resolution: o.resolution || "720p", duration: o.duration ?? 5, ...opt("aspect_ratio", o.aspect), ...opt("negative_prompt", o.negative?.trim()), ...opt("seed", o.seed) }) }),
	mode("kling-4.0/reference-to-video", "reference", { family: "k-kling-4", title: "Kling 4.0", maker: "Kuaishou", note: "Newest Kling, up to 10 pictures, 3–30 s", rate: { "720p": cr(28.5), "1080p": cr(42.5) }, durations: [3, 5, 8, 10, 15, 20, 30], resolutions: ["720p", "1080p"], maxPrompt: 8000 }, { aspects: ["auto", "9:16", "16:9", "1:1", "21:9"], maxImages: 10, refName: "@Image{n}", build: (o, u) => ({ prompt: text(o), image_urls: u.images, duration: o.duration ?? 5, resolution: o.resolution || "720p", ...opt("aspect_ratio", o.aspect) }) }),
	mode("kling-4.0/flash-reference-to-video", "reference", { family: "k-kling-4-flash", title: "Kling 4.0 Flash", maker: "Kuaishou", note: "Newest Kling, quick, up to 10 pictures", rate: { "720p": cr(17) }, durations: [3, 5, 8, 10, 15, 20], resolutions: ["720p"], maxPrompt: 8000 }, { aspects: KLING4, maxImages: 10, refName: "@Image{n}", build: (o, u) => ({ prompt: text(o), image_urls: u.images, duration: o.duration ?? 5, resolution: "720p", ...opt("aspect_ratio", o.aspect) }) }),
	mode("veo-3-1", "reference", { family: "k-veo-lite", title: "Veo 3.1 Lite", maker: "Google", note: "Up to 3 pictures, 8 s, priced per clip", rate: { "720p": 0.0188, "1080p": 0.0219, "4k": 0.0938 }, durations: [8], resolutions: ["720p", "1080p", "4k"], priceOf: perVideo(VEO_LITE) }, { aspects: ["9:16", "16:9"], maxImages: 3, build: veo("veo3_lite", "REFERENCE_2_VIDEO") }),

	// ── Motion control (billed by the clip's length)
	mode("kling-2.6/motion-control", "motion", { family: "k-kling-26-motion", title: "Kling 2.6 Motion", maker: "Kuaishou", note: "Dances and gestures for cents", rate: { "720p": cr(12.6), "1080p": cr(20.2) }, resolutions: ["720p", "1080p"], orientation: true, input: { min: 3, maxAt: { image: 10, video: 30 } } }, { build: motion }),
	mode("kling-3.0/motion-control", "motion", { family: "k-kling-3-motion", title: "Kling 3.0 Motion", maker: "Kuaishou", note: "Newest Kling motion", rate: { "720p": cr(22.7), "1080p": cr(30.2) }, resolutions: ["720p", "1080p"], orientation: true, input: { min: 3, maxAt: { image: 10, video: 30 } } }, { build: motion }),

	// ── A clip changed by a description
	mode("wan/2-7-videoedit", "edit", { family: "k-wan-27-edit", title: "Wan 2.7 Edit", maker: "Alibaba", note: "Change things in the clip, up to 10 s", rate: WAN27, resolutions: ["720p", "1080p"], seed: true, keepSound: true, input: { min: 2, max: 10 }, maxPrompt: 5000 }, { build: (o, u) => ({ prompt: text(o), video_url: u.video, resolution: o.resolution || "720p", audio_setting: (o.keepSound ?? true) ? "origin" : "auto", ...opt("seed", o.seed) }) }),
	mode("kling-3.0-omni/transformation", "edit", { family: "k-kling-omni-edit", title: "Kling 3.0 Omni", maker: "Kuaishou", note: "Swap people, places and style", rate: { "720p": cr(22.7), "1080p": cr(30.2), "4k": cr(75.5) }, resolutions: ["720p", "1080p", "4k"], picture: true, maxPrompt: 3072 }, { build: (o, u) => ({ prompt: text(o), video_urls: [u.video], resolution: o.resolution || "720p", ...opt("image_urls", u.image ? [u.image] : undefined) }) }),

	// ── Extend: a clip goes on (billed for the new seconds only). PixVerse is the one that takes any clip; Grok's, Veo's and
	// Runway's extensions take the task of a clip they made on kie.ai, which this app doesn't keep with a file.
	mode("pixverse-v6/extend", "extend", { ...shared.pix, note: "Your clip goes on: say what happens next" }, { build: (o, u) => ({ prompt: text(o), video_url: u.video, duration: o.duration ?? 5, quality: o.resolution || "720p", seed: o.seed ?? stableSeed(`${text(o)}|${u.video}|${o.duration}|${o.resolution}`), ...pixverseAudio(o) }) }),

	// ── Avatar: a photo + a sound (billed by the sound's length)
	mode("infinitalk/from-audio", "avatar", { family: "k-infinitalk", title: "InfiniteTalk", maker: "MeiGen", note: "Cheapest talking photo, up to 15 s", rate: { "480p": cr(3), "720p": cr(12) }, resolutions: ["480p", "720p"], input: { max: 15 }, maxPrompt: 5000 }, { build: (o, u) => ({ image_url: u.image, audio_url: u.audio, prompt: text(o) || "A person talking.", resolution: o.resolution || "480p" }) }),
	mode("kling/ai-avatar-standard", "avatar", { family: "k-kling-avatar", title: "Kling AI Avatar", maker: "Kuaishou", note: "Talking heads, 720p, up to 5 min", rate: { "": cr(10.1) }, input: { max: 300 }, maxPrompt: 5000 }, { build: (o, u) => ({ image_url: u.image, audio_url: u.audio, prompt: text(o) || "." }) }),
	mode("kling/ai-avatar-pro", "avatar", { family: "k-kling-avatar-pro", title: "Kling AI Avatar Pro", maker: "Kuaishou", note: "1080p, up to 5 min", rate: { "": cr(20.2) }, input: { max: 300 }, maxPrompt: 5000 }, { build: (o, u) => ({ image_url: u.image, audio_url: u.audio, prompt: text(o) || "." }) }),
	mode("omnihuman-2-0", "avatar", { family: "k-omnihuman-2", title: "OmniHuman 2.0", maker: "ByteDance", note: "Whole-body acting and singing, 720p", rate: { "": cr(14) }, input: { min: 4, max: 300 }, maxPrompt: 300 }, { build: (o, u) => ({ image_urls: [u.image], audio_url: u.audio, enable_watermark: false, ...opt("prompt", text(o)) }) }),
	mode("omnihuman-1-5", "avatar", { family: "k-omnihuman-15", title: "OmniHuman 1.5", maker: "ByteDance", note: "Expressive faces", rate: { "720p": cr(27), "1080p": cr(27) }, resolutions: ["720p", "1080p"], maxPrompt: 300 }, { build: (o, u) => ({ image_url: u.image, audio_url: u.audio, output_resolution: (o.resolution || "720p").replace("p", ""), ...opt("prompt", text(o)) }) }),
];

/** The cheap, good model each mode starts with. */
export const KIE_VIDEO_DEFAULTS: Record<VideoMode, string> = {
	text: "bytedance/seedance-2-mini#text",
	image: "bytedance/seedance-2-mini#image",
	frames: "bytedance/seedance-2-mini#frames",
	reference: "bytedance/seedance-2-mini#reference",
	motion: "kling-2.6/motion-control#motion",
	edit: "wan/2-7-videoedit#edit",
	avatar: "kling/ai-avatar-standard#avatar",
	extend: "pixverse-v6/extend#extend",
};

// ───────────────────────── pictures ─────────────────────────

export interface KieImage {
	id: string;
	/** The model that takes reference pictures. */
	edit?: string;
	title: string;
	maker: string;
	note: string;
	usd: number;
	/** Dollars by quality, where it changes the price. */
	prices?: Record<string, number>;
	/** Reference pictures past `free` cost `usd` each (Seedream 5.0 Pro: the first picture is free, each next one 0.5 credit). */
	refFee?: { free: number; usd: number };
	shapes: string[];
	maxRefs: number;
	build: (o: { prompt: string; shape: string; quality?: string; refs: string[] }) => Record<string, unknown>;
}

const IMAGE_SIZE: Record<string, string> = { "9:16": "portrait_16_9", "16:9": "landscape_16_9", "1:1": "square_hd", "3:4": "portrait_4_3", "4:3": "landscape_4_3" };
const PLAIN = ["9:16", "16:9", "1:1", "3:4", "4:3"];
const WITH_45 = [...PLAIN.slice(0, 3), "4:5", ...PLAIN.slice(3)];

export const KIE_IMAGES: KieImage[] = [
	{ id: "bytedance/seedream-v4-text-to-image", edit: "bytedance/seedream-v4-edit", title: "Seedream 4.0", maker: "ByteDance", note: "Sharp, true to the text, up to 4K", usd: cr(5), shapes: PLAIN, maxRefs: 10, build: ({ prompt, shape, refs }) => ({ prompt, image_size: IMAGE_SIZE[shape] ?? "portrait_16_9", image_resolution: "1K", max_images: 1, ...opt("image_urls", refs) }) },
	{ id: "seedream/4.5-text-to-image", edit: "seedream/4.5-edit", title: "Seedream 4.5", maker: "ByteDance", note: "Finer detail", usd: cr(6.5), shapes: PLAIN, maxRefs: 14, build: ({ prompt, shape, refs }) => ({ prompt, aspect_ratio: shape, quality: "basic", ...opt("image_urls", refs) }) },
	{ id: "seedream/5-pro-text-to-image", edit: "seedream/5-pro-image-to-image", title: "Seedream 5.0 Pro", maker: "ByteDance", note: "ByteDance's best pictures", usd: cr(7), refFee: { free: 1, usd: cr(0.5) }, shapes: PLAIN, maxRefs: 10, build: ({ prompt, shape, refs }) => ({ prompt, aspect_ratio: shape, quality: "basic", ...opt("image_urls", refs) }) },
	{ id: "google/nano-banana", edit: "google/nano-banana-edit", title: "Nano Banana", maker: "Google", note: "Best at following reference pictures", usd: cr(4), shapes: WITH_45, maxRefs: 10, build: ({ prompt, shape, refs }) => ({ prompt, aspect_ratio: shape, ...opt("image_urls", refs) }) },
	{ id: "nano-banana-2", title: "Nano Banana 2", maker: "Google", note: "Newer, sharper", usd: cr(8), shapes: WITH_45, maxRefs: 10, build: ({ prompt, shape, refs }) => ({ prompt, aspect_ratio: shape, resolution: "1K", ...opt("image_input", refs) }) },
	{ id: "nano-banana-pro", title: "Nano Banana Pro", maker: "Google", note: "Google's finest pictures", usd: cr(18), shapes: WITH_45, maxRefs: 8, build: ({ prompt, shape, refs }) => ({ prompt, aspect_ratio: shape, resolution: "1K", ...opt("image_input", refs) }) },
	{ id: "gpt-image-2-text-to-image", edit: "gpt-image-2-image-to-image", title: "GPT Image 2", maker: "OpenAI", note: "Good with words on pictures", usd: cr(6), shapes: WITH_45, maxRefs: 16, build: ({ prompt, shape, refs }) => ({ prompt, aspect_ratio: shape, resolution: "1K", ...opt("input_urls", refs) }) },
	{ id: "grok-imagine-image-2-0/text-to-image", edit: "grok-imagine-image-2-0/image-edit", title: "Grok Imagine", maker: "xAI", note: "Cheap and quick", usd: cr(4), shapes: ["9:16", "16:9", "1:1"], maxRefs: 5, build: ({ prompt, shape, refs }) => ({ prompt, aspect_ratio: shape, ...opt("image_urls", refs) }) },
	{ id: "qwen2-1/text-to-image", edit: "qwen2-1/image-to-image", title: "Qwen Image 2.1", maker: "Alibaba", note: "Cheap, fine with text", usd: cr(4), shapes: PLAIN, maxRefs: 10, build: ({ prompt, shape, refs }) => ({ prompt, aspect_ratio: shape, resolution: "1K", ...opt("image_urls", refs) }) },
	{ id: "flux-2/pro-text-to-image", edit: "flux-2/pro-image-to-image", title: "FLUX.2 Pro", maker: "Black Forest Labs", note: "Natural, photographic", usd: cr(5), shapes: PLAIN, maxRefs: 8, build: ({ prompt, shape, refs }) => ({ prompt, aspect_ratio: shape, resolution: "1K", ...opt("input_urls", refs) }) },
];

export const kieImage = (id: string | undefined) => KIE_IMAGES.find((m) => m.id === id);

/** What a kie model is called when it is run: with reference pictures, its edit model when it has one. */
export const kieImageEndpoint = (m: KieImage, refs: number) => (refs && m.edit ? m.edit : m.id);

// ───────────────────────── voices ─────────────────────────

export const KIE_VOICE: Record<string, string> = {
	ryan: "EkK5I93UQWFDigLMpZcX",
	aiden: "NNl6r8mD7vthiJatiJt1",
	eric: "NNl6r8mD7vthiJatiJt1",
	dylan: "EkK5I93UQWFDigLMpZcX",
	uncle_fu: "EkK5I93UQWFDigLMpZcX",
	vivian: "Z3R5wn05IrDiVCyEkUrK",
	serena: "Z3R5wn05IrDiVCyEkUrK",
	ono_anna: "Z3R5wn05IrDiVCyEkUrK",
	sohee: "Z3R5wn05IrDiVCyEkUrK",
};

export const kieSpeechInput = (s: { text: string; voice?: string; speed?: number; language?: string }): Record<string, unknown> => ({ text: s.text, voice: KIE_VOICE[s.voice ?? ""] ?? KIE_VOICE.ryan, speed: Math.min(1.2, Math.max(0.7, s.speed ?? 1)), ...opt("language_code", s.language) });

/** ByteDance's lipsync on kie.ai: lite for one person facing the camera, basic for harder scenes; `vocals` separates the voice from what is behind it. */
export interface VolcengineOptions {
	mode?: "lite" | "basic";
	vocals?: boolean;
}

export const volcengineInput = (video_url: string, audio_url: string, o: VolcengineOptions = {}): Record<string, unknown> => ({ video_url, audio_url, mode: o.mode ?? "lite", ...(o.vocals ? { separate_vocal: true } : {}), ...(o.mode === "basic" ? {} : { align_audio: true }) });
