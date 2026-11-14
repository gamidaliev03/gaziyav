// UI state of the motion tools: running jobs per clip (progress, Cancel), the preview's box-drawing mode and the
// tracker selected on each clip. Nothing here is saved — the project holds the motion data itself.
import { create } from "zustand";
import type { TrackerKind } from "./types";

export type MotionJobKind = "track" | "reverse" | "smooth" | "reframe" | "stabilize";

export interface MotionJob {
	key: string;
	kind: MotionJobKind;
	elementId: string;
	title: string;
	stage?: string;
	progress?: number;
	status: "running" | "done" | "error";
	error?: string;
	cancel?: () => void;
	/** What is being rendered (smooth: factor + range), so the same request isn't restarted. */
	need?: string;
	/** Stops it without counting as the user's Cancel (a newer render replaces it). */
	stop?: () => void;
}

export interface DrawMode {
	elementId: string;
	/** "object": drag a box; "subject": click the subject; "edit": drag the tracked box to correct it. */
	mode: "object" | "subject" | "edit";
	kind?: TrackerKind;
	trackerId?: string;
}

interface MotionState {
	jobs: Record<string, MotionJob>;
	draw: DrawMode | null;
	selected: Record<string, string>;
	/** Renders the user cancelled (clip id → what): not restarted automatically. */
	skipped: Record<string, string>;
	setSkipped(elementId: string, need: string | null): void;
	setJob(job: MotionJob): void;
	patchJob(key: string, patch: Partial<MotionJob>): void;
	removeJob(key: string): void;
	setDraw(draw: DrawMode | null): void;
	select(elementId: string, trackerId: string | null): void;
}

export const useMotionStore = create<MotionState>()((set) => ({
	jobs: {},
	draw: null,
	selected: {},
	skipped: {},
	setSkipped: (elementId, need) =>
		set((s) => {
			const skipped = { ...s.skipped };
			if (need) skipped[elementId] = need;
			else delete skipped[elementId];
			return { skipped };
		}),
	setJob: (job) => set((s) => ({ jobs: { ...s.jobs, [job.key]: job } })),
	patchJob: (key, patch) =>
		set((s) => (s.jobs[key] ? { jobs: { ...s.jobs, [key]: { ...s.jobs[key], ...patch } } } : s)),
	removeJob: (key) =>
		set((s) => {
			const { [key]: _gone, ...rest } = s.jobs;
			return { jobs: rest };
		}),
	setDraw: (draw) => set({ draw }),
	select: (elementId, trackerId) =>
		set((s) => {
			const selected = { ...s.selected };
			if (trackerId) selected[elementId] = trackerId;
			else delete selected[elementId];
			return { selected };
		}),
}));

export function jobFor(jobs: Record<string, MotionJob>, elementId: string, kind?: MotionJobKind): MotionJob | null {
	for (const job of Object.values(jobs)) {
		if (job.elementId === elementId && (!kind || job.kind === kind)) return job;
	}
	return null;
}
