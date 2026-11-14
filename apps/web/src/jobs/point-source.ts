// AI generations (pictures, video, sound on fal — src/cloud/client.ts usePoint) in the one job model: each is the job
// `ai:<id>` — queued (it breathes), then its percent, cancel, a failure with retry, durable on disk. The Generate tab's card
// is its placeholder (it reads the same generation); one Claude started (quiet: it lands in Media and on the timeline by
// itself) also has a Media placeholder that the result takes the place of (cloud/client.ts importResult: the same id).
import { type PointJob, usePoint } from "@/cloud/client";
import { generateUUID } from "@/utils/id";
import { registerResumer } from "./durable";
import { jobCenter, useJobsStore } from "./store";

const ids = new Map<string, string>();
/** The Media id a generation's result lands under (its placeholder's). */
export function aiAssetId(jobId: string): string {
	let id = ids.get(jobId);
	if (!id) {
		id = generateUUID();
		ids.set(jobId, id);
	}
	return id;
}

const jobId = (j: PointJob) => `ai:${j.id}`;
const active = (j: PointJob) => j.state === "queued" || j.state === "running";

function sync(list: PointJob[]) {
	const jobs = useJobsStore.getState().jobs;
	for (const j of list) {
		const id = jobId(j);
		const mine = jobs.find((x) => x.id === id);
		if (active(j)) {
			const type = j.kind === "audio" ? "audio" : j.kind === "video" ? "video" : "image";
			jobCenter.upsert(id, {
				kind: j.kind === "audio" ? "voice" : "other",
				title: j.prompt.trim().slice(0, 60) || "AI",
				tab: j.quiet ? "media" : undefined,
				status: "running",
				queued: j.state === "queued",
				progress: j.state === "queued" ? undefined : Math.max(0, Math.min(1, (j.progress ?? 0) / 100)),
				startedAt: j.at,
				cancel: () => void usePoint.getState().cancel(j.id).catch(() => {}),
				resume: { type: "ai", jobId: j.id, ...(j.input ? { input: j.input } : {}) },
				...(j.quiet
					? { place: { media: { assetId: aiAssetId(j.id), name: `${j.prompt.trim().slice(0, 40) || "AI"}`, type, origin: "result" as const, duration: j.duration } } }
					: {}),
			});
			continue;
		}
		if (!mine || mine.status !== "running") continue;
		if (j.state === "succeeded") {
			// Claude's lands in Media through importResult (which ends the job); the Generate tab's is on its card.
			if (j.quiet) jobCenter.update(id, { queued: false, progress: 0.97, cancel: undefined });
			else jobCenter.finish(id, j.prompt.trim().slice(0, 60));
		} else if (j.error === "Cancelled") jobCenter.cancelled(id);
		else {
			jobCenter.fail(id, j.error || "The generation failed");
			if (j.input && !j.quiet)
				jobCenter.update(id, {
					retry: () => {
						jobCenter.remove(id);
						void usePoint.getState().retry(j.id).catch(() => {});
					},
				});
		}
	}
}

registerResumer("ai", {
	// This run (the page reloaded): the generations list is kept and polled — its mirror carries on by itself.
	resume: () => {},
	// An earlier run: the server no longer knows it; Retry asks for it again (the user's own press, a new charge).
	retry: (r) => {
		const input = (r.resume as { input?: Parameters<ReturnType<typeof usePoint.getState>["start"]>[0] }).input;
		if (input) void usePoint.getState().start(input).catch(() => {});
	},
});

// A local model's download (ondevice/client.ts requireModel, craft B): a reload re-attaches to the server's running job;
// after a kill it comes back failed with ↻, which resumes from the bytes on disk (HTTP Range) — never by itself.
const wantModel = (r: { resume: Record<string, unknown> }) =>
	void import("@/ondevice/client")
		.then(({ requireModel }) => requireModel(r.resume.model as Parameters<typeof requireModel>[0]))
		.catch(() => {});
registerResumer("ondevice-model", { resume: wantModel, retry: wantModel });

let started = false;

/** Once per page: generations follow the job model (and their placeholders). */
export function startPointJobSource() {
	if (started || typeof window === "undefined") return;
	started = true;
	sync(usePoint.getState().jobs);
	usePoint.subscribe((s, prev) => {
		if (s.jobs !== prev.jobs) sync(s.jobs);
	});
	// The percent keeps moving wherever the user is (the Generate tab polls only while it is open).
	let polling = false;
	window.setInterval(() => {
		if (polling || !usePoint.getState().jobs.some(active)) return;
		polling = true;
		void usePoint
			.getState()
			.poll()
			.finally(() => {
				polling = false;
			});
	}, 2000);
}
