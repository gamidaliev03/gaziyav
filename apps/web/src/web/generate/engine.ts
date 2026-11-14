// AI image and AI video in the browser edition, on the visitor's own fal.ai key: what the Mac app's server does for
// /api/cloud (cloud/server.ts) — the catalog's models and prices, the price before anything runs, the job and its
// files — done inside the page with the browser's provider and job store (web/lipsync/provider.ts, park.ts).
// fal.ai's models only: the page holds one key. The catalogs and the request builders are the app's own
// (fal/models.ts, fal/video.ts, fal/wire.ts) — one list of models, one wire format for both editions; what is mirrored
// here from cloud/server.ts is only the thin part around them (the checks, the job).
import { chosenModel, type FalModel, falModel, modelsFor, price, refsFee } from "@/fal/models";
import {
	endpointOf,
	inMode,
	isVideoMode,
	type Keys,
	lengthFromInput,
	videoCatalog,
	videoDefaults,
	videoDefaultsOf,
	videoInput,
	type VideoMode,
	type VideoModel,
	videoModel,
	videoModelsFor,
	type VideoOptions,
	videoPrice,
	videoProblem,
	videoRate,
} from "@/fal/video";
import { imageInput } from "@/fal/wire";
import type { Park } from "../lipsync/park";
import type { Provider, QueuedRequest } from "../lipsync/provider";

export type Kind = "video" | "image" | "audio";

/** The page's one key is fal.ai's. */
const KEYS: Keys = { fal: true, kie: false, argo: false };

/** A model as the Generate tab lists it (cloud/server.ts CloudModel). */
export interface WebModel {
	id: string;
	kind: Kind;
	title: string;
	maker: string;
	usd: number;
	limits: {
		max_prompt_characters: number;
		max_reference_images: number;
		supported_aspect_ratios: string[];
		supported_durations_seconds?: number[];
		supported_qualities?: string[];
	};
	needsImage?: boolean;
	default?: boolean;
	api: "fal";
	mode?: VideoMode;
	family?: string;
}

/** One generation as the app's client asks for it (cloud/client.ts PointInput). */
export interface GenerateInput {
	kind: Kind;
	prompt: string;
	model: string;
	aspect_ratio?: string;
	duration_seconds?: number;
	quality?: string;
	image_asset_ids?: string[];
	reference_asset_ids?: string[];
	video_asset_ids?: string[];
	audio_asset_ids?: string[];
	reference_count?: number;
	mode?: VideoMode;
	end_image_asset_ids?: string[];
	generate_audio?: boolean;
	seed?: number;
	negative_prompt?: string;
	character_orientation?: "image" | "video";
	keep_sound?: boolean;
	reference_video_duration_seconds?: number;
	reference_audio_duration_seconds?: number;
}

export interface JobView {
	id: string;
	kind: Kind;
	model: string;
	state: "queued" | "running" | "succeeded" | "failed";
	progress: number;
	cost: number;
	error: string | null;
	files: { path: string; name: string; kind: Kind }[];
}

/** What went wrong, said to the person (the adapter answers it as the server's { error }). */
export class GenerateError extends Error {}

const IMAGE_SHAPES = ["9:16", "16:9", "1:1", "4:5", "3:4", "4:3"];
const VIDEO_SHAPES = ["9:16", "16:9", "1:1", "4:3", "3:4", "21:9"];

function view(m: FalModel): WebModel {
	const kind: Kind = m.task === "video" ? "video" : "image";
	const refs = m.id === "fal-ai/flux/schnell" ? 0 : kind === "video" ? 1 : m.id === "fal-ai/nano-banana" ? 3 : 6;
	return {
		id: m.id,
		kind,
		api: "fal",
		title: m.title,
		maker: m.maker,
		usd: m.usd,
		needsImage: m.needsImage,
		limits: {
			max_prompt_characters: kind === "video" ? 2000 : 4000,
			max_reference_images: refs,
			supported_aspect_ratios: m.needsImage ? [] : kind === "video" ? VIDEO_SHAPES : IMAGE_SHAPES,
			...(kind === "video" ? { supported_durations_seconds: [5, 10], supported_qualities: m.id.includes("seedance") ? ["720p", "1080p", "480p"] : [] } : {}),
		},
	};
}

function videoView(m: VideoModel): WebModel {
	const shapes = (m.aspects ?? []).filter((a) => a !== "auto" && a !== "adaptive");
	return {
		id: m.id,
		kind: "video",
		api: "fal",
		title: m.title,
		maker: m.maker,
		usd: videoRate(m, videoDefaults(m)),
		mode: m.mode,
		family: m.family,
		limits: {
			max_prompt_characters: m.maxPrompt ?? 2000,
			max_reference_images: m.mode === "reference" ? (m.maxImages ?? 1) : inMode(m, "image") ? 1 : 0,
			supported_aspect_ratios: shapes,
			supported_durations_seconds: m.durations ?? [],
			supported_qualities: m.resolutions ?? [],
		},
	};
}

/** The catalog's models of a kind (video: of a mode), the cheapest first, the starting one marked. */
export function models(kind: Kind, mode?: string): { models: WebModel[] } {
	if (kind === "audio") return { models: [] };
	if (kind === "video") {
		const all = videoCatalog(KEYS);
		const list = isVideoMode(mode) ? all.filter((m) => m.mode === mode) : all.filter((m) => m.mode === "text");
		const first = videoDefaultsOf(KEYS)[isVideoMode(mode) ? mode : "text"];
		const cheapest = (v: WebModel) => (v.usd > 0 ? v.usd : Number.POSITIVE_INFINITY);
		return { models: list.map((m) => ({ ...videoView(m), default: m.id === first })).sort((a, b) => cheapest(a) - cheapest(b)) };
	}
	const first = chosenModel("image", undefined, KEYS).id;
	return { models: modelsFor("image", KEYS).map((m) => ({ ...view(m), default: m.id === first })) };
}

/** The model a request names, for its mode (cloud/server.ts resolveVideoModel, fal.ai's catalog). */
export function resolveVideoModel(id: string, mode: VideoMode): { id: string; note?: string } | { error: string } {
	const list = videoModelsFor(mode, KEYS);
	const ids = () => list.slice(0, 24).map((m) => m.id).join(", ");
	const named = videoModel(id) ?? videoModel(`${id}#${mode}`) ?? videoCatalog(KEYS).find((m) => endpointOf(m) === id && m.mode === mode) ?? videoCatalog(KEYS).find((m) => endpointOf(m) === id);
	if (!named) return { error: `There is no video model «${id}». Models for ${mode}: ${ids()}` };
	const own = inMode(named, mode);
	if (!own) return { error: `${named.title} [${named.id}] has no ${mode} mode. Models for ${mode}: ${ids()}` };
	if (!list.some((m) => m.id === own.id)) return { error: `${own.title} [${own.id}] is not among the models of this page. Models for ${mode}: ${ids()}` };
	return own.id === named.id ? { id: own.id } : { id: own.id, note: `${named.id} is the ${named.mode} model of ${named.title}: used its ${mode} model ${own.id}` };
}

const first = (ids?: string[]) => (ids?.length ? ids[0] : undefined);
const pictures = (g: GenerateInput) => [...new Set([...(g.image_asset_ids ?? []), ...(g.reference_asset_ids ?? [])])];
const pictureCount = (g: GenerateInput) => pictures(g).length || Math.max(0, Math.round(Number(g.reference_count) || 0));

function imageModel(g: GenerateInput): FalModel {
	const m = falModel(g.model);
	if (!m || m.task !== "image" || (m.api ?? "fal") !== "fal") throw new GenerateError(`There is no image model «${g.model}». Pick one from the list.`);
	return m;
}

export interface EngineDeps {
	provider: Provider;
	park: Park;
	hasKey: () => boolean;
	/** Seconds of a clip or a sound (a reference's length sets a job's price). */
	seconds?: (blob: Blob) => Promise<number | undefined>;
	pollMs?: number;
	now?: () => number;
}

interface Ref {
	kind: Kind;
	seconds?: number;
	/** Its link on the provider's storage, once uploaded (kept for this visit: the provider's own links live for hours). */
	url?: string;
}

/** A job as it waits in this browser: the provider's request the moment it is known, so a reload follows it instead of paying again. */
interface Kept {
	view: JobView;
	req?: QueuedRequest;
	task: "image" | "video";
	prompt: string;
	expect: number;
	at: number;
}

const FACT = (id: string) => `gen:${id}`;
const REF = (id: string) => `gen-ref:${id}`;
const rand = () => Math.random().toString(36).slice(2, 8);

/** «prompt words — Model.ext», as the Mac app names a result (cloud/server.ts resultName). */
export function resultName(prompt: string, title: string, index: number, ext: string): string {
	const words = prompt.trim().split(/\s+/).slice(0, 6).join(" ").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 48);
	return `${words || "AI"} — ${title}${index ? ` ${index + 1}` : ""}.${ext}`;
}

export function createGenerator(d: EngineDeps) {
	const now = d.now ?? (() => Date.now());
	const pollMs = d.pollMs ?? 1500;
	const refs = new Map<string, Ref>();
	const live = new Map<string, { kept: Kept; abort: AbortController }>();

	async function refOf(id: string): Promise<Ref | undefined> {
		const hit = refs.get(id);
		if (hit) return hit;
		const stored = await d.park.getFact<Ref>(REF(id));
		if (stored) refs.set(id, { kind: stored.kind, seconds: stored.seconds });
		return refs.get(id);
	}

	/** The model, the settings and what was given, for a video request (cloud/server.ts videoRequest). */
	async function videoRequest(g: GenerateInput): Promise<{ model: VideoModel; options: VideoOptions; have: { image: boolean; end: boolean; images: number; video: boolean; audio: boolean } }> {
		const picked = videoModel(g.model);
		if (!picked || (picked.api ?? "fal") !== "fal") throw new GenerateError(`There is no video model «${g.model}». Pick one from the list.`);
		const given = g.reference_asset_ids ?? [];
		const mode: VideoMode = isVideoMode(g.mode) ? g.mode : picked.mode === "text" && g.image_asset_ids?.length ? "image" : picked.mode;
		const model = inMode(picked, mode);
		if (!model) throw new GenerateError(`${picked.title} doesn't make clips from a picture. Pick another model.`);
		const video = first(g.video_asset_ids);
		const audio = first(g.audio_asset_ids);
		const known = async (id: string | undefined) => (id ? (await refOf(id))?.seconds : undefined);
		const inputSeconds = lengthFromInput(model.mode) ? (model.mode === "avatar" ? ((await known(audio)) ?? g.reference_audio_duration_seconds) : ((await known(video)) ?? g.reference_video_duration_seconds)) : undefined;
		const options: VideoOptions = {
			prompt: g.prompt,
			duration: g.duration_seconds,
			aspect: g.aspect_ratio,
			resolution: g.quality,
			audio: g.generate_audio,
			seed: g.seed,
			negative: g.negative_prompt,
			orientation: g.character_orientation,
			keepSound: g.keep_sound,
			inputSeconds: inputSeconds !== undefined && Number.isFinite(Number(inputSeconds)) ? Number(inputSeconds) : undefined,
			images: model.mode === "reference" ? given.length || Math.max(0, Math.round(Number(g.reference_count) || 0)) : undefined,
		};
		const count = g.image_asset_ids?.length || (model.mode === "image" || model.mode === "frames" ? Math.min(1, Math.max(0, Math.round(Number(g.reference_count) || 0))) : 0);
		const have = {
			image: count > 0,
			end: !!g.end_image_asset_ids?.length,
			images: options.images ?? 0,
			video: !!video || g.reference_video_duration_seconds !== undefined,
			audio: !!audio || g.reference_audio_duration_seconds !== undefined,
		};
		return { model, options: { ...videoDefaults(model), ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) }, have };
	}

	/** Refuses what the model cannot do, in words — before anything is uploaded or paid (cloud/server.ts check). */
	async function check(g: GenerateInput): Promise<void> {
		if (g.kind === "audio") throw new GenerateError("Music generation isn't part of this app.");
		if (g.kind === "video") {
			const { model, options, have } = await videoRequest(g);
			const problem = videoProblem(model, options, have);
			if (problem) throw new GenerateError(problem.text.replace(/\{(\w+)\}/g, (all, k: string) => String(problem.vars?.[k] ?? all)));
			return;
		}
		if (!g.prompt?.trim()) throw new GenerateError("Describe what to generate.");
		const m = imageModel(g);
		const v = view(m);
		if (g.prompt.length > v.limits.max_prompt_characters) throw new GenerateError(`The description is too long for ${m.title}: ${g.prompt.length} characters, ${v.limits.max_prompt_characters} at most.`);
		const given = pictureCount(g);
		if (given > v.limits.max_reference_images) throw new GenerateError(v.limits.max_reference_images === 0 ? `${m.title} doesn't take reference pictures. Remove them or pick another model.` : `${m.title} takes ${v.limits.max_reference_images} reference pictures at most.`);
		if (m.needsImage && !given) throw new GenerateError(`${m.title} makes a clip from a picture: pick the start frame.`);
		if (g.video_asset_ids?.length || g.audio_asset_ids?.length) throw new GenerateError("These models don't take reference clips or sounds.");
	}

	/** The price in US dollars before anything is spent (fal's list price). */
	async function estimate(g: GenerateInput): Promise<{ cost: number }> {
		await check(g);
		if (g.kind === "video") {
			const { model, options } = await videoRequest(g);
			return { cost: videoPrice(model, options) };
		}
		const m = imageModel(g);
		return { cost: Math.round((price(m, 1) + refsFee(m, pictureCount(g))) * 1e6) / 1e6 };
	}

	/** A reference's link on the provider's storage: uploaded when the job that needs it starts, once a visit. */
	async function linkOf(id: string, signal?: AbortSignal): Promise<string | undefined> {
		const ref = await refOf(id);
		if (!ref) return undefined;
		if (ref.url) return ref.url;
		const file = await d.park.getFile(id);
		if (!file) return undefined;
		ref.url = await d.provider.upload(file.blob, file.name, signal);
		return ref.url;
	}

	async function buildRequest(g: GenerateInput, signal?: AbortSignal): Promise<{ endpoint: string; input: Record<string, unknown>; title: string; task: "image" | "video"; expect: number }> {
		const url = async (id: string | undefined, what: string) => {
			if (!id) return undefined;
			const link = await linkOf(id, signal);
			if (!link) throw new GenerateError(`The ${what} is no longer known. Pick it again.`);
			return link;
		};
		if (g.kind === "video") {
			const { model, options } = await videoRequest(g);
			const editPicture = model.mode === "edit" && !model.picture ? undefined : first(g.image_asset_ids);
			const urls = {
				image: await url(editPicture, "picture"),
				end: model.mode === "frames" ? await url(first(g.end_image_asset_ids), "last frame") : undefined,
				images: model.mode === "reference" ? ((await Promise.all((g.reference_asset_ids ?? []).map((id) => url(id, "reference picture")))) as string[]) : undefined,
				video: model.mode === "motion" || model.mode === "edit" || model.mode === "extend" ? await url(first(g.video_asset_ids), "clip") : undefined,
				audio: model.mode === "avatar" ? await url(first(g.audio_asset_ids), "sound") : undefined,
			};
			return { endpoint: endpointOf(model), input: videoInput(model, options, urls), title: model.title, task: "video", expect: model.mode === "avatar" || model.mode === "motion" ? 180 : 90 };
		}
		const m = imageModel(g);
		const links = (await Promise.all(pictures(g).map((id) => linkOf(id, signal)))).filter((u): u is string => !!u);
		if (links.length < pictures(g).length) throw new GenerateError("A reference picture is no longer known. Pick it again.");
		return { ...imageInput(m, g.prompt, g.aspect_ratio && IMAGE_SHAPES.includes(g.aspect_ratio) ? g.aspect_ratio : "9:16", links), title: m.title, task: "image", expect: 12 };
	}

	const keep = (kept: Kept) => d.park.putFact(FACT(kept.view.id), kept);

	/** Follows the provider's request to its end: the state the page shows, then the files, kept in this browser. */
	function follow(kept: Kept): void {
		const abort = new AbortController();
		live.set(kept.view.id, { kept, abort });
		const { view } = kept;
		void (async () => {
			try {
				const req = kept.req as QueuedRequest;
				const started = now();
				for (;;) {
					if (abort.signal.aborted) throw new DOMException("Cancelled", "AbortError");
					const status = await d.provider.status(req, abort.signal);
					if (status.state === "done") break;
					if (status.state === "failed") throw new GenerateError(status.refused ? "The provider's safety filter refused this request. Change the description or the picture." : status.error || "The provider could not finish this job. Press Retry.");
					if (status.state === "stopped") throw new GenerateError(`The provider stopped the job (${status.status}). Press Retry.`);
					view.state = status.state === "queued" ? "queued" : "running";
					// (the provider gives no percent: the bar follows the time such a job takes, and waits at 95)
					if (view.state === "running") view.progress = Math.min(95, Math.round(((now() - started) / 1000 / kept.expect) * 100));
					await new Promise((r) => setTimeout(r, pollMs));
				}
				const answer = await d.provider.answer<{ video?: { url?: string }; images?: Array<{ url?: string }>; image?: { url?: string } }>(req, abort.signal);
				const urls = kept.task === "video" ? [answer.video?.url] : [...(answer.images ?? []).map((x) => x.url), answer.image?.url];
				let index = 0;
				for (const url of urls) {
					if (!url) continue;
					const blob = await d.provider.download(url, abort.signal);
					const ext = (String(url).split("?")[0].match(/\.(mp4|mov|webm|png|jpe?g|webp)$/i)?.[1] ?? (kept.task === "video" ? "mp4" : "png")).toLowerCase();
					const name = resultName(kept.prompt, view.model, index, ext);
					await d.park.putFile({ id: `${view.id}-${index}`, name, type: blob.type || (kept.task === "video" ? "video/mp4" : `image/${ext === "jpg" ? "jpeg" : ext}`), blob, at: now() });
					view.files.push({ path: `${view.id}/${index}`, name, kind: view.kind });
					index++;
				}
				if (!view.files.length) throw new GenerateError("The provider finished without a file. Press Retry.");
				view.state = "succeeded";
				view.progress = 100;
			} catch (error) {
				view.state = "failed";
				view.error = (error as Error)?.name === "AbortError" ? "Cancelled" : error instanceof GenerateError ? error.message : (error as Error)?.message || "The generation failed. Press Retry.";
			} finally {
				live.delete(view.id);
				await keep(kept).catch(() => {});
			}
		})();
	}

	return {
		status: () => (d.hasKey() ? { connected: true as const, name: "fal.ai" } : { connected: false as const, error: "Paste your fal.ai key above: it stays in this browser." }),
		models,
		resolveVideoModel,
		estimate,

		/** A picture, a clip or a sound a generation will use: kept in this browser; uploaded when a job needs it. */
		async reference(blob: Blob, kind: Kind, name = "reference"): Promise<{ assetId: string; seconds?: number }> {
			const id = `ref-${now().toString(36)}-${rand()}`;
			const seconds = kind === "image" ? undefined : await d.seconds?.(blob).catch(() => undefined);
			await d.park.putFile({ id, name, type: blob.type || "application/octet-stream", blob, at: now() });
			const ref: Ref = { kind, ...(seconds ? { seconds } : {}) };
			refs.set(id, ref);
			await d.park.putFact(REF(id), ref);
			return { assetId: id, ...(seconds ? { seconds } : {}) };
		},

		async generate(g: GenerateInput): Promise<{ jobId: string; cost: number }> {
			if (!d.hasKey()) throw new GenerateError("Paste your fal.ai key above: it stays in this browser.");
			const { cost } = await estimate(g);
			const request = await buildRequest(g);
			const id = `gen-${now().toString(36)}-${rand()}`;
			const kept: Kept = { view: { id, kind: g.kind, model: request.title, state: "queued", progress: 0, cost, error: null, files: [] }, task: request.task, prompt: g.prompt ?? "", expect: request.expect, at: now() };
			// the paid request is written down the moment the provider names it: a reload follows it, never pays twice
			kept.req = await d.provider.submit(request.endpoint, request.input);
			await keep(kept);
			follow(kept);
			return { jobId: id, cost };
		},

		async job(id: string): Promise<JobView | null> {
			const running = live.get(id);
			if (running) return running.kept.view;
			const kept = await d.park.getFact<Kept>(FACT(id));
			if (!kept) return null;
			// a job this page lost sight of (a reload) and the provider still runs: followed again
			if ((kept.view.state === "queued" || kept.view.state === "running") && kept.req && d.hasKey()) {
				follow(kept);
				return kept.view;
			}
			return kept.view;
		},

		async cancel(id: string): Promise<boolean> {
			const running = live.get(id);
			if (!running) return false;
			running.abort.abort();
			if (running.kept.req) await d.provider.cancel(running.kept.req).catch(() => {});
			return true;
		},

		/** A finished file («<job>/<n>»). */
		async file(id: string, index: number): Promise<{ blob: Blob; name: string; type: string } | null> {
			const file = await d.park.getFile(`${id}-${index}`);
			return file ? { blob: file.blob, name: file.name, type: file.type } : null;
		},
	};
}

export type Generator = ReturnType<typeof createGenerator>;
