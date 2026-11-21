// Every AI feature of Gaziyav runs on fal.ai with one key: the models each feature can use, what they cost and the
// default (cheap and good). Shared by the page (pickers, prices) and the server (the calls). Prices are each API's own
// list prices in US dollars, read from its own pages on 06.11.2026 (docs/PRICES.md; src/fal/__tests__/prices-read.json holds
// the table the unit tests hold these numbers against); with a key, Settings shows the live price from fal's pricing API.
import { ARGO_VIDEO_DEFAULTS, ARGO_VIDEO_MODELS } from "../argo/catalog";
import { KIE_IMAGES, KIE_VIDEO_MODELS } from "../kie/catalog";
import { type AiApi, type Keys, onOffer, VIDEO_MODELS, videoRate } from "./video";

export type { AiApi, Keys };

export type FalTask = "lipsync" | "tts" | "clone" | "image" | "video" | "faceswap" | "llm";

export const FAL_TASKS: { id: FalTask; title: string; note: string }[] = [
	{ id: "lipsync", title: "Lipsync", note: "New lips on a person in a clip, to any speech" },
	{ id: "tts", title: "Voice", note: "Text to speech: voice-overs, the dub, lipsync from text" },
	{ id: "image", title: "AI image", note: "Pictures from a description (and from reference pictures)" },
	{ id: "video", title: "AI video", note: "Clips from text, pictures, motion, an edited clip or a talking photo" },
	{ id: "faceswap", title: "Face swap", note: "Another face on the person in a clip or a photo" },
	{ id: "llm", title: "AI agent", note: "The editing agent, AI scripts, the dub's translation" },
];

/** How a model is billed: what one run of it costs is `price(...)` below. */
export type PriceUnit = "clip" | "second" | "5s" | "1k-chars" | "image" | "voice" | "minute" | "tokens";

export interface FalModel {
	/** fal's endpoint id (POST https://queue.fal.run/<id>). */
	id: string;
	task: FalTask;
	title: string;
	/** Who made it, as fal lists it. */
	maker: string;
	note: string;
	unit: PriceUnit;
	/** US dollars per unit (for "clip": the first `included` seconds). */
	usd: number;
	/** "clip": seconds the clip price covers; the rest is `extra` per second. */
	included?: number;
	extra?: number;
	/** Lipsync / swap: the longest source clip (seconds) the model takes. */
	maxSeconds?: number;
	minSeconds?: number;
	/** Video: the picture-to-video endpoint (`id` is the text-to-video one); `needsImage` = picture-to-video only. */
	i2v?: string;
	needsImage?: boolean;
	/** Runs on kie.ai or ArgoLink (absent: fal). */
	api?: "kie" | "argo";
	/** Pictures: reference pictures past `free` cost `usd` each on top of the price of the picture. */
	extraRefs?: { free: number; usd: number };
	/** Lipsync: what the model is for, as keys the page translates (the ladder; studio/server/lip-ladder.ts). */
	lipFor?: string[];
	/** Lipsync: the shortest side it takes, in pixels. */
	minSide?: number;
}

export const FAL_MODELS: FalModel[] = [
	// Lipsync (video + speech → the same video with new lips)
	{ id: "fal-ai/latentsync", task: "lipsync", title: "LatentSync", maker: "ByteDance", note: "ByteDance's open lipsync: good lips for cents", unit: "clip", usd: 0.2, included: 40, extra: 0.005, lipFor: ["draft", "frontal"] },
	{ id: "veed/lipsync", task: "lipsync", title: "VEED Lipsync", maker: "VEED", note: "Realistic and the cheapest per short piece", unit: "second", usd: 0.4 / 60, lipFor: ["sample", "short"] },
	{ id: "fal-ai/sync-lipsync", task: "lipsync", title: "Sync 1.9", maker: "Sync Labs", note: "Cheap per minute, older generation", unit: "second", usd: 0.7 / 60, lipFor: ["older"] },
	{ id: "fal-ai/sync-lipsync/v2", task: "lipsync", title: "Sync lipsync-2", maker: "Sync Labs", note: "The reference for real footage: head turns, close-ups", unit: "second", usd: 3 / 60, lipFor: ["real_footage", "head_turns", "close_ups"] },
	{ id: "fal-ai/sync-lipsync/v2/pro", task: "lipsync", title: "Sync lipsync-2 Pro", maker: "Sync Labs", note: "Best detail (teeth, beards), slowest", unit: "second", usd: 5 / 60, lipFor: ["detail", "teeth", "occlusion"] },
	{ id: "fal-ai/kling-video/lipsync/audio-to-video", task: "lipsync", title: "Kling LipSync", maker: "Kuaishou", note: "Short pieces only (2–10 s), billed per 5 s", unit: "5s", usd: 0.07, minSeconds: 2, maxSeconds: 10, minSide: 720, lipFor: ["short_only"] },
	// Voice (text → speech): Qwen3-TTS clones a voice from a sample for a fraction of a cent (the app's ready voices are
	// its own); MiniMax speaks in its voices, its clones cost $1.50 each
	{ id: "fal-ai/qwen-3-tts/text-to-speech/1.7b", task: "tts", title: "Qwen3 TTS 1.7B", maker: "Alibaba Qwen", note: "Your voice from any clip for under a cent, 10 languages", unit: "1k-chars", usd: 0.09 },
	{ id: "fal-ai/minimax/speech-2.8-turbo", task: "tts", title: "MiniMax Speech 2.8 Turbo", maker: "MiniMax", note: "Natural, fast, 40 languages", unit: "1k-chars", usd: 0.06 },
	{ id: "fal-ai/minimax/speech-2.8-hd", task: "tts", title: "MiniMax Speech 2.8 HD", maker: "MiniMax", note: "The richest MiniMax voice", unit: "1k-chars", usd: 0.1 },
	{ id: "fal-ai/minimax/speech-02-turbo", task: "tts", title: "MiniMax Speech-02 Turbo", maker: "MiniMax", note: "The previous generation, fast", unit: "1k-chars", usd: 0.06 },
	{ id: "fal-ai/minimax/speech-02-hd", task: "tts", title: "MiniMax Speech-02 HD", maker: "MiniMax", note: "The previous generation, studio quality", unit: "1k-chars", usd: 0.1 },
	// ElevenLabs' own voices through fal (fal's key, fal's bill; its voice is a name: Aria, Roger, Sarah…, 21.11 schema)
	{ id: "fal-ai/elevenlabs/tts/turbo-v2.5", task: "tts", title: "ElevenLabs Turbo v2.5", maker: "ElevenLabs", note: "ElevenLabs voices, fast, 32 languages", unit: "1k-chars", usd: 0.05 },
	{ id: "fal-ai/elevenlabs/tts/multilingual-v2", task: "tts", title: "ElevenLabs Multilingual v2", maker: "ElevenLabs", note: "ElevenLabs voices, the most natural, 29 languages", unit: "1k-chars", usd: 0.1 },
	{ id: "fal-ai/elevenlabs/tts/eleven-v3", task: "tts", title: "ElevenLabs v3", maker: "ElevenLabs", note: "ElevenLabs' most expressive model", unit: "1k-chars", usd: 0.1 },
	// Voice clone: made by the voice model's family (Qwen: a speaker embedding from the sample, MiniMax: a voice id)
	{ id: "fal-ai/qwen-3-tts/clone-voice/1.7b", task: "clone", title: "Qwen3 voice clone", maker: "Alibaba Qwen", note: "A voice from a sample: $0.0008 per minute of sample", unit: "minute", usd: 0.0008 },
	{ id: "fal-ai/minimax/voice-clone", task: "clone", title: "MiniMax Voice Clone", maker: "MiniMax", note: "Once per voice; reused for free afterwards", unit: "voice", usd: 1.5 },
	// Pictures
	{ id: "fal-ai/bytedance/seedream/v4/text-to-image", task: "image", title: "Seedream 4.0", maker: "ByteDance", note: "Sharp, true to the text, up to 4K", unit: "image", usd: 0.03 },
	{ id: "fal-ai/flux/schnell", task: "image", title: "FLUX.1 schnell", maker: "Black Forest Labs", note: "The cheapest: drafts and backgrounds", unit: "image", usd: 0.003 },
	{ id: "fal-ai/nano-banana", task: "image", title: "Nano Banana", maker: "Google", note: "Best at following reference pictures", unit: "image", usd: 0.0398 },
	// Video: the text models of every family (each mode's own models are in video.ts, Media → Generate → AI video)
	...VIDEO_MODELS.filter((v) => v.mode === "text").map((v): FalModel => ({ id: v.id, i2v: VIDEO_MODELS.find((x) => x.family === v.family && x.mode === "image")?.id, task: "video", title: v.title, maker: v.maker, note: v.note, unit: "second", usd: videoRate(v) })),
	// Face swap (video: the person in the clip; a photo: the face only)
	{ id: "fal-ai/pixverse/swap", task: "faceswap", title: "PixVerse Swap", maker: "PixVerse", note: "Person swap in a clip, 720p; pieces over 5 s cost double", unit: "5s", usd: 0.2, maxSeconds: 30 },
	// The agent's brain: any model of OpenRouter through fal (billed by tokens)
	{ id: "google/gemini-2.5-flash", task: "llm", title: "Gemini 2.5 Flash", maker: "Google", note: "Cheap and quick, calls tools well", unit: "tokens", usd: 0.3 },
	{ id: "anthropic/claude-sonnet-4.5", task: "llm", title: "Claude Sonnet 4.5", maker: "Anthropic", note: "The most careful editor", unit: "tokens", usd: 3 },
	{ id: "openai/gpt-5-mini", task: "llm", title: "GPT-5 mini", maker: "OpenAI", note: "Balanced price and quality", unit: "tokens", usd: 0.25 },
	{ id: "deepseek/deepseek-chat", task: "llm", title: "DeepSeek V3", maker: "DeepSeek", note: "Very cheap, good Russian", unit: "tokens", usd: 0.3 },
];

/** kie.ai's models of the same tasks, read from its model pages (src/kie/catalog.ts). */
export const KIE_MODELS: FalModel[] = [
	{ id: "volcengine/video-to-video-lip-sync", api: "kie", task: "lipsync", title: "ByteDance Lip Sync", maker: "Volcengine", note: "ByteDance's own lipsync; a started job can't be stopped", unit: "second", usd: 0.04, maxSeconds: 240, minSeconds: 1 },
	{ id: "elevenlabs/text-to-speech-turbo-2-5", api: "kie", task: "tts", title: "ElevenLabs Turbo 2.5", maker: "ElevenLabs", note: "Fast, natural", unit: "1k-chars", usd: 0.03 },
	{ id: "elevenlabs/text-to-speech-multilingual-v2", api: "kie", task: "tts", title: "ElevenLabs Multilingual 2", maker: "ElevenLabs", note: "The richest ElevenLabs voice", unit: "1k-chars", usd: 0.06 },
	...KIE_IMAGES.map((m): FalModel => ({ id: m.id, api: "kie", task: "image", title: m.title, maker: m.maker, note: m.note, unit: "image", usd: m.usd, ...(m.refFee ? { extraRefs: m.refFee } : {}) })),
	...KIE_VIDEO_MODELS.filter((v) => v.mode === "text").map((v): FalModel => ({ id: v.id, api: "kie", task: "video", title: v.title, maker: v.maker, note: v.note, unit: "second", usd: videoRate(v) })),
];

/** ArgoLink's models: the Seedance 2.0 family (src/argo/catalog.ts); it has no pictures, voices or lipsync here. */
export const ARGO_MODELS: FalModel[] = ARGO_VIDEO_MODELS.filter((v) => v.mode === "text").map((v): FalModel => ({ id: v.id, api: "argo", task: "video", title: v.title, maker: v.maker, note: v.note, unit: "second", usd: videoRate(v) }));
const ARGO_DEFAULTS: Partial<Record<FalTask, string>> = { video: ARGO_VIDEO_DEFAULTS.text };

const KIE_DEFAULTS: Partial<Record<FalTask, string>> = {
	lipsync: "volcengine/video-to-video-lip-sync",
	tts: "elevenlabs/text-to-speech-turbo-2-5",
	image: "bytedance/seedream-v4-text-to-image",
	video: "bytedance/seedance-2-mini#text",
};

/** What kie.ai doesn't offer runs on fal.ai whatever keys there are: voice clones and face swap; the agent's brain too. */
export const FAL_ONLY: FalTask[] = ["clone", "faceswap", "llm"];

/** The image-to-image endpoint used when a picture model gets reference pictures. */
export const IMAGE_EDIT: Record<string, string> = {
	"fal-ai/bytedance/seedream/v4/text-to-image": "fal-ai/bytedance/seedream/v4/edit",
	"fal-ai/nano-banana": "fal-ai/nano-banana/edit",
	"fal-ai/flux/schnell": "fal-ai/bytedance/seedream/v4/edit",
};

/** A photo face swap (the clip's face swap is PixVerse). */
export const PHOTO_SWAP = "fal-ai/face-swap";

export const FAL_DEFAULTS: Record<FalTask, string> = {
	lipsync: "fal-ai/latentsync",
	tts: "fal-ai/qwen-3-tts/text-to-speech/1.7b",
	clone: "fal-ai/qwen-3-tts/clone-voice/1.7b",
	image: "fal-ai/bytedance/seedream/v4/text-to-image",
	video: "fal-ai/bytedance/seedance/v1/pro/fast/text-to-video",
	faceswap: "fal-ai/pixverse/swap",
	llm: "google/gemini-2.5-flash",
};

/** The API a model runs on. */
export const apiOf = (m: Pick<FalModel, "api"> | undefined): AiApi => m?.api ?? "fal";

/** One comparable amount per task: a second of video, a picture, 1,000 characters, a 10 s piece (lipsync), 5 s (swap). */
const UNIT_AMOUNT: Partial<Record<FalTask, number>> = { video: 1, image: 1, tts: 1000, lipsync: 10, faceswap: 5, clone: 30 };

/** What a model costs for that amount: the number lists are sorted by. A price that isn't known is last (Infinity). */
export function comparable(m: FalModel, unitUsd = m.usd): number {
	const v = m.unit === "tokens" ? unitUsd : price(m, UNIT_AMOUNT[m.task] ?? 1, unitUsd);
	return v > 0 && Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
}

/** Cheapest first; the sort is stable, so equal prices keep the catalog's order (fal's before kie's). */
export const byPrice = <T,>(list: T[], of: (m: T) => number): T[] => [...list].sort((a, b) => of(a) - of(b) || 0);

/** The models of a task, from every API that has a key, in one list, cheapest first. No key at all: all of them. */
export function modelsFor(task: FalTask, keys?: Keys): FalModel[] {
	const all = [...FAL_MODELS, ...KIE_MODELS, ...ARGO_MODELS].filter((m) => m.task === task);
	const on = onOffer(keys);
	const list = all.filter((m) => on.includes(apiOf(m)));
	return byPrice(list.length ? list : all, (m) => comparable(m));
}
export const falModel = (id: string | undefined): FalModel | undefined => FAL_MODELS.find((m) => m.id === id) ?? KIE_MODELS.find((m) => m.id === id) ?? ARGO_MODELS.find((m) => m.id === id);

/** Qwen's voices and clones only work with Qwen's speech, MiniMax's with MiniMax's. */
export const isQwenVoice = (id: string) => id.includes("qwen-3-tts");
/** fal's ElevenLabs speech models: the voice is one of ElevenLabs' own, by name (fal/eleven-voices.ts). */
export const isElevenVoice = (id: string) => id.includes("elevenlabs/tts");
/** The ElevenLabs model a voice of fal's ElevenLabs list switches to when another speech model is picked. */
export const ELEVEN_DEFAULT = "fal-ai/elevenlabs/tts/multilingual-v2";

/** The pick saved for a task, when it is a model of that task (any API). */
function pickOf(task: FalTask, choices: Partial<Record<FalTask, string>> | undefined): FalModel | undefined {
	const pick = falModel(choices?.[task]);
	if (pick && pick.task === task) return pick;
	if (task === "llm" && choices?.llm && /^[\w.-]+\/[\w.:-]+$/.test(choices.llm)) {
		// Any OpenRouter model id typed by the user: billed by tokens, priced by fal.
		return { id: choices.llm, task: "llm", title: choices.llm, maker: choices.llm.split("/")[0], note: "", unit: "tokens", usd: 0 };
	}
	return undefined;
}

/**
 * The model a task uses: the pick (one per task, whichever API it is on), and the pick alone decides the API. A pick
 * whose API has no key (or no pick yet) gives the default of an API that has one, fal's first. The clone follows the
 * voice model's family (a Qwen embedding can't speak through MiniMax) and is fal's alone.
 */
export function chosenModel(task: FalTask, choices: Partial<Record<FalTask, string>> | undefined, keys?: Keys): FalModel {
	if (task === "clone") {
		// (ElevenLabs on fal makes no clones: a cloned voice speaks on Qwen there, as by default)
		const tts = chosenModel("tts", choices, { fal: true, kie: false }).id;
		const qwen = isQwenVoice(tts) || isElevenVoice(tts);
		return falModel(qwen ? "fal-ai/qwen-3-tts/clone-voice/1.7b" : "fal-ai/minimax/voice-clone") as FalModel;
	}
	const on = onOffer(keys);
	const pick = pickOf(task, choices);
	if (pick && (FAL_ONLY.includes(task) || on.includes(apiOf(pick)))) return pick;
	for (const api of on) {
		const fallback = falModel(api === "kie" ? KIE_DEFAULTS[task] : api === "argo" ? ARGO_DEFAULTS[task] : FAL_DEFAULTS[task]);
		if (fallback) return fallback;
	}
	return falModel(FAL_DEFAULTS[task]) as FalModel;
}

/** The speech model a cloned voice speaks with: fal's (kie.ai has no clones), whichever API the voice model is on. */
export const cloneTts = (choices: Partial<Record<FalTask, string>> | undefined): FalModel => {
	const m = chosenModel("tts", choices, { fal: true, kie: false, argo: false });
	return isElevenVoice(m.id) ? (falModel(FAL_DEFAULTS.tts) as FalModel) : m;
};

/** Whether fal's live price (its unit as fal names it) is the catalog's unit, so the one can stand in for the other. */
export function sameUnit(m: FalModel, unit: string): boolean {
	const u = unit.toLowerCase();
	if (m.unit === "second") return /second/.test(u);
	if (m.unit === "image") return /image|megapixel/.test(u) && m.id !== "fal-ai/flux/schnell";
	if (m.unit === "1k-chars") return /1000|thousand|1k/.test(u);
	return false;
}

/** The unit price a run is priced and billed by: fal's live price when it is known and in the same unit, else the catalog's. */
export function liveUnit(m: FalModel, live: { usd: number; unit: string } | undefined): number {
	return live && Number.isFinite(live.usd) && live.usd > 0 && sameUnit(m, live.unit) ? live.usd : m.usd;
}

/** What one run costs in dollars: `amount` is seconds (lipsync, swap, video), characters (voice) or pictures. */
export function price(m: FalModel, amount = 1, unitUsd = m.usd): number {
	switch (m.unit) {
		case "clip":
			return unitUsd + Math.max(0, Math.ceil(amount) - (m.included ?? 0)) * (m.extra ?? 0);
		case "second":
			return unitUsd * Math.max(1, amount);
		case "5s":
			if (m.task === "faceswap") return unitUsd * (amount > 5 ? 2 : 1);
			return unitUsd * Math.max(1, Math.ceil(amount / 5));
		case "1k-chars":
			return (unitUsd * Math.max(1, amount)) / 1000;
		case "image":
			return unitUsd * Math.max(1, amount);
		case "voice":
			return unitUsd;
		case "minute":
			return unitUsd * Math.max(1, Math.ceil(amount / 60));
		case "tokens":
			return 0;
	}
}

/** What the reference pictures add to a picture's price (Seedream 5.0 Pro on kie: the first is free, each next 0.5 credit). */
export const refsFee = (m: Pick<FalModel, "extraRefs">, pictures: number): number => (m.extraRefs ? Math.max(0, Math.round(pictures) - m.extraRefs.free) * m.extraRefs.usd : 0);

/** «$0.20 per clip up to 40 s, then $0.005/s» — the price as a line under the model's name. */
export function priceLine(m: FalModel, unitUsd = m.usd, t: (en: string, vars?: Record<string, string | number>) => string = (en, vars) => (vars ? en.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all)) : en)): string {
	const p = usd(unitUsd);
	switch (m.unit) {
		case "clip":
			return t("{p} per clip up to {s} s, then {e}/s", { p, s: m.included ?? 0, e: usd(m.extra ?? 0) });
		case "second":
			return t("{p}/s", { p });
		case "5s":
			return m.task === "faceswap" ? t("{p} per clip up to 5 s", { p }) : t("{p} per 5 s", { p });
		case "1k-chars":
			return t("{p} per 1,000 characters", { p });
		case "image":
			return t("{p} per picture", { p });
		case "voice":
			return t("{p} per voice", { p });
		case "minute":
			return t("{p} per minute", { p });
		case "tokens":
			return unitUsd ? t("{p} per 1M input tokens", { p }) : t("billed by tokens");
	}
}

/** A balance as a person reads it: whole cents ($25.39), never the four decimals an API reports. */
export const usdCents = (v: number): string => (Number.isFinite(v) ? `$${v.toFixed(2)}` : "$—");

/**
 * A price as it is charged: whole cents with two decimals ($0.20, $1.50), anything finer exactly, to the 0.0001 the APIs bill
 * (kie's credit is $0.005 and comes in tenths: $0.3775; fal's tokens: $0.2419/s; $0.0097/s). Never rounded to the cent, so
 * the number on a button and the number in the bill are the same.
 */
export function usd(v: number): string {
	if (!Number.isFinite(v)) return "$—";
	if (v === 0) return "$0";
	const cents = Math.round(v * 100);
	if (v >= 0.01 && Math.abs(v * 100 - cents) < 1e-6) return `$${(cents / 100).toFixed(2)}`;
	const exact = v.toFixed(v < 0.0001 ? 5 : 4).replace(/0+$/, "");
	return `$${(exact.split(".")[1] ?? "").length < 2 ? v.toFixed(2) : exact}`;
}

/** The ready voices (MiniMax system voices) offered by Voice, with the style words the pickers show. */
export const MINIMAX_VOICES: { id: string; name: string; tone: string }[] = [
	{ id: "Determined_Man", name: "Determined", tone: "Man · confident" },
	{ id: "Friendly_Person", name: "Friendly", tone: "Man · friendly" },
	{ id: "Patient_Man", name: "Patient", tone: "Man · calm" },
	{ id: "Casual_Guy", name: "Casual", tone: "Man · young" },
	{ id: "Deep_Voice_Man", name: "Deep", tone: "Man · deep" },
	{ id: "Elegant_Man", name: "Elegant", tone: "Man · smooth" },
	{ id: "Lively_Girl", name: "Lively", tone: "Woman · bright" },
	{ id: "Calm_Woman", name: "Calm", tone: "Woman · soft" },
	{ id: "Exuberant_Girl", name: "Exuberant", tone: "Woman · lively" },
	{ id: "Wise_Woman", name: "Wise", tone: "Woman · warm" },
	{ id: "Inspirational_girl", name: "Inspiring", tone: "Woman · upbeat" },
	{ id: "Sweet_Girl_2", name: "Sweet", tone: "Woman · gentle" },
];
