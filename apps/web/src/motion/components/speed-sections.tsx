"use client";

// Inspector → Speed, under the built-in Speed group: Speed ramp (CapCut-style curves), Optical flow (smooth
// slow motion, rendered once in the background) and Reverse. Every change is one ⌘Z; the clip's media is
// never changed — rendered copies sit next to it (hidden from the media pool).
import { useEffect, useMemo, useRef } from "react";
import { Switch } from "@/components/ui/switch";
import { InspectorGroup, InspectorRow } from "@/components/editor/panels/properties/components/inspector-ui";
import { useEditor } from "@/editor/use-editor";
import { buildCurve, getCurveTable } from "@/retime/curve";
import { getSourceTimeAtClipTime } from "@/retime/resolve";
import type { AudioElement, RetimeConfig, VideoElement } from "@/timeline";
import { cn } from "@/utils/ui";
import { roundMediaTime, TICKS_PER_SECOND } from "@/wasm";
import { missingSmooth, renderSmooth, smoothNeedKey, toggleReverse } from "../client";
import { smoothFactorFor } from "../smooth";
import { jobFor, useMotionStore, type MotionJob } from "../store";
import type { SpeedCurve, SpeedCurvePresetId } from "../types";
import { SpeedCurveEditor, SpeedCurvePresets } from "./speed-curve-editor";

type Retimable = VideoElement | AudioElement;

/** Ticks → seconds (computed spans of a speed ramp are not whole ticks). */
const secs = (t: number) => t / TICKS_PER_SECOND;
const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}` : `${s.toFixed(1)}s`);

/** Progress line of a running motion job, with Cancel; the error with Retry when it failed. */
export function MotionJobLine({ job, onRetry }: { job: MotionJob | null; onRetry?: () => void }) {
	if (!job) return null;
	if (job.status === "error") {
		return (
			<div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs" data-motion-error>
				<span className="min-w-0 flex-1 break-words">{job.error}</span>
				{onRetry && (
					<button type="button" className="text-foreground shrink-0 underline-offset-2 hover:underline" onClick={onRetry}>
						Retry
					</button>
				)}
				<button type="button" className="text-muted-foreground hover:text-foreground shrink-0" onClick={() => useMotionStore.getState().removeJob(job.key)}>
					Dismiss
				</button>
			</div>
		);
	}
	const pct = job.progress != null ? Math.round(job.progress * 100) : null;
	return (
		<div className="flex flex-col gap-1" data-motion-job={job.kind}>
			<div className="flex items-center gap-2 text-xs">
				<span className="text-muted-foreground min-w-0 flex-1 truncate">
					{job.stage ?? job.title}
					{pct != null ? ` · ${pct}%` : "…"}
				</span>
				{job.cancel && (
					<button type="button" data-motion-cancel className="text-foreground shrink-0 rounded-sm px-1.5 py-0.5 text-xs hover:bg-accent" onClick={() => job.cancel?.()}>
						Cancel
					</button>
				)}
			</div>
			<div className="bg-accent h-1 w-full overflow-hidden rounded-full">
				<div
					className={cn("bg-primary h-full transition-[width] duration-300", pct == null && "w-1/3 animate-pulse")}
					style={pct != null ? { width: `${Math.max(2, pct)}%` } : undefined}
				/>
			</div>
		</div>
	);
}

function useRetimeCommit(element: Retimable, trackId: string) {
	const editor = useEditor();
	const span = useMemo(
		() => getSourceTimeAtClipTime({ clipTime: element.duration, retime: element.retime, duration: element.duration }),
		[element.duration, element.retime],
	);
	const build = (curve: SpeedCurve | null, base: RetimeConfig | undefined = element.retime): RetimeConfig | undefined => {
		if (!curve) {
			// Back to a constant speed: keep the average, so the clip keeps its length.
			const rate = base?.rate ?? 1;
			if (Math.abs(rate - 1) < 1e-6 && !base?.smooth) return undefined;
			return { rate, maintainPitch: base?.maintainPitch ?? true, smooth: base?.smooth };
		}
		return { mode: "curve", curve, rate: getCurveTable(curve).rate, maintainPitch: base?.maintainPitch ?? true, smooth: base?.smooth };
	};
	const preview = (curve: SpeedCurve) => {
		const retime = build(curve);
		const rate = retime?.rate ?? 1;
		editor.timeline.previewElements({
			updates: [{ trackId, elementId: element.id, updates: { retime, duration: roundMediaTime({ time: span / rate }) } }],
		});
	};
	const commit = (retime: RetimeConfig | undefined) => {
		editor.timeline.discardPreview();
		editor.timeline.updateElementRetime({ trackId, elementId: element.id, retime });
	};
	return { build, preview, commit, span };
}

/** Speed ramp: None (constant) or a curve preset / custom curve with live preview and a duration readout. */
export function SpeedRampSection({ element, trackId, inline = false }: { element: Retimable; trackId: string; inline?: boolean }) {
	const { build, preview, commit, span } = useRetimeCommit(element, trackId);
	const retime = element.retime;
	const curve = retime?.mode === "curve" && retime.curve ? retime.curve : null;
	const playhead = useEditor((e) => e.playback.getCurrentTime(), ["playback"]);
	const table = curve ? getCurveTable(curve) : null;
	const u = (playhead - element.startTime) / Math.max(1, element.duration);
	const playheadFraction = table && u >= 0 && u <= 1 ? Math.min(1, Math.max(0, getSourceTimeAtClipTime({ clipTime: u * element.duration, retime, duration: element.duration }) / Math.max(1, span))) : null;
	const sourceSeconds = secs(span);

	const pick = (preset: SpeedCurvePresetId | "none") => {
		if (preset === "none") return commit(build(null, curve ? { ...retime!, rate: 1 } : retime));
		commit(build(buildCurve(preset)));
	};

	const body = (
			<div className="flex flex-col gap-2" data-motion-section="speed-ramp">
				<button
					type="button"
					data-speed-preset="none"
					aria-pressed={!curve}
					onClick={() => pick("none")}
					className={cn(
						"h-7 rounded-md border text-xs",
						!curve ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:bg-accent",
					)}
				>
					{inline ? "Constant" : "None — constant speed"}
				</button>
				<SpeedCurvePresets value={curve?.preset ?? null} onPick={pick} />
				{curve && table && (
					<>
						<SpeedCurveEditor curve={curve} playhead={playheadFraction} onPreview={preview} onCommit={(c) => commit(build(c))} />
						<div className="text-muted-foreground flex justify-between text-[11px]" data-speed-duration>
							<span>
								{fmt(sourceSeconds)} → <span className="text-foreground">{fmt(sourceSeconds * table.k)}</span>
							</span>
							<span>
								{table.minSpeed.toFixed(2)}× – {table.maxSpeed.toFixed(1)}×
							</span>
						</div>
						{!inline && <InspectorRow label="Keep pitch" hint="Voices keep their pitch while the speed changes">
							<div className="flex justify-end">
								<Switch
									aria-label="Keep pitch"
									checked={retime?.maintainPitch ?? true}
									onCheckedChange={(on) => commit({ ...(build(curve) as RetimeConfig), maintainPitch: on })}
								/>
							</div>
						</InspectorRow>}
					</>
				)}
			</div>
	);
	if (inline) return body;
	return (
		<InspectorGroup id="motion.speed-ramp" title="Speed ramp" defaultOpen>
			{body}
		</InspectorGroup>
	);
}

/** Optical flow: smooth slow motion. Renders the in-between frames once (Apple frame interpolation), with progress. */
export function OpticalFlowSection({ element, trackId, inline = false }: { element: VideoElement; trackId: string; inline?: boolean }) {
	const editor = useEditor();
	const assets = useEditor((e) => e.media.getAssets(), ["media"]);
	const jobs = useMotionStore((s) => s.jobs);
	const job = jobFor(jobs, element.id, "smooth");
	const on = !!element.retime?.smooth;
	const factor = smoothFactorFor(element.retime);
	const missing = useMemo(() => missingSmooth(element, assets), [element, assets]);
	const skipped = useMotionStore((s) => s.skipped[element.id]);
	const isSkipped = !!missing && skipped === smoothNeedKey(missing);
	const timer = useRef<number | null>(null);

	// Render (again) when it's on and the file for this speed/range is missing — a moment after the last change.
	// biome-ignore lint/correctness/useExhaustiveDependencies: compares the missing range by value: the object is new on every render
	useEffect(() => {
		if (!on || !missing || isSkipped || job?.status === "error" || job?.status === "running") {
			// A running render for an older speed/range is replaced right away.
			if (on && missing && job?.status === "running") void renderSmooth(element.id);
			return;
		}
		if (timer.current) window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => void renderSmooth(element.id), 700);
		return () => {
			if (timer.current) window.clearTimeout(timer.current);
		};
	}, [on, missing?.factor, missing?.a, missing?.b, element.id, job?.status, isSkipped]);

	const toggle = (value: boolean) => {
		const retime: RetimeConfig = { ...(element.retime ?? { rate: 1, maintainPitch: true }), smooth: value };
		useMotionStore.getState().setSkipped(element.id, null);
		editor.timeline.updateElementRetime({ trackId, elementId: element.id, retime });
		if (!value) {
			const running = jobFor(useMotionStore.getState().jobs, element.id, "smooth");
			if (running?.status === "running") (running.stop ?? running.cancel)?.();
			else if (running) useMotionStore.getState().removeJob(running.key);
		}
	};

	let status: string;
	if (!on) status = "Off — slow motion repeats frames";
	else if (factor <= 1) status = "Slow the clip down (below 1×) to use it";
	else if (job?.status === "running") status = "";
	else if (missing && isSkipped) status = "Cancelled — plays without optical flow. Turn it off and on to render.";
	else if (missing) status = "Waiting to render…";
	else status = `Ready — ${factor >= 10 ? factor.toFixed(0) : factor.toFixed(1)}× more frames, plays in real time`;

	const hint = "Smooth slow motion: new in-between frames, rendered once on this Mac; the original clip is kept";
	if (inline) {
		const busy = job?.status === "running";
		return (
			<div className="flex flex-col gap-1" data-motion-section="optical-flow">
				<InspectorRow rowId="speed.smooth" label="Optical flow" hint={hint} inline>
					<Switch aria-label="Optical flow" title={on && factor <= 1 ? "Works on slow motion: slow the clip down (below 1×)" : hint} data-motion-smooth checked={on} onCheckedChange={toggle} />
				</InspectorRow>
				{(busy || job?.status === "error") && <MotionJobLine job={job} onRetry={() => void renderSmooth(element.id)} />}
			</div>
		);
	}
	return (
		<InspectorGroup
			id="motion.optical-flow"
			title="Optical flow"
			trailing={<Switch aria-label="Smooth slow motion (optical flow)" title={hint} data-motion-smooth checked={on} onCheckedChange={toggle} />}
		>
			<div className="flex flex-col gap-2" data-motion-section="optical-flow">
				{status && (
					<p className="text-xs" data-motion-smooth-status>
						{status}
					</p>
				)}
				<MotionJobLine job={job} onRetry={() => void renderSmooth(element.id)} />
			</div>
		</InspectorGroup>
	);
}

/** Reverse: plays the clip backwards (picture and sound) from a reversed copy rendered once. */
export function ReverseSection({ element, inline = false }: { element: VideoElement; trackId: string; inline?: boolean }) {
	const jobs = useMotionStore((s) => s.jobs);
	const job = jobFor(jobs, element.id, "reverse");
	const on = !!element.reversed;
	const busy = job?.status === "running";
	const hint = on ? "Playing backwards; off brings the original back" : "Plays the clip backwards, picture and sound; the original is kept";
	if (inline) {
		return (
			<div className="flex flex-col gap-1" data-motion-section="reverse">
				<InspectorRow rowId="speed.reverse" label="Reverse" hint={hint} inline>
					<Switch aria-label="Reverse" title={hint} data-motion-reverse checked={on || busy} disabled={busy} onCheckedChange={() => void toggleReverse(element.id)} />
				</InspectorRow>
				{(busy || job?.status === "error") && <MotionJobLine job={job} onRetry={() => void toggleReverse(element.id)} />}
			</div>
		);
	}
	return (
		<InspectorGroup
			id="motion.reverse"
			title="Reverse"
			trailing={
				<Switch aria-label="Reverse" title={hint} data-motion-reverse checked={on || busy} disabled={busy} onCheckedChange={() => void toggleReverse(element.id)} />
			}
		>
			<div className="flex flex-col gap-2" data-motion-section="reverse">
				<MotionJobLine job={job} onRetry={() => void toggleReverse(element.id)} />
			</div>
		</InspectorGroup>
	);
}
