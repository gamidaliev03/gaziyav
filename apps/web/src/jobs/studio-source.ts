// Mirrors the lipsync panel's runs (voice-over, lipsync, YouTube fragment, preparing the montage)
// into the job center, so they show up in the header chip (lipsync lives in the inspector, so no left-tab dot). Read-only on the studio store.
import type { Tab } from "@/components/editor/panels/assets/assets-panel-store";
import { type Run, type RunKind, useStudioStore } from "@/studio/client/studio-store";
import { type JobInput, type JobKind, jobCenter, useJobsStore } from "./store";

const KINDS: Record<RunKind, { kind: JobKind; title: string; tab?: Tab }> = {
	voiceover: { kind: "voice", title: "Voice-over" },
	lipsync: { kind: "lipsync", title: "Lipsync" },
	prepare: { kind: "lipsync", title: "Preparing" },
	fragment: { kind: "youtube", title: "YouTube", tab: "media" },
};

/** The panel marks a user-stopped run with this error text (Russian before the English switch). */
function isCancelled(error: string | undefined): boolean {
	return !!error && (/^cancell?ed\.?$/i.test(error.trim()) || error.trim() === "\u041e\u0442\u043c\u0435\u043d\u0435\u043d\u043e");
}

function toJob(kind: RunKind, run: Run): JobInput | null {
	if (isCancelled(run.error)) return null;
	const meta = KINDS[kind];
	const stages = run.job?.stages ?? [];
	const current = stages.find((s) => s.status === "running") ?? stages.find((s) => s.status === "pending");
	const stage = run.local?.title ?? current?.title;
	// lip3: a lipsync's measured figure is its pieces done of all (the server's); before them it breathes
	const pieces = current?.id === "lipsync" ? (current.data as { requests?: number; done?: number } | undefined) : undefined;
	const progress = kind === "lipsync" ? (pieces?.requests ? (pieces.done ?? 0) / pieces.requests : undefined) : (run.local?.progress ?? current?.progress);
	const status = run.error ? "error" : run.done ? "done" : "running";
	return {
		kind: meta.kind,
		title: meta.title,
		tab: meta.tab,
		stage: status === "running" ? stage : undefined,
		progress: status === "running" ? progress : undefined,
		status,
		message: run.error ?? run.done,
		startedAt: run.startedAt,
		endedAt: run.job?.endedAt,
		cancel: status === "running" ? run.cancel : undefined,
		// lip3: the clip it runs for shows it (jobs/components/clip-progress.tsx); a run waiting for a slot does not move yet
		place: run.key && !run.queued && (kind === "lipsync" || run.chain) ? { elements: [run.key.split("|")[1]] } : undefined,
	};
}

/** Every run the header chip shows: each clip's own (several lipsyncs at once), and the project-wide ones. */
function sync(runs: Partial<Record<RunKind, Run>>, clipRuns: Record<string, Run>) {
	const present = new Set<string>();
	const all: Array<[string, RunKind, Run]> = [];
	for (const [k, run] of Object.entries(clipRuns)) all.push([`studio:${k}`, run.kind, run]);
	for (const kind of Object.keys(KINDS) as RunKind[]) {
		const run = runs[kind];
		if (run && !run.key) all.push([`studio:${kind}`, kind, run]);
	}
	for (const [id, kind, run] of all) {
		const job = toJob(kind, run);
		if (!job) continue;
		present.add(id);
		const existing = useJobsStore.getState().jobs.find((j) => j.id === id);
		// A new run of the same kind replaces the old finished one.
		if (existing && existing.startedAt !== job.startedAt) jobCenter.remove(id);
		jobCenter.upsert(id, job);
	}
	for (const job of useJobsStore.getState().jobs) {
		if (job.id.startsWith("studio:") && !present.has(job.id)) jobCenter.remove(job.id);
	}
}

let started = false;

/** Starts mirroring once per page; safe to call from any component. */
export function startStudioJobSource() {
	if (started || typeof window === "undefined") return;
	started = true;
	sync(useStudioStore.getState().runs, useStudioStore.getState().clipRuns);
	useStudioStore.subscribe((state, prev) => {
		if (state.runs !== prev.runs || state.clipRuns !== prev.clipRuns) sync(state.runs, state.clipRuns);
	});
}
