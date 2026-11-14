"use client";

// A clip a job is reading or changing (captions, clean-up, an AI effect on it) shows the job on itself: the part done is
// lit, the rest dimmed, the edge moving right; with nothing measured the clip breathes. Nothing when no job targets it
// (one primitive selector per clip: no re-render of the timeline while a job runs).
import { type Job, useJobsStore } from "../store";

/** The progress of the running job on `elementId`: 0..1, -1 while nothing is measured, null with no job on it. */
export function clipJobProgress(jobs: readonly Job[], elementId: string): number | null {
	for (const j of jobs) {
		if (j.status === "running" && j.place?.elements?.includes(elementId)) return j.progress == null ? -1 : Math.max(0, Math.min(1, j.progress));
	}
	return null;
}

export function ClipProgress({ elementId }: { elementId: string }) {
	const p = useJobsStore((s) => clipJobProgress(s.jobs, elementId));
	if (p === null) return null;
	if (p < 0) {
		return <div data-clip-progress="" className="pointer-events-none absolute inset-0 animate-[gz-breathe_1.6s_ease-in-out_infinite] bg-black/35" />;
	}
	return (
		// transform only (CRAFT.md §8): the dim part shrinks to the right, the edge moves with it — no layout per step.
		<div data-clip-progress={Math.round(p * 1000) / 1000} className="pointer-events-none absolute inset-0 overflow-hidden">
			<div className="absolute inset-0 origin-right bg-black/40" style={{ transform: `scaleX(${1 - p})`, transition: "transform var(--gz-t3) var(--gz-ease)" }} />
			<div className="absolute inset-0" style={{ transform: `translateX(${p * 100}%)`, transition: "transform var(--gz-t3) var(--gz-ease)" }}>
				<div className="absolute inset-y-0 left-0 w-px bg-white/70" />
			</div>
		</div>
	);
}
