// The quiet background download of the models (docs/AI-DOWNLOAD.md), like iCloud Photos: nothing asks, nothing pops up.
// - Small models (a download up to 1 GB: speech recognition first, then Enhance voice, Separate, Voice changer,
//   CleanUp, Retouch) come by themselves once the first project has been opened — a couple of minutes after it, so the
//   first project opens and plays as fast as ever; on every later launch a couple of minutes after the start.
// - Large models (voice, lipsync, face swap, pictures, music) only when Settings → AI → «Download large models in the
//   background» is on (off by default); otherwise they download on first use, inside the feature's own progress.
// - One model at a time, at a capped speed (3 MB/s), and never beside the user's own work: while an export, any AI
//   tool or a download the user asked for runs, the download stands still (the connection is let go, the bytes stay on
//   disk) and continues after. A feature that asks for the model being downloaded takes it over at full speed.
// - No internet: it waits for it (checked every minute). Too little free space (the model plus 5 GB for the user's own
//   work): that model waits, the next ones go. A crash or a quit: the next launch continues from the bytes on disk.
// - A model the user removed in Settings is never downloaded by itself again (the user's choice, kept in the file).
// - An installed model that lacks an add-on file (ModelFile.optional: the speech detector beside the speech model, added
//   in a later version) gets just that file the same quiet way; the model works without it meanwhile.
import fs from "node:fs";
import path from "node:path";
import { modelsDir, supportDir } from "@/platform/paths";
import { cancelJob, getJob, type JobState, runningJobs } from "@/studio/server/jobs";
import { loadSettings, saveSettings } from "@/studio/server/settings";
import { downloadBytes, MODELS, type ModelClass, type ModelId, modelClass, type ModelSpec, PARTS } from "./manifest";
import { backgroundJobIds, freeBytes, installBytes, isBundled, isUrgent, ondeviceState, online, startInstall } from "./server";
import { isHot, isHotLevel, onThermal } from "./thermal";

const TEST = process.env.STUDIO_TEST === "1";
/** Self-tests: the queue is off unless a test turns it on (no test may download a model it did not ask for). */
const ENABLED = !TEST || process.env.STUDIO_TEST_BG === "1";
const num = (v: string | undefined, fallback: number) => (TEST && v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : fallback);
/** After the first project opens (and after each later launch): long enough for the project to open and play. */
const DELAY_MS = num(process.env.STUDIO_TEST_BG_DELAY, 120) * 1000;
/** The speed cap: a 574 MB speech model in about 3 minutes, the editor's own network left free. */
const RATE = num(process.env.STUDIO_TEST_BG_RATE, 3_000_000);
/** Free space kept for the user's own work beside a model (projects, exports, caches). */
const RESERVE = num(process.env.STUDIO_TEST_BG_RESERVE, 5e9);
/** How often a waiting queue looks again (the internet, a finished export). */
const POLL_MS = num(process.env.STUDIO_TEST_BG_POLL, 60) * 1000;
/** How long a busy report of the page counts (it repeats it every 5 s while the work runs; a closed page stops). */
const BUSY_TTL_MS = 15_000;

/** The small models in the order they help most: captions first, then Claude's hearing (sounds_like, listen). */
const SMALL_ORDER: ModelId[] = ["whisper", "hear", "denoise", "separate", "voicechange", "cleanup", "retouch"];
const LARGE_ORDER: ModelId[] = ["voice", "lipsync", "faceswap"];

export type BackgroundState = "off" | "waiting-project" | "scheduled" | "downloading" | "paused" | "done";

export interface BackgroundStatus {
	state: BackgroundState;
	/** The model being downloaded (or waiting to). */
	model?: ModelId;
	title?: string;
	progress?: number;
	/** Why it stands still, as words for the line («the export is running»). */
	reason?: string;
	/** Settings → AI → «Download large models in the background». */
	large: boolean;
	/** What is left for the queue, in order. */
	left: ModelId[];
}

interface Saved {
	/** When the first project was opened (the queue's start signal). */
	projectOpened?: string;
	/** Models the user removed: never downloaded by themselves again. */
	declined?: ModelId[];
}

const file = () => path.join(supportDir(), "ondevice-background.json");
function readSaved(): Saved {
	try {
		return JSON.parse(fs.readFileSync(file(), "utf8")) ?? {};
	} catch {
		return {};
	}
}
function writeSaved(next: Saved) {
	try {
		fs.mkdirSync(supportDir(), { recursive: true });
		fs.writeFileSync(`${file()}.tmp`, JSON.stringify(next, null, 2));
		fs.renameSync(`${file()}.tmp`, file());
	} catch {}
}

interface Runtime {
	armed: boolean;
	timer: ReturnType<typeof setTimeout> | null;
	running: boolean;
	startAt: number;
	status: BackgroundStatus;
	/** The page's report of the user's work: «export», «ai». */
	pageBusy: { reasons: string[]; at: number };
	/** This session: models that failed three times or were cancelled by hand (tried again next launch). */
	skip: Set<ModelId>;
	failures: Map<ModelId, number>;
	/** Wakes a waiting loop at once (the large switch, a finished export). */
	wake: (() => void) | null;
}
const g = globalThis as typeof globalThis & { __ondeviceBackground?: Runtime };
g.__ondeviceBackground ??= {
	armed: false,
	timer: null,
	running: false,
	startAt: 0,
	status: { state: ENABLED ? "waiting-project" : "off", large: false, left: [] },
	pageBusy: { reasons: [], at: 0 },
	skip: new Set(),
	failures: new Map(),
	wake: null,
};
const rt: Runtime = g.__ondeviceBackground;
// The Mac cooled down: a waiting queue looks again at once (once per server, the dev server reloads this module).
const hooks = globalThis as typeof globalThis & { __ondeviceThermalHook?: boolean };
if (!hooks.__ondeviceThermalHook) {
	hooks.__ondeviceThermalHook = true;
	onThermal((level) => {
		if (!isHotLevel(level)) rt.wake?.();
	});
}

/** Which models the queue takes, in order (pure: the unit test drives it). */
export function queueOrder(
	models: Array<{ id: ModelId; cls: ModelClass; installed: boolean; unsupported?: boolean; bundled?: boolean; /** Installed, an add-on file missing. */ addons?: boolean }>,
	{ large, declined, skip }: { large: boolean; declined: ReadonlySet<ModelId>; skip: ReadonlySet<ModelId> },
): ModelId[] {
	// Small before large, each in its own order; a model the lists don't name yet goes last of its class.
	const rank = (id: ModelId, cls: ModelClass) => {
		const order = cls === "small" ? SMALL_ORDER : LARGE_ORDER;
		const at = order.indexOf(id);
		return (cls === "small" ? 0 : 100) + (at < 0 ? 50 : at);
	};
	return models
		.filter((m) => (m.addons || (!m.installed && !m.bundled)) && !m.unsupported && !declined.has(m.id) && !skip.has(m.id) && (m.cls === "small" || large))
		.sort((a, b) => rank(a.id, a.cls) - rank(b.id, b.cls))
		.map((m) => m.id);
}

/**
 * Why a background download must stand still now (null = it may go): the page's export or AI work, any job of the
 * server (an AI tool, a render, a conversion) or a download the user started. The queue's own jobs don't count.
 */
export function busyReason(): string | null {
	// A hot Mac (ondevice/thermal.ts): the download stands still too, so nothing adds to the heat.
	if (isHot()) return "the Mac is hot: waiting for it to cool down";
	const page = Date.now() - rt.pageBusy.at < BUSY_TTL_MS ? rt.pageBusy.reasons : [];
	if (page.includes("export")) return "the export is running";
	const own = backgroundJobIds();
	const jobs = runningJobs().filter((j) => !own.has(j.id));
	if (jobs.some((j) => j.kind.startsWith("ondevice-"))) return "another model is downloading";
	if (jobs.length || page.length) return "an AI tool is working";
	return null;
}

/** The page tells what the user is doing (export, AI tools): sent when it changes and every 5 s while it lasts. */
export function reportBusy(reasons: string[]) {
	const was = busyReason();
	rt.pageBusy = { reasons: reasons.filter((r) => typeof r === "string").slice(0, 8), at: Date.now() };
	if (was && !busyReason()) rt.wake?.();
}

/** The features, then their parts (a faster engine for a feature that is installed: ondevice/server.ts keeps a part back until then). */
const everything = (): ModelSpec[] => [...MODELS, ...PARTS];

function specs(): Map<ModelId, ModelSpec> {
	return new Map(everything().map((s) => [s.id, s]));
}

function remaining(): ModelId[] {
	const saved = readSaved();
	const large = loadSettings().backgroundLargeModels;
	return queueOrder(
		everything().map((s) => {
			const st = ondeviceState(s.id);
			return { id: s.id, cls: modelClass(s), installed: st.installed, unsupported: !!st.unsupported, bundled: isBundled(s), addons: !!st.addons };
		}),
		{ large, declined: new Set(saved.declined ?? []), skip: rt.skip },
	);
}

const progressOf = (job: JobState | null) => {
	if (!job) return 0;
	const stage = job.stages.find((s) => s.status === "running");
	const done = job.stages.filter((s) => s.status === "done" || s.status === "skipped").length;
	return Math.min(1, (done + (stage?.progress ?? 0)) / Math.max(1, job.stages.length));
};

function setStatus(patch: Partial<BackgroundStatus>) {
	rt.status = { ...rt.status, ...patch, large: loadSettings().backgroundLargeModels };
}

const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		const t = setTimeout(done, ms);
		function done() {
			clearTimeout(t);
			if (rt.wake === done) rt.wake = null;
			resolve();
		}
		rt.wake = done;
	});

/** One model through to the end: started, watched, given way, finished (true = installed). */
async function fetchOne(id: ModelId, spec: ModelSpec): Promise<"done" | "failed" | "waiting"> {
	const title = spec.title;
	// Room: the install's own figure plus the reserve for the user's work (an add-on of an installed model is small change).
	const need = (ondeviceState(id).addons ? 0 : installBytes(spec)) + RESERVE;
	const free = freeBytes(modelsDir());
	if (free < need) {
		setStatus({ state: "paused", model: id, title, reason: `waiting for ${Math.ceil((need - free) / 1e9)} GB of free space` });
		return "waiting";
	}
	const busy = busyReason();
	if (busy) {
		setStatus({ state: "paused", model: id, title, reason: busy });
		return "waiting";
	}
	if (!(await online())) {
		setStatus({ state: "paused", model: id, title, reason: "no internet: it continues when the Mac is online" });
		return "waiting";
	}
	let job: JobState;
	try {
		job = await startInstall(id, { background: true, pace: { pause: busyReason, rate: RATE } });
	} catch (error) {
		setStatus({ state: "paused", model: id, title, reason: (error as Error).message.replace(/\s*Connect and press Retry.*$/, "").slice(0, 120) });
		return "failed";
	}
	let gaveWay = false;
	for (;;) {
		const now = getJob(job.id);
		if (!now || now.status !== "running") break;
		const stage = now.stages.find((s) => s.status === "running");
		const why = isUrgent(id) ? null : busyReason();
		// The files stand still by themselves (DownloadPace); setting up Python or the self-test can't: they stop and
		// run again later (what is already on disk stays and is reused).
		if (why && stage && stage.id !== "files") {
			gaveWay = true;
			cancelJob(job.id);
		}
		setStatus({ state: why ? "paused" : "downloading", model: id, title, progress: progressOf(now), reason: why ?? undefined });
		await new Promise((r) => setTimeout(r, 1000));
	}
	const end = getJob(job.id);
	const after = ondeviceState(id);
	// (an add-on that did not come is a failure like any other: tried again later, three times a session)
	if (after.installed && !after.addons) return "done";
	if (end?.status === "cancelled") {
		if (gaveWay) return "waiting";
		// Cancelled by the user (Settings, or the feature that was waiting for it): not again in this session.
		rt.skip.add(id);
		return "failed";
	}
	setStatus({ state: "paused", model: id, title, reason: "will try again later" });
	return "failed";
}

async function loop() {
	if (rt.running) return;
	rt.running = true;
	try {
		const all = specs();
		for (;;) {
			const left = remaining();
			setStatus({ left });
			const id = left[0];
			if (!id) {
				setStatus({ state: "done", model: undefined, title: undefined, progress: undefined, reason: undefined });
				return;
			}
			const spec = all.get(id);
			if (!spec) return;
			const outcome = await fetchOne(id, spec);
			if (outcome === "done") {
				rt.failures.delete(id);
				continue;
			}
			if (outcome === "failed") {
				// The internet went away midway: not the model's fault, it waits for the internet instead.
				if (!(await online())) {
					await sleep(POLL_MS);
					continue;
				}
				const n = (rt.failures.get(id) ?? 0) + 1;
				rt.failures.set(id, n);
				if (n >= 3) rt.skip.add(id);
				await sleep(POLL_MS * Math.min(10, 2 ** n));
				continue;
			}
			await sleep(busyReason() ? Math.min(POLL_MS, 5000) : POLL_MS);
		}
	} catch (error) {
		console.log(`[ondevice] background download stopped: ${(error as Error).message}`);
	} finally {
		rt.running = false;
	}
}

function scheduleAt(when: number) {
	if (!ENABLED) return;
	if (rt.running) return;
	if (rt.timer && rt.startAt <= when) return;
	if (rt.timer) clearTimeout(rt.timer);
	rt.startAt = when;
	setStatus({ state: "scheduled", left: remaining() });
	rt.timer = setTimeout(() => {
		rt.timer = null;
		void loop();
	}, Math.max(0, when - Date.now()));
	rt.timer.unref?.();
}

/**
 * The app started (the shell asks once at launch; Settings asks too): when a project was ever opened on this Mac,
 * the queue continues a couple of minutes later. Before the first project: nothing.
 */
export function armOnLaunch() {
	if (!ENABLED || rt.armed) return;
	rt.armed = true;
	if (readSaved().projectOpened) scheduleAt(Date.now() + DELAY_MS);
}

/** A project was opened in the editor: the first time ever, the queue starts a couple of minutes later. */
export function projectOpened(from = "") {
	if (!ENABLED) return;
	const saved = readSaved();
	if (!saved.projectOpened) {
		writeSaved({ ...saved, projectOpened: new Date().toISOString() });
		console.log(`[ondevice] the first project opened (${from || "?"}): small models download in the background in ${Math.round(DELAY_MS / 1000)} s`);
	}
	rt.armed = true;
	scheduleAt(Date.now() + DELAY_MS);
}

/** Settings → Remove: the user doesn't want this model; the queue leaves it alone from now on. */
export function declineModel(id: string) {
	const saved = readSaved();
	const declined = new Set(saved.declined ?? []);
	if (!MODELS.some((m) => m.id === id)) return;
	declined.add(id as ModelId);
	writeSaved({ ...saved, declined: [...declined] });
}

/** The user removed this model in Settings: nothing downloads it by itself (a feature asking for it still may). */
export function isDeclined(id: string): boolean {
	return (readSaved().declined ?? []).includes(id as ModelId);
}

/** Downloading it again by hand (Settings or a feature) takes the model back from the declined list. */
export function undeclineModel(id: string) {
	const saved = readSaved();
	if (!saved.declined?.includes(id as ModelId)) return;
	writeSaved({ ...saved, declined: saved.declined.filter((m) => m !== id) });
	rt.skip.delete(id as ModelId);
}

/** Settings → AI → «Download large models in the background». Off stops a large one the queue is downloading. */
export function setLargeInBackground(on: boolean) {
	saveSettings({ backgroundLargeModels: on });
	if (!on) {
		const id = rt.status.model;
		const spec = id ? MODELS.find((m) => m.id === id) : undefined;
		if (rt.status.state === "downloading" || rt.status.state === "paused") {
			if (spec && modelClass(spec) === "large" && !isUrgent(spec.id)) {
				for (const jobId of backgroundJobIds()) if (getJob(jobId)?.status === "running" && getJob(jobId)?.kind === `ondevice-${spec.id}`) cancelJob(jobId);
			}
		}
	}
	setStatus({ left: remaining() });
	if (!ENABLED) return;
	if (rt.running) rt.wake?.();
	else if (readSaved().projectOpened) scheduleAt(Math.max(Date.now() + 5000, rt.startAt || 0));
}

export function backgroundStatus(): BackgroundStatus {
	const large = loadSettings().backgroundLargeModels;
	if (!ENABLED) return { state: "off", large, left: [] };
	if (rt.status.state === "waiting-project" || rt.status.state === "done") return { ...rt.status, large, left: remaining() };
	return { ...rt.status, large };
}

/** For the Settings line: the total download of what the large switch would bring. */
export function largeBytesLeft(): number {
	return MODELS.filter((s) => modelClass(s) === "large" && !ondeviceState(s.id).installed && !ondeviceState(s.id).unsupported).reduce((a, s) => a + downloadBytes(s), 0);
}
