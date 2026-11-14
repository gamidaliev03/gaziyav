// A post's line in the job center (client.ts mirrors the rows into the header chip). Pure, so the case that broke is
// tested: a scheduled post spun as «Post · TikTok · … · 2%» until its time — once Late has it, its line ends
// («Scheduled for 14:30»); waiting is not progress.
import type { Post } from "./types";

export type PostJob =
	/** Going up / being published now: progress, and Cancel while nothing is posted yet. */
	| { status: "running"; stage: string; progress: number; cancellable: boolean; manual: boolean }
	/** Late holds it for its time: the job is over. */
	| { status: "scheduled"; at: number }
	| { status: "done" }
	| { status: "failed" }
	/** Cancelled: off the list. */
	| { status: "gone" }
	| null;

/** What the job center shows for this row. `known`: the page saw it run (one finished in an earlier launch is no news). */
export function postJob(p: Post, known: boolean): PostJob {
	if (p.state === "uploading" || p.state === "queued" || p.state === "manual") {
		const stage = p.state === "queued" ? "Opening the site" : p.stage || "Uploading";
		return { status: "running", stage, progress: p.progress, cancellable: p.state === "uploading" && !!p.cancellable, manual: p.state === "manual" };
	}
	if (!known) return null;
	if (p.state === "scheduled") return p.at ? { status: "scheduled", at: p.at } : null;
	if (p.state === "done") return { status: "done" };
	if (p.state === "failed") return { status: "failed" };
	if (p.state === "cancelled") return { status: "gone" };
	return null;
}

/** «14:30» today, «Thu, 6 Nov, 14:30» another day (this Mac's time zone). */
export function scheduledTime(at: number, now = Date.now()): string {
	const d = new Date(at);
	const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
	if (d.toDateString() === new Date(now).toDateString()) return time;
	return `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}
