// AI image / AI video in the editor (client side, fal.ai behind it): whether the key is set, the generations of this
// Mac (kept between launches) and the way a finished one gets into the project — only when taken: + adds it to Media,
// a drag or a double-click puts it on the timeline.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { EditorCore } from "@/core";
import { processMediaAssets } from "@/media/processing";
import { jobCenter, useJobsStore } from "@/jobs/store";
import type { MediaAsset } from "@/media/types";
import { t } from "@/i18n";
import { uploadOnce } from "@/studio/client/api";
import { placeOnTimeline } from "@/studio/client/editor-bridge";

/** A file bigger than this goes up by the streaming upload, not as the body of the request. */
const BODY_LIMIT = 64e6;
import { TICKS_PER_SECOND } from "@/wasm";
import { approveSpend } from "./spend";
import { falModel, usd } from "@/fal/models";
import { type VideoMode, videoModelTitle } from "@/fal/video";

export type Kind = "video" | "image" | "audio";

export interface PointStatus {
	connected: boolean;
	name?: string;
	balance?: number | null;
	unit?: string;
	error?: string | null;
	signingIn?: boolean;
}

export interface PointModel {
	id: string;
	title: string;
	kind: Kind;
	maker?: string;
	/** The model a feature starts on: the list is cheapest first. */
	default?: boolean;
	/** The API the model runs on (a job goes there). */
	api?: "fal" | "kie";
	/** The catalog's unit price (US dollars). */
	usd?: number;
	needsImage?: boolean;
	limits?: {
		max_prompt_characters?: number | null;
		max_simple_prompt_characters?: number | null;
		max_reference_images?: number | null;
		supported_aspect_ratios?: string[];
		supported_durations_seconds?: number[];
		supported_qualities?: string[];
	};
}

export interface PointJob {
	id: string;
	kind: Kind;
	model: string;
	prompt: string;
	cost: number;
	state: "queued" | "running" | "succeeded" | "failed";
	progress: number;
	error: string | null;
	files: { path: string; name: string; kind: Kind }[];
	at: number;
	/** Seconds asked for (video / audio). */
	duration?: number;
	/** Started by Gaziyav AI (it places the result itself). */
	quiet?: boolean;
	/** The timeline still this clip was made from (AI video → Image → the selected clip): «↓» puts the clip in its place. */
	replaces?: { trackId: string; elementId: string };
	/** What was asked (Retry runs it again). */
	input?: PointInput;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`/api/cloud/${path}`, { ...init, headers: { "Content-Type": "application/json", "X-Studio": "1", ...(init?.headers ?? {}) } });
	const data = (await res.json().catch(() => ({}))) as T & { error?: string };
	if (!res.ok) throw new Error(data.error || "The generator didn't answer. Check the internet connection.");
	return data;
}

/**
 * One generation. References are ids from pointReference(): a video starts from the first picture (image → video),
 * image models follow the pictures.
 */
export interface PointInput {
	kind: Kind;
	prompt: string;
	model: string;
	aspect_ratio?: string;
	duration_seconds?: number;
	quality?: string;
	image_asset_ids?: string[];
	video_asset_ids?: string[];
	audio_asset_ids?: string[];
	/** For a price only: how many pictures will be sent (they are uploaded when Generate is pressed). */
	reference_count?: number;
	/** Whole seconds of the reference clip (video_asset_ids). */
	reference_video_duration_seconds?: number;
	/** Video: the mode (text, image, frames, reference, motion, edit, avatar; extend on kie.ai) and its settings. */
	mode?: VideoMode;
	end_image_asset_ids?: string[];
	reference_asset_ids?: string[];
	generate_audio?: boolean;
	seed?: number;
	negative_prompt?: string;
	character_orientation?: "image" | "video";
	keep_sound?: boolean;
	/** Whole seconds of the sound (audio_asset_ids), for the price before it is uploaded. */
	reference_audio_duration_seconds?: number;
	/** Audio: a voice of the model, the text's language, a music style, a song with words. */
	voice?: string;
	language_code?: string;
	style?: string;
	with_lyrics?: boolean;
}

/** What the home page hands the Generate tab: the mode and the typed request. */
export interface PointDraft {
	kind: Kind;
	prompt?: string;
}

/** The AI video tab's last mode and model of each mode (kept between launches). */
export interface VideoPrefs {
	mode?: VideoMode;
	/** By mode; kie.ai's picks under «kie:<mode>», so a pick for one API never touches the other's. */
	models?: Record<string, string>;
}

interface State {
	status: PointStatus | null;
	jobs: PointJob[];
	draft: PointDraft | null;
	video: VideoPrefs;
	setDraft: (draft: PointDraft | null) => void;
	setVideo: (prefs: VideoPrefs) => void;
	refresh: () => Promise<PointStatus>;
	start: (input: PointInput, options?: { quiet?: boolean; replaces?: { trackId: string; elementId: string } }) => Promise<PointJob>;
	poll: () => Promise<void>;
	forget: (id: string) => void;
	/** Stops a running generation on fal (nothing more is billed for it). */
	cancel: (id: string) => Promise<void>;
	/** Runs a failed or stopped generation again with the same settings (a new job in its place). */
	retry: (id: string) => Promise<PointJob>;
}

export const usePoint = create<State>()(
	persist(
		(set, get) => ({
			status: null,
			jobs: [],
			draft: null,
			video: {},
			setDraft: (draft) => set({ draft }),
			setVideo: (prefs) => set({ video: { ...get().video, ...prefs, models: { ...get().video.models, ...prefs.models } } }),
			refresh: async () => {
				const status = await api<PointStatus>("status").catch((e) => ({ connected: false, error: (e as Error).message }) as PointStatus);
				set({ status });
				return status;
			},
			start: async (input, options) => {
				// The agent's step (quiet: agent/tools.ts generate_media): its price and the user's OK first, then a
				// generation refused when it would cost more (the Generate tab's own button shows the price on it).
				let allowed: number | undefined;
				if (options?.quiet) {
					const price = await estimatePoint(input);
					const ok = await approveSpend(describeInput(input), price, input.prompt);
					if (!ok) throw new Error(`The user didn't allow spending ${usd(price)} on this. Don't try again; ask what to do instead.`);
					allowed = ok.usd ?? price;
				}
				const { jobId, cost } = await api<{ jobId: string; cost: number }>("generate", { method: "POST", body: JSON.stringify(allowed === undefined ? input : { ...input, allowed }) });
				const job: PointJob = { id: jobId, kind: input.kind, model: input.model, prompt: input.prompt, cost, state: "queued", progress: 0, error: null, files: [], at: Date.now(), input, ...(input.duration_seconds ? { duration: input.duration_seconds } : {}), ...(options?.quiet ? { quiet: true } : {}), ...(options?.replaces ? { replaces: options.replaces } : {}) };
				set({ jobs: [job, ...get().jobs].slice(0, 40) });
				void get().refresh();
				return job;
			},
			poll: async () => {
				const active = get().jobs.filter((j) => j.state === "queued" || j.state === "running");
				for (const j of active) {
					try {
						const v = await api<Omit<PointJob, "prompt" | "at">>(`job/${j.id}`);
						set({ jobs: get().jobs.map((x) => (x.id === j.id ? { ...x, state: v.state, progress: v.progress, error: v.error, files: v.files, model: v.model || x.model } : x)) });
						if (v.state === "succeeded") void get().refresh();
					} catch (e) {
						set({ jobs: get().jobs.map((x) => (x.id === j.id ? { ...x, error: (e as Error).message } : x)) });
					}
				}
			},
			forget: (id) => set({ jobs: get().jobs.filter((j) => j.id !== id) }),
			cancel: async (id) => {
				await api(`cancel/${id}`, { method: "POST" });
				// The server's own word for it: fal stops the job («Cancelled»); kie.ai and ArgoLink are not told and may still bill
				// (check-ai D3, 06.11: the page wrote «Cancelled» over that warning and never read the job again).
				let said = "Cancelled";
				for (let i = 0; i < 6; i++) {
					await new Promise((r) => setTimeout(r, 250));
					const v = await api<Omit<PointJob, "prompt" | "at">>(`job/${id}`).catch(() => null);
					if (v?.state === "failed") {
						said = v.error || said;
						break;
					}
				}
				set({ jobs: get().jobs.map((x) => (x.id === id && (x.state === "queued" || x.state === "running" || x.error === "Cancelled") ? { ...x, state: "failed", error: said } : x)) });
			},
			retry: async (id) => {
				const old = get().jobs.find((j) => j.id === id);
				if (!old?.input) throw new Error("This generation can't be repeated: start it again from the form.");
				const job = await get().start(old.input);
				// The new run takes the old card's place.
				set({ jobs: get().jobs.filter((j) => j.id !== id) });
				return job;
			},
		}),
		{ name: "gaziyav-ai-generate", partialize: (s) => ({ jobs: s.jobs, video: s.video }) },
	),
);

/**
 * A model's name from the catalog by its id or fal endpoint («Seedance 1.0 Pro Fast»); the id itself when it isn't
 * there. The run card showed «fal-ai/bytedance/seedance/v1/pro/fast/text-to-video» until the first poll and after a
 * relaunch.
 */
export const modelName = (id: string): string => videoModelTitle(id) ?? falModel(id)?.title ?? id;

/** The model a job card names: its request's model (the server's view has its title, and nothing after a relaunch). */
export const jobModelId = (job: Pick<PointJob, "model" | "input">): string => job.input?.model || job.model;

/** What a generation makes, in a line («Video · Seedance 2.0 Mini · 5 s · 9:16»). */
function describeInput(input: PointInput): string {
	const kind = input.kind === "image" ? "Picture" : input.kind === "audio" ? "Audio" : "Video";
	return [t(kind), modelName(input.model), input.duration_seconds ? `${input.duration_seconds} s` : "", input.aspect_ratio ?? "", input.quality ?? ""].filter(Boolean).join(" · ");
}

/** The price shown on the Generate button (nothing is spent). */
export async function estimatePoint(input: PointInput): Promise<number> {
	return (await api<{ cost: number }>("estimate", { method: "POST", body: JSON.stringify(input) })).cost;
}

/** A picture from the project, sent to fal as a reference (30 MB at most); returns its id. */
export async function pointReference(file: Blob, kind: Kind): Promise<string> {
	return (await pointUpload(file, kind)).id;
}

/**
 * A picture, clip or sound sent to fal for a generation: its id and (clips, sounds) its seconds. `trim` sends only
 * that piece of the file (a clip as the timeline plays it); a sound can come from a clip (its own sound).
 */
export async function pointUpload(file: Blob, kind: Kind, trim?: { from: number; length: number }): Promise<{ id: string; seconds?: number }> {
	const type = file.type || (kind === "image" ? "image/png" : kind === "audio" ? "audio/mpeg" : "video/mp4");
	const range = trim ? `&from=${trim.from.toFixed(3)}&length=${trim.length.toFixed(3)}` : "";
	// A clip or sound that is big, or only a piece of its file: the file goes up once by the streaming upload (the one the
	// lipsync and the voice use) and the piece is cut on this Mac. As a request body it was read into memory whole and
	// refused above 1 GB: «too big» for ten seconds of a one-hour source.
	let where = "";
	let body: Blob | undefined = file;
	if (kind !== "image" && (trim || file.size > BODY_LIMIT)) {
		const named = file instanceof File ? file : new File([file], kind === "video" ? "clip.mp4" : "sound.m4a", { type });
		const sent = await uploadOnce(`ref:${named.name}:${named.size}:${named.lastModified}`, named);
		where = `&fileId=${sent.fileId}`;
		body = undefined;
	}
	const res = await fetch(`/api/cloud/reference?kind=${kind}&type=${encodeURIComponent(type)}${range}${where}`, { method: "POST", headers: { "X-Studio": "1", "Content-Type": "application/octet-stream" }, body });
	const data = (await res.json().catch(() => ({}))) as { assetId?: string; seconds?: number; error?: string };
	if (!res.ok || !data.assetId) throw new Error(data.error || (kind === "image" ? "The reference picture wasn't sent. Try again." : "The file wasn't sent. Try again."));
	return { id: data.assetId, ...(typeof data.seconds === "number" ? { seconds: data.seconds } : {}) };
}

export async function pointModels(kind: Kind): Promise<PointModel[]> {
	const data = await api<{ models?: PointModel[] }>(`models/${kind}`);
	return (data.models ?? []).filter((m) => m.kind === kind);
}

const imported = new Map<string, Promise<MediaAsset>>();

/** A finished result in the project's Media (once; the same file is reused afterwards). */
export async function resultToMedia(job: PointJob, index = 0): Promise<MediaAsset> {
	const key = `${job.id}:${index}`;
	const ed = EditorCore.getInstance();
	const pending = imported.get(key);
	if (pending) {
		const known = await pending.catch(() => null);
		if (known && ed.media.getAssets().some((a) => a.id === known.id)) return known;
	}
	const run = importResult(job, index);
	imported.set(key, run);
	return run;
}

async function importResult(job: PointJob, index: number): Promise<MediaAsset> {
	const ed = EditorCore.getInstance();
	const f = job.files[index];
	if (!f) throw new Error("This result has no file.");
	const res = await fetch(`/api/cloud/file/${job.id}/${index}`, { headers: { "X-Studio": "1" } });
	if (!res.ok) throw new Error("The result is no longer on this Mac. Generate it again.");
	const blob = await res.blob();
	const [processed] = await processMediaAssets({ files: [new File([blob], f.name, { type: blob.type })] });
	if (!processed) throw new Error("The editor couldn't read this result.");
	const project = ed.project.getActive();
	// Its placeholder in Media (src/jobs/point-source.ts) is taken over: the same id, the same spot.
	const placeholder = index === 0 ? useJobsStore.getState().jobs.find((j) => j.id === `ai:${job.id}`) : undefined;
	const asset = await ed.media.addMediaAsset({ projectId: project.metadata.id, asset: { ...processed, origin: "result", id: placeholder?.place?.media?.assetId } });
	if (!asset) throw new Error("Not enough disk space.");
	if (placeholder?.status === "running") jobCenter.finish(placeholder.id, asset.name);
	return asset;
}

/**
 * A finished result on the timeline at the playhead (and in Media). A clip made from a still of the timeline (AI video →
 * Image → the selected clip) takes the still's place: same start, the still goes (one ⌘Z brings it back) — check-flow,
 * 06.11: «↓» stacked the clip on a new track and left the picture under it.
 */
export async function resultToTimeline(job: PointJob, index = 0): Promise<MediaAsset> {
	const asset = await resultToMedia(job, index);
	const ed = EditorCore.getInstance();
	const still = job.replaces ? ed.timeline.getTrackById({ trackId: job.replaces.trackId })?.elements.find((e) => e.id === job.replaces?.elementId) : undefined;
	if (still && job.replaces) {
		placeOnTimeline(ed, asset, still.startTime / TICKS_PER_SECOND);
		ed.timeline.deleteElements({ elements: [{ trackId: job.replaces.trackId, elementId: job.replaces.elementId }] });
		return asset;
	}
	placeOnTimeline(ed, asset, ed.playback.getCurrentTime() / TICKS_PER_SECOND);
	return asset;
}
