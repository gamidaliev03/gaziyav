"use client";

// The content cloud's background downloads wait while the timeline plays or an AI job runs (and while a video exports:
// the exporter says so itself), so prefetching never takes the Mac's time from what the user is waiting for.
import { useEffect } from "react";
import { useEditor } from "@/editor/use-editor";
import { useJobsStore } from "@/jobs/store";

export function cloudPause(reason: string, on: boolean) {
	void fetch("/api/content/pause", {
		method: "POST",
		headers: { "Content-Type": "application/json", "X-Studio": "1" },
		body: JSON.stringify({ reason, on }),
	}).catch(() => {});
}

/** Mounted once in the editor: playback and running AI jobs pause the background downloads. */
export function CloudPauseWatcher() {
	const playing = useEditor((e) => e.playback.getIsPlaying(), ["playback"]);
	const busy = useJobsStore((s) => s.jobs.some((j) => j.status === "running"));
	useEffect(() => cloudPause("playback", playing), [playing]);
	useEffect(() => cloudPause("ai", busy), [busy]);
	useEffect(
		() => () => {
			cloudPause("playback", false);
			cloudPause("ai", false);
		},
		[],
	);
	return null;
}
