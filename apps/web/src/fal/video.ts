// AI video on fal.ai, every mode the generators offer: a clip from text, from a start frame, between a first and a
// last frame, from reference pictures, a photo moving like a person in a clip (motion control), a clip changed by a
// description, a photo talking to a sound (avatar). Each model with its exact fal inputs (read from fal.ai/models/<id>
// /llms.txt, 11.2026) and fal's list price per second of video, so the price is known before anything runs. Shared by
// the page (the Generate tab, its live price) and the server (the calls, the price it charges against).

import { ARGO_VIDEO_DEFAULTS, ARGO_VIDEO_MODELS } from "../argo/catalog";
import { KIE_VIDEO_DEFAULTS, KIE_VIDEO_MODELS } from "../kie/catalog";

/** The modes both APIs have. */
type SharedMode = "text" | "image" | "frames" | "reference" | "motion" | "edit" | "avatar";
/** «extend» is kie.ai's alone (PixVerse V6 goes on from any clip), so with fal on there is no such tab. */
export type VideoMode = SharedMode | "extend";

export const VIDEO_MODES: { id: SharedMode; label: string; note: string }[] = [
	{ id: "text", label: "Text", note: "A clip from a description" },
	{ id: "image", label: "Image", note: "A picture comes to life: it is the first frame" },
	{ id: "frames", label: "Frames", note: "From the first frame to the last one" },
	{ id: "reference", label: "Reference", note: "Your subjects or style from pictures, in a new scene" },
	{ id: "motion", label: "Motion", note: "The person in a photo moves like the one in a clip" },
	{ id: "edit", label: "Restyle", note: "The same clip, restyled or changed by a description" },
	{ id: "avatar", label: "Avatar", note: "A photo talks or sings to a sound" },
];

/** Modes only kie.ai offers. */
export const KIE_ONLY_MODES: { id: VideoMode; label: string; note: string }[] = [{ id: "extend", label: "Extend", note: "Your clip goes on: say what happens next" }];

/** What the user set (the fields a model doesn't take are ignored). */
export interface VideoOptions {
	prompt?: string;
	/** Seconds of the clip asked for (text, image, frames, reference). */
	duration?: number;
	aspect?: string;
	/** fal's own value: «720p», «768P», «4k»… */
	resolution?: string;
	audio?: boolean;
	seed?: number;
	negative?: string;
	/** Motion control: the character faces as in the photo (≤ 10 s) or as in the clip (≤ 30 s). */
	orientation?: "image" | "video";
	/** Motion control and edits: keep the clip's own sound. */
	keepSound?: boolean;
	/** Seconds of the clip (motion, edit) or of the sound (avatar) that is sent: what fal bills. */
	inputSeconds?: number;
	/** Reference pictures sent (reference mode). */
	images?: number;
}

/** fal's links of the inputs (uploaded first). */
export interface VideoUrls {
	/** The start frame; the character's photo (motion, avatar); the style picture of an edit. */
	image?: string;
	end?: string;
	images?: string[];
	video?: string;
	audio?: string;
}

/** What a mode needs from the project. */
export interface VideoHave {
	image?: boolean;
	end?: boolean;
	images?: number;
	video?: boolean;
	audio?: boolean;
}

export interface VideoModel {
	/** fal's endpoint id (POST https://queue.fal.run/<id>). */
	id: string;
	mode: VideoMode;
	/** The same model in other modes (a text model given a picture runs its picture endpoint). */
	family: string;
	title: string;
	maker: string;
	note: string;
	/** US dollars per second of video by resolution (fal's value; "" when the model has no choice). */
	rate: Record<string, number>;
	/** The same with sound, when sound costs more. */
	soundRate?: Record<string, number>;
	/** Reference pictures past `free` cost `usd` each. */
	extraImages?: { free: number; usd: number };
	durations?: number[];
	aspects?: string[];
	/** The first one is the default (the cheap one). */
	resolutions?: string[];
	/** A sound switch and where it starts. */
	sound?: { default: boolean };
	seed?: boolean;
	negative?: boolean;
	/** Reference pictures it takes at most; how the prompt names them («@Image{n}»). */
	maxImages?: number;
	refName?: string;
	/** Seconds of the clip / sound it takes; `maxAt` by orientation or resolution. */
	input?: { min?: number; max?: number; maxAt?: Record<string, number> };
	/** An edit can follow a style picture. */
	picture?: boolean;
	keepSound?: boolean;
	orientation?: boolean;
	maxPrompt?: number;
	/** It takes no description (VEED Fabric: a picture and a sound only): the page hides the field, nothing is sent. */
	noPrompt?: boolean;
	/** Runs on kie.ai or ArgoLink (absent: fal). */
	api?: "kie" | "argo";
	/** Billed per clip, not per second: the price of a run. */
	priceOf?: (o: VideoOptions) => number;
	/** With `priceOf`: how long the clip is when it isn't the length asked for (Hailuo 2.3 at 1080P is 6 s whatever is picked). */
	clipSeconds?: (o: VideoOptions) => number;
	build: (o: VideoOptions, u: VideoUrls) => Record<string, unknown>;
}

// ───────────────────────── inputs ─────────────────────────

/** The field only when it has a value. */
const opt = (key: string, value: unknown): Record<string, unknown> => (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length) ? {} : { [key]: value });
const text = (o: VideoOptions) => (o.prompt ?? "").trim();
const seconds = (o: VideoOptions, m: Pick<VideoModel, "durations">) => o.duration ?? defaultDuration(m);
const seedOf = (o: VideoOptions) => (Number.isInteger(o.seed) && (o.seed as number) >= 0 ? o.seed : undefined);
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const PORTRAIT = ["9:16", "16:9", "1:1", "4:3", "3:4", "21:9"];
const WIDE5 = ["9:16", "16:9", "1:1", "4:3", "3:4"];
const KLING_SHAPES = ["9:16", "16:9", "1:1"];

// Seedance 1.0 Pro Fast: tokens = w × h × 24 × s / 1024 at $1 per million (720p 5 s ≈ $0.11).
const seedance1 = (o: VideoOptions, u: VideoUrls) => ({
	prompt: text(o),
	duration: String(seconds(o, { durations: range(2, 12) })),
	resolution: o.resolution || "720p",
	...opt("aspect_ratio", o.aspect),
	...opt("seed", seedOf(o)),
	...opt("image_url", u.image),
});
// Seedance 1.5 Pro: $1.20 per million tokens, $2.40 with sound; ends on a last frame.
const seedance15 = (o: VideoOptions, u: VideoUrls) => ({
	prompt: text(o),
	duration: String(seconds(o, { durations: range(4, 12) })),
	resolution: o.resolution || "720p",
	generate_audio: !!o.audio,
	...opt("aspect_ratio", o.aspect),
	...opt("seed", seedOf(o)),
	...opt("image_url", u.image),
	...opt("end_image_url", u.end),
});
// Seedance 2.0 (Fast, Mini): sound included in the price. fal bills tokens = h × w × s × 24 / 1024 at $0.0112 per 1,000 (Fast) or
// $0.007 (Mini): 720p is 21,600 tokens a second ($0.2419 and $0.1512, both printed on fal's pages), 480p is 864 × 496 px, 10,044
// tokens a second ($0.1125 and $0.0703).
const seedance2 = (o: VideoOptions, u: VideoUrls) => ({
	prompt: text(o),
	duration: String(seconds(o, { durations: range(4, 15) })),
	resolution: o.resolution || "720p",
	generate_audio: o.audio ?? true,
	...opt("aspect_ratio", o.aspect),
	...opt("image_url", u.image),
	...opt("end_image_url", u.end),
	...opt("image_urls", u.images),
});
// MiniMax H3: an integer duration 5–15; fal's default resolution is 2K, so it is always sent.
const h3 = (o: VideoOptions, u: VideoUrls) => ({
	prompt: text(o),
	duration: seconds(o, { durations: range(5, 15) }),
	resolution: o.resolution || "768P",
	...opt("aspect_ratio", o.aspect),
	...opt("seed", seedOf(o)),
	...opt("image_url", u.image),
	...opt("end_image_url", u.end),
	...opt("reference_image_urls", u.images),
});
// Kling 3.0 / 2.6: start_image_url, end_image_url; no seed.
const kling = (durations: number[]) => (o: VideoOptions, u: VideoUrls) => ({
	prompt: text(o),
	duration: String(seconds(o, { durations })),
	generate_audio: !!o.audio,
	...opt("negative_prompt", o.negative?.trim()),
	...opt("aspect_ratio", o.aspect),
	...opt("start_image_url", u.image),
	...opt("end_image_url", u.end),
	...opt("image_urls", u.images),
});
// Veo 3.1 Fast: «4s», first_frame_url / last_frame_url between two frames.
const veo = (o: VideoOptions, u: VideoUrls) => ({
	prompt: text(o),
	duration: `${seconds(o, { durations: [4, 6, 8] })}s`,
	resolution: o.resolution || "720p",
	generate_audio: !!o.audio,
	...opt("aspect_ratio", o.aspect),
	...opt("negative_prompt", o.negative?.trim()),
	...opt("seed", seedOf(o)),
	...(u.end ? { first_frame_url: u.image, last_frame_url: u.end } : opt("image_url", u.image)),
});
// Wan 2.6: «5» / «10» / «15».
const wan26 = (o: VideoOptions, u: VideoUrls) => ({
	prompt: text(o),
	duration: String(seconds(o, { durations: [5, 10, 15] })),
	resolution: o.resolution || "720p",
	...opt("aspect_ratio", o.aspect),
	...opt("negative_prompt", o.negative?.trim()),
	...opt("seed", seedOf(o)),
	...opt("image_url", u.image),
});
// Vidu Q4: sound is `audio` and costs nothing more.
const vidu = (o: VideoOptions, u: VideoUrls) => ({
	prompt: text(o),
	duration: seconds(o, { durations: range(3, 16) }),
	resolution: o.resolution || "720p",
	audio: o.audio ?? true,
	...opt("aspect_ratio", o.aspect),
	...opt("seed", seedOf(o)),
	...opt("reference_image_urls", u.images),
});
// Kling motion control: the photo's character does what the clip's person does.
const motion = (o: VideoOptions, u: VideoUrls) => ({
	image_url: u.image,
	video_url: u.video,
	character_orientation: o.orientation ?? "video",
	keep_original_sound: o.keepSound ?? true,
	...opt("prompt", text(o)),
});
// A photo + a sound → a talking / singing person.
const avatar = (o: VideoOptions, u: VideoUrls) => ({ image_url: u.image, audio_url: u.audio, ...opt("prompt", text(o)) });

const T2V = "text-to-video";
const I2V = "image-to-video";

export const VIDEO_MODELS: VideoModel[] = [
	// ── Text → video
	{ id: `fal-ai/bytedance/seedance/v1/pro/fast/${T2V}`, mode: "text", family: "seedance-1", title: "Seedance 1.0 Pro Fast", maker: "ByteDance", note: "The cheapest good clip, up to 1080p", rate: { "480p": 0.0097, "720p": 0.0216, "1080p": 0.0486 }, durations: range(2, 12), aspects: PORTRAIT, resolutions: ["720p", "480p", "1080p"], seed: true, build: seedance1 },
	{ id: "minimax/h3/text-to-video", mode: "text", family: "h3", title: "MiniMax H3", maker: "MiniMax", note: "Newest MiniMax: rich motion, up to 4K", rate: { "480P": 0.05, "768P": 0.06, "2K": 0.13, "4K": 0.16 }, durations: range(5, 15), aspects: PORTRAIT, resolutions: ["768P", "480P", "2K", "4K"], seed: true, build: h3 },
	{ id: `fal-ai/bytedance/seedance/v1.5/pro/${T2V}`, mode: "text", family: "seedance-15", title: "Seedance 1.5 Pro", maker: "ByteDance", note: "Cheap clips with their own sound", rate: { "480p": 0.0117, "720p": 0.0259, "1080p": 0.0583 }, soundRate: { "480p": 0.0233, "720p": 0.0518, "1080p": 0.1166 }, durations: range(4, 12), aspects: PORTRAIT, resolutions: ["720p", "480p", "1080p"], sound: { default: false }, seed: true, build: seedance15 },
	{ id: `fal-ai/kling-video/v3/standard/${T2V}`, mode: "text", family: "kling-3", title: "Kling 3.0 Standard", maker: "Kuaishou", note: "Smooth, cinematic motion, 3–15 s", rate: { "": 0.084 }, soundRate: { "": 0.126 }, durations: range(3, 15), aspects: KLING_SHAPES, sound: { default: false }, negative: true, build: kling(range(3, 15)) },
	{ id: "fal-ai/veo3.1/fast", mode: "text", family: "veo-31", title: "Veo 3.1 Fast", maker: "Google", note: "Google's video with speech and sound", rate: { "720p": 0.1, "1080p": 0.1, "4k": 0.3 }, soundRate: { "720p": 0.15, "1080p": 0.15, "4k": 0.35 }, durations: [4, 6, 8], aspects: ["9:16", "16:9"], resolutions: ["720p", "1080p", "4k"], sound: { default: false }, seed: true, negative: true, build: veo },
	{ id: `wan/v2.6/${T2V}`, mode: "text", family: "wan-26", title: "Wan 2.6", maker: "Alibaba", note: "Multi-shot stories up to 15 s", rate: { "720p": 0.1, "1080p": 0.15 }, durations: [5, 10, 15], aspects: WIDE5, resolutions: ["720p", "1080p"], seed: true, negative: true, maxPrompt: 1500, build: wan26 },
	{ id: `bytedance/seedance-2.0/fast/${T2V}`, mode: "text", family: "seedance-2", title: "Seedance 2.0 Fast", maker: "ByteDance", note: "ByteDance's best, with sound", rate: { "480p": 0.1125, "720p": 0.2419 }, durations: range(4, 15), aspects: PORTRAIT, resolutions: ["720p", "480p"], sound: { default: true }, build: seedance2 },

	// ── Image → video (the picture is the first frame)
	{ id: `fal-ai/bytedance/seedance/v1/pro/fast/${I2V}`, mode: "image", family: "seedance-1", title: "Seedance 1.0 Pro Fast", maker: "ByteDance", note: "The cheapest good clip, up to 1080p", rate: { "480p": 0.0097, "720p": 0.0216, "1080p": 0.0486 }, durations: range(2, 12), aspects: ["auto", ...PORTRAIT], resolutions: ["720p", "480p", "1080p"], seed: true, build: seedance1 },
	{ id: `minimax/h3/${I2V}`, mode: "image", family: "h3", title: "MiniMax H3", maker: "MiniMax", note: "Newest MiniMax: rich motion, up to 4K", rate: { "480P": 0.05, "768P": 0.06, "2K": 0.13, "4K": 0.16 }, durations: range(5, 15), resolutions: ["768P", "480P", "2K", "4K"], seed: true, build: h3 },
	{ id: `fal-ai/bytedance/seedance/v1.5/pro/${I2V}`, mode: "image", family: "seedance-15", title: "Seedance 1.5 Pro", maker: "ByteDance", note: "Cheap clips with their own sound", rate: { "480p": 0.0117, "720p": 0.0259, "1080p": 0.0583 }, soundRate: { "480p": 0.0233, "720p": 0.0518, "1080p": 0.1166 }, durations: range(4, 12), aspects: ["auto", ...PORTRAIT], resolutions: ["720p", "480p", "1080p"], sound: { default: false }, seed: true, build: seedance15 },
	{ id: `fal-ai/kling-video/v2.6/pro/${I2V}`, mode: "image", family: "kling-26", title: "Kling 2.6 Pro", maker: "Kuaishou", note: "Kling's cheapest Pro motion, 5 or 10 s", rate: { "": 0.07 }, soundRate: { "": 0.14 }, durations: [5, 10], sound: { default: false }, negative: true, build: kling([5, 10]) },
	{ id: `fal-ai/kling-video/v3/standard/${I2V}`, mode: "image", family: "kling-3", title: "Kling 3.0 Standard", maker: "Kuaishou", note: "Smooth, cinematic motion, 3–15 s", rate: { "": 0.084 }, soundRate: { "": 0.126 }, durations: range(3, 15), sound: { default: false }, negative: true, build: kling(range(3, 15)) },
	{ id: `fal-ai/kling-video/v3/pro/${I2V}`, mode: "image", family: "kling-3-pro", title: "Kling 3.0 Pro", maker: "Kuaishou", note: "Kling's finest detail", rate: { "": 0.112 }, soundRate: { "": 0.168 }, durations: range(3, 15), sound: { default: false }, negative: true, build: kling(range(3, 15)) },
	{ id: `fal-ai/veo3.1/fast/${I2V}`, mode: "image", family: "veo-31", title: "Veo 3.1 Fast", maker: "Google", note: "Google's video with speech and sound", rate: { "720p": 0.1, "1080p": 0.1, "4k": 0.3 }, soundRate: { "720p": 0.15, "1080p": 0.15, "4k": 0.35 }, durations: [4, 6, 8], aspects: ["auto", "9:16", "16:9"], resolutions: ["720p", "1080p", "4k"], sound: { default: false }, seed: true, negative: true, build: veo },
	{ id: `wan/v2.6/${I2V}`, mode: "image", family: "wan-26", title: "Wan 2.6", maker: "Alibaba", note: "Multi-shot stories up to 15 s", rate: { "720p": 0.1, "1080p": 0.15 }, durations: [5, 10, 15], resolutions: ["720p", "1080p"], seed: true, negative: true, maxPrompt: 1500, build: wan26 },
	{ id: `bytedance/seedance-2.0/fast/${I2V}`, mode: "image", family: "seedance-2", title: "Seedance 2.0 Fast", maker: "ByteDance", note: "ByteDance's best, with sound", rate: { "480p": 0.1125, "720p": 0.2419 }, durations: range(4, 15), aspects: ["auto", ...PORTRAIT], resolutions: ["720p", "480p"], sound: { default: true }, build: seedance2 },

	// ── First + last frame
	{ id: `fal-ai/bytedance/seedance/v1.5/pro/${I2V}#frames`, mode: "frames", family: "seedance-15", title: "Seedance 1.5 Pro", maker: "ByteDance", note: "Cheap clips with their own sound", rate: { "480p": 0.0117, "720p": 0.0259, "1080p": 0.0583 }, soundRate: { "480p": 0.0233, "720p": 0.0518, "1080p": 0.1166 }, durations: range(4, 12), aspects: ["auto", ...PORTRAIT], resolutions: ["720p", "480p", "1080p"], sound: { default: false }, seed: true, build: seedance15 },
	{ id: `minimax/h3/${I2V}#frames`, mode: "frames", family: "h3", title: "MiniMax H3", maker: "MiniMax", note: "Newest MiniMax: rich motion, up to 4K", rate: { "480P": 0.05, "768P": 0.06, "2K": 0.13, "4K": 0.16 }, durations: range(5, 15), resolutions: ["768P", "480P", "2K", "4K"], seed: true, build: h3 },
	{ id: `fal-ai/kling-video/v2.6/pro/${I2V}#frames`, mode: "frames", family: "kling-26", title: "Kling 2.6 Pro", maker: "Kuaishou", note: "Kling's cheapest Pro motion, 5 or 10 s", rate: { "": 0.07 }, soundRate: { "": 0.14 }, durations: [5, 10], sound: { default: false }, negative: true, build: kling([5, 10]) },
	{ id: `fal-ai/kling-video/v3/standard/${I2V}#frames`, mode: "frames", family: "kling-3", title: "Kling 3.0 Standard", maker: "Kuaishou", note: "Smooth, cinematic motion, 3–15 s", rate: { "": 0.084 }, soundRate: { "": 0.126 }, durations: range(3, 15), sound: { default: false }, negative: true, build: kling(range(3, 15)) },
	{ id: "fal-ai/veo3.1/fast/first-last-frame-to-video", mode: "frames", family: "veo-31", title: "Veo 3.1 Fast", maker: "Google", note: "Google's video with speech and sound", rate: { "720p": 0.1, "1080p": 0.1, "4k": 0.3 }, soundRate: { "720p": 0.15, "1080p": 0.15, "4k": 0.35 }, durations: [4, 6, 8], aspects: ["auto", "9:16", "16:9"], resolutions: ["720p", "1080p", "4k"], sound: { default: false }, seed: true, negative: true, build: veo },
	{ id: `bytedance/seedance-2.0/fast/${I2V}#frames`, mode: "frames", family: "seedance-2", title: "Seedance 2.0 Fast", maker: "ByteDance", note: "ByteDance's best, with sound", rate: { "480p": 0.1125, "720p": 0.2419 }, durations: range(4, 15), aspects: ["auto", ...PORTRAIT], resolutions: ["720p", "480p"], sound: { default: true }, build: seedance2 },

	// ── Reference pictures → video (subjects, style)
	{ id: "minimax/h3/reference-to-video", mode: "reference", family: "h3", title: "MiniMax H3", maker: "MiniMax", note: "Up to 9 pictures; past 5, $0.08 each", rate: { "480P": 0.05, "768P": 0.06, "2K": 0.13, "4K": 0.16 }, extraImages: { free: 5, usd: 0.08 }, durations: range(5, 15), aspects: ["adaptive", ...PORTRAIT], resolutions: ["768P", "480P", "2K", "4K"], seed: true, maxImages: 9, refName: "Image {n}", build: h3 },
	{ id: "fal-ai/vidu/q4/reference-to-video", mode: "reference", family: "vidu-q4", title: "Vidu Q4", maker: "Vidu", note: "Up to 12 pictures, sound for free", rate: { "540p": 0.0315, "720p": 0.0665, "1080p": 0.084, "2K": 0.133, "4K": 0.273 }, durations: range(3, 16), aspects: WIDE5, resolutions: ["540p", "720p", "1080p", "2K", "4K"], sound: { default: true }, seed: true, maxImages: 12, refName: "[@reference_image_{n}]", maxPrompt: 5000, build: vidu },
	{ id: "fal-ai/kling-video/o3/standard/reference-to-video", mode: "reference", family: "kling-o3", title: "Kling O3 Standard", maker: "Kuaishou", note: "Up to 4 pictures, Kling's motion", rate: { "": 0.084 }, soundRate: { "": 0.112 }, durations: range(3, 15), aspects: KLING_SHAPES, sound: { default: false }, maxImages: 4, refName: "@Image{n}", build: kling(range(3, 15)) },
	{ id: "bytedance/seedance-2.0/mini/reference-to-video", mode: "reference", family: "seedance-2-mini", title: "Seedance 2.0 Mini", maker: "ByteDance", note: "Up to 9 pictures, with sound", rate: { "480p": 0.0703, "720p": 0.1512 }, durations: range(4, 15), aspects: ["auto", ...PORTRAIT], resolutions: ["720p", "480p"], sound: { default: true }, maxImages: 9, refName: "@Image{n}", build: seedance2 },

	// ── Motion control (a character photo + a clip whose motion it copies; billed by the clip's length)
	{ id: "fal-ai/kling-video/v2.6/standard/motion-control", mode: "motion", family: "kling-26-motion", title: "Kling 2.6 Motion Standard", maker: "Kuaishou", note: "Dances and gestures for cents", rate: { "": 0.07 }, orientation: true, keepSound: true, input: { maxAt: { image: 10, video: 30 } }, build: motion },
	{ id: "fal-ai/kling-video/v2.6/pro/motion-control", mode: "motion", family: "kling-26-motion-pro", title: "Kling 2.6 Motion Pro", maker: "Kuaishou", note: "Cleaner hands and faces", rate: { "": 0.112 }, orientation: true, keepSound: true, input: { maxAt: { image: 10, video: 30 } }, build: motion },
	{ id: "fal-ai/kling-video/v3/standard/motion-control", mode: "motion", family: "kling-3-motion", title: "Kling 3.0 Motion Standard", maker: "Kuaishou", note: "Newest Kling motion", rate: { "": 0.126 }, orientation: true, keepSound: true, input: { maxAt: { image: 10, video: 30 } }, build: motion },
	{ id: "fal-ai/kling-video/v3/pro/motion-control", mode: "motion", family: "kling-3-motion-pro", title: "Kling 3.0 Motion Pro", maker: "Kuaishou", note: "Kling's finest detail", rate: { "": 0.168 }, orientation: true, keepSound: true, input: { maxAt: { image: 10, video: 30 } }, build: motion },

	// ── Video → video (the clip changed by a description; billed by its length)
	{ id: "decart/lucy-restyle", mode: "edit", family: "lucy", title: "Lucy Restyle", maker: "Decart", note: "A new look for the whole clip, a cent a second", rate: { "": 0.01 }, seed: true, maxPrompt: 1500, build: (o, u) => ({ prompt: text(o), video_url: u.video, ...opt("seed", seedOf(o)) }) },
	{
		id: "fal-ai/wan/v2.7/edit-video",
		mode: "edit",
		family: "wan-27-edit",
		title: "Wan 2.7 Edit",
		maker: "Alibaba",
		note: "Change things in the clip, 2–10 s",
		rate: { "720p": 0.1, "1080p": 0.15 },
		resolutions: ["720p", "1080p"],
		seed: true,
		picture: true,
		keepSound: true,
		input: { min: 2, max: 10 },
		build: (o, u) => ({ prompt: text(o), video_url: u.video, resolution: o.resolution || "720p", audio_setting: (o.keepSound ?? true) ? "origin" : "auto", ...opt("reference_image_url", u.image), ...opt("seed", seedOf(o)) }),
	},
	{ id: "fal-ai/kling-video/o3/standard/video-to-video/edit", mode: "edit", family: "kling-o3-edit", title: "Kling O3 Edit", maker: "Kuaishou", note: "Swap people, places and style, 3–15 s", rate: { "": 0.126 }, picture: true, keepSound: true, input: { min: 3, max: 15 }, build: (o, u) => ({ prompt: text(o), video_url: u.video, keep_audio: o.keepSound ?? true, ...opt("image_urls", u.image ? [u.image] : undefined) }) },

	// ── Avatar (a photo + a sound; billed by the sound's length)
	{ id: "fal-ai/kling-video/ai-avatar/v2/standard", mode: "avatar", family: "kling-avatar", title: "Kling AI Avatar 2", maker: "Kuaishou", note: "Talking heads for cents", rate: { "": 0.0562 }, build: avatar },
	{ id: "fal-ai/kling-video/ai-avatar/v2/pro", mode: "avatar", family: "kling-avatar-pro", title: "Kling AI Avatar 2 Pro", maker: "Kuaishou", note: "Sharper faces and hands", rate: { "": 0.115 }, build: avatar },
	{ id: "bytedance/omnihuman/v2", mode: "avatar", family: "omnihuman-2", title: "OmniHuman 2", maker: "ByteDance", note: "Whole-body acting and singing, up to 5 min", rate: { "": 0.105 }, input: { min: 4, max: 300 }, build: avatar },
	{ id: "fal-ai/bytedance/omnihuman/v1.5", mode: "avatar", family: "omnihuman-15", title: "OmniHuman 1.5", maker: "ByteDance", note: "Expressive faces; 1080p up to 30 s", rate: { "720p": 0.16, "1080p": 0.16 }, resolutions: ["720p", "1080p"], input: { maxAt: { "720p": 60, "1080p": 30 } }, build: (o, u) => ({ ...avatar(o, u), resolution: o.resolution || "720p" }) },
	{ id: "veed/fabric-1.0", mode: "avatar", family: "fabric", title: "VEED Fabric 1.0", maker: "VEED", note: "Any picture talks, 480p for less", rate: { "480p": 0.08, "720p": 0.15 }, resolutions: ["480p", "720p"], noPrompt: true, build: (o, u) => ({ image_url: u.image, audio_url: u.audio, resolution: o.resolution || "480p" }) },
];

/** The cheap, good model each mode starts with. */
export const VIDEO_DEFAULTS: Record<SharedMode, string> = {
	text: `fal-ai/bytedance/seedance/v1/pro/fast/${T2V}`,
	image: `fal-ai/bytedance/seedance/v1/pro/fast/${I2V}`,
	frames: `fal-ai/bytedance/seedance/v1.5/pro/${I2V}#frames`,
	// (check-flow M2, 06.11: MiniMax H3 at $0.30 per 5 s was the dear exception among the modes' defaults; Vidu Q4 540p is $0.16)
	reference: "fal-ai/vidu/q4/reference-to-video",
	motion: "fal-ai/kling-video/v2.6/standard/motion-control",
	edit: "decart/lucy-restyle",
	avatar: "fal-ai/kling-video/ai-avatar/v2/standard",
};

/** The APIs a model can run on. A model's own `api` decides where its job goes. */
export type AiApi = "fal" | "kie" | "argo";
const APIS: AiApi[] = ["fal", "kie", "argo"];
/** Which APIs have a key (the page before its first answer: not known, so everything is on offer). */
export interface Keys {
	fal: boolean;
	kie: boolean;
	argo?: boolean;
}
/** The APIs whose models are listed: those with a key; no key at all (or not known yet): all, with the prompt to add one. */
export const onOffer = (keys?: Keys): AiApi[] => {
	const on = keys ? APIS.filter((a) => keys[a]) : [];
	return on.length ? on : APIS;
};
/** More than one API has a key: the rows say which one they run on. */
export const manyKeys = (keys?: Keys): boolean => !!keys && [keys.fal, keys.kie, !!keys.argo].filter(Boolean).length > 1;
const ALL_MODELS = [...VIDEO_MODELS, ...KIE_VIDEO_MODELS, ...ARGO_VIDEO_MODELS];
const CATALOG: Record<AiApi, VideoModel[]> = { fal: VIDEO_MODELS, kie: KIE_VIDEO_MODELS, argo: ARGO_VIDEO_MODELS };
export const videoCatalog = (keys?: Keys) => onOffer(keys).flatMap((a) => CATALOG[a]);
/** Each mode's starting model: fal's cheap one when fal is on offer, else kie's, else ArgoLink's. */
export const videoDefaultsOf = (keys?: Keys): Partial<Record<VideoMode, string>> => {
	const on = onOffer(keys);
	return { ...(on.includes("argo") ? ARGO_VIDEO_DEFAULTS : {}), ...(on.includes("kie") ? KIE_VIDEO_DEFAULTS : {}), ...(on.includes("fal") ? VIDEO_DEFAULTS : {}) };
};
/** The tabs of the AI video form: the modes the APIs with a key have models for (Extend is kie.ai's alone). */
export const videoModes = (keys?: Keys): { id: VideoMode; label: string; note: string }[] => {
	const have = new Set(videoCatalog(keys).map((m) => m.mode));
	return [...VIDEO_MODES, ...(keys?.kie ? KIE_ONLY_MODES : [])].filter((m) => have.has(m.id));
};
export const videoModelsFor = (mode: VideoMode, keys?: Keys) => videoCatalog(keys).filter((m) => m.mode === mode);
export const videoModel = (id: string | undefined): VideoModel | undefined => ALL_MODELS.find((m) => m.id === id);
/** The fal endpoint a catalog entry calls (the same endpoint can serve two modes: «…#frames»). */
export const endpointOf = (m: VideoModel) => m.id.split("#")[0];
/** The same model in another mode (the agent's text model given a start picture). */
export const inMode = (m: VideoModel, mode: VideoMode) => (m.mode === mode ? m : ALL_MODELS.find((x) => x.family === m.family && x.mode === mode));
export const isVideoMode = (v: unknown): v is VideoMode => VIDEO_MODES.some((m) => m.id === v) || KIE_ONLY_MODES.some((m) => m.id === v);
/** Whether the model reads a description (what the page shows is what fal gets: Fabric's typed prompt was dropped). */
export const takesPrompt = (m: Pick<VideoModel, "noPrompt">) => !m.noPrompt;
/** The catalog's name of a model by its id or its fal endpoint (a job card showed «fal-ai/bytedance/…/text-to-video»). */
export function videoModelTitle(id: string | undefined): string | undefined {
	if (!id) return undefined;
	return (videoModel(id) ?? ALL_MODELS.find((m) => endpointOf(m) === id))?.title;
}

// ───────────────────────── defaults and price ─────────────────────────

export function defaultDuration(m: Pick<VideoModel, "durations">): number {
	const d = m.durations ?? [];
	if (!d.length) return 5;
	if (d.includes(5)) return 5;
	return d.reduce((a, b) => (Math.abs(b - 5) < Math.abs(a - 5) || (Math.abs(b - 5) === Math.abs(a - 5) && b < a) ? b : a));
}

/** Where a model starts: the project's shape (or the picture's own), 5 s, the cheap resolution, its sound default. */
export function videoDefaults(m: VideoModel, portrait = true): VideoOptions {
	const aspects = m.aspects ?? [];
	const follow = aspects.find((a) => a === "auto" || a === "adaptive");
	const shape = portrait ? "9:16" : "16:9";
	const pictureLed = m.mode === "image" || m.mode === "frames";
	return {
		duration: m.durations ? defaultDuration(m) : undefined,
		aspect: aspects.length ? (pictureLed && follow ? follow : aspects.includes(shape) ? shape : (follow ?? aspects[0])) : undefined,
		resolution: m.resolutions?.[0],
		audio: m.sound?.default ?? false,
		orientation: m.orientation ? "video" : undefined,
		keepSound: m.keepSound ? true : undefined,
	};
}

/** The longest clip / sound a model takes now (motion: by orientation; OmniHuman 1.5: by resolution). */
export function inputMax(m: VideoModel, o: VideoOptions): number | undefined {
	const at = m.input?.maxAt;
	if (at) return at[(m.orientation ? (o.orientation ?? "video") : (o.resolution ?? m.resolutions?.[0])) ?? ""] ?? m.input?.max;
	return m.input?.max;
}

/** Only what this model takes: a shape, length or resolution it doesn't offer falls back to its default. */
export function cleanVideoOptions(m: VideoModel, o: VideoOptions): VideoOptions {
	const d = videoDefaults(m);
	const pick = <T>(value: T | undefined, list: T[] | undefined, fallback: T | undefined) => (list?.length ? (value !== undefined && list.includes(value) ? value : fallback) : undefined);
	return {
		prompt: takesPrompt(m) ? o.prompt : undefined,
		duration: pick(o.duration, m.durations, d.duration),
		aspect: pick(o.aspect, m.aspects, d.aspect),
		resolution: pick(o.resolution, m.resolutions, d.resolution),
		audio: m.sound ? (o.audio ?? m.sound.default) : undefined,
		seed: m.seed ? seedOf(o) : undefined,
		negative: m.negative ? o.negative?.trim() || undefined : undefined,
		orientation: m.orientation ? (o.orientation === "image" ? "image" : "video") : undefined,
		keepSound: m.keepSound ? (o.keepSound ?? true) : undefined,
		inputSeconds: o.inputSeconds,
		images: o.images,
	};
}

/** Only the inputs this mode sends (a photo picked for Motion isn't a start frame for Text). */
function urlsFor(m: VideoModel, u: VideoUrls): VideoUrls {
	switch (m.mode) {
		case "text":
			return {};
		case "image":
			return { image: u.image };
		case "frames":
			return { image: u.image, end: u.end };
		case "reference":
			return { images: u.images };
		case "motion":
			return { image: u.image, video: u.video };
		case "edit":
			return { video: u.video, image: m.picture ? u.image : undefined };
		case "extend":
			return { video: u.video };
		case "avatar":
			return { image: u.image, audio: u.audio };
	}
}

/** The exact input fal gets (fields from each model's API page). */
export const videoInput = (m: VideoModel, o: VideoOptions, u: VideoUrls) => m.build(cleanVideoOptions(m, o), urlsFor(m, u));

/** True when the clip's length comes from the input (motion, edit, avatar), not from a duration picked here. */
export const lengthFromInput = (mode: VideoMode) => mode === "motion" || mode === "edit" || mode === "avatar";

/**
 * US dollars per second of video with these settings. A per-clip model (`priceOf`: Veo, Wan 2.6, Hailuo on kie) has no rate of its
 * own: its clip's price over the clip's seconds, so a list in this one unit puts it where it really belongs (Veo's $0.30 clip is
 * $0.075/s at 4 s and $0.0375/s at 8 s).
 */
export function videoRate(m: VideoModel, o: VideoOptions = {}): number {
	if (m.priceOf) {
		const clean = cleanVideoOptions(m, o);
		return m.priceOf(clean) / Math.max(1, videoSeconds(m, clean));
	}
	const table = o.audio && m.soundRate ? m.soundRate : m.rate;
	const res = o.resolution && o.resolution in table ? o.resolution : (m.resolutions?.find((r) => r in table) ?? "");
	return table[res] ?? table[""] ?? Object.values(table)[0] ?? 0;
}

/** Seconds fal bills: the length asked for, or the clip's / sound's own (whole seconds, up to what the model takes). */
export function videoSeconds(m: VideoModel, o: VideoOptions = {}): number {
	if (lengthFromInput(m.mode)) {
		// Whole seconds; a few hundredths over (an encoder's padding) don't make another second.
		const s = Math.max(1, Math.ceil((o.inputSeconds ?? 5) - 0.1));
		const max = inputMax(m, o);
		return max ? Math.min(s, max) : s;
	}
	if (m.clipSeconds) return m.clipSeconds(o);
	const d = o.duration ?? defaultDuration(m);
	return m.durations?.length && !m.durations.includes(d) ? defaultDuration(m) : d;
}

/** The price of one run in US dollars (fal's list price; the bill on fal.ai is the exact one). */
export function videoPrice(m: VideoModel, raw: VideoOptions = {}): number {
	const o = cleanVideoOptions(m, raw);
	if (m.priceOf) return m.priceOf(o);
	const extra = m.extraImages ? Math.max(0, (o.images ?? 0) - m.extraImages.free) * m.extraImages.usd : 0;
	return Math.round((videoRate(m, o) * videoSeconds(m, o) + extra) * 10000) / 10000;
}

// ───────────────────────── what is missing ─────────────────────────

/** An English sentence for the page (t() with `vars`) and the server's error, or null when the run can start. */
export type VideoProblem = { text: string; vars?: Record<string, string | number> } | null;

export function videoProblem(m: VideoModel, o: VideoOptions, have: VideoHave): VideoProblem {
	const prompt = takesPrompt(m) ? text(o) : "";
	const promptOptional = m.mode === "motion" || m.mode === "avatar" || !takesPrompt(m);
	const max = m.maxPrompt ?? 2000;
	if (prompt.length > max) return { text: "The description is too long for {model}: {n} characters, {max} at most.", vars: { model: m.title, n: prompt.length, max } };
	switch (m.mode) {
		case "image":
			if (!have.image) return { text: "Pick the start frame." };
			break;
		case "frames":
			if (!have.image || !have.end) return { text: "Pick the first and the last frame." };
			break;
		case "reference":
			if (!have.images) return { text: "Pick at least one reference picture." };
			if (m.maxImages && have.images > m.maxImages) return { text: "{model} takes {n} pictures at most.", vars: { model: m.title, n: m.maxImages } };
			break;
		case "motion":
			if (!have.image) return { text: "Pick the photo of the character." };
			if (!have.video) return { text: "Pick the clip with the motion." };
			break;
		case "edit":
			if (!have.video) return { text: "Pick the clip to change." };
			break;
		case "extend":
			if (!have.video) return { text: "Pick the clip to continue." };
			// kie asks for at least 3 characters here.
			if (prompt.length < 3) return { text: "Describe what happens next." };
			break;
		case "avatar":
			if (!have.image) return { text: "Pick the photo of the person." };
			if (!have.audio) return { text: "Pick the sound." };
			break;
	}
	if (!promptOptional && !prompt) return { text: m.mode === "edit" ? "Describe what to change." : "Describe what happens in the shot." };
	if (lengthFromInput(m.mode) && o.inputSeconds !== undefined) {
		const top = inputMax(m, o);
		const what = m.mode === "avatar" ? "sound" : "clip";
		if (top && o.inputSeconds > top + 0.1) return { text: what === "sound" ? "The sound is {s} s long; {model} takes {max} s at most. Pick a shorter one." : "The clip is {s} s long; {model} takes {max} s at most. Trim it on the timeline and pick the selected clip.", vars: { s: Math.round(o.inputSeconds * 10) / 10, model: m.title, max: top } };
		if (m.input?.min && o.inputSeconds < m.input.min - 0.05) return { text: "{model} needs at least {min} s.", vars: { model: m.title, min: m.input.min } };
	}
	return null;
}

/** «$0.06/s × 5 s» with the dollars formatted by the caller. */
export function priceParts(m: VideoModel, raw: VideoOptions): { rate: number; seconds: number; extra: number; total: number } {
	const o = cleanVideoOptions(m, raw);
	const extra = m.extraImages ? Math.max(0, (o.images ?? 0) - m.extraImages.free) * m.extraImages.usd : 0;
	return { rate: videoRate(m, o), seconds: videoSeconds(m, o), extra, total: videoPrice(m, o) };
}
