// Claude's production tools in the window: analyze_material, apply_plan, review, taste_profile. The heavy judgement
// runs on the server (production/server/*); the window only hashes a few MB, streams files up, builds the tracks as
// data and commits them as ONE ⌘Z, and renders a few small frames for the review — nothing that holds the editor.
// Briefs are made in the background as soon as media lands in a project (paused while the user plays or exports).
import { checkCuts, replaceTracks } from "@/agent/hear-tools";
import { DEFAULT_BACKGROUND_COLOR } from "@/background/color";
import { EditorCore } from "@/core";
import { frameRateToFloat } from "@/fps/utils";
import { stillFramePainter } from "@/export/still-frame";
import { isStoring, onStored, whenStored } from "@/media/store-tracker";
import type { MediaAsset } from "@/media/types";
import { type PlatformSpec, platformOf, platformSpec } from "@/platforms/table";
import { readBrief as readWords } from "@/production/brief-words";
import { compilePlan } from "@/production/compile";
import { compactBrief, isFillerWord, type MaterialBrief } from "@/production/material";
import { autoPlan, type MediaRef, type Plan, type PlanInput, type SoundPick } from "@/production/plan";
import { PRESET_IDS, PRESETS, presetOf, withBrand } from "@/production/presets";
import { RECIPE_IDS, RECIPES, type RecipeId, recipeOf } from "@/production/recipes";
import { describeReview, type HeardFacts, inferRecipe, mainSound, type Measured, platformFor, type RenderedFrame, type ReviewElement, type ReviewInput, type ReviewResult, runReview, type SyncInfo, vocalSpans } from "@/production/review";
import { describeTaste, type TasteProfile } from "@/production/taste";
import { type CastMember, productionScript, type Scene, shotList } from "@/production/shots";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline";
import { TICKS_PER_SECOND } from "@/wasm";

type Args = Record<string, unknown>;

const editor = () => EditorCore.getInstance();
const HEADERS = { "X-Studio": "1", "Content-Type": "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (id: string) => id.slice(0, 8);
const sec = (ticks: number) => ticks / TICKS_PER_SECOND;
const fail = (message: string): never => {
	throw new Error(message);
};

async function api<T>(route: string, body?: unknown, signal?: AbortSignal): Promise<T> {
	const res = await fetch(`/api/production/${route}`, body === undefined ? { headers: { "X-Studio": "1" }, signal } : { method: "POST", headers: HEADERS, body: JSON.stringify(body), signal });
	const data = (await res.json().catch(() => ({}))) as T & { error?: string };
	if (!res.ok) fail(data.error || `The production desk answered ${res.status}.`);
	return data;
}

// ───────────────────────── media keys and briefs ─────────────────────────

const keys = new Map<string, string>();

/** A content key: the size and three 1 MB samples (start, middle, end) of the file, hashed. Same file → same brief in every project. */
async function keyOf(asset: MediaAsset): Promise<string> {
	const known = keys.get(asset.id);
	if (known) return known;
	const f = asset.file;
	const chunk = 1 << 20;
	const parts = [f.slice(0, chunk), f.slice(Math.max(0, f.size / 2 - chunk / 2), Math.max(0, f.size / 2 - chunk / 2) + chunk), f.slice(Math.max(0, f.size - chunk))];
	const bufs = await Promise.all(parts.map((p) => p.arrayBuffer()));
	const all = new Uint8Array(bufs.reduce((s, b) => s + b.byteLength, 0) + 16);
	let o = 0;
	for (const b of bufs) {
		all.set(new Uint8Array(b), o);
		o += b.byteLength;
	}
	new DataView(all.buffer).setFloat64(o, f.size);
	const digest = await crypto.subtle.digest("SHA-256", all);
	const key = `${asset.type[0]}${[...new Uint8Array(digest)].slice(0, 15).map((x) => x.toString(16).padStart(2, "0")).join("")}`;
	keys.set(asset.id, key);
	return key;
}

/**
 * Streams a file up (the browser sends it; nothing is copied on the main thread) — once the project's own copy of it is
 * written: read beside that copy, a 1 GB source took the copy twice as long, and a crash in those seconds lost the clip's
 * media (media/store-tracker.ts).
 */
async function upload(asset: MediaAsset, key: string, front: boolean): Promise<void> {
	await whenStored(asset.id);
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("POST", `/api/production/upload?key=${key}&name=${encodeURIComponent(asset.file.name || asset.name)}${front ? "&front=1" : ""}`);
		xhr.setRequestHeader("X-Studio", "1");
		xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
		xhr.onerror = () => reject(new Error("Gaziyav's server isn't answering."));
		xhr.send(asset.file);
	});
}

interface KeyState {
	key: string;
	ready: boolean;
	progress: number;
	stage: string;
	error?: string;
	missing?: boolean;
}

const sources = () =>
	editor()
		.media.getAssets()
		.filter((a) => !a.ephemeral && !a.motionProxy && !a.editingOriginalOf && a.file && a.file.size > 0);
/** What the background brief may take now: not a file whose copy into the project is still being written. */
const settledSources = () => sources().filter((a) => !isStoring(a.id));

/** Makes sure every asset has (or is getting) a brief; returns their states. */
async function startBriefs(assets: MediaAsset[], front: boolean, signal?: AbortSignal): Promise<Map<string, KeyState>> {
	const out = new Map<string, KeyState>();
	for (const a of assets) {
		const key = await keyOf(a);
		// the user's own file used where it is: the server reads it there, nothing is uploaded
		let st = await api<KeyState & { need?: string }>("analyze", { key, name: a.name, front, ...(a.inPlace && a.source ? { source: a.source } : {}) }, signal);
		if (st.need === "upload") {
			await upload(a, key, front);
			st = (await api<{ states: KeyState[] }>("status", { keys: [key] }, signal)).states[0];
		}
		out.set(a.id, st);
	}
	return out;
}

async function waitBriefs(assets: MediaAsset[], signal: AbortSignal, maxMs: number): Promise<Map<string, MaterialBrief>> {
	const t0 = Date.now();
	await startBriefs(assets, true, signal);
	const ks = await Promise.all(assets.map((a) => keyOf(a)));
	for (;;) {
		const { states } = await api<{ states: KeyState[] }>("status", { keys: ks }, signal);
		if (states.every((s) => s.ready || s.error) || Date.now() - t0 > maxMs) break;
		await sleep(700);
	}
	const { briefs } = await api<{ briefs: Record<string, MaterialBrief | null> }>("briefs", { keys: ks }, signal);
	const out = new Map<string, MaterialBrief>();
	assets.forEach((a, i) => {
		const b = briefs[ks[i]];
		if (b) out.set(a.id, b);
	});
	return out;
}

// ───────────────────────── background briefs, quiet while playing / exporting, taste learning ─────────────────────────

let watching = false;

function watch() {
	if (watching || typeof window === "undefined") return;
	watching = true;
	const ed = editor();
	let pending: ReturnType<typeof setTimeout> | null = null;
	const seen = new Set<string>();
	const kick = () => {
		if (pending) clearTimeout(pending);
		pending = setTimeout(() => {
			pending = null;
			if (!ed.project.getActiveOrNull()) return;
			const fresh = settledSources().filter((a) => !seen.has(a.id) && (a.type !== "image" || a.file.size > 30_000));
			if (!fresh.length) return;
			for (const a of fresh) seen.add(a.id);
			void startBriefs(fresh, false).catch(() => {
				for (const a of fresh) seen.delete(a.id);
			});
		}, 1500);
	};
	ed.media.subscribe(kick);
	// a file whose copy was still being written when it showed is taken once the copy is in
	onStored(kick);
	kick();
	let quiet = { playing: false, exporting: false };
	const tell = () => {
		const now = { playing: ed.playback.getIsPlaying(), exporting: ed.project.getExportState().isExporting };
		if (now.playing === quiet.playing && now.exporting === quiet.exporting) return;
		quiet = now;
		void fetch("/api/production/quiet", { method: "POST", headers: HEADERS, body: JSON.stringify(now) }).catch(() => {});
	};
	ed.playback.subscribe(tell);
	ed.project.subscribe(tell);
	// Taste: what the user changes in elements apply_plan made (fonts, caption colours, the music level).
	let learnTimer: ReturnType<typeof setTimeout> | null = null;
	ed.timeline.subscribe(() => {
		if (!made || learnTimer) return;
		learnTimer = setTimeout(() => {
			learnTimer = null;
			const run = () => learn();
			if ("requestIdleCallback" in window) (window as unknown as { requestIdleCallback: (f: () => void) => void }).requestIdleCallback(run);
			else run();
		}, 3000);
	});
}

let made: { project: string; roles: Record<string, string[]>; style: Record<string, string | number> } | null = null;

function learn() {
	const m = made;
	const pid = editor().project.getActiveOrNull()?.metadata.id;
	if (!m || pid !== m.project) return;
	const all = allElements();
	const byId = new Map(all.map((x) => [x.element.id, x.element]));
	const tell = (key: string, value: string | number) => void fetch("/api/production/learn", { method: "POST", headers: HEADERS, body: JSON.stringify({ key, value }) }).catch(() => {});
	const caps = (m.roles.captions ?? []).map((id) => byId.get(id)).filter(Boolean) as TimelineElement[];
	if (caps.length) {
		const font = String(caps[0].params.fontFamily ?? "");
		const color = String(caps[0].params["highlight.color"] ?? "");
		if (font && font !== m.style.captionFont && caps.every((c) => c.params.fontFamily === font)) {
			tell("captions.font", font);
			m.style.captionFont = font;
		}
		if (color && color !== m.style.captionColor && caps.every((c) => c.params["highlight.color"] === color)) {
			tell("captions.color", color);
			m.style.captionColor = color;
		}
	}
	const titleIds = [...(m.roles.hook ?? []), ...(m.roles.title ?? []), ...(m.roles.chapter ?? []), ...(m.roles.cta ?? [])];
	const title = titleIds.map((id) => byId.get(id)).find((e) => e?.type === "text");
	if (title && title.params.fontFamily && title.params.fontFamily !== m.style.titleFont) {
		tell("brand.display", String(title.params.fontFamily));
		m.style.titleFont = String(title.params.fontFamily);
	}
	const music = (m.roles.music ?? []).map((id) => byId.get(id))[0];
	if (music) {
		const v = Number(music.params.volume ?? 0);
		const delta = Math.round((v - Number(m.style.musicDb)) * 10) / 10;
		if (Math.abs(delta) >= 2) {
			tell("music.levelDb", delta);
			m.style.musicDb = v;
		}
	}
}

// ───────────────────────── reading the project ─────────────────────────

function allElements(): Array<{ track: TimelineTrack; element: TimelineElement; role: "main" | "overlay" | "audio" }> {
	const t = editor().scenes.getActiveScene().tracks;
	return [
		...t.overlay.flatMap((track) => (track.elements as TimelineElement[]).map((element) => ({ track: track as TimelineTrack, element, role: "overlay" as const }))),
		...(t.main.elements as TimelineElement[]).map((element) => ({ track: t.main as TimelineTrack, element, role: "main" as const })),
		...t.audio.flatMap((track) => (track.elements as TimelineElement[]).map((element) => ({ track: track as TimelineTrack, element, role: "audio" as const }))),
	];
}

async function mediaRefs(signal: AbortSignal, maxMs = 20 * 60_000): Promise<MediaRef[]> {
	const assets = sources();
	const briefs = await waitBriefs(assets, signal, maxMs);
	return assets.map((a) => refOf(a, briefs.get(a.id)));
}

/** A media for the plan and the review; a stem of a song separated here knows its part and its song. */
function refOf(a: MediaAsset, brief?: MaterialBrief): MediaRef {
	const stem = a.neural?.effect === "ai.separate" ? (a.neural.label === "Music" ? ("music" as const) : ("voice" as const)) : undefined;
	return { id: a.id, name: a.name, type: a.type, duration: a.duration, width: a.width, height: a.height, brief, ...(stem ? { stem, stemOf: a.neural?.originalId ?? a.neural?.sourceId } : {}) } as MediaRef;
}

/**
 * The review's media: only what the timeline uses (and the songs its stems came from), with the briefs that are ready
 * now or within `maxMs` — never minutes of waiting for media nobody placed (a project collects dozens of AI pictures).
 */
async function usedMediaRefs(signal: AbortSignal, maxMs = 10_000): Promise<MediaRef[]> {
	const used = new Set(allElements().map((x) => (x.element as { mediaId?: string }).mediaId).filter((id): id is string => !!id));
	const all = sources();
	for (const a of all) if (used.has(a.id) && a.neural?.originalId) used.add(a.neural.originalId);
	const assets = all.filter((a) => used.has(a.id));
	if (!assets.length) return [];
	const t0 = Date.now();
	// Media without a brief yet is sent for one (in the background); what is ready answers.
	const started = startBriefs(assets, true, signal).catch(() => null);
	await Promise.race([started, sleep(maxMs)]);
	const ks = await Promise.all(assets.map((a) => keyOf(a)));
	for (;;) {
		const { states } = await api<{ states: KeyState[] }>("status", { keys: ks }, signal).catch(() => ({ states: [] as KeyState[] }));
		if (!states.length || states.every((x) => x.ready || x.error) || Date.now() - t0 > maxMs) break;
		await sleep(500);
	}
	const { briefs } = await api<{ briefs: Record<string, MaterialBrief | null> }>("briefs", { keys: ks }, signal).catch(() => ({ briefs: {} as Record<string, MaterialBrief | null> }));
	return assets.map((a, i) => refOf(a, briefs[ks[i]] ?? undefined));
}

async function taste(): Promise<TasteProfile> {
	return (await api<{ taste: TasteProfile }>("taste")).taste;
}

// ───────────────────────── analyze_material ─────────────────────────

async function analyzeMaterial(args: Args, signal: AbortSignal): Promise<string> {
	const ed = editor();
	const want = Array.isArray(args.media) ? args.media.map(String) : [];
	const assets = sources().filter((a) => !want.length || want.some((w) => a.id === w || a.id.startsWith(w)));
	if (!assets.length) return "No media in this project yet: import files first (import_media).";
	const states = await startBriefs(assets, true, signal);
	// Ready ones answer at once; brand-new media gets up to 90 s here, then «still analysing».
	const t0 = Date.now();
	let keysNow = await Promise.all(assets.map((a) => keyOf(a)));
	let list = (await api<{ states: KeyState[] }>("status", { keys: keysNow }, signal)).states;
	while (list.some((s) => !s.ready && !s.error) && Date.now() - t0 < 90_000) {
		await sleep(800);
		list = (await api<{ states: KeyState[] }>("status", { keys: keysNow }, signal)).states;
	}
	keysNow = await Promise.all(assets.map((a) => keyOf(a)));
	const { briefs } = await api<{ briefs: Record<string, MaterialBrief | null> }>("briefs", { keys: keysNow }, signal);
	const lines: string[] = [];
	let total = 0;
	assets.forEach((a, i) => {
		const b = briefs[keysNow[i]];
		const st = list[i] ?? states.get(a.id);
		if (b) {
			lines.push(compactBrief(b, short(a.id)));
			total += b.seconds;
		} else lines.push(`${short(a.id)} ${a.name} · ${st?.error ? `couldn't be analysed: ${st.error}` : `still analysing ${Math.round((st?.progress ?? 0) * 100)} % (${st?.stage ?? "waiting"})`}`);
	});
	const t = await taste();
	const intent = readWords(String(args.brief ?? ""), t, { mediaSeconds: total || undefined });
	const canvas = ed.project.getActive().settings.canvasSize;
	lines.push(
		`Suggested: recipe ${intent.recipe} · preset ${intent.preset} · platform ${intent.platform} · ${intent.seconds} s${intent.topic ? ` · topic «${intent.topic}»` : ""} (${intent.said.length ? `from the words: ${intent.said.join(", ")}; ` : ""}rest from the taste profile). Project ${canvas.width}×${canvas.height}.`,
		`Next: apply_plan ${JSON.stringify(args.brief ? { brief: args.brief } : { recipe: intent.recipe })} — or give beats [{quote:n}|{from,to}] / broll [{media, words}].`,
	);
	return lines.join("\n");
}

// ───────────────────────── apply_plan ─────────────────────────

let lastPlan: { project: string; plan: Plan; plannedSeconds: number } | null = null;

/**
 * An undone apply_plan takes its plan with it, and a redo brings it back. (The plan stayed after the undo: a cut then
 * built by hand was judged against it — review's hard «length» check failed a 64-s song against the undone 56.8-s plan
 * and Claude cut the song to open the export, exam 11.11.)
 */
let undonePlan: { project: string; last: { project: string; plan: Plan; plannedSeconds: number } | null; record: unknown } | null = null;
export async function forgetPlan(projectId: string): Promise<void> {
	const record = (await api<{ record: { plan?: unknown } }>(`project?id=${encodeURIComponent(projectId)}`).catch(() => ({ record: {} as { plan?: unknown } }))).record;
	undonePlan = { project: projectId, last: lastPlan?.project === projectId ? lastPlan : null, record: record?.plan ?? null };
	if (lastPlan?.project === projectId) lastPlan = null;
	await api("project", { id: projectId, patch: { plan: null } }).catch(() => {});
}
export async function recallPlan(projectId: string): Promise<void> {
	if (undonePlan?.project !== projectId) return;
	if (undonePlan.last) lastPlan = undonePlan.last;
	await api("project", { id: projectId, patch: { plan: undonePlan.record } }).catch(() => {});
	undonePlan = null;
}

/**
 * A music video is cut to the user's song, by its score: the planner lays its own library music and a talking-head cut
 * over the footage (4 shots, 33 s for a 64-s song with the song itself ignored: exam 11.11). Nothing is built; the
 * answer is the way to do it — at once, before any analysis (it needs the song's id only).
 */
function musicVideoWay(): string {
	// the user's own song first: not a library track (a 204-s «Dreamer.mp3» was named instead of the 64-s song), not a
	// voice or a stem made here
	const audio = sources().filter((m) => m.type === "audio" && !m.neural?.originalId);
	const own = audio.filter((m) => !m.librarySourceUrl && m.origin !== "result");
	const song = (own.length ? own : audio).sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))[0];
	return [
		`Not built: a music video is cut to its song by hand, from the song's score (apply_plan would lay library music under a talking-head cut). The way:`,
		song ? `1. The song on an audio track from 0: edit {ops:[{op:"place", media:"${short(song.id)}", at:0}]}.` : `1. Import the song (import_media) and place it on an audio track from 0.`,
		`2. analyze {what:"music"${song ? `, id:"${short(song.id)}"` : ""}} — the bar starts, which parts sound in every run of bars, the sung phrases with their times.`,
		`3. One edit call, a place per shot ({op:"place", media, track:"main", at:<a bar start>, sourceFrom, duration:<whole bars>}), shot after shot with no gaps: a singer only over a sung phrase, a drummer only where drums play, a guitarist only where «other» plays, wide shots anywhere; the whole song covered.`,
		`4. A singer shot sings the song under it: generate {kind:"lipsync", id:<that clip>, sound:"timeline"} (one clip a call; it keeps the clip's place and length).`,
		`5. review {recipe:"music-video"}, look at a sung phrase and a cut, export. The project's frame decides the platform (16:9 unless the user asked for Reels).`,
	].join("\n");
}

async function applyPlan(args: Args, signal: AbortSignal): Promise<string> {
	const ed = editor();
	const project = ed.project.getActiveOrNull() ?? fail("No project is open.");
	const input = args as PlanInput;
	const t = await taste();
	const asked = recipeOf(input.recipe && RECIPE_IDS.includes(input.recipe as never) ? input.recipe : readWords(String(input.brief ?? ""), t, {}).recipe);
	if (asked.id === "music-video" && sources().some((m) => m.type === "audio" || input.recipe === "music-video")) return musicVideoWay();
	let media = await mediaRefs(signal);
	// An empty project: a generated genre still gets its production script (the cast, the shots, the prices) — the
	// first thing a generated video needs; «No media» sent Claude to build a whole news piece by hand (exam 11.11).
	if (!media.length && !input.youtube?.length) {
		const words = readWords(String(input.brief ?? ""), t, {});
		const want = recipeOf(input.recipe && RECIPE_IDS.includes(input.recipe as never) ? input.recipe : words.recipe);
		if (want.mix !== "generated")
			return `No media in this project. A video made by AI starts from its production script (cast, shots, prices): apply_plan {recipe:"ai-short" | "talking-ad" | "monologue-lipsync" | "dialogue" | "cartoon", brief}. A cut from footage: import the clips first (import_media), then apply_plan again.`;
		const spec: PlatformSpec = platformSpec(input.platform ?? "") ?? platformOf(words.platform);
		const look = presetOf(input.preset && PRESET_IDS.includes(input.preset as never) ? input.preset : words.preset);
		return scriptFor(want.id, String(input.brief ?? ""), words.topic, words.language, media, look, spec, Math.max(want.seconds[0], Math.min(input.seconds ? Number(input.seconds) : words.seconds, spec.maxSeconds ?? 7200)));
	}
	const fetched = await fetchMissing(input, media, signal);
	if (fetched.length) media = await mediaRefs(signal);
	const mediaSeconds = media.reduce((s, m) => s + (m.brief?.speech ? m.brief.seconds : 0), 0) || undefined;
	const intent = readWords(String(input.brief ?? ""), t, { mediaSeconds });
	const recipe = recipeOf(input.recipe && RECIPE_IDS.includes(input.recipe as never) ? input.recipe : intent.recipe);
	const platform: PlatformSpec = platformSpec(input.platform ?? "") ?? platformOf(recipe.id === "youtube-video" && !input.platform ? "youtube" : intent.platform);
	const preset = withBrand(presetOf(input.preset && PRESET_IDS.includes(input.preset as never) ? input.preset : intent.preset), {
		display: t.brand.display,
		text: t.captions.font ?? t.brand.text,
		ink: t.brand.ink,
		accent: t.captions.color ?? t.brand.accent,
		plate: t.brand.plate,
		captionStyle: t.captions.style,
	});
	const seconds = Math.max(recipe.seconds[0], Math.min(input.seconds ? Number(input.seconds) : intent.seconds, platform.maxSeconds ?? 7200));
	// Generated genres: without the generated shots yet, the answer is the production script (cast, shot list, prices).
	if (recipe.mix === "generated" && media.filter((m) => m.type === "video").length < 2) return scriptFor(recipe.id, String(input.brief ?? ""), intent.topic, intent.language, media, preset, platform, seconds);
	if (recipe.id === "music-video") return musicVideoWay();
	// The frame first (its own step): the platform's shape.
	const canvas0 = project.settings.canvasSize;
	if (Math.abs(canvas0.width / canvas0.height - platform.size.width / platform.size.height) > 0.02) {
		// the platform's shape is chosen: a first clip placed later keeps it
		await ed.project.updateSettings({ settings: { canvasSize: { ...platform.size }, originalCanvasSize: { ...platform.size }, canvasFromClip: false } });
	}
	const canvas = ed.project.getActive().settings.canvasSize;
	const sounds = await api<{ music: SoundPick | null; sfx: Record<string, SoundPick | null>; pending?: string }>("sounds", { mood: input.music?.mood || t.music.mood || preset.music.mood, seconds, sfx: { hit: preset.sfx.hit, whoosh: preset.sfx.whoosh, riser: preset.sfx.riser } }, signal);
	const music = input.music?.off || t.music.off ? null : sounds.music;
	if (music) music.gain = (music.gain ?? 0) + t.music.levelDb;
	const fps = frameRateToFloat(ed.project.getActive().settings.fps) || 30;
	const plan = autoPlan({
		fps,
		recipe,
		preset,
		platform,
		seconds,
		topic: input.topic || intent.topic,
		language: intent.language,
		media,
		input,
		music,
		sfx: sounds.sfx,
		cta: input.cta || t.brand.cta || (t.brand.handle ? `${intent.language === "ru" ? "Подписывайся" : "Follow"} ${t.brand.handle}` : intent.language === "ru" ? "Подпишись" : "Follow for more"),
		isFiller: isFillerWord,
	});
	if (!plan.pieces.length) return `Nothing to build: ${plan.notes.join("; ") || "no usable speech or pictures"}.`;
	const before = ed.scenes.getActiveScene().tracks;
	const built = compilePlan({ plan, preset, platform, canvas, media, before, fps });
	// A wide close-up framed in a narrow frame: above and below it the look's plate colour (its own step, before the
	// tracks land). A colour costs the preview nothing; a blurred copy would decode every clip twice. A background the
	// user chose stays.
	const bg = ed.project.getActive().settings.background;
	if (built.framed && bg.type === "color" && bg.color.toLowerCase() === DEFAULT_BACKGROUND_COLOR) {
		await ed.project.updateSettings({ settings: { background: { type: "color", color: preset.palette.plate } } });
	}
	// One ⌘Z: the whole edit lands at once (no flicker of a timeline building up).
	replaceTracks(() => built.tracks as SceneTracks);
	// Pictures never sit still: one slow eased push each (Ken Burns), all in one more step.
	kenBurns(built.roles.stills ?? []);
	made = { project: project.metadata.id, roles: built.roles, style: built.style };
	lastPlan = { project: project.metadata.id, plan, plannedSeconds: plan.seconds };
	await api("project", { id: project.metadata.id, patch: { plan: { recipe: plan.recipe, preset: plan.preset, platform: plan.platform, seconds: plan.seconds, chapters: plan.chapters }, made: { stamp: String(Date.now()), roles: built.roles, style: built.style } } }, signal).catch(() => {});
	const assumed = `Assumed: ${recipe.id} · ${preset.id} · ${platform.id} ${platform.aspect} · ${Math.round(plan.seconds)} s · captions ${plan.captions ? plan.captions.style : "off"} · music ${plan.music ? `«${plan.music.pick.name}»` : "off"}${intent.topic ? ` · «${intent.topic}»` : ""} (${intent.said.length ? `your words: ${intent.said.join(", ")}; ` : ""}the rest from your taste profile).`;
	const review = await reviewNow({ platform: platform.id }, signal);
	const chapters = plan.chapters.length ? `\nChapters: 0:00 Intro${plan.chapters.map((c) => ` · ${Math.floor(c.at / 60)}:${String(Math.round(c.at % 60)).padStart(2, "0")} ${c.title}`).join("")}` : "";
	return [assumed, `Built (one ⌘Z): ${built.summary.join(" · ")}.`, ...(plan.notes.length ? [`Notes: ${plan.notes.join("; ")}.`] : []), ...(sounds.pending ? [`Music: ${sounds.pending}.`] : []), `${chapters ? chapters.trim() : ""}`, describeReview(review.result, { waived: review.waived }), `Next: ${review.result.hardFailed.length ? "review {fix:true}" : `look {at:[0.5, ${(plan.seconds / 2).toFixed(1)}, ${(plan.seconds - 1).toFixed(1)}]} → export {platform:"${platform.id}"${review.result.cover ? `, cover: ${review.result.cover.t.toFixed(1)}` : ""}}`}.`].filter(Boolean).join("\n");
}

/**
 * Material the edit lacks, in the owner's order: the user's media (already here) → the library (music and sounds, picked
 * in the plan) → free web pictures for the strongest lines → the YouTube seconds Claude named → generation (the
 * production script, priced). Each fetched piece is written into the project's record (YouTube: may be claimed).
 */
async function fetchMissing(input: PlanInput, media: MediaRef[], signal: AbortSignal): Promise<string[]> {
	const run = (window as unknown as { __agentTools?: { run: (name: string, args: string, signal: AbortSignal) => Promise<{ ok: boolean; content: string }> } }).__agentTools?.run;
	if (!run) return [];
	const pid = editor().project.getActive().metadata.id;
	const got: Array<{ media: string; name: string; from: "youtube" | "web"; source?: string; at: number }> = [];
	for (const y of input.youtube ?? []) {
		const r = await run("youtube", JSON.stringify({ query: y.url || y.query, from: y.from, to: y.to, download: true }), signal).catch(() => null);
		const j = r?.ok ? (JSON.parse(r.content) as { media?: string; name?: string }) : null;
		if (j?.media) got.push({ media: j.media, name: j.name ?? "YouTube", from: "youtube", source: `${y.url || y.query} ${y.from}–${y.to} s`, at: Date.now() });
	}
	const speaker = media.filter((m) => (m.brief?.speech?.words.length ?? 0) >= 10).sort((a, b) => (b.brief?.speech?.words.length ?? 0) - (a.brief?.speech?.words.length ?? 0))[0];
	const visuals = media.filter((m) => m.id !== speaker?.id && m.type !== "audio");
	if (input.find !== false && speaker?.brief?.speech && visuals.length < 2) {
		const sp = speaker.brief.speech;
		const lines = sp.quotes.slice(0, 3).map((i) => sp.sentences[i]).filter(Boolean);
		for (const s of lines) {
			const words = s.text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 4).slice(0, 3).join(" ");
			if (!words) continue;
			const r = await run("web_image", JSON.stringify({ query: words }), signal).catch(() => null);
			const j = r?.ok ? (JSON.parse(r.content) as { media?: string; name?: string }) : null;
			if (j?.media) got.push({ media: j.media, name: j.name ?? words, from: "web", source: words, at: Date.now() });
		}
	}
	if (got.length) await api("project", { id: pid, patch: { provenance: got } }, signal).catch(() => {});
	return got.map((g) => g.media);
}

const CAMERA_MOVE_WORDS = "camera:";

function scriptFor(recipeId: string, brief: string, topic: string, language: "ru" | "en", media: MediaRef[], preset: ReturnType<typeof presetOf>, platform: PlatformSpec, seconds: number): string {
	const photos = media.filter((m) => m.type === "image" && (m.brief?.faces ?? 0) > 0);
	const cast: CastMember[] = (photos.length ? photos : [null]).slice(0, recipeId === "dialogue" ? 2 : 1).map((m, i) => ({
		id: String.fromCharCode(65 + i),
		name: m ? m.name.replace(/\.[a-z0-9]+$/i, "") : language === "ru" ? "Герой" : "The hero",
		look: m ? "as in the reference photo" : topic || "the main character of the brief",
		outfit: "the same outfit in every shot",
		...(m ? { sheet: short(m.id) } : {}),
	}));
	if (recipeId === "dialogue" && cast.length < 2) cast.push({ id: "B", name: language === "ru" ? "Собеседник" : "The other", look: "a contrasting second character", outfit: "the same outfit in every shot" });
	const quoted = /[«"“](.+?)[»"”]/.exec(brief)?.[1] ?? (/:\s*(.+)$/.exec(brief)?.[1] ?? "");
	const lines = quoted
		? quoted.split(/(?<=[.!?])\s+/).map((text, i) => ({ text, who: recipeId === "dialogue" ? cast[i % 2].id : recipeId === "monologue-lipsync" || recipeId === "talking-ad" ? "A" : undefined }))
		: ["hook", "line", "line", "payoff"].map((what, i) => ({ text: `(write the ${what}${topic ? ` about ${topic}` : ""})`, who: recipeId === "dialogue" ? cast[i % 2].id : recipeId === "monologue-lipsync" || recipeId === "talking-ad" ? "A" : undefined }));
	// A talking photo / UGC ad: the voice first, then the avatar model speaks it from the photo (one shot, lips in sync),
	// then the product shots animated from the user's product pictures — about $2–3 of generation for 30 s.
	if (recipeId === "monologue-lipsync" || recipeId === "talking-ad") {
		const photo = cast[0]?.sheet;
		const text = lines.map((l) => l.text).join(" ");
		const products = media.filter((m) => m.type === "image" && !(m.brief?.faces ?? 0));
		const steps = [
			`price_plan {"items":[{"kind":"voice","chars":${text.length}},{"kind":"video","mode":"avatar","aspect":"${platform.aspect}","duration":${Math.min(seconds, Math.ceil(text.length / 14))},"model":"cheapest"}${products.length ? `,{"kind":"video","mode":"image","quality":"480p","aspect":"${platform.aspect}","duration":5,"count":${products.length},"model":"cheapest"}` : ""}]}`,
			`generate {"kind":"voice","text":${JSON.stringify(text)},"place":false} → VOICE`,
			`generate {"kind":"video","mode":"avatar","from":"${photo ?? "PHOTO"}","sound":"VOICE","aspect":"${platform.aspect}","prompt":"the person speaks to camera, natural head movement, ${preset.suits.split(":")[0]}","place":false,"model":"cheapest"} → AVATAR`,
			...products.map((p, i) => `generate {"kind":"video","mode":"image","quality":"480p","aspect":"${platform.aspect}","duration":5,"from":"${short(p.id)}","prompt":"${CAMERA_MOVE_WORDS} slow push-in on the product, soft studio light","place":false,"model":"cheapest"} → PRODUCT_${i + 1}`),
			`apply_plan {"recipe":"${recipeId}"} — assembles AVATAR as the talking clip, the product shots as inserts, captions from the voice, music, CTA, one grade; then review`,
		];
		return [`Assumed: ${recipeId} · ${preset.id} · ${platform.id} ${platform.aspect} · ${seconds} s · ${photo ? `the photo ${short(photo)}` : "a photo is needed (import one)"} speaks${products.length ? ` · ${products.length} product shot(s)` : ""}.`, "Production script (run in order; CAPS = the ids the steps return):", ...steps.map((x, i) => `${i + 1}. ${x}`)].join("\n");
	}
	const style = recipeId === "cartoon" ? "flat 2D cartoon illustration, clean outlines, soft shading, one consistent art style" : "cinematic, natural skin, filmic contrast";
	const scenes: Scene[] = [{ n: 1, place: topic || "the place of the story", light: recipeId === "cartoon" ? "soft even daylight" : "soft window light from the left, warm", palette: `${preset.palette.accent}, ${preset.palette.plate}, natural skin` }];
	const shots = shotList({ lines, cast, seconds, scenes: seconds > 40 ? 2 : 1 });
	if (seconds > 40) scenes.push({ n: 2, place: scenes[0].place, light: scenes[0].light, palette: scenes[0].palette });
	const steps = productionScript({ shots, scenes, cast, style, mood: preset.suits.split(":")[0], aspect: platform.aspect });
	return [
		`Assumed: ${recipeId} · ${preset.id} · ${platform.id} ${platform.aspect} · ${seconds} s · cast ${cast.map((c) => `${c.name}${c.sheet ? ` (photo ${short(c.sheet)})` : ""}`).join(", ")}.`,
		`Production script — ${shots.length} shots, film grammar (establishing → medium → close${cast.length > 1 ? "; A left looking right, B right looking left" : ""}), one light and palette, each shot a picture first then animated (480p drafts), the next shot of a scene from the previous last frame. Run in order; names in CAPS are the ids the steps return:`,
		...steps.map((st, i) => `${i + 1}. ${st.step}: ${st.tool} ${JSON.stringify(st.args)}${st.as ? ` → ${st.as}` : ""}`),
		"Then apply_plan again: it assembles the shots on the voice with captions, music, sounds and one grade, and reviews.",
	].join("\n");
}

/** A slow push (+8 %) with a small drift over each still, eased: one upsertKeyframes call = one ⌘Z. */
function kenBurns(ids: string[]) {
	if (!ids.length) return;
	const ed = editor();
	const canvas = ed.project.getActive().settings.canvasSize;
	const keys: Parameters<typeof ed.timeline.upsertKeyframes>[0]["keyframes"] = [];
	allElements().forEach(({ track, element }, k) => {
		if (!ids.includes(element.id)) return;
		const s = Number(element.params["transform.scaleX"] ?? 1);
		const x = Number(element.params["transform.positionX"] ?? 0);
		const drift = canvas.width * 0.012 * (k % 2 ? 1 : -1);
		const at = (t: number) => (element.startTime + Math.round(t * element.duration)) as never;
		for (const [path, a, b] of [["transform.scaleX", s, s * 1.08], ["transform.scaleY", s, s * 1.08], ["transform.positionX", x, x + drift]] as const) {
			keys.push({ trackId: track.id, elementId: element.id, propertyPath: path as never, time: at(0), value: a, interpolation: "bezier" as never });
			keys.push({ trackId: track.id, elementId: element.id, propertyPath: path as never, time: at(1), value: Math.round(b * 1000) / 1000, interpolation: "bezier" as never });
		}
	});
	if (keys.length) ed.timeline.upsertKeyframes({ keyframes: keys });
}

// ───────────────────────── review ─────────────────────────

function reviewElements(): { elements: ReviewElement[]; transitions: Array<{ type: string; at: number }> } {
	const elements: ReviewElement[] = [];
	const transitions: Array<{ type: string; at: number }> = [];
	const overlays = editor().scenes.getActiveScene().tracks.overlay.map((t) => t.id);
	for (const { track, element, role } of allElements()) {
		const e = element as TimelineElement & { mediaId?: string; definitionId?: string; sourceUrl?: string; effects?: Array<{ type: string; params: Record<string, unknown> }>; hidden?: boolean; retime?: { rate?: number } };
		if (e.hidden || ("hidden" in track && track.hidden)) continue;
		elements.push({
			// overlay[0] is the top layer; the main track lies under every overlay
			layer: role === "overlay" ? Math.max(0, overlays.indexOf(track.id)) : role === "main" ? 1e6 : undefined,
			rate: Number(e.retime?.rate ?? 1) || 1,
			trackMuted: !!(track as { muted?: boolean }).muted,
			id: e.id,
			type: e.type,
			track: track.id,
			trackType: track.type,
			trackRole: role,
			name: e.name,
			start: sec(e.startTime),
			end: sec(e.startTime + e.duration),
			mediaId: e.mediaId,
			trimStart: e.trimStart,
			params: e.params as Record<string, unknown>,
			effects: e.effects,
			definitionId: e.definitionId,
			sourceUrl: e.sourceUrl,
			animated: !!(e as { animations?: Record<string, unknown> }).animations && Object.keys((e as { animations?: Record<string, unknown> }).animations ?? {}).length > 0,
		});
	}
	const main = editor().scenes.getActiveScene().tracks.main as unknown as { transitions?: Array<{ type: string; toElementId: string }> };
	for (const tr of main.transitions ?? []) {
		const to = elements.find((x) => x.id === tr.toElementId);
		transitions.push({ type: tr.type, at: to?.start ?? 0 });
	}
	return { elements, transitions };
}

/** The sound of the project as pieces of its sources, for the server's mix. */
async function mixParts(elements: ReviewElement[], media: MediaRef[]) {
	const assets = sources();
	const parts = [];
	const speech: Array<[number, number]> = [];
	for (const e of elements) {
		if (e.type !== "video" && e.type !== "audio") continue;
		if (e.params.muted === true || Number(e.params.volume ?? 0) <= -59) continue;
		const rate = Number((e as unknown as { retime?: { rate?: number } }).retime?.rate ?? 1) || 1;
		const len = e.end - e.start;
		const from = (e.trimStart ?? 0) / TICKS_PER_SECOND;
		const lib = e.sourceUrl ? decodeURIComponent(/\/api\/library\/file\/([^?]+)/.exec(e.sourceUrl)?.[1] ?? "") : "";
		const asset = e.mediaId ? assets.find((a) => a.id === e.mediaId) : undefined;
		const key = asset ? await keyOf(asset) : undefined;
		if (!key && !lib) continue;
		const brief = media.find((m) => m.id === e.mediaId)?.brief;
		if (e.type === "video" && brief && !brief.hasAudio) continue;
		const isSpeech = (brief?.speech?.words.length ?? 0) >= 10;
		const isMusic = e.params.duckUnderVoice === true || (!!lib && len > 12);
		parts.push({ key, library: lib || undefined, from, to: from + len * rate, at: e.start, gainDb: Number(e.params.volume ?? 0), fadeIn: Number(e.params.fadeIn ?? 0), fadeOut: Number(e.params.fadeOut ?? 0), rate, role: isSpeech ? "speech" : isMusic ? "music" : "other", duck: e.params.duckUnderVoice === true });
		if (isSpeech && brief?.speech) for (const w of brief.speech.words) if (w.start >= from - 0.01 && w.end <= from + len * rate + 0.01) speech.push([e.start + (w.start - from) / rate, e.start + (w.end - from) / rate]);
	}
	speech.sort((a, b) => a[0] - b[0]);
	const merged: Array<[number, number]> = [];
	for (const s of speech) {
		const last = merged[merged.length - 1];
		if (last && s[0] - last[1] < 0.5) last[1] = Math.max(last[1], s[1]);
		else merged.push([s[0], s[1]]);
	}
	return { parts, speech: merged.map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000] as [number, number]) };
}

/** Small frames of the edit, rendered off screen (its own renderer: the user's playhead and preview don't move). */
async function renderFrames(times: number[]): Promise<Array<{ t: number; data: string }>> {
	const ed = editor();
	const canvasSize = ed.project.getActive().settings.canvasSize;
	const width = 360;
	const painter = stillFramePainter(ed, { width });
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = Math.round((width * canvasSize.height) / canvasSize.width / 2) * 2;
	const out: Array<{ t: number; data: string }> = [];
	try {
		for (const t of times) {
			await painter.paint(canvas, Math.round(t * TICKS_PER_SECOND));
			const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
			if (blob) {
				const data = await new Promise<string>((r) => {
					const fr = new FileReader();
					fr.onload = () => r(String(fr.result));
					fr.readAsDataURL(blob);
				});
				out.push({ t, data });
			}
			// one frame per task: the editor stays smooth
			await sleep(0);
		}
	} finally {
		painter.dispose();
	}
	return out;
}

function checkpoints(elements: ReviewElement[], total: number): number[] {
	const main = elements.filter((e) => e.trackRole === "main").sort((a, b) => a.start - b.start);
	const inserts = elements.filter((e) => e.trackRole === "overlay" && (e.type === "video" || e.type === "image"));
	const titles = elements.filter((e) => e.type === "text" && !e.params["caption.style"]);
	const caps = elements.filter((e) => e.type === "text" && !!e.params["caption.style"]);
	const times = new Set<number>([0.6, Math.max(0, total - 0.8)]);
	const step = Math.max(1, Math.ceil(main.length / 12));
	for (const [i, e] of main.entries()) if (i % step === 0) times.add((e.start + e.end) / 2);
	for (const e of inserts.slice(0, 6)) times.add((e.start + e.end) / 2);
	for (const e of titles.slice(0, 5)) times.add(Math.min(e.end - 0.05, e.start + 0.7));
	const capStep = Math.max(1, Math.ceil(caps.length / 4));
	for (const [i, e] of caps.entries()) if (i % capStep === 0) times.add((e.start + e.end) / 2);
	return [...times].filter((t) => t >= 0 && t < total).sort((a, b) => a - b).slice(0, 26).map((t) => Math.round(t * 100) / 100);
}

/** A promise, or `fallback` after `ms` (a slow measurement never holds the window). */
const within = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> => Promise.race([p, sleep(ms).then(() => fallback)]);

/** The main sound of the edit as the hearing model hears it (a few 10 s windows of the full mix), when it was listened to. */
async function heardOfMain(elements: ReviewElement[], media: MediaRef[], signal: AbortSignal): Promise<HeardFacts | null> {
	const main = mainSound(elements, media);
	if (!main) return null;
	try {
		const { fileOf, findSounding } = await import("@/hear/client");
		// The song's own file (the full mix), also when only its stems play on the timeline.
		const el = elements.find((e) => e.type === "audio" && (e.mediaId === main.ref.id || media.find((m) => m.id === e.mediaId)?.stemOf === main.ref.id));
		const s = el ? findSounding(el.id) : null;
		if (!s) return null;
		const full = await import("@/agent/hear-tools").then((m) => m.fullMixOf(s));
		const fileId = await fileOf(full);
		const res = await fetch("/api/hear/music", { method: "POST", headers: HEADERS, body: JSON.stringify({ fileId, duration: full.asset?.duration ?? full.end - full.start, quick: true }), signal });
		const r = (await res.json().catch(() => null)) as { summary?: { music: number; singing: number; speech: number } } | null;
		return r?.summary ? { music: r.summary.music, singing: r.summary.singing, speech: r.summary.speech } : null;
	} catch {
		return null;
	}
}

/** The song under a music video: where its vocals are sung (its own words, or its voice stem's), in timeline seconds. */
function songOf(elements: ReviewElement[], media: MediaRef[], heard: HeardFacts | null): ReviewInput["song"] {
	const main = mainSound(elements, media);
	if (!main) return null;
	const vocals: Array<{ start: number; end: number }> = [];
	let words = 0;
	for (const e of elements) {
		if (e.type !== "audio" || !e.mediaId) continue;
		const m = media.find((x) => x.id === e.mediaId);
		if (!m || (m.id !== main.ref.id && m.stemOf !== main.ref.id) || m.stem === "music") continue;
		const w = m.brief?.speech?.words ?? (m.stem === "voice" ? [] : (main.ref.brief?.speech?.words ?? []));
		words += w.length;
		vocals.push(...vocalSpans(w, { start: e.start, end: e.end, trimStart: (e.trimStart ?? 0) / TICKS_PER_SECOND, rate: e.rate }));
	}
	vocals.sort((a, b) => a.start - b.start);
	const merged: Array<{ start: number; end: number }> = [];
	for (const v of vocals) {
		const last = merged[merged.length - 1];
		if (last && v.start <= last.end + 0.5) last.end = Math.max(last.end, v.end);
		else merged.push({ ...v });
	}
	return { name: main.ref.name, vocals: merged, hasVocals: words >= 6 || (heard?.singing ?? 0) >= 0.15 };
}

/** Claude's own record of when each performance shot's sound was (generate avatar / lipsync store it as they place it). */
export async function rememberSync(mediaId: string, info: SyncInfo): Promise<void> {
	const pid = editor().project.getActiveOrNull()?.metadata.id;
	if (!pid || !mediaId || !Number.isFinite(info.at)) return;
	const record = (await api<{ record: { sync?: Record<string, SyncInfo> } }>(`project?id=${encodeURIComponent(pid)}`).catch(() => ({ record: {} as { sync?: Record<string, SyncInfo> } }))).record;
	await api("project", { id: pid, patch: { sync: { ...(record.sync ?? {}), [mediaId]: info } } }).catch(() => {});
}

async function reviewNow(args: Args, signal: AbortSignal): Promise<{ result: ReviewResult; waived: string[]; head: string }> {
	const ed = editor();
	const project = ed.project.getActiveOrNull() ?? fail("No project is open.");
	const pid = project.metadata.id;
	const record = (await api<{ record: { plan?: { recipe?: string; preset?: string; platform?: string; seconds?: number }; waived: string[]; provenance: Array<{ media: string; from: string; name: string }>; sync?: Record<string, SyncInfo> } }>(`project?id=${encodeURIComponent(pid)}`)).record;
	const waive = Array.isArray(args.waive) ? args.waive.map(String) : [];
	if (args.recipe !== undefined && !RECIPE_IDS.includes(String(args.recipe) as RecipeId)) fail(`recipe: one of ${RECIPE_IDS.join(", ")}.`);
	const t = await taste();
	const { elements, transitions } = reviewElements();
	const total = elements.filter((e) => e.trackRole !== "audio").reduce((m, e) => Math.max(m, e.end), 0);
	if (!total) return { result: { score: 0, hardFailed: ["length"], checks: [], fixes: [], cover: null, notes: ["The timeline is empty."] }, waived: waive, head: "" };
	const canvas = project.settings.canvasSize;
	// The platform: the one asked, the plan's, else the one this frame is for (16:9 → YouTube, 9:16 → Reels…).
	const asked = args.platform ?? record.plan?.platform;
	const platform = asked ? platformOf(String(asked)) : platformFor(canvas, total, [t.platform, ...(t.targets ?? [])]);
	const media = await usedMediaRefs(signal, 10_000);
	// The recipe: the one asked, the plan's, else what the edit is (a song with vocals under it → a music video).
	const heard = !args.recipe && !record.plan?.recipe ? await within(heardOfMain(elements, media, signal), 8_000, null) : null;
	const inferred = !args.recipe && !record.plan?.recipe ? inferRecipe({ elements, media, heard }) : null;
	const recipe = recipeOf(String(args.recipe ?? record.plan?.recipe ?? inferred?.recipe ?? (platform.id === "youtube" ? "youtube-video" : t.recipe)));
	const preset = withBrand(presetOf(record.plan?.preset ?? t.preset), { display: t.brand.display, text: t.captions.font ?? t.brand.text, ink: t.brand.ink, accent: t.captions.color ?? t.brand.accent, plate: t.brand.plate });
	const head = `Judged as ${recipe.id}${args.recipe ? "" : record.plan?.recipe ? " (the plan's)" : inferred ? ` (${inferred.why}; review {recipe} to judge it as another)` : " (no plan: the taste's recipe; review {recipe} names it)"} for ${platform.label}${asked ? "" : ` (the project's ${canvas.width}×${canvas.height} frame)`}.`;
	const { parts, speech } = await mixParts(elements, media);
	const thirds = record.plan && (record.plan as { chapters?: Array<{ at: number }> }).chapters?.length ? [0, ...((record.plan as { chapters: Array<{ at: number }> }).chapters.map((c) => c.at)), total] : [0, total / 3, (2 * total) / 3, total];
	const sections = thirds.slice(0, -1).map((a, i) => [a, thirds[i + 1]] as [number, number]);
	// Everything slow runs side by side, each with a ceiling: the review answers in well under a minute.
	const measuredP = within(api<Measured>("measure", { parts, total, speech, sections }, signal).catch(() => null), 30_000, null);
	const seamsP = within(
		checkCuts({}, signal)
			.then((r) => {
				const text = typeof r === "string" ? r : r.text;
				const m = /checked: (\d+) with problems/.exec(text);
				return text ? { problems: m ? Number(m[1]) : 0, text: text.split("\n").filter((l) => l.startsWith("✗")).slice(0, 3).join(" | ") } : null;
			})
			.catch(() => null),
		12_000,
		null,
	);
	// The render tree follows the timeline on the next frames.
	await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
	const frames = await renderFrames(checkpoints(elements, total));
	const judgedP = within(api<{ frames: RenderedFrame[] }>("judge", { frames }, signal).then((r) => r.frames).catch(() => [] as RenderedFrame[]), 30_000, [] as RenderedFrame[]);
	const [measured, judged, seams] = await Promise.all([measuredP, judgedP, seamsP]);
	const waived = [...new Set([...record.waived, ...waive])];
	const result = runReview({
		platform,
		preset,
		recipe,
		canvas,
		fps: frameRateToFloat(project.settings.fps) || 30,
		elements,
		transitions,
		media,
		measured,
		frames: judged,
		seams,
		plannedSeconds: lastPlan?.project === pid ? lastPlan.plannedSeconds : record.plan?.seconds,
		exportNormalizes: true,
		waived,
		provenance: record.provenance ?? [],
		sync: record.sync,
		song: recipe.id === "music-video" ? songOf(elements, media, heard) : null,
	});
	await api("project", { id: pid, patch: { review: { score: result.score, hardFailed: result.hardFailed, at: Date.now(), stamp: String(elements.length) }, waived: waive } }, signal).catch(() => {});
	return { result, waived, head };
}

/** Applies the review's own fixes as one ⌘Z (set / set_effect / apply_filter / keyframes on known ids; deletes of inserts). */
function applyFixes(result: ReviewResult): string[] {
	const done: string[] = [];
	const auto = result.fixes.filter((f) => f.auto && f.steps.length);
	if (!auto.length) return done;
	replaceTracks((tracks) => {
		const find = (id: string) => {
			for (const track of [...tracks.overlay, tracks.main, ...tracks.audio] as TimelineTrack[]) {
				const i = (track.elements as TimelineElement[]).findIndex((e) => e.id.startsWith(id));
				if (i >= 0) return { track, i };
			}
			return null;
		};
		const next = structuredClone(tracks) as SceneTracks;
		const findNext = (id: string) => {
			for (const track of [...next.overlay, next.main, ...next.audio] as TimelineTrack[]) {
				const i = (track.elements as TimelineElement[]).findIndex((e) => e.id.startsWith(id));
				if (i >= 0) return { track, i };
			}
			return null;
		};
		void find;
		for (const f of auto) {
			let ok = false;
			for (const s of f.steps) {
				const at = findNext(String(s.id ?? (Array.isArray(s.ids) ? s.ids[0] : "")));
				if (!at) continue;
				const el = (at.track.elements as TimelineElement[])[at.i] as TimelineElement & { effects?: Array<{ type: string; params: Record<string, unknown> }> };
				if (s.op === "set") {
					(at.track.elements as TimelineElement[])[at.i] = { ...el, params: { ...el.params, ...(s.params as Record<string, never>) } } as TimelineElement;
					ok = true;
				} else if ((s.op === "set_effect" || s.op === "apply_filter") && el.effects) {
					const params = s.op === "apply_filter" ? { look: s.look } : (s.params as Record<string, unknown>);
					(at.track.elements as TimelineElement[])[at.i] = { ...el, effects: el.effects.map((x) => (x.type === "studio.color" ? { ...x, params: { ...x.params, ...params } } : x)) } as unknown as TimelineElement;
					ok = true;
				} else if (s.op === "delete") {
					(at.track.elements as TimelineElement[]).splice(at.i, 1);
					ok = true;
				} else if (s.op === "keyframes") {
					// a slow push: a scale a little bigger at the end (the inspector's keyframes would need the animation model; a static punch is the safe form)
					const scale = Number(el.params["transform.scaleX"] ?? 1) * 1.08;
					(at.track.elements as TimelineElement[])[at.i] = { ...el, params: { ...el.params, "transform.scaleX": scale, "transform.scaleY": scale } } as TimelineElement;
					ok = true;
				}
			}
			if (ok) done.push(f.say);
		}
		return next;
	});
	return done;
}

async function review(args: Args, signal: AbortSignal): Promise<string> {
	let r = await reviewNow(args, signal);
	const text = (x: typeof r) => `${x.head ? `${x.head}\n` : ""}${describeReview(x.result, { waived: x.waived })}`;
	if (args.fix === true) {
		const done = applyFixes(r.result);
		if (done.length) {
			r = await reviewNow({ ...args, fix: false }, signal);
			return `Fixed (one ⌘Z): ${done.join("; ")}.\n${text(r)}`;
		}
		return `Nothing the review can fix by itself.\n${text(r)}`;
	}
	return text(r);
}

// ───────────────────────── taste_profile ─────────────────────────

async function tasteProfile(args: Args): Promise<string> {
	const t = args.set && typeof args.set === "object" ? (await api<{ taste: TasteProfile }>("taste", { set: args.set })).taste : await taste();
	return [
		describeTaste(t),
		`presets: ${PRESETS.map((p) => `${p.id} (${p.suits.split(":")[0]})`).join(" · ")}`,
		`recipes: ${RECIPES.map((r) => `${r.id} ${r.seconds[1]} s`).join(" · ")}`,
		"Change: taste_profile {set:{platform, preset, budget, captions:{style,font,color}, music:{mood, levelDb, off}, seconds:{short,long}, brand:{name, display, text, ink, accent, plate, handle, cta}, targets}}",
	].join("\n");
}

// ───────────────────────── the catalog ─────────────────────────

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const S = (description: string) => ({ type: "string", description });
const N = (description: string) => ({ type: "number", description });
const B = (description: string) => ({ type: "boolean", description });

export const PRODUCE_TOOLS: Array<{ name: string; description: string; parameters: Record<string, unknown>; run: (args: Args, signal: AbortSignal) => Promise<unknown> }> = [
	{
		name: "analyze_material",
		description:
			"Read the material first: per clip the shot, faces, motion, cuts, exposure, the most beautiful and the weak frames, the sound, and for speech the best lines ranked as hooks (#n with times), retakes and dead air; then the suggested recipe, look, platform and length for the user's words. Cached (made in the background on import): instant for known media.",
		parameters: obj({ media: { type: "array", items: { type: "string" }, description: "Media ids (default: all)" }, brief: S("The user's words, e.g. 'рилс из этого', '8-min YouTube about coffee'") }),
		run: (a, s) => analyzeMaterial(a, s),
	},
	{
		name: "apply_plan",
		description:
			"Build the whole edit in one call (one ⌘Z) from a brief and/or a plan: cuts on natural pauses, punch-ins over jump cuts, B-roll matched to the words, captions in the safe zone, titles, music ending on a bar and ducked, sounds, one grade, the dialog cleaned. Everything optional: {brief:'рилс из этого'} alone works (the taste profile fills the rest). Runs review and returns its score and fixes.",
		parameters: obj({
			brief: S("The user's words"),
			recipe: S(RECIPE_IDS.join(" | ")),
			preset: S(PRESET_IDS.join(" | ")),
			platform: S("reels | tiktok | shorts | youtube | feed | vk | telegram"),
			seconds: N("Length"),
			topic: S("What it is about (titles)"),
			title: S("Hook / title text"),
			cta: S("Call to action text"),
			speaker: S("Name for the lower third"),
			beats: { type: "array", items: obj({ media: S("Media id"), from: N("Clip seconds"), to: N("Clip seconds"), quote: N("Sentence #n from analyze_material") }), description: "The talking pieces in order (default: chosen by hook score)" },
			broll: { type: "array", items: obj({ media: S("Media id"), at: N("Timeline seconds"), words: S("The words it illustrates"), seconds: N("Length") }, ["media"]), description: "Inserts (default: matched to the words)" },
			music: obj({ mood: S("Words for the library"), off: B("No music") }),
			captions: obj({ style: S("Caption style id"), off: B("No captions") }),
		}),
		run: (a, s) => applyPlan(a, s),
	},
	{
		name: "review",
		description:
			"The quality gate: score 0–100 from the real project, its rendered frames (judged for beauty: blur, exposure, horizon, eyes, faces under text) and its measured sound (loudness, music under speech, holes), hard checks that keep export closed until fixed or waived, the top fixes as exact edit steps, and the best cover frame. A music video or AI short must move (stills on top ≤ 10 % of the length), use each shot ≤ 2×, keep every avatar / lipsync shot at its own sound's time, and a song with vocals needs the singer singing on screen in every sung section. fix:true applies the fixes it can (one ⌘Z) and reviews again.",
		parameters: obj({ recipe: S(`What the video is, judged as one: ${RECIPE_IDS.join(" | ")} (default: the plan's; without a plan a song with vocals under the edit is a music-video)`), platform: S("Platform id (default: the plan's, else the project's frame: 16:9 → youtube, 9:16 → reels)"), fix: B("Apply the automatic fixes"), waive: { type: "array", items: { type: "string" }, description: "Check ids to waive (the user's choice)" } }),
		run: (a, s) => review(a, s),
	},
	{
		name: "taste_profile",
		description: "The user's stored taste (platform, look, budget, captions, music, lengths, brand kit, where to post) — what a short brief is filled with — plus the preset and recipe ids. set: change it when the user says so.",
		parameters: obj({ set: { type: "object", description: "Fields to change" } }),
		run: (a) => tasteProfile(a),
	},
];

export const PRODUCE_STEP_LABELS: Record<string, string> = {
	analyze_material: "Reading the material",
	apply_plan: "Building the edit",
	review: "Reviewing the edit",
	taste_profile: "Reading your taste",
};

/** The Assemble button (src/assemble) builds with the very pieces apply_plan and review use: no second engine. */
export const produceKit = {
	api,
	sources,
	keyOf,
	startBriefs,
	refOf,
	taste,
	reviewNow,
	applyFixes,
	kenBurns,
	remember(project: string, plan: Plan, roles: Record<string, string[]>, style: Record<string, string | number>) {
		made = { project, roles, style };
		lastPlan = { project, plan, plannedSeconds: plan.seconds };
	},
};

if (typeof window !== "undefined") {
	queueMicrotask(() => {
		try {
			watch();
		} catch {}
	});
	// Self-tests read which content keys the open project's media have (the background brief's progress).
	(window as unknown as { __produceKeys: () => string[] }).__produceKeys = () => sources().map((a) => keys.get(a.id)).filter((k): k is string => !!k);
}
