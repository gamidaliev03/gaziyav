// The durable side of the one job model (PLAN.md stage 2 §B). A job that carries `resume` is written to disk by the shell
// (GaziyavShell modules/jobs-journal.js: one small file per job, atomic) when it starts and as it moves, and removed when
// it is done or cancelled. On the next start (startDurableJobs) a job of this very run (the page reloaded) continues
// through its kind's resumer; one of an earlier run of the app (killed, quit) comes back failed and retryable, on its
// target (its Media placeholder) — never lost, never run twice by itself. The record's shape is the plan's:
// Job {id, kind, target{projectId, mediaId?, elementId?}, state queued|running|done|failed|cancelled, progress 0..1|null,
// resume{…}, error{code, retryable}}.
import { type Job, jobCenter, useJobsStore } from "./store";

export interface DurableRecord {
	id: string;
	kind: Job["kind"];
	title: string;
	target: { projectId?: string; mediaId?: string; elementId?: string };
	state: "queued" | "running" | "done" | "failed" | "cancelled";
	progress: number | null;
	resume: { type: string } & Record<string, unknown>;
	error?: { code: string; retryable: boolean; message?: string };
	place?: Job["place"];
	tab?: Job["tab"];
	startedAt: number;
	/** Set by the shell's list: an earlier run of the app wrote it. */
	earlier?: boolean;
}

export interface Resumer {
	/** Goes on with a job of this run (the page reloaded while it ran). Without it such a job comes back failed. */
	resume?: (record: DurableRecord) => void;
	/** Runs it again (the retry glyph on its placeholder). */
	retry: (record: DurableRecord) => void;
}

const resumers = new Map<string, Resumer>();

/** A producer says how its jobs continue and repeat (by `resume.type`). */
export function registerResumer(type: string, resumer: Resumer) {
	resumers.set(type, resumer);
}

type ShellJobs = (op: string, a?: unknown) => Promise<unknown>;
const shell = (): ShellJobs | undefined =>
	typeof window === "undefined" ? undefined : (window as unknown as { studioApp?: { jobs?: ShellJobs } }).studioApp?.jobs;

export function toRecord(job: Job): DurableRecord | null {
	if (!job.resume) return null;
	const media = job.place?.media;
	const state = job.status === "error" ? "failed" : job.status === "running" ? (job.queued ? "queued" : "running") : job.status;
	return {
		id: job.id,
		kind: job.kind,
		title: job.title,
		target: { projectId: media?.projectId, mediaId: media?.assetId, elementId: job.place?.elements?.[0] },
		state,
		progress: job.progress ?? null,
		resume: job.resume,
		...(state === "failed" ? { error: { code: "failed", retryable: !!job.retry, message: job.message } } : {}),
		place: job.place,
		tab: job.tab,
		startedAt: job.startedAt,
	};
}

/** What was last written for each job: progress in 5 % steps, so a running job writes ~20 small files at most. */
const written = new Map<string, string>();
const stamp = (r: DurableRecord) => `${r.state}|${r.progress == null ? "-" : Math.floor(r.progress * 20)}|${r.error?.retryable ?? ""}`;

function persist(jobs: Job[]) {
	const api = shell();
	if (!api) return;
	const seen = new Set<string>();
	for (const job of jobs) {
		const record = toRecord(job);
		if (!record) continue;
		seen.add(job.id);
		if (record.state === "done" || record.state === "cancelled") {
			if (written.has(job.id)) {
				written.delete(job.id);
				void api("end", job.id).catch(() => {});
			}
			continue;
		}
		const now = stamp(record);
		if (written.get(job.id) === now) continue;
		written.set(job.id, now);
		void api("put", record).catch(() => {});
	}
	// Gone from the list (cancelled, dismissed): gone from the disk.
	for (const id of [...written.keys()]) {
		if (seen.has(id)) continue;
		written.delete(id);
		void api("end", id).catch(() => {});
	}
}

/** A job from the disk on its target again: failed and retryable (an earlier run), or continued (this run). */
function restore(record: DurableRecord) {
	if (useJobsStore.getState().jobs.some((j) => j.id === record.id)) return;
	const resumer = resumers.get(record.resume?.type ?? "");
	const live = record.state === "running" || record.state === "queued";
	if (live && !record.earlier && resumer?.resume) {
		resumer.resume(record);
		return;
	}
	jobCenter.start({
		id: record.id,
		kind: record.kind,
		title: record.title,
		tab: record.tab,
		startedAt: record.startedAt,
		place: record.place,
		resume: record.resume,
		progress: record.progress ?? undefined,
	});
	jobCenter.fail(record.id, record.error?.message || "Stopped when the app closed");
	if (resumer)
		jobCenter.update(record.id, {
			retry: () => {
				jobCenter.remove(record.id);
				resumer.retry(record);
			},
		});
}

let started = false;

/** Once per page, after the producers registered their resumers: the disk's jobs come back, new ones are kept. */
export function startDurableJobs() {
	if (started || typeof window === "undefined") return;
	started = true;
	const api = shell();
	if (!api) return;
	void api("list")
		.then((list) => {
			for (const record of (Array.isArray(list) ? list : []) as DurableRecord[]) {
				if (record?.id && record.resume) restore(record);
			}
		})
		.catch(() => {})
		.finally(() => {
			persist(useJobsStore.getState().jobs);
			useJobsStore.subscribe((s, prev) => {
				if (s.jobs !== prev.jobs) persist(s.jobs);
			});
		});
}
