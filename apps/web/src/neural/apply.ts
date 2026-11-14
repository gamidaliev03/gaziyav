// Effects → AI on the selected clips. Each clip's media is processed on this Mac by the app's server
// (`neuralfx`: Vision / Core Image / MetalFX, VideoToolbox), the result is added to Media (Results) and the
// clip is pointed at it in ONE undo step. The original media stays in the project; ⌘Z or "Use original"
// (Properties → Effects) brings it back. Progress, ETA and Cancel are in the job center.
import { toast } from "sonner";
import { EditorCore } from "@/core";
import { BatchCommand, Command } from "@/commands";
import { createElementSelectionResult } from "@/commands/base-command";
import { InsertElementCommand, UpdateElementsCommand } from "@/commands/timeline";
import { jobCenter } from "@/jobs/store";
import { type ModelId, requireModel, useOndeviceStore } from "@/ondevice/client";
import { processMediaAssets } from "@/media/processing";
import type { MediaAsset } from "@/media/types";
import type { ParamValues } from "@/params";
import { storageService } from "@/services/storage/service";
import type { NeuralAssetInfo } from "@/services/storage/types";
import type { ImageElement, TimelineElement, UploadAudioElement, VideoElement } from "@/timeline";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { generateUUID } from "@/utils/id";
import { mediaTimeFromSeconds, mediaTimeToSeconds, type MediaTime } from "@/wasm";
import {
	describe,
	effectFor,
	FAMILIES,
	helperOptions,
	type NeuralEffect,
	type NeuralFamily,
	type NeuralFamilyId,
	neuralEffect,
} from "./catalog";
import { trackExportQuality } from "./pending";

const BASE = "/api/studio";
/** Bump when the helper's output changes, so old cached results aren't reused. */
const VERSION = "neuralfx-1";

const sec = (t: MediaTime | undefined) => (t == null ? 0 : mediaTimeToSeconds({ time: t }));
const mt = (seconds: number) => mediaTimeFromSeconds({ seconds: Math.max(0, seconds) });

interface Target {
	trackId: string;
	/** A video clip, or (for the tools on sound) an audio clip of an imported file. */
	element: VideoElement | UploadAudioElement;
	asset: MediaAsset;
}

/** Clips a family can work on: the video effects and Retouch on video, the sound tools on video with sound and audio files. */
function canRun(family: NeuralFamily, element: TimelineElement | undefined): element is VideoElement | UploadAudioElement {
	if (element?.type === "video") return true;
	return family.tool === "audio" && element?.type === "audio" && element.sourceType === "upload";
}

interface ServerResult {
	key: string;
	cached: boolean;
	width: number;
	height: number;
	frames: number;
	seconds: number;
	fps: number;
	engine: string;
	alpha: boolean;
}

interface ServerJob {
	id: string;
	status: "running" | "done" | "failed" | "cancelled";
	error?: string;
	result?: ServerResult;
	stages: Array<{ progress?: number; detail?: string; title: string }>;
}

class Cancelled extends Error {}

function selectedVideoClips(editor: EditorCore): { targets: Target[]; skipped: number } {
	const assets = editor.media.getAssets();
	const picked = editor.timeline.getElementsWithTracks({ elements: editor.selection.getSelectedElements() });
	const targets: Target[] = [];
	let skipped = 0;
	for (const { track, element } of picked) {
		const asset = element.type === "video" ? assets.find((a) => a.id === element.mediaId) : undefined;
		if (element.type === "video" && asset?.file) targets.push({ trackId: track.id, element, asset });
		else skipped++;
	}
	return { targets, skipped };
}

/** Applies an AI effect tile (its family's settings + the tile's preset) to every selected video clip. */
export function applyNeuralEffect(effectId: string, values: ParamValues): number {
	const effect = neuralEffect(effectId);
	if (!effect) return 0;
	const editor = EditorCore.getInstance();
	const { targets, skipped } = selectedVideoClips(editor);
	if (targets.length === 0) {
		toast.error(
			skipped > 0 ? `${effect.name} works on video clips` : `Select a video clip on the timeline, then double-click ${effect.name}`,
		);
		return 0;
	}
	const merged = { ...values, ...(effect.preset ?? {}) };
	for (const target of targets) void runOnClip(editor, target, effect, merged);
	return targets.length;
}

/** The inspector's Apply / Re-run (and the Retouch and Audio tools): one clip, a family and its settings. */
export function applyToClip(trackId: string, elementId: string, family: NeuralFamilyId, values: ParamValues): boolean {
	const editor = EditorCore.getInstance();
	const element = findElement(editor, trackId, elementId);
	if (!canRun(FAMILIES[family], element)) return false;
	const asset = editor.media.getAssets().find((a) => a.id === element.mediaId);
	if (!asset?.file) return false;
	void runOnClip(editor, { trackId, element, asset }, effectFor(family, values), values);
	return true;
}

/**
 * Cutout → Remove background on a photo: one PNG with alpha made on this Mac (studio/server/photo-matte.ts — Apple
 * Vision's subject lift, free, about a second), added to Media (Results) and shown by the photo clip in one undo step.
 * Its switch in the section (or ⌘Z) brings the original back.
 */
export function applyToPhoto(trackId: string, elementId: string, values: ParamValues): boolean {
	const editor = EditorCore.getInstance();
	const element = findElement(editor, trackId, elementId);
	if (element?.type !== "image") return false;
	const asset = editor.media.getAssets().find((a) => a.id === element.mediaId);
	if (!asset?.file) return false;
	void runOnPhoto(editor, trackId, element, asset, values);
	return true;
}

async function runOnPhoto(editor: EditorCore, trackId: string, element: ImageElement, asset: MediaAsset, values: ParamValues) {
	const projectId = editor.project.getActiveOrNull()?.metadata.id;
	if (!projectId) return;
	const family = FAMILIES.background;
	// Again on a photo that shows a cut-out: from the photo it was made from (the new settings replace the old).
	let source = asset;
	if (asset.neural && neuralEffect(asset.neural.effect)?.family === "background") {
		const from = editor.media.getAssets().find((a) => a.id === asset.neural?.sourceId);
		if (from?.file) source = from;
	}
	const params = helperOptions(family, values);
	const label = describe(family, values);
	const effect = effectFor("background", values);
	const key = await sha([VERSION, "photo", source.id, source.file.size, JSON.stringify(Object.entries(params).sort())].join("|"));
	if (asset.neural?.key === key) {
		toast(`${label} is already on this photo`);
		return;
	}
	const runKey = `${element.id}|${key}`;
	if (runningOnClip.has(runKey)) return;
	runningOnClip.add(runKey);
	const jobId = jobCenter.start({ kind: "other", title: label, stage: "Finding what to keep", progress: 0.15, tab: "effects", place: { elements: [element.id] } });
	noteJob(element.id, jobId);
	try {
		let result = editor.media.getAssets().find((a) => a.neural?.key === key && a.file);
		if (!result) {
			const query = new URLSearchParams({ key, params: JSON.stringify(params) });
			const res = await fetch(`${BASE}/neural/photo?${query}`, { method: "POST", headers: { "X-Studio": "1", "Content-Type": "application/octet-stream" }, body: source.file });
			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error(data?.error || "Remove background failed");
			}
			jobCenter.update(jobId, { stage: "Adding the result to Media", progress: 0.9 });
			const file = new File([await res.blob()], `${baseName(source.name)} · ${effect.done}.png`, { type: "image/png" });
			result = await addResult(editor, projectId, file, {
				effect: effect.id,
				key,
				label,
				params: values as NeuralAssetInfo["params"],
				sourceId: source.id,
				originalId: source.neural?.originalId ?? source.id,
				offset: 0,
			});
		}
		const now = findElement(editor, trackId, element.id);
		const same = now?.type === "image" && now.mediaId === asset.id && editor.project.getActiveOrNull()?.metadata.id === projectId;
		if (same) {
			editor.command.execute({
				command: new UpdateElementsCommand({ updates: [{ trackId, elementId: element.id, patch: { mediaId: result.id, aiOff: undefined } as Partial<TimelineElement> }] }),
			});
		}
		jobCenter.finish(jobId, same ? effect.done : `${effect.done} — the photo changed meanwhile; the result is in Media → Results`);
	} catch (error) {
		jobCenter.fail(jobId, error instanceof Error ? error.message : `${label} failed`);
		jobCenter.update(jobId, { retry: () => void runOnPhoto(editor, trackId, element, asset, values) });
	} finally {
		runningOnClip.delete(runKey);
	}
}

const runningOnClip = new Set<string>();

/** Separations (separate_voice) running, by clip id: the hearing waits for them (the clip's sound is about to change). */
const separating = new Map<string, Promise<void>>();

/** The separations running on the clip whose id starts with `id` (every running one without it). */
export function separationsRunning(id?: string): Array<Promise<void>> {
	return [...separating.entries()].filter(([k]) => !id || k === id || k.startsWith(id)).map(([, p]) => p);
}

/** What Separate calls its results: «<song> · voice» (the clip) and «<song> · music» (under it), files to match. */
export function separationNames(sourceName: string): { voice: string; music: string; voiceFile: string; musicFile: string } {
	const base = baseName(sourceName).replace(/ · (voice|music)$/i, "");
	return { voice: `${base} · voice`, music: `${base} · music`, voiceFile: `${base} · voice.mov`, musicFile: `${base} · music.m4a` };
}

// The jobs of each clip (its preview pass and export-quality pass), for the inspector's status rows.
const clipJobs = new Map<string, string[]>();
function noteJob(elementId: string, jobId: string) {
	clipJobs.set(elementId, [jobId, ...(clipJobs.get(elementId) ?? [])].slice(0, 4));
}
export function jobIdsOfClip(elementId: string): string[] {
	return clipJobs.get(elementId) ?? [];
}

async function sha(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

const VIDEO_EXT = /\.(mp4|mov|m4v|qt|webm|mkv)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|aif|aiff|flac|ogg|opus|caf)$/i;
/** The name the clip's file is sent under: with a real extension (stored files may have none). */
function uploadName(asset: MediaAsset): string {
	for (const name of [asset.name, asset.file.name]) if (name && (VIDEO_EXT.test(name) || (asset.type === "audio" && AUDIO_EXT.test(name)))) return name;
	const ext = ({ "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" } as Record<string, string>)[asset.file.type] ?? "mov";
	return `${baseName(asset.name || "clip")}.${ext}`;
}

function baseName(name: string): string {
	const dot = name.lastIndexOf(".");
	return (dot > 0 ? name.slice(0, dot) : name) || "Clip";
}

function formatSeconds(s: number): string {
	return s < 60 ? `${s < 10 ? s.toFixed(1) : Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

/** The first media of an AI chain and the offset (s) of `asset` inside it. */
export function originalOf(assets: MediaAsset[], asset: MediaAsset): { original: MediaAsset; offset: number } | null {
	let current = asset;
	let offset = 0;
	for (let hops = 0; current.neural && hops < 16; hops++) {
		offset += current.neural.offset ?? 0;
		const next = assets.find((a) => a.id === current.neural?.sourceId);
		if (!next) {
			const root = assets.find((a) => a.id === current.neural?.originalId);
			return root ? { original: root, offset } : null;
		}
		current = next;
	}
	return current === asset ? null : { original: current, offset };
}

// The clip's file is sent to the server once per media; the export-quality pass reuses it.
const sentSources = new Map<string, string>();

function send(
	file: File,
	query: URLSearchParams,
	onProgress: (v: number) => void,
	signal: AbortSignal,
	withBody: boolean,
): Promise<{ job: ServerJob; source: string | null }> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("POST", `${BASE}/neural?${query}`);
		xhr.setRequestHeader("X-Studio", "1");
		xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
		xhr.onload = () => {
			let data: any = null;
			try {
				data = JSON.parse(xhr.responseText);
			} catch {}
			if (xhr.status >= 200 && xhr.status < 300 && data?.job?.id) resolve(data);
			else reject(new Error(data?.error || "Couldn't send the clip to the AI effect"));
		};
		xhr.onerror = () => reject(new Error("Gaziyav's local server is not responding. Restart Gaziyav."));
		xhr.onabort = () => reject(new Cancelled());
		signal.addEventListener("abort", () => xhr.abort(), { once: true });
		xhr.send(withBody ? file : null);
	});
}

async function getJson<T>(path: string): Promise<T> {
	const res = await fetch(`${BASE}/${path}`, { headers: { "X-Studio": "1" } });
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new Error(data?.error || `Request failed (HTTP ${res.status})`);
	return data as T;
}

/** Runs the helper on the server (or takes the cached result). Progress 0–0.95 through `report`. */
async function processOnServer({
	source,
	effect,
	params,
	key,
	start,
	length,
	signal,
	report,
	onServerJob,
}: {
	source: MediaAsset;
	effect: { op: string; name: string };
	params: Record<string, string | number>;
	key: string;
	start: number;
	length: number;
	signal: AbortSignal;
	report: (progress: number, stage: string) => void;
	onServerJob: (id: string) => void;
}): Promise<ServerResult> {
	const { hit } = await getJson<{ hit: ServerResult | null }>(`neural/cache/${key}`);
	if (hit) return hit;
	const query = new URLSearchParams({
		op: effect.op,
		key,
		name: uploadName(source),
		params: JSON.stringify(params),
		length: String(length),
		title: effect.name,
	});
	if (start > 0) query.set("start", start.toFixed(4));
	if (Math.abs(length - (source.duration ?? length)) > 0.01 || start > 0) query.set("duration", length.toFixed(4));
	const known = sentSources.get(source.id);
	let started: { job: ServerJob; source: string | null };
	try {
		if (known) query.set("source", known);
		started = await send(source.file, query, (v) => report(v * 0.05, "Sending the clip"), signal, !known);
	} catch (error) {
		if (!known || error instanceof Cancelled) throw error;
		// The server forgot the earlier copy (restart, cleanup): send the file again.
		sentSources.delete(source.id);
		query.delete("source");
		started = await send(source.file, query, (v) => report(v * 0.05, "Sending the clip"), signal, true);
	}
	if (started.source) sentSources.set(source.id, started.source);
	onServerJob(started.job.id);
	let job = started.job;
	let misses = 0;
	while (job.status === "running") {
		await new Promise((r) => setTimeout(r, 300));
		if (signal.aborted) throw new Cancelled();
		try {
			job = await getJson<ServerJob>(`jobs/${job.id}`);
			misses = 0;
		} catch (error) {
			if (++misses >= 8) throw error;
			continue;
		}
		const stage = job.stages[0];
		report(0.05 + (stage?.progress ?? 0) * 0.9, stage?.detail || stage?.title || effect.name);
	}
	if (job.status === "cancelled") throw new Cancelled();
	if (job.status !== "done" || !job.result) throw new Error(job.error || `${effect.name} failed`);
	return job.result;
}

/** A result from the server's cache: a movie, or (`sound`) an AAC sound file. */
async function download(key: string, name: string, sound = false): Promise<File> {
	const res = await fetch(`${BASE}/neural/file/${key}`, { headers: { "X-Studio": "1" } });
	if (!res.ok) {
		const data = await res.json().catch(() => null);
		throw new Error(data?.error || "Couldn't get the AI effect's result");
	}
	return new File([await res.blob()], sound ? name.replace(/\.mov$/, ".m4a") : name, { type: sound ? "audio/mp4" : "video/quicktime" });
}

/** Adds the result to the project's media (the project the job started in, even if another is open now). */
async function addResult(
	editor: EditorCore,
	projectId: string,
	file: File,
	neural: NeuralAssetInfo,
	ephemeral = false,
): Promise<MediaAsset> {
	const [processed] = await processMediaAssets({ files: [file] });
	if (!processed) throw new Error("The editor couldn't read the AI effect's result");
	const asset = { ...processed, origin: "result" as const, neural, ephemeral };
	if (editor.project.getActiveOrNull()?.metadata.id !== projectId) {
		const stored: MediaAsset = { ...asset, id: generateUUID() };
		await storageService.saveMediaAsset({ projectId, mediaAsset: stored });
		return stored;
	}
	const added = await editor.media.addMediaAsset({ projectId, asset });
	if (!added) throw new Error("Not enough storage space for the result — free some disk space and retry");
	return added;
}

function findElement(editor: EditorCore, trackId: string, elementId: string): TimelineElement | undefined {
	return editor.timeline
		.getElementsWithTracks({ elements: [{ trackId, elementId }] })
		.find((x) => x.element.id === elementId)?.element;
}

async function runOnClip(editor: EditorCore, target: Target, effect: NeuralEffect, values: ParamValues) {
	const projectId = editor.project.getActiveOrNull()?.metadata.id;
	if (!projectId) return;
	const assets = editor.media.getAssets();
	const { element } = target;

	const family: NeuralFamily = FAMILIES[effect.family];
	// Applying the same kind of AI effect again replaces the earlier one: work from the media it was made from.
	let source = target.asset;
	let shift = 0;
	if (target.asset.neural && neuralEffect(target.asset.neural.effect)?.family === effect.family) {
		const from = assets.find((a) => a.id === target.asset.neural?.sourceId);
		if (from?.file) {
			source = from;
			shift = target.asset.neural.offset ?? 0;
		}
	}
	const rate = element.retime?.rate ?? 1;
	const trimStart = sec(element.trimStart) + shift;
	const visible = sec(element.duration) * rate;
	const sourceLength = source.duration ?? trimStart + visible + sec(element.trimEnd);
	const onSound = family.tool === "audio";
	// The whole file, unless the clip uses a short piece of a long one (then the piece plus 1 s handles). Sound is
	// always the whole file: it is fast, and a copied picture can only start at a key frame.
	let start = 0;
	let length = sourceLength;
	if (!onSound && sourceLength > Math.max(60, visible + 20)) {
		start = Math.max(0, trimStart - 1);
		length = Math.min(sourceLength - start, trimStart - start + visible + 1);
	}
	const params = helperOptions(family, values);
	// An audio clip gets sound back (a video's picture isn't needed). Separate: the engine the user has, and the music's key.
	const soundOnly = onSound && element.type === "audio";
	if (soundOnly) params.kind = "audio";
	if (family.id === "separate") params.engine = values.engine === "quick" ? "apple" : await separationEngine();
	// Color match: the reference's colours (its histogram, measured by the panel) are part of the request and of the key.
	if (family.id === "colorMatch") params.ref = String(values.ref ?? "");
	const twoPass = family.op === "matte";
	const label = describe(family, values);
	const keyFor = (quality: string) =>
		sha(
			[VERSION, source.id, source.file.size, family.op, JSON.stringify(Object.entries(params).sort()), start.toFixed(3), length.toFixed(3), quality].join("|"),
		);
	const key = await keyFor(twoPass ? "balanced" : "");
	const musicKey = family.id === "separate" ? await keyFor("music") : null;
	if (musicKey) params.musicKey = musicKey;
	// The clip already shows this very result (the same tool, the same settings): nothing to redo (Separate would lay a
	// second music clip).
	if (target.asset.neural?.key === key) {
		toast(`${label} is already on this clip`);
		return;
	}
	// The same effect with the same settings already running on this clip: nothing to start.
	const runKey = `${element.id}|${key}`;
	if (runningOnClip.has(runKey)) {
		toast(`${label} is already running on this clip`);
		return;
	}
	runningOnClip.add(runKey);
	let separated: () => void = () => {};
	if (family.id === "separate") separating.set(element.id, new Promise<void>((resolve) => (separated = resolve)));
	const names = family.id === "separate" ? separationNames(source.name) : null;

	const controller = new AbortController();
	let serverJob: string | null = null;
	const began = Date.now();
	const jobId = jobCenter.start({
		kind: "other",
		title: label,
		stage: "Preparing the clip",
		progress: 0,
		tab: "effects",
		place: { elements: [element.id] },
		cancel: () => {
			controller.abort();
			if (serverJob) void fetch(`${BASE}/jobs/${serverJob}`, { method: "DELETE", headers: { "X-Studio": "1" } }).catch(() => {});
		},
	});
	noteJob(element.id, jobId);
	try {
		// The tool's model, when it isn't on this Mac yet: downloaded now, inside this very progress («Downloading the
		// model · 504 MB · 3 %»), Cancel stops it — no question first. Started in Settings → AI, it is the same download.
		// The bar never goes back: the work after a download fills what the download left.
		let floor = 0;
		const model = modelFor(family, values);
		if (model && params.engine !== "apple") {
			await requireModel(model, {
				signal: controller.signal,
				onProgress: (f, label) => {
					floor = 0.2 * f;
					jobCenter.update(jobId, { stage: label, progress: floor });
				},
			});
		}
		if (controller.signal.aborted) throw new Cancelled();
		const info: NeuralAssetInfo = {
			effect: effect.id,
			key,
			label,
			params: values as NeuralAssetInfo["params"],
			sourceId: source.id,
			originalId: source.neural?.originalId ?? source.id,
			offset: start,
			...(twoPass ? { quality: "balanced" as const } : {}),
		};
		// The same clip and settings were processed before in this project: reuse that media.
		let result = editor.media.getAssets().find((a) => a.neural?.key === key && a.file);
		let stats: ServerResult | null = null;
		if (!result) {
			stats = await processOnServer({
				source,
				effect: { op: family.op, name: label },
				params: twoPass ? { ...params, quality: "balanced" } : params,
				key,
				start,
				length,
				signal: controller.signal,
				report: (progress, stage) => jobCenter.update(jobId, { progress: floor + (1 - floor) * progress, stage }),
				onServerJob: (id) => {
					serverJob = id;
				},
			});
			jobCenter.update(jobId, { stage: "Adding the result to Media", progress: floor + (1 - floor) * 0.96 });
			const file = await download(key, names ? names.voiceFile : `${baseName(source.name)} · ${effect.done}.mov`, soundOnly);
			if (controller.signal.aborted) throw new Cancelled();
			result = await addResult(editor, projectId, file, info);
		}
		// Separate: the music as media of its own (made in the same run, under its own key).
		let music: MediaAsset | null = null;
		if (musicKey) {
			music = editor.media.getAssets().find((a) => a.neural?.key === musicKey && a.file) ?? null;
			if (!music) {
				const file = await download(musicKey, names ? names.musicFile : `${baseName(source.name)} · Music.m4a`, true);
				if (controller.signal.aborted) throw new Cancelled();
				music = await addResult(editor, projectId, file, { ...info, key: musicKey, label: "Music" });
			}
		}

		// One undo step: the clip now shows the result (and Separate's music lies under it); trims shift when only a
		// piece was processed.
		const now = findElement(editor, target.trackId, element.id);
		const sameClip = (now?.type === "video" || now?.type === "audio") && "mediaId" in now && now.mediaId === target.asset.id;
		if (sameClip && editor.project.getActiveOrNull()?.metadata.id === projectId) {
			// a new result supersedes one switched off in the inspector
			const patch: Partial<VideoElement | UploadAudioElement> = { mediaId: result.id, ...(now.type === "video" ? { aiOff: undefined } : {}), ...(names ? { name: names.voice } : {}) };
			if (start > 0 || shift > 0) {
				const newTrimStart = trimStart - start;
				const total = result.duration ?? length;
				patch.trimStart = mt(newTrimStart);
				patch.trimEnd = mt(total - newTrimStart - visible);
				if (now.sourceDuration != null) patch.sourceDuration = mt(total);
			}
			const commands: Command[] = [new UpdateElementsCommand({ updates: [{ trackId: target.trackId, elementId: element.id, patch: patch as Partial<TimelineElement> }] })];
			// The music goes under the clip; the clip stays selected (inserting selects the new clip).
			const musicEl = music ? { ...musicElement(now, music), ...(names ? { name: names.music } : {}) } : null;
			if (musicEl) commands.push(new InsertElementCommand({ element: musicEl as TimelineElement, placement: { mode: "auto" } }), new SelectClip({ trackId: target.trackId, elementId: element.id }));
			editor.command.execute({ command: commands.length > 1 ? new BatchCommand(commands) : commands[0] });
		}
		const took = (Date.now() - began) / 1000;
		const speed = stats && !stats.cached ? ` · ${formatSeconds(took)}${stats.fps > 0 ? `, ${Math.round(stats.fps)} fps` : ""}` : " · from cache";
		// Separate says where each part went (Claude reads the job's line): the voice is the clip, the music lies under it.
		const placedMusic = music && sameClip ? editor.scenes.getActiveScene().tracks.audio.flatMap((t) => t.elements as TimelineElement[]).find((e) => "mediaId" in e && (e as { mediaId?: string }).mediaId === music?.id && e.startTime === now?.startTime) : undefined;
		const parts = names && sameClip ? `: voice → clip ${element.id.slice(0, 8)} «${names.voice}» (media ${result.id.slice(0, 8)})${music ? ` · music → ${placedMusic ? `clip ${placedMusic.id.slice(0, 8)}` : "Media"} «${names.music}» (media ${music.id.slice(0, 8)})` : ""}; both together are the song` : "";
		jobCenter.finish(jobId, sameClip ? `${effect.done}${parts}${speed}` : `${effect.done} — the clip changed meanwhile; the result is in Media → Results`);
		jobCenter.update(jobId, { messageDetail: "An effect on the clip: its eye or 🗑 in the clip's Effects tab (or ⌘Z) brings the original back" });

		if (twoPass && sameClip && result.neural && !result.neural.exportId) {
			refineForExport({ editor, projectId, elementId: element.id, preview: result, source, effect, family, params, label, start, length, keyFor, values });
		}
	} catch (error) {
		// Cancelled here, or its model's download cancelled in Settings → AI (an AbortError): no error, nothing red.
		if (error instanceof Cancelled || controller.signal.aborted || (error as Error)?.name === "AbortError") {
			jobCenter.cancelled(jobId);
			return;
		}
		jobCenter.fail(jobId, error instanceof Error ? error.message : `${label} failed`);
		jobCenter.update(jobId, { retry: () => void runOnClip(editor, target, effect, values) });
	} finally {
		runningOnClip.delete(runKey);
		if (separating.has(element.id)) {
			separating.delete(element.id);
			separated();
		}
	}
}

/** Selects a clip as the last step of a batch (and again on redo); nothing to undo. */
class SelectClip extends Command {
	constructor(private readonly ref: { trackId: string; elementId: string }) {
		super();
	}
	execute() {
		return createElementSelectionResult([this.ref]);
	}
	undo() {}
}

/** The model a tool runs on, for these settings (none: it runs without one). */
function modelFor(family: NeuralFamily, values: ParamValues): ModelId | null {
	return typeof family.model === "function" ? family.model(values) : (family.model ?? null);
}

/**
 * Separate's engine: the downloaded one (Demucs; the run gets it first when it isn't here yet), or the one built into
 * macOS on a Mac that can't run it.
 */
async function separationEngine(): Promise<"demucs" | "apple"> {
	const state = useOndeviceStore.getState().state ?? (await useOndeviceStore.getState().refresh());
	const model = state?.models.find((m) => m.id === "separate");
	return model?.unsupported ? "apple" : "demucs";
}

/** Separate's music clip: the same piece of the same moment as the clip it came from, on an audio track. */
function musicElement(clip: TimelineElement, music: MediaAsset) {
	const element = buildElementFromMedia({ mediaId: music.id, mediaType: "audio", name: music.name, duration: clip.duration, startTime: clip.startTime });
	const timing = clip as VideoElement;
	return { ...element, trimStart: timing.trimStart, trimEnd: timing.trimEnd, duration: clip.duration, ...(timing.retime ? { retime: timing.retime } : {}) };
}

/** Remove Background's accurate pass, in the background; export uses it (and waits for it if needed). */
function refineForExport({
	editor,
	projectId,
	elementId,
	preview,
	source,
	effect,
	family,
	params,
	label,
	start,
	length,
	keyFor,
	values,
}: {
	editor: EditorCore;
	projectId: string;
	elementId: string;
	preview: MediaAsset;
	source: MediaAsset;
	effect: NeuralEffect;
	family: NeuralFamily;
	params: Record<string, string | number>;
	label: string;
	start: number;
	length: number;
	keyFor: (quality: string) => Promise<string>;
	values: ParamValues;
}) {
	const controller = new AbortController();
	let serverJob: string | null = null;
	const work = (async () => {
		const key = await keyFor("accurate");
		const jobId = jobCenter.start({
			kind: "other",
			title: `${family.name} · export quality`,
			stage: "Accurate edges for export",
			progress: 0,
			tab: "effects",
			cancel: () => {
				controller.abort();
				if (serverJob) void fetch(`${BASE}/jobs/${serverJob}`, { method: "DELETE", headers: { "X-Studio": "1" } }).catch(() => {});
			},
		});
		noteJob(elementId, jobId);
		try {
			let twin = editor.media.getAssets().find((a) => a.neural?.key === key && a.file);
			if (!twin) {
				await processOnServer({
					source,
					effect: { op: family.op, name: family.name },
					params: { ...params, quality: "accurate" },
					key,
					start,
					length,
					signal: controller.signal,
					report: (progress, stage) => jobCenter.update(jobId, { progress, stage: `Accurate edges for export · ${stage}` }),
					onServerJob: (id) => {
						serverJob = id;
					},
				});
				const file = await download(key, `${baseName(source.name)} · ${effect.done} (export).mov`);
				twin = await addResult(
					editor,
					projectId,
					file,
					{
						effect: effect.id,
						key,
						label: `${label} · export quality`,
						params: values as NeuralAssetInfo["params"],
						sourceId: source.id,
						originalId: source.neural?.originalId ?? source.id,
						offset: start,
						quality: "accurate",
					},
					true,
				);
			}
			// Link the preview copy to its export copy (media info, not an edit: nothing to undo).
			const neural = { ...(preview.neural as NeuralAssetInfo), exportId: twin.id };
			if (editor.project.getActiveOrNull()?.metadata.id === projectId) {
				editor.media.setAssets({
					assets: editor.media.getAssets().map((a) => (a.id === preview.id ? { ...a, neural } : a)),
				});
			}
			await storageService.updateMediaNeuralInfo({ projectId, id: preview.id, neural });
			jobCenter.finish(jobId, "Export will use the accurate cut-out");
			const sent = sentSources.get(source.id);
			if (sent) {
				sentSources.delete(source.id);
				void fetch(`${BASE}/file/${sent}`, { method: "DELETE", headers: { "X-Studio": "1" } }).catch(() => {});
			}
		} catch (error) {
			if (error instanceof Cancelled || controller.signal.aborted) {
				jobCenter.cancelled(jobId);
				return;
			}
			jobCenter.fail(jobId, `${error instanceof Error ? error.message : "Failed"} — export uses the preview cut-out`);
		}
	})();
	trackExportQuality(work);
}

/**
 * The AI effects on a clip as the inspector lists them, first to last: each result was made from the one before (the
 * clip shows the last; while its eye is off, the media before it — `element.aiOff` keeps the result).
 */
export function aiStepsOf(assets: MediaAsset[], element: VideoElement | ImageElement): MediaAsset[] {
	const steps: MediaAsset[] = [];
	let current = assets.find((a) => a.id === (element.aiOff ?? element.mediaId));
	for (let hops = 0; current?.neural && hops < 16; hops++) {
		steps.unshift(current);
		const source: string = current.neural.sourceId;
		current = assets.find((a) => a.id === source);
	}
	return steps;
}

/** Seconds `from` starts into `to`, walking `from`'s AI chain back to it; null when `to` isn't in it. */
function offsetInto(assets: MediaAsset[], from: MediaAsset, to: MediaAsset): number | null {
	let current: MediaAsset | undefined = from;
	let offset = 0;
	for (let hops = 0; current && current.id !== to.id && hops < 16; hops++) {
		if (!current.neural) return null;
		offset += current.neural.offset ?? 0;
		const source: string = current.neural.sourceId;
		current = assets.find((a) => a.id === source);
	}
	return current?.id === to.id ? offset : null;
}

/** The clip shows `to` (its trims moved by `offset` seconds); one undo step. */
function showMedia(trackId: string, element: VideoElement | ImageElement, to: MediaAsset, offset: number, aiOff: string | undefined): void {
	const editor = EditorCore.getInstance();
	const patch: Partial<VideoElement> = { mediaId: to.id, aiOff };
	if (offset !== 0 && element.type === "video") {
		const visible = sec(element.duration) * (element.retime?.rate ?? 1);
		const trimStart = sec(element.trimStart) + offset;
		patch.trimStart = mt(trimStart);
		const total = to.duration ?? trimStart + visible;
		patch.trimEnd = mt(total - trimStart - visible);
		if (element.sourceDuration != null) patch.sourceDuration = mt(total);
	}
	editor.command.execute({ command: new UpdateElementsCommand({ updates: [{ trackId, elementId: element.id, patch: patch as Partial<TimelineElement> }] }) });
}

/**
 * Inspector → an AI effect's 🗑: the clip shows the media that step was made from again, as removing an effect does
 * (the steps after it were made from it and go too). The result stays in Media → Results; ⌘Z brings it back.
 */
export function removeAiStep(trackId: string, elementId: string, stepId: string): boolean {
	const editor = EditorCore.getInstance();
	const element = findElement(editor, trackId, elementId);
	if (element?.type !== "video" && element?.type !== "image") return false;
	const assets = editor.media.getAssets();
	const step = assets.find((a) => a.id === stepId);
	const target = step?.neural && assets.find((a) => a.id === step.neural?.sourceId);
	const shown = assets.find((a) => a.id === element.mediaId);
	if (!target || !shown) return false;
	const offset = offsetInto(assets, shown, target);
	if (offset == null) {
		// switched off at this very step: the clip already shows its source
		if (element.aiOff === stepId && shown.id === target.id) showMedia(trackId, element, target, 0, undefined);
		else return false;
		return true;
	}
	showMedia(trackId, element, target, offset, undefined);
	return true;
}

/** Inspector → the last AI effect's eye: off shows the media it was made from, on shows the result again. */
export function toggleAiResult(trackId: string, elementId: string): boolean {
	const editor = EditorCore.getInstance();
	const element = findElement(editor, trackId, elementId);
	if (element?.type !== "video" && element?.type !== "image") return false;
	const assets = editor.media.getAssets();
	const shown = assets.find((a) => a.id === element.mediaId);
	if (!shown) return false;
	if (element.aiOff) {
		const result = assets.find((a) => a.id === element.aiOff);
		const back = result ? offsetInto(assets, result, shown) : null;
		if (!result || back == null) return false;
		showMedia(trackId, element, result, -back, undefined);
		return true;
	}
	const source = shown.neural && assets.find((a) => a.id === shown.neural?.sourceId);
	if (!source) return false;
	showMedia(trackId, element, source, shown.neural?.offset ?? 0, shown.id);
	return true;
}

/** Properties → "Use original": the clip goes back to the user's own media (one undo step). */
export function restoreOriginal(trackId: string, elementId: string): boolean {
	const editor = EditorCore.getInstance();
	const element = findElement(editor, trackId, elementId);
	if (element?.type !== "video" && element?.type !== "image" && !(element?.type === "audio" && element.sourceType === "upload")) return false;
	const assets = editor.media.getAssets();
	const asset = assets.find((a) => a.id === element.mediaId);
	if (!asset) return false;
	const root = originalOf(assets, asset);
	if (!root) return false;
	const patch: Partial<VideoElement> = { mediaId: root.original.id, aiOff: undefined };
	if (root.offset > 0 && element.type !== "image") {
		const visible = sec(element.duration) * (element.retime?.rate ?? 1);
		const trimStart = sec(element.trimStart) + root.offset;
		patch.trimStart = mt(trimStart);
		const total = root.original.duration ?? trimStart + visible;
		patch.trimEnd = mt(total - trimStart - visible);
		if (element.type === "video" && element.sourceDuration != null) patch.sourceDuration = mt(total);
	}
	editor.command.execute({ command: new UpdateElementsCommand({ updates: [{ trackId, elementId, patch: patch as Partial<TimelineElement> }] }) });
	return true;
}
