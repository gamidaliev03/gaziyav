// Motion jobs from the editor: the clip's media is sent to the local server once, the native helper tracks /
// reverses / interpolates (progress in the job center, the header chip and the Dock; Cancel stops it), and the
// result lands in the project as one ⌘Z. The clip's original media is only read — never changed or removed.
import { EditorCore } from "@/core";
import { jobCenter } from "@/jobs/store";
import { processMediaAssets } from "@/media/processing";
import type { MediaAsset } from "@/media/types";
import { getSourceTimeAtClipTime } from "@/retime/resolve";
import { followJob, studioApi, uploadOnce, type JobState } from "@/studio/client/api";
import type { MediaAssetData } from "@/services/storage/types";
import { storageService } from "@/services/storage/service";
import type { VideoElement } from "@/timeline";
import { generateUUID } from "@/utils/id";
import { TICKS_PER_SECOND, type MediaTime } from "@/wasm";
import { frameRateToFloat } from "@/fps/utils";
import { addTracker, applyReframe, applyReverse, locate, playsOwnReversedCopy, removeReverse, updateTracker, type AspectId } from "./commands";
import { clipSourceSeconds, makeFollowResolver, trackerCanvasPoint } from "./follow";
import { smoothFactorFor, SMOOTH_VERSION } from "./smooth";
import { type MotionJobKind, useMotionStore } from "./store";
import type { Tracker, TrackerFx, TrackerKind } from "./types";

type ProxyMeta = NonNullable<MediaAssetData["motionProxy"]>;

interface TrackResult {
	frame: [number, number];
	fps: number;
	samples: number[][];
}

interface RenderResult {
	fileId: string;
	name: string;
	neural?: boolean;
}

class Cancelled extends Error {}

async function post<T>(path: string, body: unknown): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`/api/studio/${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Studio": "1" },
			body: JSON.stringify(body),
		});
	} catch {
		throw new Error("Gaziyav's local server is not responding. Restart Gaziyav.");
	}
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new Error(data?.error || `Request failed (HTTP ${res.status})`);
	return data as T;
}

/** Ticks → seconds (computed spans of a speed ramp are not whole ticks). */
const secs = (t: number) => t / TICKS_PER_SECOND;

function editor() {
	return EditorCore.getInstance();
}

function clipAndAsset(elementId: string): { clip: VideoElement; asset: MediaAsset } {
	const at = locate(editor(), elementId);
	if (!at || at.element.type !== "video") throw new Error("Select a video clip on the timeline");
	const clip = at.element as VideoElement;
	const asset = editor().media.getAssets().find((m) => m.id === clip.mediaId);
	if (!asset?.file) throw new Error("This clip's media file is missing from the project");
	return { clip, asset };
}

/** Seconds of the media the clip shows: [start, end]. */
export function clipSourceRange(clip: VideoElement): [number, number] {
	const s0 = secs(clip.trimStart);
	return [s0, s0 + secs(getSourceTimeAtClipTime({ clipTime: clip.duration, retime: clip.retime, duration: clip.duration }))];
}

function projectFps(): number {
	const fps = editor().project.getActiveOrNull()?.settings.fps;
	const f = fps ? frameRateToFloat(fps) : 30;
	return Number.isFinite(f) && f > 0 ? f : 30;
}

function baseName(name: string): string {
	return name.replace(/\.[a-z0-9]{2,4}$/i, "");
}

/**
 * One job: upload (once per media file), start on the server, follow, then `onResult`. Errors are shown in the job
 * center and on the clip's panel unless `quiet` (the caller handles them); Cancel → null.
 */
async function runJob<T>({
	key,
	kind,
	elementId,
	title,
	asset,
	start,
	onResult,
	quiet = false,
	need,
}: {
	need?: string;
	key: string;
	kind: MotionJobKind;
	elementId: string;
	title: string;
	asset: MediaAsset;
	start: (fileId: string) => Promise<JobState>;
	onResult: (result: T) => Promise<string | void> | string | void;
	quiet?: boolean;
}): Promise<T | null> {
	const store = useMotionStore.getState();
	if (store.jobs[key]?.status === "running") return null;
	let serverJob: string | null = null;
	let cancelled = false;
	let userCancelled = false;
	const stop = () => {
		cancelled = true;
		if (serverJob) void studioApi.cancel(serverJob).catch(() => {});
	};
	/** The Cancel button (a replaced render is stopped with `stop`, and may restart). */
	const cancel = () => {
		userCancelled = true;
		stop();
	};
	const centerId = jobCenter.start({ kind: "other", title, stage: "Preparing the clip", cancel });
	store.setJob({ key, kind, elementId, title, status: "running", stage: "Preparing the clip", cancel, need, stop });
	const report = (stage: string | undefined, progress: number | undefined) => {
		jobCenter.update(centerId, { stage, progress });
		useMotionStore.getState().patchJob(key, { stage, progress });
	};
	try {
		const upload = await uploadOnce(`motion:${asset.id}`, asset.file, (p) => report("Preparing the clip", p));
		if (cancelled) throw new Cancelled();
		const job = await start(upload.fileId);
		serverJob = job.id;
		if (cancelled) {
			stop();
			throw new Cancelled();
		}
		const final = await followJob(job.id, (s) => {
			const stage = s.stages.find((x) => x.status === "running") ?? s.stages.find((x) => x.status === "pending");
			report(stage?.detail ? `${stage.title} — ${stage.detail}` : stage?.title, stage?.progress);
		});
		if (cancelled || final.status === "cancelled") throw new Cancelled();
		if (final.status !== "done") throw new Error(final.error || `${title} failed`);
		report("Finishing", 1);
		const message = await onResult(final.result as T);
		jobCenter.finish(centerId, message || "Done");
		useMotionStore.getState().removeJob(key);
		return final.result as T;
	} catch (error) {
		if (cancelled || error instanceof Cancelled) {
			jobCenter.cancelled(centerId);
			useMotionStore.getState().removeJob(key);
			if (need && userCancelled) useMotionStore.getState().setSkipped(elementId, need);
			return null;
		}
		const message = error instanceof Error ? error.message : String(error);
		if (quiet) {
			jobCenter.remove(centerId);
			useMotionStore.getState().removeJob(key);
			throw error;
		}
		jobCenter.fail(centerId, message);
		useMotionStore.getState().patchJob(key, { status: "error", error: message, cancel: undefined, progress: undefined });
		return null;
	}
}

const KIND_TITLE: Record<TrackerKind, string> = { face: "Face", object: "Object", subject: "Subject" };

/**
 * Tracks a face (auto, or the one nearest `point`), a subject (click) or an object (drawn box) over the clip,
 * forward and backward from the playhead. Adds the tracker to the clip (one ⌘Z) and returns it.
 */
export async function trackClip({
	elementId,
	kind,
	rect,
	point,
	fx,
	quiet = false,
	add = true,
	replace,
	direction = "both",
}: {
	elementId: string;
	kind: TrackerKind;
	rect?: [number, number, number, number];
	point?: [number, number];
	fx?: TrackerFx;
	quiet?: boolean;
	/** false: return the tracker without adding it (the caller adds it in its own ⌘Z step). */
	add?: boolean;
	/** Re-track: new samples for this tracker (keeps its name, action and attached layers). */
	replace?: string;
	/** Re-track only after (forward) or before (backward) the playhead; the other side keeps its samples. */
	direction?: "both" | "forward" | "backward";
}): Promise<Tracker | null> {
	const { clip, asset } = clipAndAsset(elementId);
	const [s0, s1] = clipSourceRange(clip);
	const clipStart = Math.max(0, s0 - 0.25);
	const clipEnd = Math.min(asset.duration ?? s1 + 0.25, s1 + 0.25);
	const at = Math.min(clipEnd, Math.max(clipStart, clipSourceSeconds(clip, editor().playback.getCurrentTime())));
	const start = direction === "forward" ? at : clipStart;
	const end = direction === "backward" ? at : clipEnd;
	let created: Tracker | null = null;
	await runJob<TrackResult>({
		key: `track:${elementId}`,
		kind: "track",
		elementId,
		title: `Track ${KIND_TITLE[kind].toLowerCase()}`,
		asset,
		quiet,
		start: (fileId) => post<JobState>("jobs/track", { fileId, kind, start, end, at, rect, point }),
		onResult: (r) => {
			const current = locate(editor(), elementId)?.element as VideoElement | undefined;
			if (!current || current.mediaId !== asset.id) throw new Error("The clip changed while tracking — track it again");
			const old = replace ? current.trackers?.find((t) => t.id === replace) : undefined;
			if (old) {
				// Only the re-tracked side changes: the samples on the other side of the playhead are kept.
				const eps = 1 / 240;
				const keep = old.samples.filter((row) => (direction === "forward" ? row[0] < at - eps : direction === "backward" ? row[0] > at + eps : false));
				const samples = [...keep, ...r.samples].sort((p, q) => p[0] - q[0]);
				updateTracker(editor(), elementId, old.id, { samples, frame: r.frame });
				created = { ...old, samples, frame: r.frame };
				return `${old.name} re-tracked (${r.samples.length} frames)`;
			}
			const n = (current.trackers ?? []).filter((t) => t.kind === kind).length + 1;
			const tracker: Tracker = {
				id: generateUUID(),
				name: `${KIND_TITLE[kind]} ${n}`,
				kind,
				samples: r.samples,
				frame: r.frame,
				smoothing: kind === "face" ? 0.55 : 0.45,
				...(fx ? { fx } : {}),
			};
			if (add) {
				addTracker(editor(), elementId, tracker);
				useMotionStore.getState().select(elementId, tracker.id);
			}
			created = tracker;
			return `${tracker.name} tracked (${r.samples.length} frames)`;
		},
	});
	return created;
}

function activeProjectId(): string | null {
	return editor().project.getActiveOrNull()?.metadata.id ?? null;
}

/**
 * Adds a rendered file to the project the job was started in. When the user has opened another project
 * meanwhile, it is saved into its own project (found there next time) and `null` is returned: nothing is applied.
 */
async function importProxy(file: File, meta: ProxyMeta, projectId: string | null): Promise<MediaAsset | null> {
	const ed = editor();
	if (!projectId) throw new Error("No project is open");
	const [processed] = await processMediaAssets({ files: [file] });
	if (!processed) throw new Error("The editor couldn't read the rendered file");
	const asset = { ...processed, origin: "result" as const, motionProxy: meta };
	if (activeProjectId() !== projectId) {
		await storageService.saveMediaAsset({ projectId, mediaAsset: { ...asset, id: generateUUID() } });
		return null;
	}
	const added = await ed.media.addMediaAsset({ projectId, asset });
	if (!added) throw new Error("Not enough editor storage space — free some disk space and retry");
	return added;
}

/**
 * Reverse on/off. Off is instant (the original media is still there); on renders a reversed copy once. When the
 * picture was replaced after Reverse (an AI effect…), off reverses that picture back instead of dropping it.
 */
export async function toggleReverse(elementId: string): Promise<boolean> {
	const ed = editor();
	const { clip, asset } = clipAndAsset(elementId);
	const back = !!clip.reversed && !playsOwnReversedCopy(ed, clip);
	if (clip.reversed && !back) return removeReverse(ed, elementId);
	const [s0, s1] = clipSourceRange(clip);
	const existing = ed.media
		.getAssets()
		.find((m) => m.motionProxy?.reverse && m.motionProxy.of === asset.id && m.motionProxy.a <= s0 + 0.01 && m.motionProxy.b >= s1 - 0.01);
	if (existing?.motionProxy) return applyReverse(ed, elementId, existing, existing.motionProxy.a, existing.motionProxy.b, { back });
	const duration = asset.duration ?? s1;
	// Short files are reversed whole (trim freely afterwards); long ones around the clip.
	const a = duration <= 90 ? 0 : Math.max(0, s0 - 3);
	const b = duration <= 90 ? duration : Math.min(duration, s1 + 3);
	let ok = false;
	const projectId = activeProjectId();
	await runJob<RenderResult>({
		key: `reverse:${elementId}`,
		kind: "reverse",
		elementId,
		title: back ? "Play forwards" : "Reverse",
		asset,
		start: (fileId) => post<JobState>("jobs/motion", { fileId, op: "reverse", start: a, end: b, name: `${baseName(asset.name)} · reversed` }),
		onResult: async (r) => {
			const file = await studioApi.fetchFile(r.fileId, r.name, "video/mp4");
			const reversed = await importProxy(file, { of: asset.id, a, b, m: 1, fps: asset.fps ?? projectFps(), reverse: true }, projectId);
			if (!reversed) return "Reversed copy saved in its project";
			const now = locate(ed, elementId)?.element as VideoElement | undefined;
			if (!now || now.mediaId !== asset.id || !!now.reversed !== back) return "Reversed copy saved — the clip changed meanwhile";
			ok = applyReverse(ed, elementId, reversed, a, b, { back });
			return back ? "Clip plays forwards" : "Clip reversed";
		},
	});
	return ok;
}

export type StabilizeLevel = "recommended" | "mincrop" | "most";

/** What Stabilize keeps on the clip: the level and the original it was made from (params, so it saves with the project). */
export function stabilizeOf(clip: VideoElement): { level: StabilizeLevel; mediaId: string; a: number; sourceDuration: number } | null {
	const level = clip.params["stabilize.level"];
	const mediaId = clip.params["stabilize.of"];
	// "" = off (a params patch merges, so off clears the level instead of dropping the keys)
	if (typeof level !== "string" || !level || typeof mediaId !== "string") return null;
	return {
		level: level as StabilizeLevel,
		mediaId,
		a: Number(clip.params["stabilize.a"] ?? 0),
		sourceDuration: Number(clip.params["stabilize.src"] ?? clip.sourceDuration),
	};
}

const tk = (ticks: number) => Math.round(ticks) as MediaTime;

/** The clip's params with Stabilize off (element param patches merge into the old params: keys are cleared, not dropped). */
const withoutStabilize = (params: VideoElement["params"]) => ({ ...params, "stabilize.level": "", "stabilize.of": "", "stabilize.a": 0, "stabilize.src": 0 });

/** The clip on its original media again, the same piece of it (one ⌘Z). */
function unstabilize(elementId: string): boolean {
	const ed = editor();
	const at = locate(ed, elementId);
	if (!at || at.element.type !== "video") return false;
	const clip = at.element as VideoElement;
	const link = stabilizeOf(clip);
	const asset = link ? ed.media.getAssets().find((m) => m.id === link.mediaId) : null;
	if (!link || !asset) return false;
	const sourceDuration = Number.isFinite(link.sourceDuration) ? link.sourceDuration : Math.round((asset.duration ?? 0) * TICKS_PER_SECOND);
	const [s0, s1] = clipSourceRange(clip);
	ed.timeline.updateElements({
		updates: [
			{
				trackId: at.trackId,
				elementId,
				patch: {
					mediaId: link.mediaId,
					trimStart: tk((s0 + link.a) * TICKS_PER_SECOND),
					trimEnd: tk(Math.max(0, sourceDuration - (s1 + link.a) * TICKS_PER_SECOND)),
					sourceDuration: tk(sourceDuration),
					params: withoutStabilize(clip.params),
				} as Partial<VideoElement>,
			},
		],
	});
	return true;
}

/**
 * Basic → Stabilize (CapCut): on renders a steadied copy of the clip's piece of its media once (ffmpeg vid.stab, in
 * the background with progress and Cancel) and the clip plays it — one ⌘Z; another level is made from the original;
 * off goes back to the original at once. The original media is never changed.
 */
export async function setStabilize(elementId: string, level: StabilizeLevel | null): Promise<boolean> {
	const ed = editor();
	const at = locate(ed, elementId);
	if (!at || at.element.type !== "video") throw new Error("Select a video clip on the timeline");
	const clip = at.element as VideoElement;
	const link = stabilizeOf(clip);
	if (!level) return link ? unstabilize(elementId) : false;
	if (link?.level === level) return false;
	// the piece of the ORIGINAL media the clip shows now
	const original = ed.media.getAssets().find((m) => m.id === (link?.mediaId ?? clip.mediaId));
	if (!original?.file) throw new Error("This clip's media file is missing from the project");
	const [c0, c1] = clipSourceRange(clip);
	const s0 = c0 + (link?.a ?? 0);
	const s1 = c1 + (link?.a ?? 0);
	const duration = original.duration ?? s1;
	// short files whole (trim freely afterwards), long ones around the clip
	const a = duration <= 90 ? 0 : Math.max(0, s0 - 3);
	const b = duration <= 90 ? duration : Math.min(duration, s1 + 3);
	const sourceDuration = link?.sourceDuration ?? clip.sourceDuration ?? Math.round(duration * TICKS_PER_SECOND);
	const projectId = activeProjectId();
	let ok = false;
	await runJob<RenderResult>({
		key: `stabilize:${elementId}`,
		kind: "stabilize",
		elementId,
		title: "Stabilize",
		asset: original,
		start: (fileId) => post<JobState>("jobs/motion", { fileId, op: "stabilize", level, start: a, end: b, name: `${baseName(original.name)} · stabilized` }),
		onResult: async (r) => {
			const file = await studioApi.fetchFile(r.fileId, r.name, "video/mp4");
			// a motion copy (hidden from the media pool, never taken for a smooth-motion file: v 0, m 1)
			const steady = await importProxy(file, { of: original.id, a, b, m: 1, fps: original.fps ?? projectFps(), v: 0 }, projectId);
			if (!steady) return "Stabilized copy saved in its project";
			const now = locate(ed, elementId);
			if (!now || now.element.type !== "video" || (now.element as VideoElement).mediaId !== clip.mediaId) return "Stabilized copy saved — the clip changed meanwhile";
			const current = now.element as VideoElement;
			const length = steady.duration ?? b - a;
			const [n0, n1] = clipSourceRange(current);
			const from = n0 + (link?.a ?? 0);
			const to = n1 + (link?.a ?? 0);
			ed.timeline.updateElements({
				updates: [
					{
						trackId: now.trackId,
						elementId,
						patch: {
							mediaId: steady.id,
							trimStart: tk(Math.max(0, from - a) * TICKS_PER_SECOND),
							trimEnd: tk(Math.max(0, length - (to - a)) * TICKS_PER_SECOND),
							sourceDuration: tk(length * TICKS_PER_SECOND),
							params: { ...withoutStabilize(current.params), "stabilize.level": level, "stabilize.of": original.id, "stabilize.a": a, "stabilize.src": sourceDuration },
						} as Partial<VideoElement>,
					},
				],
			});
			ok = true;
			return "Clip stabilized";
		},
	});
	return ok;
}


/** The smooth-motion file this clip needs right now, if it is missing (null = nothing to render). */
export function missingSmooth(clip: VideoElement, assets: MediaAsset[]): { factor: number; a: number; b: number } | null {
	if (!clip.retime?.smooth) return null;
	const factor = smoothFactorFor(clip.retime);
	if (factor <= 1) return null;
	const [s0, s1] = clipSourceRange(clip);
	const has = assets.some((m) => {
		const p = m.motionProxy;
		return p && !p.reverse && (p.v ?? 1) >= SMOOTH_VERSION && p.of === clip.mediaId && p.a <= s0 + 0.02 && p.b >= s1 - 0.02 && Math.abs(p.m - factor) / factor < 0.02;
	});
	if (has) return null;
	return { factor, a: s0, b: s1 };
}

export function smoothNeedKey(need: { factor: number; a: number; b: number }): string {
	return `${need.factor.toFixed(3)}:${need.a.toFixed(2)}:${need.b.toFixed(2)}`;
}

/** Renders the optical-flow file for the clip's current speed and range (kept in the project, cached). */
export async function renderSmooth(elementId: string): Promise<boolean> {
	const ed = editor();
	const { clip, asset } = clipAndAsset(elementId);
	const need = missingSmooth(clip, ed.media.getAssets());
	if (!need) return true;
	const key = `smooth:${elementId}`;
	const needKey = smoothNeedKey(need);
	const running = useMotionStore.getState().jobs[key];
	// Already rendering exactly this: nothing to do. Something else (speed/trim changed): restart.
	if (running?.status === "running" && running.need === needKey) return false;
	if (running?.status === "running") running.stop?.();
	const duration = asset.duration ?? need.b;
	const a = Math.max(0, need.a - 0.1);
	const b = Math.min(duration, need.b + 0.1);
	// The file is read at (source s − a) × m seconds, so it is written at the source's own frame rate.
	const fps = asset.fps && asset.fps > 0 ? asset.fps : projectFps();
	let ok = false;
	const projectId = activeProjectId();
	// Wait for a cancelled run to clear.
	for (let i = 0; i < 20 && useMotionStore.getState().jobs[key]?.status === "running"; i++) await new Promise((r) => setTimeout(r, 100));
	await runJob<RenderResult>({
		key,
		kind: "smooth",
		need: needKey,
		elementId,
		title: `Smooth slow motion ${need.factor >= 10 ? need.factor.toFixed(0) : need.factor.toFixed(1)}×`,
		asset,
		start: (fileId) =>
			post<JobState>("jobs/motion", { fileId, op: "smooth", start: a, end: b, factor: need.factor, fps, name: `${baseName(asset.name)} · smooth ${need.factor.toFixed(2)}x` }),
		onResult: async (r) => {
			const file = await studioApi.fetchFile(r.fileId, r.name, "video/mp4");
			const added = await importProxy(file, { of: asset.id, a, b, m: need.factor, fps, v: SMOOTH_VERSION }, projectId);
			if (!added) return "Smooth motion saved in its project";
			ok = true;
			return r.neural === false ? "Smooth motion ready (ffmpeg)" : "Smooth motion ready";
		},
	});
	return ok;
}

/**
 * Make Vertical / Reframe: keeps each clip's face (else its main subject) in frame on the new aspect with
 * smoothed position keyframes. Missing trackers are made first (face, then subject); one ⌘Z for everything.
 */
export async function reframeClips(elementIds: string[], aspect: AspectId | null): Promise<boolean> {
	const ed = editor();
	const plan: Array<{ elementId: string; tracker: Tracker | null; isNew?: boolean }> = [];
	const centerId = jobCenter.start({ kind: "other", title: aspect ? `Make ${aspect}` : "Reframe", stage: "Finding faces" });
	try {
		for (const elementId of elementIds) {
			const at = locate(ed, elementId);
			if (!at || at.element.type !== "video") continue;
			const clip = at.element as VideoElement;
			const selectedId = useMotionStore.getState().selected[elementId];
			let tracker =
				clip.trackers?.find((t) => t.id === selectedId) ??
				clip.trackers?.find((t) => t.kind === "face") ??
				clip.trackers?.find((t) => t.kind === "subject") ??
				clip.trackers?.[0] ??
				null;
			let isNew = false;
			if (!tracker) {
				jobCenter.update(centerId, { stage: `Finding the face in ${clip.name}` });
				tracker = await trackClip({ elementId, kind: "face", quiet: true, add: false }).catch(() => null);
				if (!tracker) {
					jobCenter.update(centerId, { stage: `Finding the subject in ${clip.name}` });
					tracker = await trackClip({ elementId, kind: "subject", quiet: true, add: false }).catch(() => null);
				}
				isNew = !!tracker;
			}
			plan.push({ elementId, tracker, isNew });
		}
		if (!plan.length) throw new Error("Select a video clip");
		applyReframe(ed, plan, aspect);
		const found = plan.filter((p) => p.tracker).length;
		jobCenter.finish(centerId, found === plan.length ? "Reframed — the subject stays in frame" : `Reframed (${plan.length - found} clip(s) centred: nothing to follow)`);
		return true;
	} catch (error) {
		jobCenter.fail(centerId, error instanceof Error ? error.message : String(error));
		return false;
	}
}

/** Offset (canvas px) of a layer that follows a tracker, at a timeline second — for self-tests. */
function followOffset(elementId: string, seconds: number) {
	const ed = editor();
	const tracks = ed.scenes.getActiveSceneOrNull()?.tracks;
	const el = locate(ed, elementId)?.element;
	if (!tracks || !el?.follow) return null;
	const canvas = ed.project.getActiveOrNull()?.settings.canvasSize ?? { width: 1080, height: 1920 };
	return makeFollowResolver(tracks, canvas)(el.follow, Math.round(seconds * TICKS_PER_SECOND));
}

/** Canvas point (px from the centre) of a clip's first tracker at a timeline second — for self-tests. */
function trackerPoint(elementId: string, seconds: number) {
	const ed = editor();
	const clip = locate(ed, elementId)?.element as VideoElement | undefined;
	const tracker = clip?.trackers?.[0];
	if (!clip || !tracker) return null;
	const canvas = ed.project.getActiveOrNull()?.settings.canvasSize ?? { width: 1080, height: 1920 };
	return trackerCanvasPoint({ clip, tracker, timelineTicks: Math.round(seconds * TICKS_PER_SECOND), canvas });
}

if (typeof window !== "undefined") {
	(window as unknown as { __motion: unknown }).__motion = { trackClip, toggleReverse, renderSmooth, reframeClips, missingSmooth, followOffset, trackerPoint, store: useMotionStore };
}
