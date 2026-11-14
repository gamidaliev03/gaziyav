// Manual check: a job started during warm-up shows "Preparing speech model…", then real progress.
import fs from "node:fs";
import { newFile } from "@/studio/server/files";
import { getJob } from "@/studio/server/jobs";
import { startTranscribe } from "@/transcribe/server/job";
import { warmUp } from "@/transcribe/server/whisper";

const slot = newFile("a.wav");
fs.copyFileSync(process.argv[2], slot.path);
warmUp();
const job = await startTranscribe({ fileId: slot.id, language: "ru" });
const seen: string[] = [];
const t0 = Date.now();
for (;;) {
	const s = getJob(job.id)!;
	const st = s.stages.find((x) => x.status === "running");
	const label = st ? `${st.detail || st.title}${st.progress != null && !st.detail ? ` ${Math.round(st.progress * 100)}%` : ""}` : s.status;
	if (seen.at(-1) !== label) seen.push(label);
	if (s.status !== "running") break;
	await new Promise((r) => setTimeout(r, 100));
}
console.log(((Date.now() - t0) / 1000).toFixed(1), "s:", seen.join(" → "));
console.log("words:", (getJob(job.id)!.result as any)?.words?.length);
