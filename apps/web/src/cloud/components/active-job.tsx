"use client";

// The generation that is running now, in one line right under Generate: its model, the progress (or «Queued») and Stop —
// where the person is looking after the press. The card with the same job lies among the results under the form, often
// below the panel's edge (check-ai D6, 06.11: after Generate nothing seemed to happen).
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n";
import { jobModelId, modelName, usePoint } from "../client";

export function ActiveJobLine({ kind }: { kind?: "video" | "image" | "audio" }) {
	const t = useT();
	const job = usePoint((s) => s.jobs.find((j) => (j.state === "queued" || j.state === "running") && (!kind || j.kind === kind)));
	if (!job) return null;
	const stop = () => void usePoint.getState().cancel(job.id).catch((e) => toast.error((e as Error).message));
	return (
		<div className="flex items-center gap-2 text-[11px]" data-point-active={job.id}>
			<Spinner className="size-3 shrink-0" />
			<span className="text-muted-foreground min-w-0 flex-1 truncate">{modelName(jobModelId(job))}</span>
			<span className="tabular-nums" data-point-active-progress>
				{job.state === "queued" ? t("Queued") : `${job.progress}%`}
			</span>
			<button type="button" className="text-muted-foreground hover:text-foreground underline underline-offset-2" onClick={stop} data-point-active-stop>
				{t("Stop")}
			</button>
		</div>
	);
}
