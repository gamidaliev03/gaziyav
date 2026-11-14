"use client";

import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@/components/ui/icon";
import { Alert02Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { cn } from "@/utils/ui";
import { t as translate, useT } from "@/i18n";
import { isHotLevel, useThermal } from "@/ondevice/thermal-client";
import { etaSeconds, formatDuration, type Job, jobCenter, signalFor, useJobsStore } from "../store";
import { startStudioJobSource } from "../studio-source";
import { connectSpeechJobs } from "@/transcribe/runs";
import { ActivityRing, JobObjectRow } from "./activity";
import { useClaudeActivity } from "@/agentview/components/agent-view";

/** How long a finished task stays «unseen» (the tab dots, the Dock) — the jobs model's own rhythm, kept as it was. */
const DONE_GLOW_MS = 10_000;
/** The header icon flashes a finished task once, this long, then settles (the owner, 12.11: shown by behaviour). */
const FLASH_MS = 1600;

/** The most recently finished (or started) of these jobs. */
function newest(list: Job[]): Job | undefined {
	let best: Job | undefined;
	for (const job of list) {
		if (!best || (job.endedAt ?? job.startedAt) > (best.endedAt ?? best.startedAt)) best = job;
	}
	return best;
}

/** Ticks once a second while something runs, for elapsed time and ETA. */
function useNow(active: boolean) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		setNow(Date.now());
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, [active]);
	return now;
}

function timeLine(job: Job, now: number): string {
	const end = job.status === "running" ? now : (job.endedAt ?? now);
	const elapsed = formatDuration((end - job.startedAt) / 1000);
	const eta = etaSeconds(job, now);
	if (eta == null) return elapsed;
	// (a measured time left is said as it is; «at least» when a later step's speed is not known yet; «~» for an estimate
	// from the bar — whole lines for t(), so the Russian reads in its own order)
	const time = formatDuration(eta);
	return translate(job.eta ? (job.eta.atLeast ? "{elapsed} · at least {time} left" : "{elapsed} · {time} left") : "{elapsed} · ~{time} left", { elapsed, time });
}

/** Header chip: the one place that shows every background task, with progress, time left, cancel and errors. */
export function JobsChip() {
	useEffect(() => startStudioJobSource(), []);
	// Local Whisper (captions, remove pauses) also reports into the job center.
	useEffect(() => connectSpeechJobs(jobCenter), []);
	const jobs = useJobsStore((s) => s.jobs);
	const [open, setOpen] = useState(false);
	const running = jobs.filter((j) => j.status === "running");
	// Claude in this project is one more activity in the same icon (no pill of its own in the bar, 12.11)
	const claude = useClaudeActivity();
	const claudeBusy = claude.kind === "working" || claude.kind === "thinking";
	const claudeShown = claude.kind !== "none";
	const signal = claudeBusy ? "running" : signalFor(jobs) ?? (claude.kind === "error" ? "error" : null);
	const now = useNow(running.length > 0);
	// A finished task flashes the icon once, then it settles to the quiet dot (the task stays unseen inside for the
	// tab dots and the Dock; the model is not touched).
	const doneAt = newest(jobs.filter((j) => j.status === "done" && !j.seen))?.endedAt ?? 0;
	const [, settle] = useState(0);
	useEffect(() => {
		const left = doneAt + FLASH_MS - Date.now();
		if (!doneAt || left <= 0) return;
		const timer = setTimeout(() => settle((n) => n + 1), left + 20);
		return () => clearTimeout(timer);
	}, [doneAt]);
	const shown: "running" | "error" | "done" | "quiet" =
		signal === "running" ? "running" : signal === "error" ? "error" : signal === "done" && doneAt + FLASH_MS > Date.now() ? "done" : "quiet";

	// A finished task stays unseen for a while (the tab dots, the Dock), then it is marked seen (the task stays inside):
	// «Reverse done» stayed lit all session and hid the newer «Captions from speech» (check-edit C4).
	useEffect(() => {
		const unseen = jobs.filter((j) => j.status === "done" && !j.seen && j.endedAt);
		if (unseen.length === 0) return;
		const due = Math.max(0, Math.min(...unseen.map((j) => (j.endedAt ?? 0) + DONE_GLOW_MS)) - Date.now());
		const timer = setTimeout(() => jobCenter.markSeen((j) => j.status === "done" && (j.endedAt ?? 0) + DONE_GLOW_MS <= Date.now() + 50), due + 20);
		return () => clearTimeout(timer);
	}, [jobs]);

	if (jobs.length === 0 && !claudeShown && !open) return null;

	const lead = running[0] ?? newest(jobs.filter((j) => j.status === "error" && !j.seen)) ?? newest(jobs.filter((j) => !j.seen)) ?? newest(jobs);
	const more = running.length > 1 ? running.length - 1 : 0;

	const handleOpenChange = (next: boolean) => {
		setOpen(next);
		if (!next) jobCenter.markSeen();
	};

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger asChild>
				{/*
				    while anything runs (captions, exports, Claude…), one flash when something finishes, then a quiet dot;
				    a red dot on a failure until it is looked at. The words are inside. */}
				<button
					type="button"
					data-testid="jobs-chip"
					data-activity={shown}
					aria-label={translate("Background tasks")}
					title={claudeBusy ? claude.spoken : lead ? `${translate(lead.title)}${lead.status === "running" && lead.progress != null && lead.progress > 0 ? ` · ${Math.round(lead.progress * 100)}%` : ""}${more > 0 ? ` +${more}` : ""}` : translate("Background tasks")}
					className="text-muted-foreground flex size-6 items-center justify-center rounded-[5px] transition-colors hover:bg-accent"
				>
					{shown === "running" ? (
						// CRAFT.md §9: a ring of the running jobs' aggregate progress (the Dock's figure), breathing when unmeasured
						<ActivityRing busy failed={false} idle={null} />
					) : shown === "done" ? (
						<HugeiconsIcon key={doneAt} icon={Tick02Icon} className="animate-in fade-in zoom-in-50 size-4 text-emerald-500 duration-300" />
					) : (
						<span
							key={shown}
							className={cn("animate-in fade-in rounded-full duration-500", shown === "error" ? "bg-destructive size-2" : "bg-muted-foreground/60 size-1.5")}
						/>
					)}
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 p-0">
				<div className="flex items-center justify-between border-b px-3 py-2.5">
					<span className="text-sm font-medium">Background tasks</span>
					{jobs.some((j) => j.status !== "running") && (
						<button
							type="button"
							className="text-muted-foreground hover:text-foreground text-xs"
							onClick={() => jobCenter.clearFinished()}
						>
							Clear finished
						</button>
					)}
				</div>
				<div className="flex max-h-96 flex-col divide-y overflow-y-auto">
					{claudeShown && (
						<button
							type="button"
							data-job="claude"
							className="hover:bg-accent flex items-center gap-2 px-3 py-2.5 text-left text-sm"
							onClick={() => {
								setOpen(false);
								claude.toggle();
							}}
						>
							<SignalIcon status={claudeBusy ? "running" : claude.kind === "error" ? "error" : "done"} />
							<span className="flex-1 truncate font-medium" data-no-translate>
								{claude.spoken}
							</span>
						</button>
					)}
					{jobs.length === 0 && !claudeShown && <p className="text-muted-foreground p-3 text-sm" data-empty-line>
							Nothing is running
						</p>}
					{/* each job as its object (CRAFT.md §9): a mini tile with its own progress; a click reveals it */}
					{jobs.map((job) => (
						<JobObjectRow key={job.id} job={job} onReveal={() => setOpen(false)}>
							<ThermalLine job={job} now={now} />
						</JobObjectRow>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}

/**
 * The Mac is hot (ondevice/thermal-client.ts): every running AI task stands still until it cools down (the line counts
 * the wait); an export goes on, just slower (one line). Cooled down: «continuing» for a moment on the tasks that waited.
 */
function ThermalLine({ job, now }: { job: Job; now: number }) {
	const t = useT();
	const { level, since, cooledAt } = useThermal();
	if (job.status !== "running") return null;
	if (isHotLevel(level)) {
		if (job.kind === "export") {
			return (
				<span className="pl-5.5 text-xs text-amber-600 dark:text-amber-400" data-thermal-line="export">
					{t("The Mac got hot — the export goes on (hardware codec), just slower")}
				</span>
			);
		}
		return (
			<span className="pl-5.5 text-xs text-amber-600 tabular-nums dark:text-amber-400" data-thermal-line="paused">
				{t("The Mac got hot — paused until it cools down · {time}", { time: formatDuration((now - since) / 1000) })}
			</span>
		);
	}
	if (job.kind !== "export" && cooledAt && now - cooledAt < 10_000 && job.startedAt < cooledAt) {
		return (
			<span className="pl-5.5 text-xs text-emerald-600 dark:text-emerald-400" data-thermal-line="resumed">
				{t("Cooled down — continuing")}
			</span>
		);
	}
	return null;
}

function SignalIcon({ status }: { status: Job["status"] }) {
	if (status === "running") return <Spinner className="size-3.5 shrink-0 text-sky-500" />;
	if (status === "error") return <HugeiconsIcon icon={Alert02Icon} className="text-destructive size-3.5 shrink-0" />;
	return <HugeiconsIcon icon={Tick02Icon} className="size-3.5 shrink-0 text-emerald-500" />;
}
