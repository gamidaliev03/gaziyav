"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { t as tr, useT } from "@/i18n";
import { cn } from "@/utils/ui";
import type { Run } from "@/studio/client/studio-store";
import type { StageState } from "@/studio/server/jobs";
import { formatNumber, formatSeconds } from "@/studio/shared/models";
import { cents } from "@/studio/client/money";
import { apiOf, falModel } from "@/fal/models";

/** «6.0 s» (RU: «6,0 с»). */
const sec = (s: number) => tr("{s} s", { s: formatNumber(s, 1) });

// The server's stage titles, details, checks and errors come in English (studio/server, fal/): they are put into the
// interface language here, at the edge, by key (ru-studio.ts) or by these patterns for the ones with numbers in them.
const PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
	[/^Lipsync on (.+?) · (.+)$/, (m) => tr("Lipsync on {api} · {model}", { api: m[1], model: m[2] })],
	[/^Voicing on (.+)$/, (m) => tr("Voicing on {api}", { api: m[1] })],
	[/^cutting ([\d.]+) s$/, (m) => tr("cutting {s}", { s: sec(Number(m[1])) })],
	[/^cutting the speech to ([\d.]+) s$/, (m) => tr("cutting the speech to {s}", { s: sec(Number(m[1])) })],
	[/^fitting the speech to ([\d.]+) s$/, (m) => tr("fitting the speech to {s}", { s: sec(Number(m[1])) })],
	[/^keeping all ([\d.]+) s of the clip$/, (m) => tr("keeping all {s} of the clip", { s: sec(Number(m[1])) })],
	[/^waiting in the fal\.ai queue · (\d+) ahead$/, (m) => tr("in the fal.ai queue · {n} ahead", { n: m[1] })],
	[/^Low-quality source \((\d+)p\) — the result will look blurry$/, (m) => tr("Low-quality source ({p}p) — the result will look blurry", { p: m[1] })],
	[/^The result will be ≈ ([\d.]+) s \(speech length\)$/, (m) => tr("The result will be ≈ {s}", { s: sec(Number(m[1])) })],
	[/^(.+) takes pieces up to (\d+) s — .*$/, (m) => tr("{model} takes pieces up to {n} s — pick another model", { model: m[1], n: m[2] })],
	[/^(.+) takes (\d+)p or better — this clip is (\d+)p\. Pick another model$/, (m) => tr("{model} takes {a}p or better — this clip is {b}p. Pick another model", { model: m[1], a: m[2], b: m[3] })],
	[/^Done: (.+?) · ([\d.]+) s\. Listen to it below\.$/, (m) => tr("Voice ready · {s}", { s: sec(Number(m[2])) })],
];

/** A text from the pipeline in the interface language (English stays where nothing covers it). */
export function sayStudio(text: string | undefined): string {
	if (!text) return "";
	const direct = tr(text);
	if (direct !== text) return direct;
	for (const [re, out] of PATTERNS) {
		const m = text.match(re);
		if (m) return out(m);
	}
	return text;
}

/**
 * The server's failure keys (job `errorKey / errorVars`, studio/server/errors.ts) in the interface's own words — no
 * English sentence is matched where a key exists. Null: no key (an older job, a failure without one).
 */
export function keyedError(key: string | undefined, vars: Record<string, string | number> = {}): string | null {
	const n = (v: unknown) => Number(v) || 0;
	switch (key) {
		case "fal.timeout":
			return tr("fal.ai didn't finish within {time}. The job was cancelled; press Retry.", { time: formatSeconds(n(vars.seconds)) });
		case "fal.silent":
			return tr("fal.ai stopped answering {time} ago. The job may still finish there: press Retry in a minute — it isn't charged twice.", { time: formatSeconds(n(vars.seconds)) });
		case "fal.stopped":
			return tr("fal.ai stopped the job. Press Retry.");
		case "fal.failed":
			return tr("The provider answered with an error. Nothing was lost — press Retry.");
		case "stage.timeout":
			return tr("The step didn't finish within {time}. Press Retry — it usually works the second time.", { time: formatSeconds(n(vars.seconds)) });
		case "lipsync.too_long":
			return tr("{model} takes pieces up to {n} s — pick another model", { model: String(vars.model ?? ""), n: n(vars.max) });
		case "lipsync.too_short":
			return tr("{model} needs a piece of at least {n} s.", { model: String(vars.model ?? ""), n: n(vars.min) });
		case "lipsync.no_video":
			return tr("Lipsync produced no video. Press Retry.");
		case "lipsync.no_video_track":
			return tr("The chosen clip has no video — pick a video clip");
		case "lipsync.sample_no_speech":
			return tr("Nobody speaks in this sound — there is nothing to sample.");
		case "lipsync.over_limit":
			return tr("The lipsync costs {sum} — more than agreed. Nothing was sent; press the button again to see the price.", { sum: cents(n(vars.usd)) });
		case "cancelled":
			return tr("Cancelled · nothing changed");
		default:
			return null;
	}
}

/** A stage's title and its one detail line by the stage's id and data (the lipsync in pieces: pieces done / all). */
export function stageText(run: Run, s: StageState): { title: string; detail: string } {
	const plan = (run.job?.stages.find((x) => x.id === "lipsync")?.data ?? null) as { model?: string; requests?: number; secondsSent?: number; wholeSeconds?: number; done?: number } | null;
	if (run.kind === "lipsync" && plan?.requests != null) {
		const m = plan.model ? falModel(plan.model) : undefined;
		const n = plan.requests;
		if (s.id === "prepare") return { title: tr("Preparing the video"), detail: tr("{n} pieces · {a} of {b} goes out", { n, a: sec(plan.secondsSent ?? 0), b: sec(plan.wholeSeconds || plan.secondsSent || 0) }) }; // a sample's plan has no whole (lip5)
		if (s.id === "lipsync") {
			const title = m ? tr("Lipsync on {api} · {model}", { api: apiOf(m) === "kie" ? "kie.ai" : "fal.ai", model: m.title }) : sayStudio(s.title);
			// one line for the clip, never a list: pieces ready of all (a single piece says fal's own state)
			const detail = n > 1 ? tr("Pieces ready: {done} of {n}", { done: plan.done ?? 0, n }) : sayStudio((s.detail ?? "").replace(/^piece 1 of 1 · /, ""));
			return { title, detail: s.status === "pending" ? "" : detail };
		}
	}
	return { title: sayStudio(s.title), detail: sayStudio(s.detail) };
}

/**
 * The error of a run as the user reads it: by the server's key when the job has one; else the older way (a time-out
 * names the time it really waited, audit bug 7).
 */
export function runError(run: Run): string {
	const keyed = run.job?.status === "failed" || run.job?.status === "cancelled" ? keyedError(run.job.errorKey, run.job.errorVars) : null;
	if (keyed) return keyed;
	const line = (run.error ?? "").split("\n\nDetails:")[0];
	if (/didn't finish within \d+ min/.test(line)) {
		const stage = run.job?.stages.find((s) => s.id === "lipsync" || s.status === "failed");
		const waited = stage?.startedAt ? ((stage.endedAt ?? run.job?.endedAt ?? Date.now()) - stage.startedAt) / 1000 : 0;
		return waited > 0 ? tr("fal.ai didn't finish within {time}. The job was cancelled; press Retry.", { time: formatSeconds(waited) }) : tr("fal.ai didn't finish in time. The job was cancelled; press Retry.");
	}
	const said = sayStudio(line);
	// a provider's own words (English) under one Russian sentence; the words themselves stay in «Details»
	if (/[A-Za-z]{4,}/.test(said.replace(/fal\.ai|kie\.ai|LatentSync|Sync|Kling|VEED|Qwen3?|MiniMax/g, ""))) return tr("The provider answered with an error. Nothing was lost — press Retry.");
	return said;
}

/** The raw text behind a run's error, for «Details» (the provider's words when the sentence above is ours). */
export function runDetails(run: Run): string {
	const [line, details] = (run.error ?? "").split("\n\nDetails:");
	return [runError(run) !== sayStudio(line) ? line : "", details?.trim() ?? ""].filter(Boolean).join(" · ");
}

function Elapsed({ since, until }: { since: number; until?: number }) {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		if (until) return;
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, [until]);
	return <span className="tabular-nums">{formatSeconds(((until ?? now) - since) / 1000)}</span>;
}

/** Stages of a running step: what is happening now, how long it takes, and a way to stop it. */
export function RunStatus({
	run,
	onDismiss,
	onRetry,
	onWatch,
}: {
	run: Run;
	onDismiss?: () => void;
	/** Error action: run the step again. */
	onRetry?: () => void;
	/** Done action: "▶ Watch" the result on the timeline. */
	onWatch?: () => void;
}) {
	const t = useT();
	const running = !run.error && !run.done;
	const stages = run.job?.stages ?? [];
	return (
		<div className="flex flex-col gap-2 rounded-md border p-3 text-sm" data-testid="run-status">
			{run.local && running && (
				<div className="flex flex-col gap-1.5">
					<div className="flex items-center gap-2">
						<Spinner className="size-3.5" />
						<span className="flex-1">{sayStudio(run.local.title)}</span>
						<Elapsed since={run.startedAt} />
					</div>
					{run.local.progress != null && <Progress value={run.local.progress * 100} className="h-1" />}
				</div>
			)}
			{stages.map((s) => {
				const said = stageText(run, s);
				return (
				<div key={s.id} className="flex flex-col gap-1">
					<div className="flex items-center gap-2">
						<StageIcon status={s.status} />
						<span className={cn("flex-1", s.status === "pending" && "text-muted-foreground")}>{said.title}</span>
						{s.startedAt && (s.status === "running" || s.endedAt) && <Elapsed since={s.startedAt} until={s.endedAt} />}
					</div>
					{said.detail && s.status !== "pending" && <span className="text-muted-foreground pl-5.5 text-xs">{said.detail}</span>}
					{s.status === "running" && s.progress != null && <Progress value={s.progress * 100} className="ml-5.5 h-1" />}
				</div>
				);
			})}
			{running && stages.length > 0 && <span className="text-muted-foreground text-xs">{t("You can keep editing — this runs in the background")}</span>}
			{running && run.cancel && (
				<Button variant="outline" size="sm" onClick={run.cancel}>
					{t("Stop")}
				</Button>
			)}
			{/* Stopped by the user: a quiet line, not a red error (nothing went wrong, nothing changed). */}
			{run.error === "Cancelled" && (
				<div className="text-muted-foreground flex items-center gap-2 text-xs" data-testid="run-cancelled">
					<span className="min-w-0 flex-1">{t("Cancelled · nothing changed")}</span>
					{onDismiss && (
						<Button variant="ghost" size="sm" onClick={onDismiss}>
							{t("Hide")}
						</Button>
					)}
				</div>
			)}
			{run.error && run.error !== "Cancelled" && (
				<div className="bg-destructive/10 border-destructive/20 flex flex-col gap-2 rounded-md border p-2.5" data-testid="run-error">
					<p className="text-destructive text-sm whitespace-pre-wrap">{runError(run)}</p>
					{!!runDetails(run) && (
						<details className="text-muted-foreground text-xs">
							<summary className="cursor-pointer">{t("Details")}</summary>
							<span className="break-all" data-no-translate>
								{runDetails(run)}
							</span>
						</details>
					)}
					<div className="flex flex-wrap gap-1.5">
						{onRetry && (
							<Button variant="outline" size="sm" onClick={onRetry} data-run-retry>
								{t("Retry")}
							</Button>
						)}
						{onDismiss && (
							<Button variant="ghost" size="sm" onClick={onDismiss}>
								{t("Hide")}
							</Button>
						)}
					</div>
				</div>
			)}
			{run.done && (
				<div className="flex items-start gap-2 text-emerald-500">
					<span>✓</span>
					<span className="flex-1">{sayStudio(run.done)}</span>
					{onWatch && (
						<button type="button" className="text-foreground shrink-0 text-xs hover:underline" onClick={onWatch}>
							{t("Watch")}
						</button>
					)}
					{onDismiss && (
						<button type="button" className="text-muted-foreground hover:text-foreground text-xs" onClick={onDismiss}>
							{t("Hide")}
						</button>
					)}
				</div>
			)}
		</div>
	);
}

function StageIcon({ status }: { status: string }) {
	if (status === "running") return <Spinner className="size-3.5" />;
	const map: Record<string, [string, string]> = {
		done: ["✓", "text-emerald-500"],
		skipped: ["–", "text-muted-foreground"],
		failed: ["✕", "text-destructive"],
		pending: ["○", "text-muted-foreground"],
	};
	const [ch, cls] = map[status] ?? map.pending;
	return <span className={cn("inline-flex w-3.5 justify-center text-xs", cls)}>{ch}</span>;
}

/** "about 40 s left", "about 2 min left" — rounded so it doesn't flicker. */
function left(seconds: number): string {
	if (seconds < 8) return tr("almost done");
	if (seconds < 60) return tr("about {n} s left", { n: Math.max(10, Math.round(seconds / 10) * 10) });
	return tr("about {n} min left", { n: Math.round(seconds / 60) });
}

/**
 * One calm line for a running step: what happens now (stage n of N), the time left (from the stage's progress) or the
 * usual time, a bar, Stop. Errors keep the full RunStatus (cause + Retry / Keys / Hide).
 */
export function RunProgress({
	run,
	eta,
	part,
	steps,
}: {
	run: Run;
	eta?: string;
	/** This run is a part of a longer one (Video translator: the voice, then the lips): it fills from…from + span. */
	part?: { from: number; span: number };
	/** A part of «voice → lipsync» as one run: its steps are numbered among all of them. */
	steps?: { offset: number; total: number };
}) {
	const t = useT();
	const stages = run.job?.stages ?? [];
	const active = stages.find((s) => s.status === "running");
	const done = stages.filter((s) => s.status === "done" || s.status === "skipped").length;
	const index = active ? stages.indexOf(active) + 1 : done;
	const said = active ? stageText(run, active) : null;
	const title = run.local ? sayStudio(run.local.title) : (said?.title ?? sayStudio("Starting"));
	// One bar for the whole run that only moves forward (not a bar per step that starts again at 0): the first 5 % while
	// it gets ready, then the steps done plus the running step's share.
	const whole = stages.length ? 0.05 + 0.95 * Math.min(1, (done + (active?.progress ?? 0)) / stages.length) : 0.05 * (run.local?.progress ?? 0);
	const value = part ? part.from + whole * part.span : whole;
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, []);
	// Remaining time of the long stage: elapsed × (1 − p) / p, smoothed; shown once there is enough to go on.
	const smooth = useRef<{ stage?: string; value?: number }>({});
	let remaining: number | null = null;
	if (active?.startedAt && active.progress != null && active.progress >= 0.05 && now - active.startedAt > 4000) {
		const raw = ((now - active.startedAt) / 1000) * ((1 - active.progress) / active.progress);
		const prev = smooth.current.stage === active.id ? smooth.current.value : undefined;
		remaining = prev == null ? raw : prev * 0.7 + raw * 0.3;
		smooth.current = { stage: active.id, value: remaining };
	}
	const later = active ? stages.slice(stages.indexOf(active) + 1).some((s) => s.status === "pending") : false;
	const total = steps ? steps.total : stages.length;
	const n = (steps?.offset ?? 0) + Math.max(1, index);
	const where = run.queued ? t("In line · {n} ahead", { n: run.queued }) : stages.length > 0 ? t("Step {n} of {m}", { n, m: total }) : t("Preparing");
	// The usual time is the AI step's: a model download (run.local) has its own size and time left, not «usually 10–30 s».
	return (
		<div className="flex flex-col gap-2" data-testid="run-progress">
			<div className="flex items-baseline gap-2 text-sm">
				<Spinner className="size-3.5 self-center" />
				<span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{title}</span>
				<span className="text-muted-foreground shrink-0 text-xs tabular-nums" data-testid="run-eta">
					<Elapsed since={run.startedAt} />
					{remaining != null && !later ? ` · ${left(remaining)}` : eta && !run.local ? ` · ${t("usually {time}", { time: eta })}` : ""}
				</span>
			</div>
			<Progress value={value * 100} className="h-1" />
			<div className="flex items-center justify-between gap-2 text-xs">
				<span className="text-muted-foreground min-w-0 [overflow-wrap:anywhere]" data-testid="run-stage">
					{where}
					{said?.detail ? ` · ${said.detail}` : ""}
				</span>
				{run.cancel && (
					<button type="button" className="text-muted-foreground hover:text-foreground shrink-0" onClick={run.cancel} data-run-stop>
						{t("Stop")}
					</button>
				)}
			</div>
		</div>
	);
}
