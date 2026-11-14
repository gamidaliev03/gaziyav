// Speech jobs (recognition, pause search) for the one job center in the header.
// The job center lives in the shell (src/jobs/store.ts); it subscribes with connectSpeechJobs(jobCenter),
// so this module stays free of a hard dependency on it.
import { create } from "zustand";

export interface SpeechRun {
	id: string;
	title: string;
	stage?: string;
	progress?: number;
	status: "running" | "done" | "error" | "cancelled";
	message?: string;
	startedAt: number;
	endedAt?: number;
	cancel?: () => void;
	/** The timeline clips it reads: the progress shows on them. */
	elements?: string[];
}

export const useSpeechRuns = create<{ runs: SpeechRun[] }>()(() => ({ runs: [] }));

let counter = 0;

function patch(id: string, p: Partial<SpeechRun>) {
	useSpeechRuns.setState((s) => ({ runs: s.runs.map((r) => (r.id === id ? { ...r, ...p } : r)) }));
}

export const speechRuns = {
	start({ title, cancel, elements }: { title: string; cancel: () => void; elements?: string[] }): string {
		const id = `speech-${Date.now().toString(36)}-${++counter}`;
		useSpeechRuns.setState((s) => ({
			runs: [{ id, title, status: "running" as const, startedAt: Date.now(), cancel, elements }, ...s.runs].slice(0, 6),
		}));
		return id;
	},
	update(id: string, p: { stage?: string; progress?: number }) {
		patch(id, p);
	},
	finish(id: string, message?: string) {
		patch(id, { status: "done", message, endedAt: Date.now(), cancel: undefined, progress: 1 });
	},
	fail(id: string, message: string) {
		patch(id, { status: "error", message, endedAt: Date.now(), cancel: undefined });
	},
	cancelled(id: string) {
		patch(id, { status: "cancelled", endedAt: Date.now(), cancel: undefined });
	},
};

/** The subset of the shell's jobCenter we need (structural, so no import of src/jobs here). */
export interface JobCenterLike {
	upsert(
		id: string,
		input: {
			kind: "transcribe";
			title: string;
			stage?: string;
			progress?: number;
			status?: "running" | "done" | "error" | "cancelled";
			message?: string;
			startedAt?: number;
			endedAt?: number;
			tab?: any;
			cancel?: () => void;
			place?: { elements?: string[] };
		},
	): void;
	remove(id: string): void;
}

/** Mirrors speech runs into the job center. Call once at startup: connectSpeechJobs(jobCenter). */
let warmRequested = false;

export function connectSpeechJobs(center: JobCenterLike): () => void {
	// The editor is open: let the server warm the recognizer up in the background (first «Generate captions»
	// then takes seconds, not the ~25 s cold start of a fresh install).
	if (!warmRequested && typeof window !== "undefined") {
		warmRequested = true;
		setTimeout(() => void fetch("/api/transcribe/status").catch(() => {}), 4000);
	}
	const sync = (runs: SpeechRun[]) => {
		for (const r of runs) {
			if (r.status === "cancelled") {
				center.remove(r.id);
				continue;
			}
			center.upsert(r.id, {
				kind: "transcribe",
				title: r.title,
				tab: "captions",
				stage: r.status === "running" ? r.stage : undefined,
				progress: r.status === "running" ? r.progress : undefined,
				status: r.status,
				message: r.message,
				startedAt: r.startedAt,
				endedAt: r.endedAt,
				cancel: r.status === "running" ? r.cancel : undefined,
				...(r.elements?.length ? { place: { elements: r.elements } } : {}),
			});
		}
	};
	sync(useSpeechRuns.getState().runs);
	return useSpeechRuns.subscribe((s) => sync(s.runs));
}
