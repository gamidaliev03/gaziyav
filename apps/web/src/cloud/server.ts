// AI image and AI video on fal.ai (Media → Generate, the agent, the AI Composition's pictures): the catalog's models,
// their prices before anything runs, the jobs and their files. A job runs in this process (fal's queue behind it); its
// result is saved on this Mac at once (fal's links expire) and dragged from here like a file from Finder. Video has
// every mode of fal's generators (src/fal/video.ts): text, a start frame, first + last frame, reference pictures,
// motion control, an edited clip, a talking photo; its inputs (pictures, clips, sounds) are prepared on this Mac and
// uploaded to the API of the model that runs the job (kie.ai's to kie.ai, ArgoLink's to ArgoLink: never fal's storage).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type Provider, provider } from "@/ai/provider";
import { apiOf, type FalModel, falModel, modelsFor, price, refsFee } from "@/fal/models";
import { keysNow, modelFor } from "@/fal/server";
import { kieImage, kieImageEndpoint } from "@/kie/catalog";
import { imageInput } from "@/fal/wire";
import { type AiApi, endpointOf, inMode, isVideoMode, lengthFromInput, videoCatalog, videoDefaultsOf, type VideoMode, type VideoModel, videoModelsFor, type VideoOptions, videoDefaults, videoInput, videoModel, videoPrice, videoProblem, videoRate } from "@/fal/video";
import { CancelledError, StudioError } from "@/studio/server/errors";
import { probe } from "@/studio/server/media";
import { studioHome } from "@/studio/server/settings";
import { findTool, reason, run } from "@/studio/server/tools";
import { chosenProvider, runService } from "@/studio/server/providers/services";

export type Kind = "video" | "image" | "audio";

/** A model as the Generate tab lists it: its shapes, lengths, qualities, pictures and price. */
export interface CloudModel {
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
	/** The model a feature starts on (the list is cheapest first, so it is not the first row). */
	default?: boolean;
	/** The API the model runs on: a job goes there. */
	api: AiApi;
	/** Video: the mode and the model's family (the same model in other modes). */
	mode?: VideoMode;
	family?: string;
}

const IMAGE_SHAPES = ["9:16", "16:9", "1:1", "4:5", "3:4", "4:3"];
const VIDEO_SHAPES = ["9:16", "16:9", "1:1", "4:3", "3:4", "21:9"];

function view(m: FalModel): CloudModel {
	const kieMade = kieImage(m.id);
	// kie.ai's pictures: their own shapes and how many pictures they follow.
	if (kieMade) return { id: m.id, kind: "image", api: "kie", title: m.title, maker: m.maker, usd: m.usd, limits: { max_prompt_characters: 3000, max_reference_images: kieMade.maxRefs, supported_aspect_ratios: kieMade.shapes } };
	const kind: Kind = m.task === "video" ? "video" : "image";
	const refs = m.id === "fal-ai/flux/schnell" ? 0 : kind === "video" ? 1 : m.id === "fal-ai/nano-banana" ? 3 : 6;
	return {
		id: m.id,
		kind,
		api: apiOf(m),
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

export function status() {
	const on = (["fal", "kie", "argo"] as const).map(provider).filter((p) => p.hasKey());
	return on.length ? { connected: true as const, name: on.map((p) => p.label).join(" + ") } : { connected: false as const, error: "Add your fal.ai, kie.ai or ArgoLink key in Settings → AI." };
}

/** A video model as the agent's list shows it: the text endpoint of each family (a start picture runs its picture one). */
function videoView(m: VideoModel): CloudModel {
	const shapes = (m.aspects ?? []).filter((a) => a !== "auto" && a !== "adaptive");
	return {
		id: m.id,
		kind: "video",
		api: apiOf(m),
		title: m.title,
		maker: m.maker,
		// US dollars per SECOND of video at the model's own start settings (the list is sorted by it, and the agent's tool and the
		// pickers print it as «$/s»). It was videoPrice(m, { duration: 1 }), which is the whole default clip (5 s, Veo 4 s) for
		// nearly every model and one second for PixVerse, so the list was cheapest-first in three different units.
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

/**
 * The model a request names, for its mode — the one resolver of generate and price_plan (B4/A20/C9: 38 of 106 of Claude's
 * videos named a text model with mode image and silently got the mode's default instead). The id itself when it does this
 * mode (a kie.ai id without its «#mode» too); the same family's model of this mode when it is another mode's id, with the
 * line that says so; otherwise a refusal naming this mode's models — before anything is uploaded or paid.
 */
export function resolveVideoModel(id: string, mode: VideoMode): { id: string; note?: string } | { error: string } {
	const keys = keysNow();
	const list = videoModelsFor(mode, keys);
	const ids = () => list.slice(0, 24).map((m) => m.id).join(", ");
	const named = videoModel(id) ?? videoModel(`${id}#${mode}`) ?? videoCatalog().find((m) => endpointOf(m) === id && m.mode === mode) ?? videoCatalog().find((m) => endpointOf(m) === id);
	if (!named) return { error: `There is no video model «${id}». Models for ${mode}: ${ids()}` };
	const own = inMode(named, mode);
	if (!own) return { error: `${named.title} [${named.id}] has no ${mode} mode. Models for ${mode}: ${ids()}` };
	if (!list.some((m) => m.id === own.id)) return { error: `${own.title} [${own.id}] runs on ${provider(own.api).label}, which has no key here. Models for ${mode}: ${ids()}` };
	if (own.id === named.id) return { id: own.id };
	const takes: Record<VideoMode, string> = { text: "a description only", image: "a start frame", frames: "a first and a last frame", reference: "reference pictures", motion: "a photo and a motion clip", edit: "a clip to change", avatar: "a photo and a sound", extend: "a clip to continue" };
	return { id: own.id, note: `${named.id} is the ${named.mode} model of ${named.title}; this call gives ${takes[mode]}: used its ${mode} model ${own.id}` };
}

export function models(kind: Kind, mode?: string) {
	if (kind === "audio") return { models: [] };
	// Every API with a key, in one list; the model picked decides where the job goes.
	const keys = keysNow();
	if (kind === "video") {
		const all = videoCatalog(keys);
		const list = isVideoMode(mode) ? all.filter((m) => m.mode === mode) : all.filter((m) => m.mode === "text");
		const first = videoDefaultsOf(keys)[isVideoMode(mode) ? mode : "text"];
		const cheapest = (v: CloudModel) => (v.usd > 0 ? v.usd : Number.POSITIVE_INFINITY);
		return { models: list.map((m) => ({ ...videoView(m), default: m.id === first })).sort((a, b) => cheapest(a) - cheapest(b)) };
	}
	// modelsFor lists cheapest first.
	const first = modelFor("image").id;
	return { models: modelsFor("image", keys).map((m) => ({ ...view(m), default: m.id === first })) };
}

export interface GenerateInput {
	kind: Kind;
	prompt: string;
	model: string;
	aspect_ratio?: string;
	duration_seconds?: number;
	quality?: string;
	/** Pictures (uploadReference ids): a video starts from the first one; an image model follows them. */
	image_asset_ids?: string[];
	reference_asset_ids?: string[];
	video_asset_ids?: string[];
	audio_asset_ids?: string[];
	reference_count?: number;
	/** Video: the mode (absent: text, or image when a start picture is given — the agent's way). */
	mode?: VideoMode;
	/** The last frame (first + last frame). */
	end_image_asset_ids?: string[];
	generate_audio?: boolean;
	seed?: number;
	negative_prompt?: string;
	character_orientation?: "image" | "video";
	keep_sound?: boolean;
	/** For a price before the clip / sound is uploaded: its seconds. */
	reference_video_duration_seconds?: number;
	reference_audio_duration_seconds?: number;
}

const pictures = (g: GenerateInput) => [...new Set([...(g.image_asset_ids ?? []), ...(g.reference_asset_ids ?? [])])];
const pictureCount = (g: GenerateInput) => pictures(g).length || Math.max(0, Math.round(Number(g.reference_count) || 0));

function modelOf(g: GenerateInput): FalModel {
	const m = falModel(g.model);
	if (!m || (m.task !== "image" && m.task !== "video") || (g.kind === "video") !== (m.task === "video")) throw new StudioError(`There is no ${g.kind} model «${g.model}». Pick one from the list.`);
	return m;
}

export async function check(g: GenerateInput): Promise<void> {
	if (serviceRoute(g)) return;
	if (g.kind === "audio") throw new StudioError("Music generation isn't part of this app.");
	if (g.kind === "video") {
		const { model, options, have } = videoRequest(g);
		const problem = videoProblem(model, options, have);
		if (problem) throw new StudioError(problem.text.replace(/\{(\w+)\}/g, (all, k: string) => String(problem.vars?.[k] ?? all)));
		return;
	}
	if (!g.prompt?.trim()) throw new StudioError("Describe what to generate.");
	const m = modelOf(g);
	const v = view(m);
	if (g.prompt.length > v.limits.max_prompt_characters) throw new StudioError(`The description is too long for ${m.title}: ${g.prompt.length} characters, ${v.limits.max_prompt_characters} at most.`);
	const refs = pictureCount(g);
	if (refs > v.limits.max_reference_images) throw new StudioError(v.limits.max_reference_images === 0 ? `${m.title} doesn't take reference pictures. Remove them or pick another model.` : `${m.title} takes ${v.limits.max_reference_images} reference pictures at most.`);
	if (m.needsImage && !refs) throw new StudioError(`${m.title} makes a clip from a picture: pick the start frame.`);
	if (g.video_asset_ids?.length || g.audio_asset_ids?.length) throw new StudioError("These models don't take reference clips or sounds.");
}

// ───────────────────────── video ─────────────────────────

const first = (ids?: string[]) => (ids?.length ? ids[0] : undefined);

/** The model, the settings and what was given, for a video request (an uploaded clip's own length wins). */
function videoRequest(g: GenerateInput): { model: VideoModel; options: VideoOptions; have: { image: boolean; end: boolean; images: number; video: boolean; audio: boolean } } {
	const picked = videoModel(g.model);
	if (!picked) throw new StudioError(`There is no video model «${g.model}». Pick one from the list.`);
	const refs = g.reference_asset_ids ?? [];
	const mode: VideoMode = isVideoMode(g.mode) ? g.mode : picked.mode === "text" && g.image_asset_ids?.length ? "image" : picked.mode;
	const model = inMode(picked, mode);
	if (!model) throw new StudioError(`${picked.title} doesn't make clips from a picture. Pick another model.`);
	const video = first(g.video_asset_ids);
	const audio = first(g.audio_asset_ids);
	const known = (id: string | undefined) => (id ? refs_.get(id)?.seconds : undefined);
	const inputSeconds = lengthFromInput(model.mode) ? (model.mode === "avatar" ? (known(audio) ?? g.reference_audio_duration_seconds) : (known(video) ?? g.reference_video_duration_seconds)) : undefined;
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
		images: model.mode === "reference" ? refs.length || Math.max(0, Math.round(Number(g.reference_count) || 0)) : undefined,
	};
	const pictureCount = g.image_asset_ids?.length || (model.mode === "image" || model.mode === "frames" ? Math.min(1, Math.max(0, Math.round(Number(g.reference_count) || 0))) : 0);
	const have = {
		image: pictureCount > 0,
		end: !!g.end_image_asset_ids?.length,
		images: options.images ?? 0,
		video: !!video || g.reference_video_duration_seconds !== undefined,
		audio: !!audio || g.reference_audio_duration_seconds !== undefined,
	};
	return { model, options: { ...videoDefaults(model), ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) }, have };
}

/** How an input id becomes the link the API reads: uploaded to the API that runs the job, or (to name the job) its hash. */
type LinkOf = (id: string) => Promise<string | undefined>;

/** The links of a video request's inputs on the API that runs it (each one uploaded there when the job starts). */
async function videoUrls(g: GenerateInput, m: VideoModel, linkOf: LinkOf) {
	const url = async (id: string | undefined, what: string) => {
		if (!id) return undefined;
		const link = await linkOf(id);
		if (!link) throw new StudioError(`The ${what} is no longer known. Pick it again.`);
		return link;
	};
	const editPicture = m.mode === "edit" && !m.picture ? undefined : first(g.image_asset_ids);
	return {
		image: await url(editPicture, "picture"),
		end: m.mode === "frames" ? await url(first(g.end_image_asset_ids), "last frame") : undefined,
		images: m.mode === "reference" ? await Promise.all((g.reference_asset_ids ?? []).map((id) => url(id, "reference picture") as Promise<string>)) : undefined,
		video: m.mode === "motion" || m.mode === "edit" || m.mode === "extend" ? await url(first(g.video_asset_ids), "clip") : undefined,
		audio: m.mode === "avatar" ? await url(first(g.audio_asset_ids), "sound") : undefined,
	};
}

/** The price in US dollars before anything is spent (fal's list price). */
export async function estimate(g: GenerateInput): Promise<{ cost: number }> {
	// A service chosen in Settings → Services bills its own key: no price is known here.
	if (serviceRoute(g)) return { cost: 0 };
	await check(g);
	if (g.kind === "video") {
		const { model, options } = videoRequest(g);
		return { cost: videoPrice(model, options) };
	}
	// A picture: the model's price, and what its reference pictures add (Seedream 5.0 Pro on kie: the first is free).
	const m = modelOf(g);
	return { cost: Math.round((price(m, 1) + refsFee(m, pictureCount(g))) * 1e6) / 1e6 };
}

// ───────────────────────── jobs ─────────────────────────

const resultsDir = () => path.join(studioHome(), "ai-results");

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

const jobs: Map<string, { view: JobView; abort: AbortController }> = ((globalThis as Record<string, unknown>).__gaziyavGenJobs as Map<string, { view: JobView; abort: AbortController }>) ?? new Map();
(globalThis as Record<string, unknown>).__gaziyavGenJobs = jobs;

/**
 * A reference: its file here (prepared once: a piece cut out, a sound made an MP3), its link on each API a job sent it to
 * (the model's own), and where it came from (a sound can be made again from it). `format`: what its bytes really are.
 */
type Ref = { file: string; urls: Partial<Record<AiApi, string>>; kind: Kind; seconds?: number; at: number; source?: string; cut?: { from: number; length: number }; format?: Sniffed };
const refs_: Map<string, Ref> = ((globalThis as Record<string, unknown>).__gaziyavGenRefs as Map<string, Ref>) ?? new Map();
(globalThis as Record<string, unknown>).__gaziyavGenRefs = refs_;

/**
 * A reference's link on the API that runs the job: uploaded there now (each API keeps its uploads a few hours, so the same
 * file goes once). Never another API's storage: kie.ai's and ArgoLink's jobs died on «fal balance empty» while fal's own
 * storage was the first stop of every input (K4/B5, 10.11 02:22).
 */
async function refUrl(id: string, api: Provider): Promise<string | undefined> {
	const hit = refs_.get(id);
	if (!hit) return undefined;
	const url = await api.upload(hit.file);
	hit.urls[api.id] = url;
	return url;
}

/** A reference by its content hash, for naming a job before anything is uploaded (jobKey maps each link to the same). */
const hashLink: LinkOf = async (id) => (refs_.has(id) ? `asset:${id}` : undefined);

/**
 * What names a paid job for a Retry or a second press (the APIs' `resumeKey`): the request with every upload link
 * replaced by the content hash of the file behind it. A link is new on every upload (and after a restart every reference
 * is sent again), the hash is the same for the same picture: so the same press after a relaunch comes back to the job
 * that was already paid for instead of starting a second one. Without links it is the very hash the APIs make themselves;
 * the request that goes out is not changed by it.
 */
export function jobKey(endpoint: string, input: Record<string, unknown>, assetOfLink: Map<string, string>): string {
	const stable = assetOfLink.size ? JSON.stringify(input, (_k, v) => (typeof v === "string" && assetOfLink.has(v) ? `asset:${assetOfLink.get(v)}` : v)) : JSON.stringify(input);
	return crypto.createHash("sha1").update(`${endpoint}\n${stable}`).digest("hex");
}

/** Every link a reference was uploaded as, on every API → the reference's id (its content hash). */
function linksOfRefs(): Map<string, string> {
	const links = new Map<string, string>();
	for (const [id, ref] of refs_) for (const url of Object.values(ref.urls)) if (url) links.set(url, id);
	return links;
}

/** What a job cost and whether it was counted: kept beside its files, so a result read after a restart still says it. */
type JobMeta = { kind: Kind; model: string; api: AiApi; task: "image" | "video"; cost: number; spent: boolean };
const metaFile = (jobId: string) => path.join(resultsDir(), `${jobId}.json`);
function writeMeta(jobId: string, meta: JobMeta) {
	try {
		fs.mkdirSync(resultsDir(), { recursive: true });
		fs.writeFileSync(metaFile(jobId), JSON.stringify(meta));
	} catch {}
}
function readMeta(jobId: string): JobMeta | null {
	try {
		const j = JSON.parse(fs.readFileSync(metaFile(jobId), "utf8")) as Partial<JobMeta>;
		return j && typeof j === "object" && typeof j.cost === "number" ? { kind: j.kind === "video" ? "video" : "image", model: String(j.model ?? ""), api: j.api === "kie" || j.api === "argo" ? j.api : "fal", task: j.task === "video" ? "video" : "image", cost: j.cost, spent: !!j.spent } : null;
	} catch {
		return null;
	}
}

/**
 * model (A11: «AI Nano Banana 2 c90fd9.jpg» told Claude and the owner nothing; the model stays in the name, review reads
 * avatar/lipsync shots by it); no prompt: the model and the job.
 */
export function resultName(prompt: string, title: string, jobId: string, index: number, ext: string): string {
	const words = String(prompt ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, 5).join(" ").slice(0, 48).trim();
	return `AI ${words ? `${words} · ${title}` : `${title} ${jobId.slice(-6)}`}${index ? ` ${index + 1}` : ""}.${ext}`;
}

/** How long a job may take in all, queue included (B1: a stuck kie.ai picture held Claude 29 min under a 30 min limit). */
export function limitSeconds(task: "image" | "video", mode?: VideoMode): number {
	if (task === "image") return 240;
	return mode === "avatar" || mode === "motion" ? 1200 : 900;
}

/** Claude's paid calls: the same request again within this time is the same result (C2), never a second charge. */
export const SAME_HOLD_MS = 30 * 60 * 1000;
/** A picture fal's filter refused on a model is refused again before uploading, for this long (C13). */
export const REFUSED_HOLD_MS = 3 * 3600 * 1000;

/** The request a job sends: built twice, once with each input's hash (its name) and once with the real links. */
type JobRequest = { endpoint: string; input: Record<string, unknown>; title: string; task: "image" | "video"; expect: number; mode?: VideoMode };

async function buildRequest(g: GenerateInput, linkOf: LinkOf): Promise<JobRequest> {
	if (g.kind === "video") {
		const { model, options } = videoRequest(g);
		const urls = await videoUrls(g, model, linkOf);
		return { endpoint: endpointOf(model), input: videoInput(model, options, urls), title: model.title, task: "video", expect: model.mode === "avatar" || model.mode === "motion" ? 180 : 90, mode: model.mode };
	}
	const m = modelOf(g);
	const refs = (await Promise.all(pictures(g).map((id) => linkOf(id)))).filter((u): u is string => !!u);
	if (refs.length < pictures(g).length) throw new StudioError("A reference picture is no longer known. Pick it again.");
	const made = kieImage(m.id);
	const request = made ? { endpoint: kieImageEndpoint(made, refs.length), input: made.build({ prompt: g.prompt, shape: g.aspect_ratio && made.shapes.includes(g.aspect_ratio) ? g.aspect_ratio : made.shapes[0], refs }) } : imageInput(m, g.prompt, g.aspect_ratio || "9:16", refs);
	return { ...request, title: m.title, task: "image", expect: 12 };
}

/** Claude's requests by their key (endpoint + input by content): the job that made it, running or done. Kept on disk too. */
type Same = { jobId: string; at: number; cost: number; done?: number };
const same_: Map<string, Same> = ((globalThis as Record<string, unknown>).__gaziyavSameJobs as Map<string, Same>) ?? new Map();
(globalThis as Record<string, unknown>).__gaziyavSameJobs = same_;
const sameFile = () => path.join(resultsDir(), "same.json");
let sameRead = false;

function sameLoad() {
	if (sameRead) return;
	sameRead = true;
	try {
		const j = JSON.parse(fs.readFileSync(sameFile(), "utf8")) as Record<string, Same>;
		for (const [k, v] of Object.entries(j)) if (v && typeof v.jobId === "string" && typeof v.done === "number" && Date.now() - v.done < SAME_HOLD_MS && !same_.has(k)) same_.set(k, v);
	} catch {}
}

function sameSave() {
	try {
		const keep: Record<string, Same> = {};
		for (const [k, v] of same_) if (v.done !== undefined && Date.now() - v.done < SAME_HOLD_MS) keep[k] = v;
		fs.mkdirSync(resultsDir(), { recursive: true });
		fs.writeFileSync(sameFile(), JSON.stringify(keep));
	} catch {}
}

/** The job behind this key when it still counts: running now, or succeeded under 30 min ago with its files here. */
function sameJob(key: string): { jobId: string; cost: number; state: "running" | "succeeded"; at: number } | null {
	sameLoad();
	const hit = same_.get(key);
	if (!hit) return null;
	const live = jobs.get(hit.jobId)?.view;
	if (live && (live.state === "queued" || live.state === "running")) return { jobId: hit.jobId, cost: live.cost, state: "running", at: hit.at };
	const v = live ?? job(hit.jobId);
	if (v.state === "succeeded" && v.files.length && v.files.every((f) => fs.existsSync(f.path)) && Date.now() - (hit.done ?? hit.at) < SAME_HOLD_MS) return { jobId: hit.jobId, cost: v.cost, state: "succeeded", at: hit.done ?? hit.at };
	same_.delete(key);
	return null;
}

/** Pictures fal's safety filter refused: «<model>|<picture hash>» → when. */
const refused_: Map<string, number> = ((globalThis as Record<string, unknown>).__gaziyavRefusedPictures as Map<string, number>) ?? new Map();
(globalThis as Record<string, unknown>).__gaziyavRefusedPictures = refused_;
const pictureIds = (g: GenerateInput) => [...new Set([...(g.image_asset_ids ?? []), ...(g.end_image_asset_ids ?? []), ...(g.reference_asset_ids ?? [])])];
const clock = (at: number) => new Date(at).toTimeString().slice(0, 5);

/** «Audio format is invalid» and the like: the sound wasn't what its name said (K9). */
const BAD_AUDIO = /audio (format|file)[^.]*(invalid|unsupported|not supported)|invalid audio|unsupported audio|audio[^.]*could not be (read|decoded)/i;

/** Claude's call (`once`): the same request again is the same job. `again`: a new take all the same. */
export interface GenerateOptions {
	once?: boolean;
	again?: boolean;
}

export interface Started {
	jobId: string;
	cost: number;
	/** Claude's same request again: the job that already ran (or runs) it — nothing new was started or charged. */
	same?: { state: "running" | "succeeded"; at: number };
}

/**
 * Starts a generation (the agent passes `allowed`: what the user agreed to spend; a dearer price is refused).
 * Returns at once with the job id; the page follows it with job(). Claude's calls (`once`) are named by what they make
 * (the endpoint and the input, each upload by its content): the same request while it runs joins that job, and once it is
 * done (30 min) returns its result — a call Claude re-sent after a timeout, with other start/place arguments, never pays
 * twice (C2: 9 paid re-runs, $1.35, on 10.11). `again` makes a new take.
 */
export async function generate(g: GenerateInput, allowed?: number, o: GenerateOptions = {}): Promise<Started> {
	const svc = serviceRoute(g);
	if (svc) return startService(g, svc);
	// The model decides, not the switch: a form opened before a flip still runs what it shows.
	const api = provider(g.kind === "video" ? videoModel(g.model)?.api : falModel(g.model)?.api);
	if (!api.hasKey()) throw new StudioError(api.id === "kie" ? "Add your kie.ai key first: Settings → AI." : api.id === "argo" ? "Add your ArgoLink key first: Settings → AI." : "Add your fal.ai key first: Settings → AI (fal.ai).");
	const { cost } = await estimate(g);
	if (allowed !== undefined && !(cost <= allowed + 1e-9)) throw new StudioError(`This now costs $${cost.toFixed(3)} (you allowed $${allowed.toFixed(3)}). Nothing was spent — ask again.`);
	// Named before anything is uploaded: each input by its content hash (the key jobKey makes of the real links).
	const named = await buildRequest(g, hashLink);
	const key = jobKey(named.endpoint, named.input, new Map());
	if (o.once && !o.again) {
		// (the same call twice at once: the second waits for the first one's start — nothing between this check and the
		// mark below waits, so two calls can't both pass it)
		const starting = starting_.get(key);
		if (starting) return { ...(await starting), same: { state: "running", at: Date.now() } };
		const hit = sameJob(key);
		if (hit) return { jobId: hit.jobId, cost: hit.cost, same: { state: hit.state, at: hit.at } };
		for (const id of pictureIds(g)) {
			const at = refused_.get(`${g.model}|${id}`);
			if (at !== undefined && Date.now() - at < REFUSED_HOLD_MS) throw new StudioError(`fal.ai's safety filter refused this picture on ${named.title} at ${clock(at)}: it isn't sent again (nothing was spent). Use another picture, or another model.`);
		}
	}
	if (!o.once) return start(g, api, cost, key, false);
	const started = start(g, api, cost, key, true);
	starting_.set(key, started);
	void started.finally(() => starting_.get(key) === started && starting_.delete(key)).catch(() => {});
	return started;
}

/**
 * Settings → Services → Image / Video generation set to another service (with its key): every picture or clip of the
 * panels and of Claude is made there, with the model chosen in that row; null = Gaziyav's own way (fal / kie / Argo).
 */
function serviceRoute(g: GenerateInput) {
	if (g.kind !== "image" && g.kind !== "video") return null;
	return chosenProvider(g.kind);
}

function startService(g: GenerateInput, svc: NonNullable<ReturnType<typeof serviceRoute>>): Started {
	const id = `gen-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
	const title = svc.option.en;
	const view: JobView = { id, kind: g.kind, model: title, state: "running", progress: 5, cost: 0, error: null, files: [] };
	const abort = new AbortController();
	jobs.set(id, { view, abort });
	// The first picture (a picture's reference, a clip's first frame) goes with it, under its own extension.
	const first = pictures(g)[0];
	const ref = first ? refs_.get(first)?.file : undefined;
	const inputs: Record<string, string> = ref ? { [`ref/first${path.extname(ref) || ".png"}`]: ref } : {};
	const refPath = Object.keys(inputs)[0];
	const args: Record<string, unknown> =
		g.kind === "image"
			? { prompt: g.prompt, out: "gen", ...(g.aspect_ratio ? { ratio: g.aspect_ratio } : {}), ...(refPath ? { ref: [refPath] } : {}) }
			: { prompt: g.prompt, out: "gen", ...(g.duration_seconds ? { duration: g.duration_seconds } : {}), ...(g.aspect_ratio ? { "aspect-ratio": g.aspect_ratio } : {}), ...(refPath ? { "first-frame": refPath } : {}) };
	void (async () => {
		try {
			const r = await runService(svc.provider.id, g.kind, args, { model: svc.option.model, into: resultsDir(), signal: abort.signal, inputs });
			for (const [i, file] of r.files.entries()) {
				const ext = path.extname(file).slice(1).toLowerCase() || (g.kind === "video" ? "mp4" : "png");
				view.files.push({ path: file, name: resultName(g.prompt, title, id, i, ext), kind: g.kind });
			}
			if (!view.files.length) throw new StudioError("The service didn't make it: try again, or pick another service.");
			view.state = "succeeded";
			view.progress = 100;
		} catch (error) {
			view.state = "failed";
			view.error = error instanceof CancelledError ? "Cancelled" : (error as Error).message;
		}
	})();
	return { jobId: id, cost: 0 };
}

/** Claude's calls being started (uploads under way): «key» → the start. */
const starting_ = new Map<string, Promise<Started>>();

async function start(g: GenerateInput, api: Provider, cost: number, key: string, once: boolean): Promise<Started> {
	const job = await buildRequest(g, (id) => refUrl(id, api));
	const id = `gen-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
	const view: JobView = { id, kind: g.kind, model: job.title, state: "queued", progress: 0, cost, error: null, files: [] };
	const abort = new AbortController();
	jobs.set(id, { view, abort });
	if (once) same_.set(key, { jobId: id, at: Date.now(), cost });
	const m = { task: job.task, title: job.title };
	const meta = (spent: boolean) => writeMeta(id, { kind: g.kind, model: job.title, api: api.id, task: m.task, cost: view.cost, spent });
	meta(false);
	const runOnce = (input: Record<string, unknown>) =>
		api.run(job.endpoint, input, m.task === "video" ? "video" : "image", {
			signal: abort.signal,
			expectSeconds: job.expect,
			timeoutSeconds: limitSeconds(m.task, job.mode),
			resumeKey: jobKey(job.endpoint, input, linksOfRefs()),
			onStatus: (t) => {
				view.state = /queue/.test(t) ? "queued" : "running";
			},
			onProgress: (p) => {
				view.state = "running";
				view.progress = Math.round(p * 100);
			},
		});
	void (async () => {
		try {
			let r: Awaited<ReturnType<typeof runOnce>>;
			try {
				r = await runOnce(job.input);
			} catch (error) {
				// The sound wasn't what its name said («Audio format is invalid», K9): made a real MP3 now, sent once more.
				const sound = first(g.audio_asset_ids);
				if (!(error instanceof StudioError) || !sound || !BAD_AUDIO.test(error.message) || !(await reencodeSound(sound))) throw error;
				r = await runOnce((await buildRequest(g, (ref) => refUrl(ref, api))).input);
			}
			const urls = m.task === "video" ? [r.video?.url] : [...(r.images ?? []).map((x) => x.url), r.image?.url].filter(Boolean);
			fs.mkdirSync(resultsDir(), { recursive: true });
			for (const [i, url] of urls.entries()) {
				const ext = (String(url).split("?")[0].match(/\.(mp4|mov|webm|png|jpe?g|webp)$/i)?.[1] ?? (m.task === "video" ? "mp4" : "png")).toLowerCase();
				const file = path.join(resultsDir(), `${id}-${i}.${ext}`);
				await api.save(url, file, abort.signal);
				view.files.push({ path: file, name: resultName(g.prompt, m.title, id, i, ext), kind: g.kind });
			}
			if (!view.files.length) throw new StudioError(`${api.label} finished without a file. Press Retry.`);
			// What the API says it charged, when it says (kie.ai reports the credits a job took).
			view.cost = r.usd ?? cost;
			api.spend(m.task === "video" ? "video" : "image", view.cost);
			meta(true);
			view.state = "succeeded";
			view.progress = 100;
			const kept = same_.get(key);
			if (kept?.jobId === id) {
				Object.assign(kept, { cost: view.cost, done: Date.now() });
				sameSave();
			}
		} catch (error) {
			view.state = "failed";
			// fal stops a job on Cancel; kie.ai can't, so it says what that means for the bill.
			view.error = error instanceof CancelledError ? (api.id === "kie" || api.id === "argo" ? `Cancelled here: ${api.label} was not told to stop a started job, it may still bill it — Generate again within 3 hours comes back to it` : "Cancelled") : (error as Error).message;
			fs.rmSync(metaFile(id), { force: true });
			if (same_.get(key)?.jobId === id) same_.delete(key);
			// A picture fal's filter refused on this model: not sent to it again for 3 hours (C13).
			const field = (error as { refused?: unknown }).refused;
			if (typeof field === "string" && /image|frame|photo|picture/i.test(field)) for (const pic of pictureIds(g)) refused_.set(`${g.model}|${pic}`, Date.now());
		}
	})();
	return { jobId: id, cost };
}

export function job(jobId: string): JobView {
	const hit = jobs.get(jobId)?.view;
	if (hit) return hit;
	// After a relaunch: the files on disk are the result, the note beside them says the model and the price (and the
	// price is counted in «Spent» now when the old process did not get to it).
	try {
		const files = fs
			.readdirSync(resultsDir())
			.filter((n) => n.startsWith(`${jobId}-`) && !n.endsWith(".part"))
			.map((n) => ({ path: path.join(resultsDir(), n), name: n, kind: (/\.(mp4|mov|webm)$/i.test(n) ? "video" : "image") as Kind }));
		if (files.length) {
			const meta = /^[\w-]{4,100}$/.test(jobId) ? readMeta(jobId) : null;
			if (meta && !meta.spent) {
				provider(meta.api).spend(meta.task, meta.cost);
				writeMeta(jobId, { ...meta, spent: true });
			}
			return { id: jobId, kind: meta?.kind ?? files[0].kind, model: meta?.model ?? "", state: "succeeded", progress: 100, cost: meta?.cost ?? 0, error: null, files };
		}
	} catch {}
	return { id: jobId, kind: "image", model: "", state: "failed", progress: 0, cost: 0, error: "This generation is no longer known (the app was restarted while it ran).", files: [] };
}

export function cancelGeneration(jobId: string) {
	jobs.get(jobId)?.abort.abort();
}

export function resultFile(jobId: string, index: number): string {
	const f = jobs.get(jobId)?.view.files[index]?.path;
	if (f && fs.existsSync(f)) return f;
	if (/^[\w-]{4,100}$/.test(jobId) && Number.isInteger(index) && index >= 0) {
		try {
			const hit = fs.readdirSync(resultsDir()).find((name) => name.startsWith(`${jobId}-${index}.`) && !name.endsWith(".part"));
			if (hit) return path.join(resultsDir(), hit);
		} catch {}
	}
	throw new StudioError("That result is no longer on this Mac.");
}

const UPLOAD_LIMIT: Record<Kind, number> = { image: 30e6, video: 1e9, audio: 200e6 };

async function ffmpeg(args: string[], what: string) {
	const r = await run(findTool("ffmpeg"), ["-y", "-hide_banner", "-loglevel", "error", ...args], { timeout: 900 });
	if (r.status !== 0) throw new StudioError(`${what}: ${reason(r)}`);
}

/** What a file's bytes are, by their first ones — never by the type or the name, which can be wrong. */
export type Sniffed = "mp4" | "mp3" | "wav" | "aac" | "ogg" | "flac" | "webm" | "png" | "jpg" | "webp" | "gif" | "unknown";

/**
 * The container by its magic bytes (K9, 10.11 12:00: MP4 exports of song pieces, loaded back from the app's storage
 * without a type after a restart, were taken for MP3 by the type the page guessed, sent unconverted as «-in.mp3», and
 * Kling Avatar answered «Audio format is invalid» five times).
 */
export function sniff(head: Uint8Array): Sniffed {
	const at = (i: number, s: string) => head.length >= i + s.length && [...s].every((c, k) => head[i + k] === c.charCodeAt(0));
	if (at(4, "ftyp") || at(4, "moov") || at(4, "mdat") || at(4, "wide") || at(4, "free")) return "mp4";
	if (at(0, "ID3")) return "mp3";
	if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpg";
	// an MPEG audio frame: 11 sync bits; layer bits 00 are AAC's ADTS, anything else MPEG audio (MP3)
	if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return ((head[1] >> 1) & 3) === 0 ? "aac" : "mp3";
	if (at(0, "RIFF") && at(8, "WAVE")) return "wav";
	if (at(0, "RIFF") && at(8, "WEBP")) return "webp";
	if (at(0, "OggS")) return "ogg";
	if (at(0, "fLaC")) return "flac";
	if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "webm";
	if (head[0] === 0x89 && at(1, "PNG")) return "png";
	if (at(0, "GIF8")) return "gif";
	return "unknown";
}

function headOf(input: Buffer | string): Uint8Array {
	if (Buffer.isBuffer(input)) return input.subarray(0, 16);
	const fd = fs.openSync(input, "r");
	try {
		const head = Buffer.alloc(16);
		const n = fs.readSync(fd, head, 0, 16, 0);
		return head.subarray(0, n);
	} finally {
		fs.closeSync(fd);
	}
}

const EXT: Record<Sniffed, string> = { mp4: ".mp4", mp3: ".mp3", wav: ".wav", aac: ".aac", ogg: ".ogg", flac: ".flac", webm: ".webm", png: ".png", jpg: ".jpg", webp: ".webp", gif: ".gif", unknown: "" };

/** A sound as an MP3 the avatar models read (a clip's own sound, any other container, a piece of either). */
async function toMp3(source: string, cut: { from: number; length: number } | undefined, out: string) {
	const info = await probe(source).catch(() => null);
	if (info && !info.hasAudio) throw new StudioError("This clip has no sound. Pick a sound or a clip with a voice.");
	const range = cut ? ["-ss", cut.from.toFixed(3), "-i", source, "-t", cut.length.toFixed(3)] : ["-i", source];
	await ffmpeg([...range, "-vn", "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k", out], "The sound couldn't be prepared");
}

/** A provider said the sound was not a sound it reads: the reference is made a real MP3 from its source (once), its links dropped. */
async function reencodeSound(id: string): Promise<boolean> {
	const ref = refs_.get(id);
	if (!ref || ref.kind !== "audio" || !ref.source || !fs.existsSync(ref.source) || /\.again\.mp3$/.test(ref.file)) return false;
	const out = path.join(path.dirname(ref.file), `${id}.again.mp3`);
	// (a source that can't be made an MP3 leaves the provider's own words as the error)
	if (!(await toMp3(ref.source, ref.cut, out).then(() => true, () => false))) return false;
	Object.assign(ref, { file: out, urls: {}, format: "mp3" as Sniffed });
	return true;
}

/**
 * A picture, clip or sound from the project, prepared on this Mac now; its id is used in generate(), which uploads it to
 * the API of the model that runs the job (never to another API first: K4). A clip is sent as MP4 (the timeline's piece of
 * it when `trim` is given), a sound as MP3 or WAV (from a sound file, a clip's own sound, or a piece of either) — decided
 * by what the bytes are, not by the type the page sent (a file loaded back from the app's storage has none).
 */
export async function uploadReference(kind: Kind, contentType: string, input: Buffer | { file: string }, trim?: { from: number; length: number }): Promise<{ assetId: string; seconds?: number }> {
	// `{ file }`: a clip or sound that is already on this Mac (the app's streaming upload, studio/client/api.ts): only the
	// piece asked for is cut out and sent, however big the file it sits in (a one-hour source of 1.5 GB used to be refused
	// whole, and a smaller one was read into memory whole). A `Buffer`: the body of the request, small by its limit.
	const stored = Buffer.isBuffer(input) ? null : input.file;
	const bytes = Buffer.isBuffer(input) ? input : null;
	const size = bytes ? bytes.length : fs.statSync(stored as string).size;
	const piece = !!trim && Number.isFinite(trim.from) && Number.isFinite(trim.length) && trim.length > 0;
	if (size > UPLOAD_LIMIT[kind] && (bytes || !piece)) throw new StudioError(kind === "image" ? "The reference picture is too big (30 MB at most)." : bytes ? "This file is too big to send. Trim it on the timeline and pick the selected clip." : "This file is too big to send whole. Mark a shorter piece on the timeline and pick the selected clip.");
	const dir = path.join(studioHome(), "ai-results", "refs");
	fs.mkdirSync(dir, { recursive: true });
	const cut = trim && Number.isFinite(trim.from) && Number.isFinite(trim.length) && trim.length > 0 ? { from: Math.max(0, trim.from), length: trim.length } : undefined;
	const real = sniff(headOf(bytes ?? (stored as string)));
	const hasher = crypto.createHash("sha1");
	// (a stored file is named by where it is and when it was written: hashing a 1.5 GB source for every piece would cost seconds)
	if (bytes) hasher.update(bytes);
	else hasher.update(`${stored}|${size}|${fs.statSync(stored as string).mtimeMs}`);
	// What the bytes are is part of the name: a ref made while the type was wrong is never handed back for the right one.
	const hash = hasher.update(`${kind}:${cut ? `${cut.from.toFixed(3)}+${cut.length.toFixed(3)}` : ""}:${real}`).digest("hex").slice(0, 20);
	const known = refs_.get(hash);
	if (known && Date.now() - known.at < 3 * 3600 * 1000 && fs.existsSync(known.file)) return { assetId: hash, seconds: known.seconds };
	if (kind === "image") {
		const ext = EXT[real] && real !== "mp4" ? EXT[real] : contentType.includes("png") ? ".png" : contentType.includes("webp") ? ".webp" : ".jpg";
		const file = path.join(dir, `${hash}${ext}`);
		if (!fs.existsSync(file)) {
			if (bytes) fs.writeFileSync(file, bytes);
			else fs.copyFileSync(stored as string, file);
		}
		refs_.set(hash, { file, urls: {}, kind, at: Date.now(), format: real });
		return { assetId: hash };
	}
	const type = contentType.split(";")[0].trim().toLowerCase();
	// a stored file is read where it lies (no copy of a 1.5 GB source); a request body is written once, named by what it is
	const inExt = EXT[real] || (type.startsWith("audio/") ? ".m4a" : ".mp4");
	const source = stored ?? path.join(dir, `${hash}-in${inExt}`);
	if (bytes && !fs.existsSync(source)) fs.writeFileSync(source, bytes);
	let file = source;
	if (kind === "video") {
		// The models read MP4 / MOV; a piece of a clip is cut out (re-encoded, so it starts on its first frame).
		if (cut || real !== "mp4") {
			file = path.join(dir, `${hash}.mp4`);
			const range = cut ? ["-ss", cut.from.toFixed(3), "-i", source, "-t", cut.length.toFixed(3)] : ["-i", source];
			if (!fs.existsSync(file)) await ffmpeg([...range, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", file], "The clip couldn't be prepared");
		}
	} else if (cut || !(real === "mp3" || real === "wav")) {
		// Avatars read MP3 / WAV: a clip's own sound, any other container (an MP4 export, M4A, AAC, OGG…), a piece — an MP3.
		file = path.join(dir, `${hash}.mp3`);
		if (!fs.existsSync(file)) await toMp3(source, cut, file);
	}
	const seconds = await probe(file)
		.then((p) => (p.duration > 0 ? Math.round(p.duration * 100) / 100 : undefined))
		.catch(() => undefined);
	refs_.set(hash, { file, urls: {}, kind, seconds, at: Date.now(), source, cut, format: kind === "audio" && file !== source ? "mp3" : real });
	return { assetId: hash, seconds };
}
