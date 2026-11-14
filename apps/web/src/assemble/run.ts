// «Assemble»: the first cut as a job of the Jobs center. The plan Claude writes between analyze_material and
// apply_plan is written here by code (cut.ts for the words, production/plan.ts autoPlan for the rest), and built by
// the very functions Claude's tools use (compilePlan, replaceTracks, kenBurns, review). Each step lands as its own
// ⌘Z; a step can be taken out alone (the edit is rebuilt without it) and «Undo all» goes back to before the run.
// Cancel at any moment puts the project back as it was. Nothing here calls a paid service.
import { replaceTracks } from "@/agent/hear-tools";
import { produceKit } from "@/agent/produce-tools";
import { DEFAULT_BACKGROUND_COLOR } from "@/background/color";
import { EditorCore } from "@/core";
import { frameRateToFloat } from "@/fps/utils";
import { t } from "@/i18n";
import { jobCenter } from "@/jobs/store";
import type { MediaAsset } from "@/media/types";
import { type PlatformSpec, platformOf } from "@/platforms/table";
import { compilePlan } from "@/production/compile";
import type { MaterialBrief } from "@/production/material";
import { autoPlan, headline, type MediaRef, type PlanInput, type SoundPick } from "@/production/plan";
import { presetOf, withBrand } from "@/production/presets";
import { recipeOf } from "@/production/recipes";
import type { SceneTracks, TimelineElement } from "@/timeline";
import { TICKS_PER_SECOND } from "@/wasm";
import { type CutFlags, type CutStats, clock, cutRanges, isFiller } from "./cut";
import { type AssembleOptions, type Kind, kindOf, type StepId } from "./kinds";
import { type AssembleResult, type DoneStep, keepBefore, readBefore, SESSION, useAssembleStore } from "./store";

const editor = () => EditorCore.getInstance();

/**
 * The undo history this result lives in (polish, 11.11). It was the page load only: a project closed and opened again in
 * the same page has a new, empty history, yet the card took it for live — «Undo all» rewound nothing and the card said
 * «undone». A history is cleared on every project open (depth 0, nothing to redo): each such moment is a new history.
 */
let historyGeneration = 0;
let watching = false;
export function historyId(): string {
	if (!watching && typeof window !== "undefined") {
		watching = true;
		const c = editor().command;
		c.subscribeHistory(() => {
			if (c.depth() === 0 && !c.canRedo()) historyGeneration++;
		});
	}
	return `${SESSION}:${historyGeneration}`;
}
if (typeof window !== "undefined") queueMicrotask(() => { try { historyId(); } catch {} });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TICKS = TICKS_PER_SECOND;

interface KeyState {
	key: string;
	ready: boolean;
	progress: number;
	stage?: string;
	error?: string;
}

/** Everything a build needs, fixed for the run (and kept for the strip's later rebuilds). */
interface Context {
	projectId: string;
	opts: AssembleOptions;
	kind: Kind;
	media: MediaRef[];
	platform: PlatformSpec;
	preset: ReturnType<typeof presetOf>;
	music: SoundPick | null;
	sfx: Record<string, SoundPick | null>;
	language: "ru" | "en";
	title: string;
	fps: number;
	lufs: number;
}

export type Flags = Record<"repeats" | "pauses" | "fillers" | "length" | "sound" | "music" | "captions" | "title", boolean>;
const NONE: Flags = { repeats: false, pauses: false, fillers: false, length: false, sound: false, music: false, captions: false, title: false };

let ctx: Context | null = null;
/** The steps a run went through, in order (self-tests read them). */
let stagesSeen: string[] = [];
let flags: Flags = { ...NONE };
let controller: AbortController | null = null;

const speakers = (media: MediaRef[]) => media.filter((m) => m.type !== "image" && (m.brief?.speech?.words.length ?? 0) >= 3);

function cutFlags(f: Flags, c: Context): CutFlags {
	return { repeats: f.repeats, pauses: f.pauses, fillers: f.fillers, tight: c.opts.length === "tight", limit: f.length && c.opts.length === "minutes" ? c.opts.minutes * 60 : undefined };
}

/** The edit for a set of steps: tracks for replaceTracks, the stills for the slow push, the plan for the review. */
function build(c: Context, f: Flags, before: SceneTracks) {
	const ed = editor();
	const canvas = ed.project.getActive().settings.canvasSize;
	const base = recipeOf(c.kind.recipe);
	// captions asked for are made even where the recipe leaves them to the platform (a long YouTube cut)
	const recipe = f.captions && base.captions === "off" ? { ...base, captions: "lines" as const } : base;
	const beats: NonNullable<PlanInput["beats"]> = [];
	const stats: CutStats[] = [];
	for (const m of speakers(c.media)) {
		const sp = m.brief!.speech!;
		const r = cutRanges(sp, m.brief!.seconds || m.duration || 0, cutFlags(f, c), isFiller);
		stats.push(r.stats);
		for (const [from, to] of r.ranges) beats.push({ media: m.id, from, to, exact: true });
	}
	const input: PlanInput = {
		recipe: recipe.id,
		beats: beats.length ? beats : undefined,
		title: c.title,
		captions: { off: !f.captions },
		music: { off: !f.music },
		find: false,
	};
	const plan = autoPlan({
		fps: c.fps,
		recipe,
		preset: c.preset,
		platform: c.platform,
		seconds: Math.max(recipe.seconds[0], speakers(c.media).length ? 7200 : Math.min(c.platform.maxSeconds ?? 600, recipe.seconds[2])),
		topic: "",
		language: c.language,
		media: c.media,
		input,
		music: f.music ? c.music : null,
		sfx: c.sfx,
		cta: c.language === "ru" ? "Подпишись" : "Subscribe",
		isFiller,
	});
	if (!f.captions) plan.captions = null;
	if (!f.music) plan.music = null;
	if (!f.title) {
		plan.texts = [];
		plan.sfx = [];
	}
	const built = compilePlan({ plan, preset: c.preset, platform: c.platform, canvas, media: c.media, before, fps: c.fps });
	const tracks = built.tracks;
	// Evening the sound: the dialog chain compile puts on speech, plus the level that brings the voice to the target.
	for (const e of tracks.main.elements as TimelineElement[]) {
		const m = c.media.find((x) => x.id === (e as { mediaId?: string }).mediaId);
		if (!m?.brief?.speech) continue;
		const params = { ...(e.params as Record<string, unknown>) };
		if (!f.sound) {
			for (const k of Object.keys(params)) if (k.startsWith("fx.")) delete params[k];
		} else {
			const lufs = m.brief.audio?.lufs;
			if (typeof lufs === "number" && Number.isFinite(lufs)) params.volume = Math.round(Math.max(-12, Math.min(12, c.lufs - lufs)) * 10) / 10;
		}
		(e as { params: unknown }).params = params;
	}
	// A story on the music: the music starts on its first downbeat and every cut lands on a downbeat (whole frames).
	const musicEl = tracks.audio.flatMap((tr) => tr.elements as TimelineElement[]).find((e) => (built.roles.music ?? []).includes(e.id));
	const downs = c.music?.downbeats ?? [];
	if (f.music && musicEl && !speakers(c.media).length && downs.length > 2 && recipe.onBeat) {
		const d0 = downs[0];
		const frame = Math.round(TICKS / c.fps);
		const shift = Math.round(d0 * TICKS);
		const me = musicEl as unknown as { trimStart: number; trimEnd: number; duration: number };
		me.trimStart = (me.trimStart ?? 0) + shift;
		me.trimEnd = Math.max(0, (me.trimEnd ?? 0) - shift);
		const grid = downs.map((d) => Math.round(((d - d0) * TICKS) / frame) * frame);
		const main = tracks.main.elements as unknown as Array<{ type: string; startTime: number; duration: number; trimEnd?: number }>;
		let cursor = 0;
		for (let i = 0; i < main.length; i++) {
			const e = main[i];
			const wantEnd = e.startTime + e.duration;
			const snapped = grid.reduce((best, g) => (g > cursor && Math.abs(g - wantEnd) < Math.abs(best - wantEnd) ? g : best), grid.find((g) => g > cursor) ?? wantEnd);
			const room = e.type === "video" ? e.duration + (e.trimEnd ?? 0) : Number.POSITIVE_INFINITY;
			const len = Math.min(snapped - cursor, room);
			if (e.type === "video") e.trimEnd = Math.max(0, (e.trimEnd ?? 0) - (len - e.duration));
			(e as { startTime: number }).startTime = cursor;
			(e as { duration: number }).duration = len;
			cursor += len;
		}
		me.duration = Math.min(me.duration, cursor);
	}
	return { tracks, built, plan, stats };
}

function apply(c: Context, f: Flags) {
	const ed = editor();
	const { tracks, built, plan, stats } = build(c, f, ed.scenes.getActiveScene().tracks);
	replaceTracks(() => tracks);
	produceKit.kenBurns(built.roles.stills ?? []);
	produceKit.remember(c.projectId, plan, built.roles, built.style);
	return { built, plan, stats };
}

const sumStats = (list: CutStats[]) =>
	list.reduce(
		(a, s) => {
			for (const k of Object.keys(a) as Array<keyof CutStats>) a[k] += s[k];
			return a;
		},
		{ repeats: 0, repeatSeconds: 0, pauses: 0, pauseSeconds: 0, fillers: 0, fillerSeconds: 0, dropped: 0, droppedSeconds: 0, kept: 0 } as CutStats,
	);

const timelineSeconds = () => {
	const tr = editor().scenes.getActiveScene().tracks;
	return (tr.main.elements as TimelineElement[]).reduce((m, e) => Math.max(m, (e.startTime + e.duration) / TICKS), 0);
};

/** Undo back to a history depth (the run's own steps; what the user did later goes too, the strip says so). */
function rewind(depth: number) {
	const ed = editor();
	let guard = 400;
	while (ed.command.depth() > depth && ed.command.canUndo() && guard-- > 0) ed.command.undo();
}

/** Self-tests may hold each step a moment (window.__assembleHold, ms) to press Cancel inside it. */
const hold = () => (typeof window === "undefined" ? 0 : Number((window as unknown as { __assembleHold?: number }).__assembleHold) || 0);

async function stage(jobId: string, words: string, progress: number) {
	jobCenter.update(jobId, { stage: t(words), progress });
	useAssembleStore.setState({ running: { jobId, stage: words, progress } });
	if (stagesSeen[stagesSeen.length - 1] !== words) stagesSeen.push(words);
	if (hold() && words !== "Listening") await sleep(hold());
}

async function listen(assets: MediaAsset[], jobId: string, signal: AbortSignal): Promise<Map<string, MaterialBrief>> {
	await produceKit.startBriefs(assets, true, signal);
	const ks = await Promise.all(assets.map((a) => produceKit.keyOf(a)));
	for (;;) {
		if (signal.aborted) throw new DOMException("cancelled", "AbortError");
		const { states } = await produceKit.api<{ states: KeyState[] }>("status", { keys: ks }, signal);
		const p = states.length ? states.reduce((s, x) => s + (x.ready ? 1 : x.progress || 0), 0) / states.length : 1;
		void stage(jobId, "Listening", Math.min(0.6, p * 0.6));
		useAssembleStore.setState((s) => (s.running ? { running: { ...s.running, stepProgress: p } } : {}));
		if (states.every((s) => s.ready || s.error)) break;
		await sleep(500);
	}
	const { briefs } = await produceKit.api<{ briefs: Record<string, MaterialBrief | null> }>("briefs", { keys: ks }, signal);
	const out = new Map<string, MaterialBrief>();
	assets.forEach((a, i) => {
		const b = briefs[ks[i]];
		if (b) out.set(a.id, b);
	});
	return out;
}

export function isAssembling() {
	return !!controller;
}

export function cancelAssemble() {
	controller?.abort();
}

/** The run, from the sheet's «Assemble». Returns when the cut is on the timeline (or the run was cancelled). */
export async function runAssemble(opts: AssembleOptions): Promise<void> {
	if (controller) return;
	const ed = editor();
	const project = ed.project.getActiveOrNull();
	if (!project) return;
	const kind = kindOf(opts.kind);
	const assets = produceKit.sources();
	const startDepth = ed.command.depth();
	const s0 = project.settings;
	const snapshot: Snapshot = { tracks: structuredClone(ed.scenes.getActiveScene().tracks), canvasSize: { ...s0.canvasSize }, background: structuredClone(s0.background) };
	const t0 = performance.now();
	const timings: Record<string, number> = {};
	let mark = t0;
	const lap = (id: string) => {
		const now = performance.now();
		timings[id] = Math.round((now - mark) / 100) / 10;
		mark = now;
	};
	const ac = new AbortController();
	controller = ac;
	stagesSeen = [];
	const signal = ac.signal;
	const jobId = jobCenter.start({ kind: "montage", title: t("Assemble"), stage: t("Listening"), progress: 0, cancel: () => ac.abort() });
	useAssembleStore.setState({ running: { jobId, stage: "Listening", progress: 0 }, open: false, last: opts, result: null, ended: null, stripOpen: true, seen: false });
	const check = () => {
		if (signal.aborted) throw new DOMException("cancelled", "AbortError");
	};
	let noSpeech = false;
	try {
		if (!assets.length) throw new Error(t("Add your footage to Media first."));
		// ── Listening: the material briefs (speech to words on this Mac, the sound, the pictures, the music's bars) ──
		const briefs = await listen(assets, jobId, signal);
		check();
		lap("listen");
		const media = assets.map((a) => produceKit.refOf(a, briefs.get(a.id)));
		const talk = speakers(media);
		if (kind.lead === "speech" && !talk.length) {
			noSpeech = true;
			throw new Error(t("No speech found in this footage. Try «Photo and video story»."));
		}
		// ── the frame and the platform ──
		const lead = talk[0] ?? media.find((m) => m.type !== "audio");
		const w = lead?.brief?.width ?? lead?.width ?? 1920;
		const h = lead?.brief?.height ?? lead?.height ?? 1080;
		const vertical = opts.frame === "9:16" || (opts.frame === "footage" && h > w);
		const platform = platformOf(vertical ? kind.vertical : kind.wide);
		const tst = await produceKit.taste();
		const preset = withBrand(presetOf(kind.preset ?? recipeOf(kind.recipe).preset), { display: tst.brand.display, text: tst.captions.font ?? tst.brand.text, ink: tst.brand.ink, accent: tst.captions.color ?? tst.brand.accent, plate: tst.brand.plate, captionStyle: tst.captions.style });
		const spoken = talk[0]?.brief?.speech?.language?.startsWith("ru") ? "ru" : talk[0]?.brief?.speech?.language?.startsWith("en") ? "en" : undefined;
		const language = opts.language === "auto" ? (spoken ?? (/[а-яё]/i.test(talk[0]?.brief?.speech?.words.map((x) => x.text).join(" ") ?? "") ? "ru" : "en")) : opts.language;
		const firstLine = talk[0]?.brief?.speech?.sentences.find((s) => !s.retake && s.words >= 3)?.text;
		const title = (firstLine ? headline(firstLine, 6) : (lead?.name ?? "").replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ")).replace(/[\s–—-]+$/u, "").trim();
		const fps = frameRateToFloat(project.settings.fps) || 30;
		const total = talk.reduce((s, m) => s + (m.brief?.seconds ?? 0), 0) || 60;
		// ── Finding the best takes / cutting: the plan by code ──
		await stage(jobId, "Finding the best takes", 0.62);
		check();
		let music: SoundPick | null = null;
		let sfx: Record<string, SoundPick | null> = {};
		// the library's music (its beat grid) and the preset's small sounds only when music is wanted
		const sounds = opts.music
			? await produceKit
					.api<{ music: SoundPick | null; sfx: Record<string, SoundPick | null> }>("sounds", { mood: opts.mood || preset.music.mood, seconds: Math.min(total, 600), sfx: { hit: preset.sfx.hit, whoosh: preset.sfx.whoosh, riser: preset.sfx.riser } }, signal)
					.catch(() => ({ music: null, sfx: {} as Record<string, SoundPick | null> }))
			: { music: null, sfx: {} as Record<string, SoundPick | null> };
		check();
		music = sounds.music;
		sfx = sounds.sfx ?? {};
		if (music) music.gain = (music.gain ?? 0) + (tst.music.levelDb ?? 0);
		const c: Context = { projectId: project.metadata.id, opts, kind, media, platform, preset, music, sfx, language, title, fps, lufs: platform.export.lufs };
		ctx = c;
		lap("takes");
		await stage(jobId, "Cutting pauses and repeats", 0.66);
		check();
		const before = timelineSeconds();
		const full = sumStats(build(c, { ...NONE, repeats: true, pauses: true, fillers: true, length: true }, ed.scenes.getActiveScene().tracks).stats);
		await sleep(0);
		check();
		lap("pauses");
		// ── Laying the cut: the frame first (its own step), then the cut, one switch at a time ──
		await stage(jobId, "Laying the cut", 0.72);
		check();
		const want = vertical || opts.frame !== "footage" ? platform.size : { width: w % 2 ? w + 1 : w, height: h % 2 ? h + 1 : h };
		const canvas0 = project.settings.canvasSize;
		if (canvas0.width !== want.width || canvas0.height !== want.height) await ed.project.updateSettings({ settings: { canvasSize: { ...want } } });
		const steps: DoneStep[] = [];
		const depths: Array<{ id: StepId; depth: number }> = [];
		const step = (id: StepId, line: string, alone = true) => {
			steps.push({ id, line, alone });
			depths.push({ id, depth: ed.command.depth() });
		};
		flags = { ...NONE };
		if (kind.lead === "speech") {
			// the material as it was said, then each removal as its own ⌘Z
			apply(c, flags);
			if (full.repeats) {
				flags = { ...flags, repeats: true };
				apply(c, flags);
				step("repeats", t("Removed {n} repeats", { n: full.repeats }));
			}
			check();
			flags = { ...flags, pauses: true };
			apply(c, flags);
			step("pauses", t("Cut {n} pauses (−{time})", { n: full.pauses, time: clock(full.pauseSeconds) }));
			if (full.fillers) {
				flags = { ...flags, fillers: true };
				apply(c, flags);
				step("fillers", t("Removed {n} filler words", { n: full.fillers }));
			}
			if (opts.length === "minutes" && full.dropped) {
				flags = { ...flags, length: true };
				apply(c, flags);
				step("length", t("Kept the strongest {time} (−{cut})", { time: clock(full.kept), cut: clock(full.droppedSeconds) }));
			}
		} else {
			apply(c, flags);
			step("lay", t("Laid {n} shots", { n: (ed.scenes.getActiveScene().tracks.main.elements as TimelineElement[]).length }), false);
		}
		const framed = ed.scenes.getActiveScene().tracks.main.elements.length > 0;
		const bg = ed.project.getActive().settings.background;
		if (framed && bg.type === "color" && bg.color.toLowerCase() === DEFAULT_BACKGROUND_COLOR && vertical && w > h) await ed.project.updateSettings({ settings: { background: { type: "color", color: preset.palette.plate } } });
		flags = { ...flags, title: true };
		apply(c, flags);
		step("title", t("Title «{title}»", { title: c.title || t("Untitled") }));
		check();
		lap("lay");
		if (kind.lead === "speech") {
			await stage(jobId, "Evening the sound", 0.8);
			check();
			flags = { ...flags, sound: true };
			apply(c, flags);
			step("sound", t("Voice evened to {lufs} LUFS", { lufs: c.lufs }));
			lap("sound");
			check();
		}
		if (opts.music && music) {
			await stage(jobId, "Music", 0.84);
			check();
			flags = { ...flags, music: true };
			apply(c, flags);
			step("music", kind.lead === "speech" ? t("Music added, quieter under speech") : t("Music added, cuts on its beats"));
			lap("music");
			check();
		}
		if (opts.captions && kind.lead === "speech") {
			await stage(jobId, "Captions", 0.88);
			check();
			flags = { ...flags, captions: true };
			const r = apply(c, flags);
			const lines = (r.built.roles.captions ?? []).length;
			step("captions", t("Captions: {n} lines", { n: lines }));
			lap("captions");
			check();
		}
		// ── Checking: the review Claude's review tool runs (rendered frames, measured sound) ──
		await stage(jobId, "Checking", 0.9);
		check();
		const after = timelineSeconds();
		let score: number | null = null;
		let hard: string[] = [];
		let fixes: AssembleResult["fixes"] = [];
		try {
			const r = await produceKit.reviewNow({ platform: platform.id, recipe: kind.recipe }, signal);
			score = r.result.score;
			hard = r.result.hardFailed;
			fixes = fixesOf(r.result);
			reviewed = r.result;
		} catch (e) {
			if (signal.aborted) throw e;
		}
		check();
		lap("check");
		await produceKit.api("project", { id: c.projectId, patch: { plan: { recipe: kind.recipe, preset: preset.id, platform: platform.id, seconds: after } } }).catch(() => {});
		const totalSeconds = Math.round((performance.now() - t0) / 100) / 10;
		keepBefore(c.projectId, snapshot);
		useAssembleStore.setState({ result: { projectId: c.projectId, steps, startDepth, endDepth: ed.command.depth(), score, hard, fixes, timings, totalSeconds, before, after, session: historyId() }, stripOpen: true, running: null });
		stepDepths = depths;
		jobCenter.finish(jobId, t("First cut ready: {before} → {after}", { before: clock(before || total), after: clock(after) }));
	} catch (error) {
		// Cancelled or failed: the project goes back to exactly what it was.
		rewind(startDepth);
		ctx = null;
		const message = error instanceof Error ? error.message : String(error);
		useAssembleStore.setState({ running: null, ended: { kind: signal.aborted ? "cancelled" : noSpeech ? "nospeech" : "error", message } });
		if (signal.aborted) jobCenter.cancelled(jobId);
		else jobCenter.fail(jobId, message);
	} finally {
		controller = null;
	}
}

type Reviewed = NonNullable<typeof reviewed>;
/** The top three checks with fixes, one entry each, by the check's name (never element ids on screen). */
function fixesOf(result: Reviewed): AssembleResult["fixes"] {
	const out: AssembleResult["fixes"] = [];
	result.fixes.forEach((f, index) => {
		if (out.some((x) => x.say === f.check) || out.length >= 3) return;
		const name = result.checks.find((c) => c.id === f.check)?.name ?? f.check;
		out.push({ name, say: f.check, auto: f.auto && f.steps.length > 0, index });
	});
	return out;
}

let reviewed: Awaited<ReturnType<typeof produceKit.reviewNow>>["result"] | null = null;
let stepDepths: Array<{ id: StepId; depth: number }> = [];

const FLAG_OF: Partial<Record<StepId, keyof Flags>> = { repeats: "repeats", pauses: "pauses", fillers: "fillers", length: "length", sound: "sound", music: "music", captions: "captions", title: "title" };

/** «Undo this step» / «Bring back»: the edit rebuilt with that one switch changed (one ⌘Z). */
export function toggleStep(id: StepId) {
	const r = useAssembleStore.getState().result;
	if (!ctx || !r) return;
	const key = FLAG_OF[id];
	if (!key) {
		// the shots of a story: everything after goes with them
		undoAll();
		return;
	}
	flags = { ...flags, [key]: !flags[key] };
	apply(ctx, flags);
	useAssembleStore.setState({ result: { ...r, steps: r.steps.map((s) => (s.id === id ? { ...s, off: !flags[key] } : s)), endDepth: editor().command.depth(), after: timelineSeconds() } });
}

/** «Undo all»: back to before the run (⌘⇧Z brings it all back). */
export function undoAll() {
	const r = useAssembleStore.getState().result;
	if (!r) return;
	if (r.session === historyId()) return rewind(r.startDepth);
	// Reopened: the saved copy of before the run comes back as one step (⌘Z brings the cut back).
	const snap = readBefore<Snapshot>(r.projectId);
	const ed = editor();
	if (!snap || ed.project.getActiveOrNull()?.metadata.id !== r.projectId) return;
	void ed.project.updateSettings({ settings: { canvasSize: snap.canvasSize, background: snap.background as never } });
	replaceTracks(() => snap.tracks);
	useAssembleStore.setState({ result: { ...r, reverted: true } });
}

type Snapshot = { tracks: SceneTracks; canvasSize: { width: number; height: number }; background: unknown };

/** A fix of the review as a button: applied like review {fix:true} does, then checked again. */
export async function applyFix(index: number) {
	const r = useAssembleStore.getState().result;
	if (!reviewed || !r) return;
	const first = reviewed.fixes[index];
	if (!first) return;
	// every automatic fix of that check at once (one ⌘Z)
	produceKit.applyFixes({ ...reviewed, fixes: reviewed.fixes.filter((f) => f.check === first.check && f.auto) });
	const again = await produceKit.reviewNow({ platform: ctx?.platform.id, recipe: ctx?.kind.recipe }, new AbortController().signal).catch(() => null);
	if (again) {
		reviewed = again.result;
		useAssembleStore.setState({ result: { ...r, score: again.result.score, hard: again.result.hardFailed, fixes: fixesOf(again.result), endDepth: editor().command.depth() } });
	}
}

if (typeof window !== "undefined") {
	(window as unknown as { __assemble?: unknown }).__assemble = {
		state: () => {
			const s = useAssembleStore.getState();
			return { running: s.running, result: s.result, ended: s.ended, flags, stepDepths, stages: stagesSeen, depth: editor().command.depth() };
		},
		cancel: cancelAssemble,
		/** The words of the cut (the speech brief's words inside each kept piece, in timeline order) and of the source. */
		words: () => {
			if (!ctx) return null;
			const main = editor().scenes.getActiveScene().tracks.main.elements as Array<TimelineElement & { mediaId?: string; trimStart?: number }>;
			const kept: string[] = [];
			for (const e of [...main].sort((a, b) => a.startTime - b.startTime)) {
				const m = ctx.media.find((x) => x.id === e.mediaId);
				const words = m?.brief?.speech?.words ?? [];
				const from = (e.trimStart ?? 0) / TICKS;
				const to = from + e.duration / TICKS;
				for (const w of words) if (w.start >= from - 0.005 && w.end <= to + 0.005) kept.push(w.text);
			}
			const source = speakers(ctx.media).flatMap((m) => m.brief?.speech?.words.map((w) => w.text) ?? []);
			return { kept, source, retakes: speakers(ctx.media).map((m) => m.brief?.speech?.retakes.length ?? 0) };
		},
	};
}
