// State of the lipsync panel. Per CLIP (lipa, 14.11 — the charter's «state belongs to the clip»): the draft (text,
// sound, model, length choice), the run and the result card are keyed `<projectId>|<elementId>`; a bare project id
// resolves to the clip chosen in that project (the pin), so older callers (the agent, the translator) work per clip too.
// Running jobs live here as well, so switching panels or projects never loses progress; several clips run at once.
import type { LipPlace, PlacedVoice } from "./editor-bridge";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { JobState, StudioState } from "./api";
import type { FitChoice } from "./fit";

export interface Speech {
	fileId: string;
	mediaId?: string;
	name: string;
	seconds: number;
	text: string;
	voiceId: string;
	/** Word timings from the TTS, for captions. */
	words?: Array<{ text: string; start: number; end: number }>;
}

export interface ProjectDraft {
	text: string;
	/** "clone" = clone from the selected clip, otherwise a saved voice id. */
	voice: string;
	voiceName: string;
	speech?: Speech;
	model: string;
	replaceClip: boolean;
	/** Add captions from the voice's word timings together with the lipsync result. */
	captions: boolean;
	/** Speech longer/shorter than the piece: use more video, change the voice tempo, or loop/trim (provider). */
	fit?: FitChoice;
	/** kie.ai's ByteDance lipsync: Lite or Basic, and separating the voice from what is behind it. */
	kieMode?: "lite" | "basic";
	kieVocals?: boolean;
	/** Where the result goes: in the clip's place, on a new track above it, or inserted (what follows moves). */
	place?: LipPlace;
	/** Speech shorter than the clip: where the sent piece starts, seconds from the clip's (or In/Out's) start. */
	offset?: number;
	/** Whole-montage mode: mute the original clips under the result (same ⌘Z). */
	muteOriginal: boolean;
	/** Voice-over only: the voice goes under the selected clip, no lipsync. */
	audioOnly?: boolean;
	source: "clip" | "timeline";
	/** Translate & dub: the text is a translation into this language (the voice is told to speak it). */
	dub?: { language: string; text: string; at?: number; span?: number };
	/** "Voice only": what went under which clip (newest last) — the next voice under that clip replaces it. */
	placed?: PlacedVoice[];
}

export type RunKind = "voiceover" | "lipsync" | "fragment" | "prepare";

export interface Run {
	kind: RunKind;
	projectId: string;
	/** The draft key of the clip this run belongs to (`<projectId>|<elementId>`); none for project-wide runs. */
	key?: string;
	/** Part of «voice → lipsync» as one run: the lipsync follows the voice. */
	chain?: boolean;
	/** Waiting for a free slot (at most 3 lipsync runs at once): how many go before it. */
	queued?: number;
	job?: JobState;
	/** Local steps before the server job starts (sending the clip, exporting the timeline). */
	local?: { title: string; progress?: number };
	error?: string;
	done?: string;
	/** Lipsync: where the result landed on the timeline (for "▶ Watch"). */
	resultAt?: number;
	/** Lipsync: the result and what it replaced, for the before/after compare. */
	result?: {
		assetId: string;
		beforeAssetId?: string;
		beforeStart: number;
		length: number;
		replaced: boolean;
		/** Local lipsync: timeline pieces where the original face was kept, and why. */
		kept?: Array<{ from: number; to: number; reason: string }>;
		/** The result's element on the timeline (its card shows for it and for the clip it came from). */
		elementId?: string;
	};
	/** lip5: a sample's answer (rule E) — it plays in the panel only, nothing lands on the timeline. */
	sample?: { fileId: string; from: number; to: number; model: string; cost?: number; beforeAssetId?: string; beforeStart: number };
	startedAt: number;
	cancel?: () => void;
}

/** One finished lipsync of a piece (the versions list of the Lipsync window): the result in Media and how it was made. */
export interface LipVersion {
	assetId: string;
	name: string;
	model: string;
	createdAt: number;
	/** Seconds of the result. */
	length: number;
	/** What fal charged (list price, US dollars). */
	cost?: number;
}

/** A paid server job that must survive a window reload: its id and what to do with the result. */
export interface PendingJob {
	kind: RunKind;
	projectId: string;
	jobId: string;
	startedAt: number;
	meta: Record<string, unknown>;
}

interface Store {
	drafts: Record<string, ProjectDraft>;
	server: StudioState | null;
	/** The newest run of each kind, whatever clip (older callers read it right after awaiting a run). */
	runs: Partial<Record<RunKind, Run>>;
	/** Every clip's own runs: `<kind>|<draft key>`. */
	clipRuns: Record<string, Run>;
	/** Cloning consent, asked once per cloned voice: the source media id → when it was given. */
	consents: Record<string, number>;
	/** A paid step whose total is above this many dollars asks first (Settings → Services); below it the button is the consent. */
	confirmAbove: number;
	/** The last length choice for a voice shorter than the clip (new clips start with it). */
	lastFit?: FitChoice;
	youtubeOpen: boolean;
	/** A link to open the dialog with (⌘V of a YouTube link in the editor). */
	youtubePrefill: string;
	/** Clip chosen for lipsync per project: stays chosen when the timeline selection is cleared. */
	pins: Record<string, string>;
	/** Running server jobs by job id — persisted, so a reload re-attaches to them instead of losing the result. */
	pending: Record<string, PendingJob>;
	/** Lipsync versions per piece: `<projectId>|<original media id>|<start in tenths of a second>`, newest first. */
	versions: Record<string, LipVersion[]>;
	addVersion: (key: string, v: LipVersion) => void;
	addPending: (job: PendingJob) => void;
	removePending: (jobId: string) => void;
	/** The draft of a clip: a draft key, or a project id (its chosen clip). */
	draft: (key: string) => ProjectDraft;
	patch: (key: string, patch: Partial<ProjectDraft>) => void;
	setServer: (s: StudioState) => void;
	/** With `key`: that clip's run (and the newest of its kind). Without: the newest run of the kind (cleared: its clip's too). */
	setRun: (kind: RunKind, run: Run | undefined, key?: string) => void;
	updateRun: (kind: RunKind, patch: Partial<Run>, key?: string) => void;
	consent: (sourceId: string) => void;
	setConfirmAbove: (usd: number) => void;
	setYoutubeOpen: (open: boolean, prefill?: string) => void;
	pin: (projectId: string, elementId: string | undefined) => void;
	/** The last «Where» the user picked (new projects start with it). */
	lastPlace?: LipPlace;
}

export const EMPTY_DRAFT: ProjectDraft = {
	text: "",
	voice: "clone",
	voiceName: "",
	model: "",
	replaceClip: true,
	captions: true,
	muteOriginal: true,
	source: "clip",
};

/** The draft key of a clip in a project. */
export const draftKey = (projectId: string, elementId?: string | null) => (elementId ? `${projectId}|${elementId}` : projectId);
/** A key as given, or a project id resolved to the clip chosen in it. */
export function resolveKey(s: { pins: Record<string, string> }, key: string): string {
	if (!key || key.includes("|")) return key;
	return draftKey(key, s.pins[key]);
}
/** What a new clip's draft takes from the project (the choices, never the words, sound, price or run of another clip). */
const CARRIED: Array<keyof ProjectDraft> = ["model", "captions", "muteOriginal", "kieMode", "kieVocals"];
const runKey = (kind: RunKind, key: string) => `${kind}|${key}`;

export const useStudioStore = create<Store>()(
	persist(
		(set, get) => ({
			drafts: {},
			server: null,
			runs: {},
			clipRuns: {},
			consents: {},
			confirmAbove: 1,
			youtubeOpen: false,
			youtubePrefill: "",
			pins: {},
			pending: {},
			versions: {},
			addVersion: (key, v) => set((s) => ({ versions: { ...s.versions, [key]: [v, ...(s.versions[key] ?? []).filter((x) => x.assetId !== v.assetId)].slice(0, 12) } })),
			addPending: (job) => {
				set((s) => ({ pending: { ...s.pending, [job.jobId]: job } }));
				void savePendingDurable(get().pending);
			},
			removePending: (jobId) => {
				set((s) => {
					if (!s.pending[jobId]) return {};
					const pending = { ...s.pending };
					delete pending[jobId];
					return { pending };
				});
				void savePendingDurable(get().pending);
			},
			draft: (id) => {
				const s = get();
				const key = resolveKey(s, id);
				const saved = s.drafts[key];
				if (saved) return { ...EMPTY_DRAFT, ...saved };
				// A new clip speaks with its own voice (cloned once per sample, then reused) and takes the project's choices.
				const project = key.includes("|") ? s.drafts[key.split("|")[0]] : undefined;
				const carried: Partial<ProjectDraft> = {};
				if (project) for (const k of CARRIED) if (project[k] !== undefined) (carried as Record<string, unknown>)[k] = project[k];
				return { ...EMPTY_DRAFT, ...carried };
			},
			patch: (id, patch) =>
				set((s) => {
					const key = resolveKey(s, id);
					const drafts = { ...s.drafts, [key]: { ...s.draft(key), ...patch } };
					// the project's choices follow the newest pick (a new clip starts with them)
					const pid = key.split("|")[0];
					const carried = CARRIED.filter((k) => k in patch);
					if (pid !== key && carried.length) drafts[pid] = { ...EMPTY_DRAFT, ...s.drafts[pid], ...Object.fromEntries(carried.map((k) => [k, patch[k]])) };
					return { drafts, ...(patch.place ? { lastPlace: patch.place } : {}), ...(patch.fit ? { lastFit: patch.fit } : {}) };
				}),
			setServer: (server) => set({ server }),
			setRun: (kind, run, key) =>
				set((s) => {
					const clipRuns = { ...s.clipRuns };
					const k = key ?? (run ? run.key : s.runs[kind]?.key);
					if (k) {
						if (run) clipRuns[runKey(kind, k)] = { ...run, key: k };
						else delete clipRuns[runKey(kind, k)];
					}
					return { clipRuns, runs: { ...s.runs, [kind]: run ? { ...run, ...(k ? { key: k } : {}) } : key && s.runs[kind]?.key !== key ? s.runs[kind] : undefined } };
				}),
			updateRun: (kind, patch, key) =>
				set((s) => {
					const k = key ?? s.runs[kind]?.key;
					const own = k ? s.clipRuns[runKey(kind, k)] : undefined;
					const out: Partial<Store> = {};
					if (own) out.clipRuns = { ...s.clipRuns, [runKey(kind, k!)]: { ...own, ...patch } };
					const newest = s.runs[kind];
					if (newest && (newest.key ?? "") === (k ?? "")) out.runs = { ...s.runs, [kind]: { ...newest, ...patch } };
					return out;
				}),
			consent: (sourceId) => set((s) => ({ consents: { ...s.consents, [sourceId]: Date.now() } })),
			setConfirmAbove: (usd) => set({ confirmAbove: Math.max(0, Number.isFinite(usd) ? usd : 1) }),
			setYoutubeOpen: (youtubeOpen, prefill = "") => set({ youtubeOpen, ...(youtubeOpen ? { youtubePrefill: prefill } : {}) }),
			pin: (projectId, elementId) =>
				set((s) => {
					if (s.pins[projectId] === elementId) return {};
					const pins = { ...s.pins };
					if (elementId) pins[projectId] = elementId;
					else delete pins[projectId];
					return { pins };
				}),
		}),
		{ name: "lipsync-studio", partialize: (s) => ({ drafts: s.drafts, pending: s.pending, versions: s.versions, lastPlace: s.lastPlace, lastFit: s.lastFit, consents: s.consents, confirmAbove: s.confirmAbove }) },
	),
);

// Paid jobs in flight are kept in IndexedDB as well (lipa, 14.11): the window's localStorage is written to disk in
// batches, and a kill −9 lost the newest writes — two runs in flight came back as none. An IndexedDB write is on disk
// when its transaction completes.
const IDB_NAME = "lipsync-studio";
function openIdb(): Promise<IDBDatabase | null> {
	if (typeof indexedDB === "undefined") return Promise.resolve(null);
	return new Promise((resolve) => {
		try {
			const req = indexedDB.open(IDB_NAME, 1);
			req.onupgradeneeded = () => req.result.createObjectStore("kv");
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
}
let pendingWrite: Promise<void> = Promise.resolve();
/** Writes the pending jobs (in order: the newest call wins). */
export function savePendingDurable(pending: Record<string, PendingJob>): Promise<void> {
	pendingWrite = pendingWrite.then(async () => {
		const db = await openIdb();
		if (!db) return;
		await new Promise<void>((resolve) => {
			try {
				const tx = db.transaction("kv", "readwrite", { durability: "strict" } as IDBTransactionOptions);
				tx.objectStore("kv").put(JSON.parse(JSON.stringify(pending)), "pending");
				tx.oncomplete = () => resolve();
				tx.onerror = () => resolve();
				tx.onabort = () => resolve();
			} catch {
				resolve();
			}
		});
		db.close();
	});
	return pendingWrite;
}
/** The pending jobs IndexedDB holds (empty when none or unreadable). */
export async function loadPendingDurable(): Promise<Record<string, PendingJob>> {
	const db = await openIdb();
	if (!db) return {};
	const out = await new Promise<Record<string, PendingJob>>((resolve) => {
		try {
			const req = db.transaction("kv", "readonly").objectStore("kv").get("pending");
			req.onsuccess = () => resolve((req.result as Record<string, PendingJob>) ?? {});
			req.onerror = () => resolve({});
		} catch {
			resolve({});
		}
	});
	db.close();
	return out;
}

/** The versions key of a piece: the project, the original media and where the piece starts in it. */
export const versionKey = (projectId: string, assetId: string | undefined, start: number) => `${projectId}|${assetId ?? "edit"}|${Math.round(start * 10)}`;

// Lets the app's self-tests inspect and drive the panel.
if (typeof window !== "undefined") (window as unknown as { __studioStore: unknown }).__studioStore = useStudioStore;

export function isRunning(run: Run | undefined): boolean {
	return !!run && !run.error && !run.done;
}

/** A clip's own run of this kind. */
export function clipRun(s: { clipRuns: Record<string, Run> }, kind: RunKind, key: string): Run | undefined {
	return s.clipRuns[runKey(kind, key)];
}

/** The lipsync runs in flight (or waiting for a slot), every clip. */
export function runningLipsyncs(s: { clipRuns: Record<string, Run> }): Run[] {
	return Object.values(s.clipRuns).filter((r) => (r.kind === "lipsync" || (r.kind === "voiceover" && r.chain)) && isRunning(r));
}

/** A single YouTube video link (not a playlist/channel page): youtube.com/watch?v=…, youtu.be/…, /shorts/…. */
export function looksLikeYouTubeVideo(text: string): boolean {
	try {
		const u = new URL(text.trim());
		const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
		if (host === "youtu.be") return u.pathname.length > 1;
		if (host !== "youtube.com" && host !== "music.youtube.com") return false;
		return !!u.searchParams.get("v") || /^\/(shorts|live|embed)\/[\w-]+/.test(u.pathname);
	} catch {
		return false;
	}
}

/**
 * Where a lipsync result goes for this draft: the user's pick (remembered), else as the timeline works now — the
 * magnet on inserts (what follows moves), off replaces in place. An old «Replace» switched off means «above».
 */
export function placeOf(draft: ProjectDraft, rippleOn: boolean): LipPlace {
	if (draft.place) return draft.place;
	if (draft.replaceClip === false) return "above";
	return useStudioStore.getState().lastPlace ?? (rippleOn ? "insert" : "replace");
}
