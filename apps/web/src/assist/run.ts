// One Assist action at a time, like Kadr's runAssist: a toast with the stage, progress and Cancel, the same
// task in the header's job center, and a readable error. Each action ends in ONE ⌘Z on the timeline.
import { toast } from "sonner";
import { jobCenter } from "@/jobs/store";
import { followJob, type JobState, studioApi } from "@/studio/client/api";

export interface AssistCtl {
	signal: AbortSignal;
	stage: (text: string, progress?: number) => void;
	/** Starts a server job and follows it; Cancel stops it on the server too. */
	job: <R>(start: () => Promise<JobState>) => Promise<R>;
}

let busy: string | null = null;

const cancelled = () => new DOMException("Cancelled", "AbortError");

export async function runAssist(
	title: string,
	body: (ctl: AssistCtl) => Promise<{ message: string; undo?: () => void } | null>,
): Promise<void> {
	if (busy) {
		toast.warning(`Busy: ${busy}. Wait for it or cancel it first.`);
		return;
	}
	busy = title;
	const abort = new AbortController();
	let serverJob: string | null = null;
	const cancel = () => {
		abort.abort();
		if (serverJob) void studioApi.cancel(serverJob).catch(() => {});
	};
	const toastId = toast.loading(`${title}…`, { action: { label: "Cancel", onClick: cancel }, duration: Number.POSITIVE_INFINITY });
	const jobId = jobCenter.start({ kind: "other", title, cancel });
	const stage = (text: string, progress?: number) => {
		if (abort.signal.aborted) return;
		const pct = progress != null && progress > 0 && progress < 1 ? ` ${Math.round(progress * 100)}%` : "…";
		toast.loading(`${text}${pct}`, { id: toastId, action: { label: "Cancel", onClick: cancel }, duration: Number.POSITIVE_INFINITY });
		jobCenter.update(jobId, { stage: text, progress });
	};
	const ctl: AssistCtl = {
		signal: abort.signal,
		stage,
		async job<R>(start: () => Promise<JobState>): Promise<R> {
			if (abort.signal.aborted) throw cancelled();
			const first = await start();
			serverJob = first.id;
			if (abort.signal.aborted) {
				void studioApi.cancel(first.id).catch(() => {});
				throw cancelled();
			}
			const end = await followJob(first.id, (j) => {
				const s = j.stages.find((x) => x.status === "running");
				if (s) stage(s.detail && !/\d/.test(s.detail) ? s.detail : s.title, s.progress);
			});
			serverJob = null;
			if (end.status === "cancelled" || abort.signal.aborted) throw cancelled();
			if (end.status === "failed") throw new Error(end.error || `${title} failed. Try again.`);
			return end.result as R;
		},
	};
	try {
		const done = await body(ctl);
		if (abort.signal.aborted) throw cancelled();
		if (!done) {
			toast.dismiss(toastId);
			jobCenter.remove(jobId);
			return;
		}
		jobCenter.finish(jobId, done.message);
		toast.success(done.message, {
			id: toastId,
			duration: 6000,
			description: done.undo ? "⌘Z puts it back" : undefined,
			action: done.undo ? { label: "Undo", onClick: done.undo } : undefined,
		});
	} catch (error) {
		if (abort.signal.aborted || (error as Error)?.name === "AbortError") {
			jobCenter.cancelled(jobId);
			jobCenter.remove(jobId);
			toast.dismiss(toastId);
			toast(`${title} cancelled`, { duration: 2500 });
		} else {
			const message = (error as Error)?.message || `${title} failed. Try again.`;
			jobCenter.fail(jobId, message);
			toast.error(message, { id: toastId, duration: 8000, action: undefined });
		}
	} finally {
		busy = null;
	}
}

export function throwIfAborted(signal: AbortSignal) {
	if (signal.aborted) throw cancelled();
}
