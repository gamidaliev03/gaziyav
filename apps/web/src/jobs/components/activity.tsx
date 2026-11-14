"use client";

// The top bar's one activity icon and its list (docs/CRAFT.md §9): a ring that is the running jobs' aggregate progress
// (the same figure as the Dock bar), breathing while nothing is measured, one tick when something finishes, a red
// point on a failure. Its list shows each job AS its object — a mini tile of the thing (grey → colour with its own
// progress) — and a click on a row reveals the object. Words only in tooltips.
import { HugeiconsIcon } from "@/components/ui/icon";
import { Cancel01Icon, Image02Icon, MusicNote01Icon, RefreshIcon, Tick02Icon, Video01Icon, Mic01Icon, Upload04Icon, AiMagicIcon } from "@hugeicons/core-free-icons";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { useT } from "@/i18n";
import { cn } from "@/utils/ui";
import { aggregateProgress, type Job, jobCenter, useJobsStore } from "../store";
import { Still } from "./pending-media";

/** The ring: idle shows `idle` (the bar's own quiet glyph). */
export function ActivityRing({ busy, failed, idle }: { busy: boolean; failed: boolean; idle: ReactNode }) {
	const p = useJobsStore((s) => aggregateProgress(s.jobs));
	const done = useJobsStore((s) => s.jobs.filter((j) => j.status === "done").length);
	const [tick, setTick] = useState(0);
	const seen = useRef(done);
	useEffect(() => {
		if (done > seen.current) setTick((n) => n + 1);
		seen.current = done;
	}, [done]);
	// the tick takes the idle glyph's place for its 900 ms, then the bar is quiet again
	const [ticking, setTicking] = useState(false);
	useEffect(() => {
		if (!tick) return;
		setTicking(true);
		const timer = setTimeout(() => setTicking(false), 900);
		return () => clearTimeout(timer);
	}, [tick]);
	const running = p !== null || busy;
	const measured = p !== null && p >= 0;
	return (
		<span className="relative grid size-4 place-items-center" data-activity-ring={measured ? Math.round((p ?? 0) * 100) : running ? "" : "idle"}>
			{running ? (
				<svg viewBox="0 0 16 16" className={cn("size-4 -rotate-90", !measured && "animate-[gz-breathe_1.6s_ease-in-out_infinite]")} aria-hidden="true">
					<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
					<circle
						cx="8"
						cy="8"
						r="6"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						pathLength={1}
						strokeDasharray="1"
						// paint only, no layout (CRAFT.md §8)
						style={{ strokeDashoffset: measured ? 1 - Math.max(0.02, p ?? 0) : 0.75, transition: "stroke-dashoffset var(--gz-t3) var(--gz-ease)" }}
						className="text-primary"
					/>
				</svg>
			) : ticking ? null : (
				idle
			)}
			{ticking && !running && (
				<span key={tick} className="absolute inset-0 grid animate-[gz-tick_900ms_cubic-bezier(0.22,1,0.36,1)_1_forwards] place-items-center text-emerald-500" data-activity-tick>
					<HugeiconsIcon icon={Tick02Icon} className="size-3.5" />
				</span>
			)}
			{failed && <span className="bg-destructive absolute -top-0.5 -right-0.5 size-1.5 rounded-full" data-activity-failed />}
		</span>
	);
}

const KIND_ICON = { voice: Mic01Icon, export: Upload04Icon, lipsync: AiMagicIcon, montage: AiMagicIcon, youtube: Video01Icon, transcribe: Mic01Icon, other: AiMagicIcon } as const;

/** Shows where a job's result lives: its Media item (on its way or landed), its panel, or its own reveal. */
export function revealJob(job: Job) {
	if (job.reveal) return job.reveal();
	const media = job.place?.media;
	const panel = useAssetsPanelStore.getState();
	if (media) {
		if (job.status === "done") return panel.requestRevealMedia(media.assetId);
		panel.setActiveTab("media");
		requestAnimationFrame(() => document.querySelector(`[data-pending-media="${media.assetId}"]`)?.scrollIntoView({ block: "nearest" }));
		return;
	}
	if (job.tab) panel.setActiveTab(job.tab);
}

/** One job in the list, as its object: a mini tile of the thing with its own progress, glyphs to stop / retry. */
export function JobObjectRow({ job, onReveal, children }: { job: Job; onReveal: () => void; children?: ReactNode }) {
	const t = useT();
	const media = job.place?.media;
	const running = job.status === "running";
	const failed = job.status === "error";
	const known = running && job.progress != null;
	const p = job.status === "done" ? 1 : failed ? 0 : Math.max(0, Math.min(1, job.progress ?? 0));
	const glyph = media ? (media.type === "audio" ? MusicNote01Icon : media.type === "image" ? Image02Icon : Video01Icon) : KIND_ICON[job.kind] ?? AiMagicIcon;
	return (
		<div className="group flex flex-col gap-1 px-3 py-2" data-job={job.id} data-job-status={job.status}>
			<div className="flex items-center gap-2.5">
				<button
					type="button"
					className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
					title={failed && job.message ? job.message : job.stage ? `${job.title} — ${job.stage}` : job.title}
					onClick={() => {
						revealJob(job);
						onReveal();
					}}
				>
					<span className="bg-accent relative size-7 shrink-0 overflow-hidden rounded-[4px]">
						<span
							className={cn("absolute inset-0", running && !known && "animate-[gz-breathe_1.6s_ease-in-out_infinite]", failed && "opacity-40")}
							style={{ filter: `grayscale(${1 - p})`, transition: "filter var(--gz-t3) var(--gz-ease)" }}
						>
							{media ? (
								<Still still={media.still} type={media.type} />
							) : (
								<span className="text-muted-foreground absolute inset-0 grid place-items-center">
									<HugeiconsIcon icon={glyph} className="size-3.5" />
								</span>
							)}
						</span>
						{known && (
							<span className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary" style={{ transform: `scaleX(${p})`, transition: "transform var(--gz-t3) var(--gz-ease)" }} />
						)}
					</span>
					<span className="flex min-w-0 flex-1 flex-col">
						<span className={cn("truncate text-sm", !running && "text-muted-foreground")} data-no-translate>
							{job.title}
						</span>
						{/* a job with no object of its own (a model's download): its measured figure, bytes, under the name */}
						{running && !media && job.stage && /\d/.test(job.stage) && (
							<span className="text-muted-foreground truncate text-xs tabular-nums" data-job-stage>
								{job.stage}
							</span>
						)}
						{failed && !media && job.message && (
							<span className="text-muted-foreground truncate text-xs" data-job-why>
								{job.message}
							</span>
						)}
					</span>
					{known && <span className="text-muted-foreground text-xs tabular-nums">{Math.min(99, Math.floor(p * 100))}%</span>}
					{job.status === "done" && <HugeiconsIcon icon={Tick02Icon} className="size-3.5 shrink-0 text-emerald-500" />}
				</button>
				{failed && job.retry && (
					<button
						type="button"
						aria-label={t("Retry")}
						title={job.message ? `${t("Retry")} — ${job.message}` : t("Retry")}
						className="text-foreground grid size-6 place-items-center rounded-full hover:bg-accent"
						onClick={() => {
							jobCenter.remove(job.id);
							job.retry?.();
						}}
						data-job-retry
					>
						<HugeiconsIcon icon={RefreshIcon} className="size-3.5" />
					</button>
				)}
				{(running ? !!job.cancel : true) && (
					<button
						type="button"
						aria-label={running ? t("Cancel") : t("Remove")}
						title={running ? t("Cancel") : t("Remove")}
						className="text-muted-foreground hover:text-foreground grid size-6 place-items-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent focus-visible:opacity-100"
						onClick={() => {
							// instant to the eye (CRAFT.md §6)
							if (running) job.cancel?.();
							jobCenter.remove(job.id);
						}}
						data-job-close
					>
						<HugeiconsIcon icon={Cancel01Icon} className="size-3" />
					</button>
				)}
			</div>
			{children}
		</div>
	);
}
