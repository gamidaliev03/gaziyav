// The Assemble sheet and its result strip: open or not, the last choice (remembered), the running job, and what the
// last run did, step by step (each with what «Undo this step» needs).
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AssembleOptions, StepId } from "./kinds";

export interface DoneStep {
	id: StepId;
	/** «Cut 41 pauses (−3:12)». */
	line: string;
	/** Undone with «Undo this step» (the edit is rebuilt without it; «Bring back» rebuilds it with it). */
	off?: boolean;
	/** Whether this step can be taken out alone (a rebuild without it); false: only by going back to it. */
	alone: boolean;
}

/** The review's fixes of one check, as one button (automatic) or one line (to look at). */
export interface Fixable {
	/** The check's name in words («Pace», «Hook»). */
	name: string;
	say: string;
	auto: boolean;
	index: number;
}

export interface AssembleResult {
	projectId: string;
	steps: DoneStep[];
	/** History depth before the run: «Undo all» goes back to it. */
	startDepth: number;
	/** History depth after the run (and after each later step change by the strip). */
	endDepth: number;
	score: number | null;
	hard: string[];
	fixes: Fixable[];
	/** Seconds each run step took (the report and the tests). */
	timings: Record<string, number>;
	totalSeconds: number;
	before: number;
	after: number;
	/** The page load that made it: its steps can be undone one by one only there (history lives in the session). */
	session: string;
	/** Reverted after a reopen (from the saved copy of before the run): ⌘Z brings it back. */
	reverted?: boolean;
}

/** This page load. */
export const SESSION = Math.random().toString(36).slice(2);

interface AssembleState {
	open: boolean;
	last: Partial<AssembleOptions>;
	running: { jobId: string; stage: string; progress: number; stepProgress?: number } | null;
	result: AssembleResult | null;
	/** How the last run ended when it did not finish: the card says so. */
	ended: { kind: "cancelled" | "error" | "nospeech"; message: string } | null;
	stripOpen: boolean;
	/** The finished result was looked at (the header's dot goes). */
	seen: boolean;
	setOpen: (open: boolean) => void;
}

export const useAssembleStore = create<AssembleState>()(
	persist(
		(set) => ({
			open: false,
			last: {},
			running: null,
			result: null,
			ended: null,
			stripOpen: false,
			seen: true,
			setOpen: (open) => set({ open }),
		}),
		{ name: "gaziyav-assemble", partialize: (s) => ({ last: s.last, result: s.result }) },
	),
);

/** Files given on the start page: the sheet opens as soon as their project has them. */
let pendingSheet = false;
export const askSheetOnOpen = () => {
	pendingSheet = true;
};
/** The project before the run, kept on disk so «Undo all» works after the project is closed and opened again. */
const beforeKey = (projectId: string) => `gaziyav-assemble-before:${projectId}`;
export function keepBefore(projectId: string, snapshot: unknown) {
	try {
		localStorage.setItem(beforeKey(projectId), JSON.stringify(snapshot));
	} catch {}
}
export function readBefore<T>(projectId: string): T | null {
	try {
		const raw = localStorage.getItem(beforeKey(projectId));
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}

export const takeSheetOnOpen = () => {
	const was = pendingSheet;
	pendingSheet = false;
	return was;
};
