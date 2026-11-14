// The lipsync models (fal.ai, src/fal/models.ts), length rules and number formatting shared by the panel and the server.
import { FAL_DEFAULTS, falModel, modelsFor } from "@/fal/models";

/** A fal lipsync endpoint id («fal-ai/latentsync»…). */
export type LipsyncModelId = string;

/** The lipsync model as the panel and the pre-flight use it. */
export interface LipsyncModel {
	id: LipsyncModelId;
	title: string;
	note: string;
	/** Frame rate the video is re-encoded to before the lipsync (none: the clip's own). */
	fps?: number;
	/** What the model does when the speech is longer than the video. */
	whenLonger: string;
	/** Typical processing time for a 10 s clip. */
	typical: string;
}

const TYPICAL: Record<string, string> = { "fal-ai/latentsync": "~1 min", "fal-ai/sync-lipsync": "~1 min", "fal-ai/sync-lipsync/v2": "~1–2 min", "fal-ai/sync-lipsync/v2/pro": "~2–3 min", "fal-ai/kling-video/lipsync/audio-to-video": "~5 min", "volcengine/video-to-video-lip-sync": "~2–3 min" };

const asLipsync = (m: (ReturnType<typeof modelsFor>)[number]): LipsyncModel => ({
	id: m.id,
	title: m.title,
	note: m.note,
	whenLonger: m.id === "fal-ai/latentsync" ? "the video will loop" : "the speech is cut at the end of the video",
	typical: TYPICAL[m.id] ?? "~1–2 min",
});

export const LIPSYNC_MODELS: LipsyncModel[] = modelsFor("lipsync", { fal: true, kie: false }).map(asLipsync);
/** kie.ai's, for finding a model by its id (the list a window offers follows the keys). */
const KIE_LIPSYNC: LipsyncModel[] = modelsFor("lipsync", { fal: false, kie: true }).map(asLipsync);

export function getModel(id?: string): LipsyncModel {
	return LIPSYNC_MODELS.find((m) => m.id === id) ?? KIE_LIPSYNC.find((m) => m.id === id) ?? LIPSYNC_MODELS.find((m) => m.id === FAL_DEFAULTS.lipsync) ?? LIPSYNC_MODELS[0];
}

/** Seconds of held picture and silence sent after a lipsync piece, so a model that drops a piece's end drops only that
 * (LatentSync works in 16-frame chunks: up to 0.6 s, the last word, was lost). fal bills them; the result is cut back. */
export const LIPSYNC_TAIL_SECONDS = 0.8;

export const isLipsyncModel = (id: unknown): id is string => typeof id === "string" && falModel(id)?.task === "lipsync";

/** ~14 characters per second of Russian/English speech at speed 1.0. */
export function estimateSpeechSeconds(chars: number, speed: number): number {
	return Math.max(2, chars / 14 / Math.max(speed, 0.5));
}

/** What happens when speech and video lengths differ — shown before voicing (estimate) and before lipsync (exact). */
export function fitNote(speech: number, video: number, model: LipsyncModel): { text: string; warn: boolean } {
	const f = (n: number) => formatNumber(n, 1);
	if (speech > video + 0.4) {
		return {
			text: `Speech ≈ ${f(speech)} s, video ${f(video)} s → for the last ${f(speech - video)} s ${model.whenLonger}`,
			warn: true,
		};
	}
	if (speech < video - 0.4) {
		return {
			text: `Speech ≈ ${f(speech)} s, video ${f(video)} s → the video is trimmed to ${f(speech)} s`,
			warn: false,
		};
	}
	return { text: `Speech ≈ ${f(speech)} s fits the ${f(video)} s video`, warn: false };
}

// MARK: Number formatting

/** 6.6 · 1,234.5 */
export function formatNumber(v: number, digits = 1): string {
	return new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

/** 0:42 */
export function formatSeconds(s: number): string {
	const t = Math.max(0, Math.round(s));
	return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** "9 min 16 s" · "42 s" · "1 h 3 min". */
export function formatDuration(s: number): string {
	const t = Math.max(0, Math.round(s));
	const h = Math.floor(t / 3600);
	const m = Math.floor((t % 3600) / 60);
	const sec = t % 60;
	if (h) return `${h} h ${m} min`;
	if (m) return sec ? `${m} min ${sec} s` : `${m} min`;
	return `${sec} s`;
}

export const LANGUAGES = [
	{ id: "auto", title: "Auto" },
	{ id: "Russian", title: "Russian" },
	{ id: "English", title: "English" },
	{ id: "Ukrainian", title: "Ukrainian" },
	{ id: "Spanish", title: "Español" },
	{ id: "German", title: "Deutsch" },
	{ id: "French", title: "Français" },
	{ id: "Italian", title: "Italiano" },
	{ id: "Portuguese", title: "Português" },
	{ id: "Turkish", title: "Türkçe" },
];
