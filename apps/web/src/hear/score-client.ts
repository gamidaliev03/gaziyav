// The window's side of the song's score: the clip's file sent once (hear/client.ts), the score asked of the server
// (/api/hear/score), its job followed for as long as the caller can wait — Claude's connector answers within 45 s, so
// a first separation of a long song answers «still running» and the same call later gets the cached score.
import { studioApi } from "@/studio/client/api";
import type { JobState } from "@/studio/server/jobs";
import { fileOf, type Sounding } from "./client";
import type { SongScore } from "./score-types";

export type ScoreReply = { state: "done"; key: string; score: SongScore } | { state: "running"; jobId: string; progress: number; stage: string } | { state: "failed"; error: string };

/** A running score job per file (the server dedups too): a second ask follows the same job. */
const jobs = new Map<string, string>();

async function post<T>(body: unknown, signal?: AbortSignal): Promise<T> {
	const res = await fetch("/api/hear/score", { method: "POST", headers: { "Content-Type": "application/json", "X-Studio": "1" }, body: JSON.stringify(body), signal });
	const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
	if (!res.ok || !data) throw new Error(data?.error || "The score of the song couldn't be made.");
	return data;
}

/** Overall progress of a score job: separation 70 %, reading 10 %, words 20 %. */
export function scoreProgress(j: JobState): { progress: number; stage: string } {
	const w: Record<string, number> = { separate: 0.7, read: 0.1, words: 0.2 };
	let p = 0;
	let stage = "";
	for (const s of j.stages) {
		const share = w[s.id] ?? 0;
		if (s.status === "done" || s.status === "skipped") p += share;
		else if (s.status === "running") {
			p += share * (s.progress ?? 0);
			stage = s.detail || s.title;
		}
	}
	return { progress: Math.min(0.99, p), stage: stage || "Separating the parts" };
}

/**
 * The score of a clip's file. `wait`: ms to follow a job before answering «running» (Infinity: to the end);
 * `onProgress` for a progress bar; `cachedOnly`: never start a separation.
 */
export async function songScore(s: Sounding, { wait = Infinity, signal, onProgress, cachedOnly = false }: { wait?: number; signal?: AbortSignal; onProgress?: (p: number, stage: string, jobId: string) => void; cachedOnly?: boolean } = {}): Promise<ScoreReply> {
	const fileId = await fileOf(s);
	const until = Date.now() + wait;
	const known = jobs.get(fileId);
	let job: JobState | null = null;
	if (known) job = await studioApi.job(known).catch(() => null);
	if (!job || job.status === "failed" || job.status === "cancelled") {
		const r = await post<JobState | { key: string; score: SongScore | null }>({ fileId, cachedOnly }, signal);
		if ("score" in r) return r.score ? { state: "done", key: r.key, score: r.score } : { state: "failed", error: "not separated yet" };
		job = r;
		jobs.set(fileId, job.id);
	}
	for (;;) {
		if (job.status === "done") {
			jobs.delete(fileId);
			const r = job.result as { key: string; score: SongScore };
			return { state: "done", key: r.key, score: r.score };
		}
		if (job.status !== "running") {
			jobs.delete(fileId);
			return { state: "failed", error: job.error || "The separation stopped." };
		}
		const pr = scoreProgress(job);
		onProgress?.(pr.progress, pr.stage, job.id);
		if (Date.now() >= until) return { state: "running", jobId: job.id, ...pr };
		if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
		await new Promise((r) => setTimeout(r, 500));
		job = await studioApi.job(job.id);
	}
}

/** Stop a score job (the progress bar's ✕). */
export function cancelScore(jobId: string) {
	void fetch(`/api/studio/jobs/${jobId}`, { method: "DELETE", headers: { "X-Studio": "1" } }).catch(() => {});
}

/** A part's sound file from the score's cache. */
export async function stemFile(key: string, part: string, name: string): Promise<File> {
	const res = await fetch(`/api/hear/score?key=${encodeURIComponent(key)}&part=${encodeURIComponent(part)}`, { headers: { "X-Studio": "1" } });
	if (!res.ok) {
		const data = await res.json().catch(() => null);
		throw new Error(data?.error || "Couldn't get the part's sound.");
	}
	return new File([await res.blob()], name, { type: "audio/mp4" });
}
