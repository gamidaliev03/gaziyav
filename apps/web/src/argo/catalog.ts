// ArgoLink's models as Gaziyav offers them. Each form and price is read from the model's own page
// (argolink.io/en/models/<id>, 06.11.2026): POST /v1/videos/generations with {model, prompt, duration, resolution,
// aspect_ratio, generate_audio, start_image, end_image, reference_images}; prices are US dollars per OUTPUT second without
// video input (the modes here send pictures only: reference pictures and sounds are free). Only the Seedance 2.0 family
// is here; ArgoLink's other models stay out until their pages are read the same way.
import type { VideoMode, VideoModel, VideoOptions, VideoUrls } from "../fal/video";

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const SHAPES = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
/** First-frame modes also take «adaptive» (the picture's own shape). */
const FIRST_FRAME_SHAPES = ["adaptive", ...SHAPES];

/** The model's request name: «argolink/seedance-2.0-mini#text» → «seedance-2.0-mini». */
export const argoModelName = (endpoint: string) => endpoint.replace(/^argolink\//, "").split("#")[0];

/** Dollars per output second by resolution, as each page prints them. */
export const ARGO_RATES: Record<string, Record<string, number>> = {
	"seedance-2.0-mini": { "480p": 0.0299, "720p": 0.0643 },
	"seedance-2.0-fast": { "480p": 0.0478, "720p": 0.103 },
	"seedance-2.0": { "480p": 0.0598, "720p": 0.129, "1080p": 0.318, "4k": 0.661 },
};

const text = (o: VideoOptions) => (o.prompt ?? "").trim();
const url = (u?: string) => (u ? { url: u } : undefined);
const seedance = (o: VideoOptions, u: VideoUrls) => ({
	prompt: text(o),
	duration: o.duration ?? 5,
	resolution: o.resolution || "720p",
	generate_audio: o.audio ?? true,
	...(o.aspect ? { aspect_ratio: o.aspect } : {}),
	// A start picture and a reference list are never sent together (the page refuses it).
	...(u.image ? { start_image: url(u.image) } : {}),
	...(u.end ? { end_image: url(u.end) } : {}),
	...(u.images?.length ? { reference_images: u.images.map((link) => ({ url: link })) } : {}),
});

const FAMILIES = {
	mini: { name: "seedance-2.0-mini", family: "a-seedance-2-mini", title: "Seedance 2.0 Mini", note: "The cheapest Seedance 2.0", resolutions: ["720p", "480p"] },
	fast: { name: "seedance-2.0-fast", family: "a-seedance-2-fast", title: "Seedance 2.0 Fast", note: "Seedance 2.0 at 480p and 720p, with sound", resolutions: ["720p", "480p"] },
	full: { name: "seedance-2.0", family: "a-seedance-2", title: "Seedance 2.0", note: "Full quality, up to 4K", resolutions: ["720p", "480p", "1080p", "4k"] },
};

const entry = (f: (typeof FAMILIES)[keyof typeof FAMILIES], m: VideoMode, over: Partial<VideoModel> = {}): VideoModel => ({
	id: `argolink/${f.name}#${m}`,
	api: "argo",
	mode: m,
	family: f.family,
	title: f.title,
	maker: "ByteDance",
	note: f.note,
	rate: ARGO_RATES[f.name],
	durations: range(4, 15),
	aspects: m === "image" || m === "frames" ? FIRST_FRAME_SHAPES : SHAPES,
	resolutions: f.resolutions,
	sound: { default: true },
	maxPrompt: 20000,
	build: seedance,
	...over,
});

export const ARGO_VIDEO_MODELS: VideoModel[] = (["mini", "fast", "full"] as const).flatMap((k) => {
	const f = FAMILIES[k];
	return [entry(f, "text"), entry(f, "image"), entry(f, "frames"), entry(f, "reference", { maxImages: 9, refName: "@Image {n}" })];
});

export const ARGO_VIDEO_DEFAULTS: Partial<Record<VideoMode, string>> = {
	text: "argolink/seedance-2.0-mini#text",
	image: "argolink/seedance-2.0-mini#image",
	frames: "argolink/seedance-2.0-mini#frames",
	reference: "argolink/seedance-2.0-mini#reference",
};
