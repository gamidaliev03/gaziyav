"use client";

// Video → Basic → Stabilize (CapCut: a group with its own on/off and a level). On renders a steadied copy of the clip
// once in the background (motion/client.ts setStabilize, ffmpeg vid.stab) and the clip plays it; another level is made
// from the original; off and ⌘Z bring the original back. The original media is never changed.
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setStabilize, stabilizeOf, type StabilizeLevel } from "@/motion/client";
import { MotionJobLine } from "@/motion/components/speed-sections";
import { jobFor, useMotionStore } from "@/motion/store";
import type { VideoElement } from "@/timeline";
import { InspectorGroup, InspectorRow, Segmented } from "../components/inspector-ui";

const LEVELS: Array<{ value: StabilizeLevel; label: string; title: string }> = [
	{ value: "recommended", label: "Recommended", title: "Recommended: smooth camera, a little zoom" },
	{ value: "mincrop", label: "Min crop", title: "Minimum crop: keeps most of the picture, smooths less" },
	{ value: "most", label: "Most stable", title: "Most stable: the steadiest picture, zooms in more" },
];

export function StabilizeSection({ element }: { element: VideoElement }) {
	const jobs = useMotionStore((s) => s.jobs);
	const job = jobFor(jobs, element.id, "stabilize");
	const busy = job?.status === "running";
	const link = stabilizeOf(element);
	const run = (level: StabilizeLevel | null) =>
		void setStabilize(element.id, level).catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
	return (
		<InspectorGroup
			id="stabilize"
			title="Stabilize"
			defaultOpen={false}
			trailing={
				<Switch
					aria-label="Stabilize"
					title={link ? "On: a steadied copy plays; off brings the original back" : "Smooths a shaky camera on this Mac; the original is kept"}
					data-stabilize={link ? link.level : "off"}
					checked={!!link || busy}
					disabled={busy}
					onCheckedChange={(on) => run(on ? "recommended" : null)}
				/>
			}
		>
			<div className="flex flex-col gap-2" data-stabilize-section>
				<InspectorRow rowId="stabilize.level" label="Level" stackWhenNarrow>
					<Segmented<StabilizeLevel | "">
						label="Stabilization level"
						value={link?.level ?? ""}
						options={LEVELS}
						onChange={(level) => {
							if (level && !busy) run(level);
						}}
					/>
				</InspectorRow>
				{(busy || job?.status === "error") && <MotionJobLine job={job} onRetry={() => run(link?.level ?? "recommended")} />}
			</div>
		</InspectorGroup>
	);
}
