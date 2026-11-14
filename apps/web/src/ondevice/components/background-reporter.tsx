"use client";

// Tells the server what the user is doing, so the quiet background download of the models (ondevice/background.ts)
// gives way: an export, any AI tool or download in the job list. Mounted with the editor: opening a project is also
// the queue's start signal (the first project ever: it begins a couple of minutes later). Nothing shows.
import { useEffect } from "react";
import { useEditor } from "@/editor/use-editor";
import { useJobsStore } from "@/jobs/store";
import { ondeviceApi } from "@/ondevice/client";
import { watchThermal } from "@/ondevice/thermal-client";

export function BackgroundReporter() {
	const editor = useEditor();
	useEffect(() => {
		// The Mac's temperature, for the job list's lines (ondevice/thermal-client.ts).
		watchThermal();
		void ondeviceApi.background({ project: true }).catch(() => {});
		let last = "";
		let beat: ReturnType<typeof setInterval> | null = null;
		const reasons = () => {
			const out = new Set<string>();
			if (editor.project.getExportState().isExporting) out.add("export");
			for (const job of useJobsStore.getState().jobs) if (job.status === "running") out.add(job.kind === "export" ? "export" : "ai");
			return [...out].sort();
		};
		const send = (list: string[]) => void ondeviceApi.background({ busy: list }).catch(() => {});
		const check = () => {
			const list = reasons();
			const key = list.join(",");
			if (key !== last) {
				last = key;
				send(list);
			}
			// While the work lasts the report repeats (the server forgets one after 15 s: a closed window never blocks it).
			if (key && !beat) beat = setInterval(() => send(reasons()), 5000);
			else if (!key && beat) {
				clearInterval(beat);
				beat = null;
			}
		};
		const offJobs = useJobsStore.subscribe(check);
		const offProject = editor.project.subscribe(check);
		check();
		return () => {
			offJobs();
			offProject();
			if (beat) clearInterval(beat);
			if (last) send([]);
		};
	}, [editor]);
	return null;
}
