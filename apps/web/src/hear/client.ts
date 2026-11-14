// The window's side of Claude's ears: which clips sound where on the timeline, their files sent once to the app's
// server (shared with lipsync and scenes), and the server's answers (studio/server/hear.ts) in timeline seconds. No
// sound is decoded or analysed here: the editor stays smooth. Importable as functions (claude-produce builds on them).
import type { HeardStretch, Placement, RangeMap, Seam, SeamFix, SeamReport } from "@/studio/server/hear";
import type { HearModelState } from "@/studio/server/hear-models";
import type { CutPoint, PlannedCut, Snapped } from "./cuts";
import { EditorCore } from "@/core";
import type { MediaAsset } from "@/media/types";
import { followJob, uploadOnce } from "@/studio/client/api";
import type { JobState } from "@/studio/server/jobs";
import type { TimelineElement, TimelineTrack } from "@/timeline";
import { isRetimableElement } from "@/timeline";
import { doesElementHaveEnabledAudio } from "@/timeline/audio-separation";
import { TICKS_PER_SECOND } from "@/wasm";

export type { CutPoint, HeardStretch, PlannedCut, RangeMap, Seam, SeamFix, SeamReport, Snapped };
export type ModelState = HearModelState["state"];

const editor = () => EditorCore.getInstance();
const sec = (ticks: number) => ticks / TICKS_PER_SECOND;

export function projectFps(): number {
	const fps = editor().project.getActiveOrNull()?.settings.fps;
	const f = fps ? fps.numerator / fps.denominator : 30;
	return Number.isFinite(f) && f > 0 ? f : 30;
}

/** A clip whose sound is heard on the timeline. */
export interface Sounding {
	track: TimelineTrack;
	element: TimelineElement;
	asset: MediaAsset | null;
	name: string;
	/** Timeline seconds. */
	start: number;
	end: number;
	place: Placement;
	gainDb: number;
	/** Library music (no words are listened for). */
	music: boolean;
	/** A short library sound (an effect). */
	sfx: boolean;
	/** Not heard in the mix: why («the clip is muted», «on muted track «Audio 2»»). The analysis still reads its file. */
	muted?: string;
	/** A Media file that isn't on the timeline: its own seconds are the times (placed at 0). */
	mediaOnly?: boolean;
}

export function allTracks(): TimelineTrack[] {
	const t = editor().scenes.getActiveSceneOrNull()?.tracks;
	return t ? ([...t.overlay, t.main, ...t.audio] as TimelineTrack[]) : [];
}

const trackName = (track: TimelineTrack) => (track as { name?: string }).name || track.id.slice(0, 8);

/** Every clip you can hear (not muted, its track not muted), in timeline order; `muted`: the muted ones too, marked. */
export function soundingClips({ muted = false }: { muted?: boolean } = {}): Sounding[] {
	const assets = editor().media.getAssets();
	const out: Sounding[] = [];
	for (const track of allTracks()) {
		const trackMuted = !!(track as { muted?: boolean }).muted;
		if (trackMuted && !muted) continue;
		for (const element of track.elements as TimelineElement[]) {
			if (element.type !== "video" && element.type !== "audio") continue;
			const params = (element.params ?? {}) as Record<string, unknown>;
			if (params.muted === true && !muted) continue;
			const mediaId = "mediaId" in element ? (element as { mediaId?: string }).mediaId : undefined;
			const asset = mediaId ? (assets.find((a) => a.id === mediaId) ?? null) : null;
			const library = element.type === "audio" && element.sourceType === "library";
			if (!library && !asset?.file) continue;
			if (element.type === "video" && (asset?.hasAudio === false || !doesElementHaveEnabledAudio({ element, mediaAsset: asset }))) continue;
			const rate = isRetimableElement(element) ? (element.retime?.rate ?? 1) : 1;
			const start = sec(element.startTime);
			const end = start + sec(element.duration);
			out.push({
				track,
				element,
				asset,
				name: element.name,
				start,
				end,
				place: { start, trimStart: sec(element.trimStart), rate },
				gainDb: typeof params.volume === "number" ? params.volume : 0,
				music: library && end - start >= 10,
				sfx: library && end - start < 10,
				...(trackMuted ? { muted: `on muted track «${trackName(track)}»` } : params.muted === true ? { muted: "the clip is muted" } : {}),
			});
		}
	}
	return out.sort((a, b) => a.start - b.start);
}

/**
 * A clip with sound by id — muted ones too (the analysis reads the file; `muted` says it isn't heard in the mix) —
 * or, with `media`, a Media file that isn't on the timeline (heard as placed at 0: its own seconds).
 */
export function findSounding(id: string, { media = false }: { muted?: boolean; media?: boolean } = {}): Sounding | null {
	const key = id.trim();
	if (!key) return null;
	const hit = soundingClips({ muted: true }).find((s) => s.element.id === key || s.element.id.startsWith(key));
	if (hit || !media) return hit ?? null;
	const asset = editor().media.getAssets().find((a) => (a.id === key || a.id.startsWith(key)) && a.file && (a.type === "audio" || (a.type === "video" && a.hasAudio !== false)));
	return asset ? mediaSounding(asset) : null;
}

/** A Media file heard by itself, as if placed at 0 on its own track. */
export function mediaSounding(asset: MediaAsset, place?: Placement): Sounding {
	const duration = asset.duration ?? 0;
	const p = place ?? { start: 0, trimStart: 0, rate: 1 };
	const element = { id: asset.id, type: asset.type === "audio" ? "audio" : "video", name: asset.name, mediaId: asset.id, params: {}, startTime: Math.round(p.start * TICKS_PER_SECOND), duration: Math.round(duration * TICKS_PER_SECOND), trimStart: Math.round(p.trimStart * TICKS_PER_SECOND), trimEnd: 0 } as unknown as TimelineElement;
	const track = { id: "media", name: "Media", type: asset.type === "audio" ? "audio" : "video", elements: [] } as unknown as TimelineTrack;
	return { track, element, asset, name: asset.name, start: p.start, end: p.start + duration / (p.rate || 1), place: p, gainDb: 0, music: false, sfx: false, ...(place ? {} : { mediaOnly: true }) };
}

/** The clip's file on the app's server (sent once per session): the hearing models and the music map read it. */
export const fileOf = (s: Sounding) => fileIdOf(s);

// ───────────────────────── server calls ─────────────────────────

async function post<T>(route: string, body: unknown, signal?: AbortSignal): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`/api/hear/${route}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Studio": "1" }, body: JSON.stringify(body), signal });
	} catch (error) {
		if ((error as Error)?.name === "AbortError") throw error;
		throw new Error("Gaziyav's local server is not responding. Restart Gaziyav.");
	}
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
	return data as T;
}

const files = new Map<string, Promise<string>>();

/** The clip's file on the server (sent once per session). */
function fileIdOf(s: Sounding): Promise<string> {
	const el = s.element;
	const key = s.asset ? `media:${s.asset.id}` : `library:${(el as { sourceUrl?: string }).sourceUrl}`;
	let p = files.get(key);
	if (!p) {
		p = (async () => {
			if (s.asset?.file) return (await uploadOnce(key, s.asset.file)).fileId;
			const url = (el as { sourceUrl?: string }).sourceUrl;
			const res = url ? await fetch(url).catch(() => null) : null;
			if (!res?.ok) throw new Error(`Couldn't open «${s.name}».`);
			const blob = await res.blob();
			return (await uploadOnce(key, new File([blob], s.name || "sound", { type: blob.type }))).fileId;
		})();
		files.set(key, p);
		p.catch(() => files.delete(key));
	}
	return p;
}

const heard = new Map<string, Promise<{ key: string; fileId: string }>>();

/** Listens to the clip's whole file once (server job, cached by the file's hash): its analysis key. */
export function listenTo(s: Sounding, signal?: AbortSignal, { cachedOnly = false }: { cachedOnly?: boolean } = {}): Promise<{ key: string; fileId: string }> {
	const words = !s.music && !s.sfx;
	const id = `${s.asset?.id ?? (s.element as { sourceUrl?: string }).sourceUrl}|${words}`;
	let p = heard.get(id);
	if (!p && cachedOnly) {
		// Only what the server already heard: never starts a first listen (quick edits don't wait for it).
		return (async () => {
			const fileId = await fileIdOf(s);
			const job = await post<JobState>("source", { fileId, words, cachedOnly: true }, signal);
			if (job.status !== "done") throw new Error("not heard yet");
			const got = { key: (job.result as { key: string }).key, fileId };
			heard.set(id, Promise.resolve(got));
			return got;
		})();
	}
	if (!p) {
		p = (async () => {
			const fileId = await fileIdOf(s);
			let job = await post<JobState>("source", { fileId, words }, signal);
			if (job.status === "running") job = await followJob(job.id, () => {});
			if (job.status !== "done") throw new Error(job.error || "Couldn't listen to the sound.");
			return { key: (job.result as { key: string }).key, fileId };
		})();
		heard.set(id, p);
		p.catch(() => heard.delete(id));
	}
	return p;
}

/**
 * The picture at timeline times as the main track shows it, decoded on the server from the clips' own files (no
 * preview seeks in the window): small JPEG data URLs, null where no picture is.
 */
export async function framesAt(times: number[], height = 160, signal?: AbortSignal): Promise<Array<string | null>> {
	const main = editor().scenes.getActiveSceneOrNull()?.tracks.main;
	const assets = editor().media.getAssets();
	const items: Array<{ fileId: string; at: number } | null> = [];
	for (const t of times) {
		const el = (main?.elements as TimelineElement[] | undefined)?.find((e) => (e.type === "video" || e.type === "image") && sec(e.startTime) <= t + 1e-6 && sec(e.startTime + e.duration) > t);
		const mediaId = el && "mediaId" in el ? (el as { mediaId?: string }).mediaId : undefined;
		const asset = mediaId ? assets.find((a) => a.id === mediaId) : undefined;
		if (!el || !asset?.file) {
			items.push(null);
			continue;
		}
		const rate = isRetimableElement(el) ? (el.retime?.rate ?? 1) : 1;
		const fileId = (await uploadOnce(`media:${asset.id}`, asset.file)).fileId;
		items.push({ fileId, at: el.type === "image" ? 0 : sec(el.trimStart) + (t - sec(el.startTime)) * rate });
	}
	const asked = items.filter((x): x is { fileId: string; at: number } => !!x);
	if (!asked.length) return times.map(() => null);
	const got = await post<Array<string | null>>("frames", { items: asked, height }, signal);
	let k = 0;
	return items.map((x) => (x ? (got[k++] ?? null) : null));
}

export interface ClipMap extends RangeMap {
	/** Word #n of the first word here (numbers count from the clip's first word). */
	first: number;
	/** With captions: the hearing model's state, and why it didn't hear (when it didn't). */
	model?: ModelState;
	note?: string;
	/** With captions and the model: what its tagger hears in each stretch, and over the whole range. */
	heard?: HeardStretch[];
	heardAll?: Array<[string, number]>;
}

/** The audio map of a clip (or its piece [from, to], timeline seconds); `captions`: what the hearing model hears too. */
export async function mapClip(s: Sounding, range?: { from?: number; to?: number }, { top = 10, signal, captions = false }: { top?: number; signal?: AbortSignal; captions?: boolean } = {}): Promise<ClipMap> {
	const { key, fileId } = await listenTo(s, signal);
	return post<ClipMap>("map", { key, fileId, place: s.place, fps: projectFps(), from: Math.max(s.start, range?.from ?? s.start), to: Math.min(s.end, range?.to ?? s.end), clip: { start: s.start, end: s.end }, top, captions }, signal);
}

/** The map of the clip's whole source as it is placed (also past the clip's visible end: fit_music needs the bars there). */
export async function mapPlaced(s: Sounding, signal?: AbortSignal): Promise<ClipMap> {
	const { key } = await listenTo(s, signal);
	return post<ClipMap>("map", { key, place: s.place, fps: projectFps(), from: s.start, to: s.start + 6 * 3600, clip: { start: s.start, end: s.end }, top: 1 }, signal);
}

/** Every clip heard in [from, to] with its map (music beds included). */
export async function mapTimeline(from: number, to: number, signal?: AbortSignal, { captions = false }: { captions?: boolean } = {}): Promise<Array<{ clip: Sounding; map: ClipMap }>> {
	const out: Array<{ clip: Sounding; map: ClipMap }> = [];
	for (const s of soundingClips()) {
		if (s.end <= from + 0.01 || s.start >= to - 0.01) continue;
		out.push({ clip: s, map: await mapClip(s, { from, to }, { signal, captions }) });
	}
	return out;
}

/** The best frame-exact cuts near `at` (or after word #n of the clip). */
export async function cutPointsAt(s: Sounding, { at, after, window, music }: { at?: number; after?: number; window?: number; music?: boolean }, signal?: AbortSignal): Promise<{ at: number; points: CutPoint[]; words?: Array<string | null> }> {
	const { key } = await listenTo(s, signal);
	return post("near", { key, place: s.place, fps: projectFps(), at, after, window, music, from: s.start, to: s.end }, signal);
}

export interface AskAnswer {
	question: string;
	score: number | null;
	concepts: string[];
	why: string;
	/** heard = the hearing model (CLAP); measured = the signal measurements; both = the higher of the two. */
	by?: "heard" | "measured" | "both";
}
export interface AskFound {
	question: string;
	concepts: string[];
	hits: Array<{ start: number; end: number; score: number; why: string }>;
	best?: { start: number; end: number; score: number; why: string };
	why?: string;
	by?: "heard" | "measured" | "both";
}
export interface AskResult {
	from: number;
	to: number;
	answers?: AskAnswer[];
	found?: AskFound[];
	/** The hearing model's state; `note` says why it didn't answer (when it didn't); `heard`: the closest everyday sounds. */
	model?: ModelState;
	note?: string;
	heard?: string[];
	window?: number;
}

/** How much the clip's [from, to] sounds like each of `like` (0–100 + why), or with `find` where it does most. */
export async function askClip(s: Sounding, like: string[], { from, to, find, window }: { from?: number; to?: number; find?: boolean; window?: number } = {}, signal?: AbortSignal): Promise<AskResult> {
	const { key, fileId } = await listenTo(s, signal);
	return post("ask", { key, fileId, place: s.place, fps: projectFps(), from: Math.max(s.start, from ?? s.start), to: Math.min(s.end, to ?? s.end), like, find, window }, signal);
}

let modelAsked = false;
/**
 * The hearing model isn't on this Mac (or its quiet background download is under way): the app's own download starts
 * — or goes to full speed — with its progress in the job list (Cancel there), once per session. Nothing waits for it.
 */
export function wantHearingModel(state: ModelState | undefined) {
	if (modelAsked || (state !== "missing" && state !== "downloading")) return;
	modelAsked = true;
	void import("@/ondevice/client")
		.then(({ requireModel }) => requireModel("hear"))
		.catch(() => {
			modelAsked = false;
		});
}

/** The voice clip under a timeline time (the one with words wins over music). */
export function clipAt(t: number, pool = soundingClips()): Sounding | null {
	const under = pool.filter((s) => s.start <= t + 1e-6 && s.end >= t - 1e-6);
	return under.find((s) => !s.music && !s.sfx) ?? under[0] ?? null;
}

/** Where `remove_pauses` cuts a clip: the seamless plan. */
export async function planPauses(s: Sounding, opts: { minPause?: number; fillers?: boolean } = {}, signal?: AbortSignal): Promise<{ cuts: PlannedCut[]; rhythm: { pause: number } }> {
	const { key } = await listenTo(s, signal);
	return post("plan", { key, place: s.place, fps: projectFps(), op: "pauses", from: s.start, to: s.end, ...opts }, signal);
}

/** Ranges to cut made seamless: each edge moved by the clip under it (frame-exact; notes say what moved). */
export async function snapRanges(ranges: Array<{ from: number; to: number }>, signal?: AbortSignal): Promise<Snapped[]> {
	const pool = soundingClips();
	const out: Snapped[] = [];
	for (const r of ranges) {
		const fps = projectFps();
		const left = clipAt(r.from + 0.001, pool);
		const right = clipAt(r.to - 0.001, pool);
		let from = Math.round(r.from * fps) / fps;
		let to = Math.round(r.to * fps) / fps;
		const notes: string[] = [];
		for (const [side, s] of [["from", left], ["to", right]] as const) {
			if (!s || s.music || s.sfx) continue;
			const { key } = await listenTo(s, signal);
			const lo = Math.max(r.from, s.start);
			const hi = Math.min(r.to, s.end);
			const res = await post<{ ranges: Snapped[] }>("plan", { key, place: s.place, fps, op: "ranges", ranges: [{ from: lo, to: hi }] }, signal);
			const snapped = res.ranges[0];
			if (!snapped) continue;
			// One clip under both edges: one plan gives both.
			const both = left === right;
			if ((side === "from" || both) && lo === r.from) from = snapped.from;
			if ((side === "to" || both) && hi === r.to) to = snapped.to;
			for (const n of snapped.notes) if ((both ? /./ : side === "from" ? /^start|no word|tight/ : /^end|tight/).test(n) && !notes.includes(n)) notes.push(n);
			if (both) break;
		}
		if (to - from < 1 / fps) {
			from = Math.round(r.from * fps) / fps;
			to = Math.round(r.to * fps) / fps;
		}
		out.push({ from, to, notes });
	}
	return out;
}

/**
 * A single cut time made seamless (split, trim): frame-exact always; moved out of a word or breath when the clip under
 * it was already heard (listen, transcript, remove_pauses, cut_out) — a split never waits for a first listen.
 */
export async function snapTimeAt(t: number, signal?: AbortSignal, s = clipAt(t)): Promise<{ at: number; note?: string }> {
	const fps = projectFps();
	if (!s || s.sfx) return { at: Math.round(t * fps) / fps };
	const heardAlready = await listenTo(s, signal, { cachedOnly: true }).catch(() => null);
	if (!heardAlready) return { at: Math.round(t * fps) / fps };
	const { key } = heardAlready;
	const res = await post<{ times: Array<{ at: number; note?: string }> }>("plan", { key, place: s.place, fps, op: "times", times: [t] }, signal);
	return res.times[0] ?? { at: Math.round(t * fps) / fps };
}

// ───────────────────────── the cuts on the timeline ─────────────────────────

export interface TimelineSeam {
	at: number;
	left?: Sounding;
	right?: Sounding;
	gap?: number;
}

const TICK = 1.5 / TICKS_PER_SECOND;

/**
 * The audio cuts of the timeline: two clips that meet on a track (or with a gap under 2 s between them), and a clip's
 * edge that a trim made (its sound starts or stops there). `ids` / range narrow it down.
 */
export function timelineSeams({ ids, from = -Infinity, to = Infinity }: { ids?: string[]; from?: number; to?: number } = {}): TimelineSeam[] {
	const pool = soundingClips();
	const out: TimelineSeam[] = [];
	const byTrack = new Map<string, Sounding[]>();
	for (const s of pool) byTrack.set(s.track.id, [...(byTrack.get(s.track.id) ?? []), s]);
	const want = (s?: Sounding) => !ids?.length || (!!s && ids.some((id) => s.element.id === id || s.element.id.startsWith(id)));
	for (const list of byTrack.values()) {
		list.sort((a, b) => a.start - b.start);
		for (let i = 0; i < list.length; i++) {
			const a = list[i];
			const b = list[i + 1];
			if (b && b.start - a.end < 2 && b.start - a.end > -TICK) {
				const gap = Math.max(0, b.start - a.end);
				out.push({ at: a.end, left: a, right: b, ...(gap > TICK ? { gap } : {}) });
			} else if (sec(a.element.trimEnd) > 0.02 && !a.music) out.push({ at: a.end, left: a });
			if (i === 0 || list[i - 1].end < a.start - 2) {
				if (sec(a.element.trimStart) > 0.02 && !a.music) out.push({ at: a.start, right: a });
			}
		}
	}
	return out.filter((s) => s.at >= from - 1e-6 && s.at <= to + 1e-6 && (want(s.left) || want(s.right))).sort((p, q) => p.at - q.at);
}

async function sideOf(s: Sounding, which: "left" | "right", signal?: AbortSignal) {
	const { key, fileId } = await listenTo(s, signal);
	const el = s.element;
	const rate = s.place.rate || 1;
	const params = (el.params ?? {}) as Record<string, unknown>;
	const edge = which === "left" ? s.place.trimStart + (s.end - s.start) * rate : s.place.trimStart;
	return {
		key,
		fileId,
		edge,
		rate,
		gainDb: s.gainDb,
		fade: Number(which === "left" ? params.fadeOut : params.fadeIn) || 0,
		spare: which === "left" ? sec(el.trimEnd) : sec(el.trimStart),
		music: s.music,
	};
}

/** Every cut checked by ear on the server: defects with their fixes. */
export async function checkSeams(seams: TimelineSeam[], signal?: AbortSignal): Promise<SeamReport[]> {
	if (!seams.length) return [];
	const payload: Seam[] = [];
	for (const s of seams) payload.push({ at: s.at, gap: s.gap, left: s.left ? await sideOf(s.left, "left", signal) : undefined, right: s.right ? await sideOf(s.right, "right", signal) : undefined });
	return post<SeamReport[]>("seams", { seams: payload, fps: projectFps() }, signal);
}

export { type AppliedFix, planFixes } from "./fixes";
