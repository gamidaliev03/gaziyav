"use client";

// Loudness where the level meter is (timeline/components/level-meter.tsx), the quiet way: one number above the bars
// — the short-term loudness while the film plays, the whole timeline's integrated loudness at rest — and a thin bar
// of the momentary loudness with a tick at the target. A click opens the numbers a professional checks (integrated,
// short-term, momentary, true peak, range), the target by destination, and «Bring to target».
//
// The live numbers are written straight into the DOM ten times a second (no React render per reading).
import { Alert02Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/ui/segmented";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import { meterFraction } from "@/media/level-meter";
import { TICKS_PER_SECOND } from "@/wasm";
import { cn } from "@/utils/ui";
import { isBringing, resetMaster, runBringToTarget } from "../actions";
import { cancelBringToTarget } from "../bring";
import { type LiveReading, liveLoudness } from "../live";
import { isNoMaster, masterOf } from "../master";
import { type FreshMeasure, cancelMeasure, freshMeasure, measureTimeline, useTimelineLoudness } from "../measure";
import { setTarget, useTarget } from "../target-pref";
import { DESTINATIONS, TARGET_MAX, TARGET_MIN, ceilingFor, formatDelta, formatLufs, formatTarget, isDestination, isOnTarget } from "../targets";
import { Ring, Seal } from "../ui";
import { useSoundUi } from "../ui-store";
import "../diagnostics";

/** Timelines up to this long are measured as soon as the numbers are opened; longer ones wait for the button. */
const AUTO_MEASURE_SECONDS = 300;
/** After an edit the «whole timeline» number is checked again this long after the edits stop. */
const STALE_CHECK_MS = 500;

/** The unit, the same in every language. */
const LUFS = "LUFS";


/** The last whole-timeline measure while it still describes the timeline (checked a moment after edits stop). */
function useFreshMeasure(): FreshMeasure | null {
	const editor = useEditor();
	const result = useTimelineLoudness((s) => s.result);
	const [fresh, setFresh] = useState<FreshMeasure | null>(null);
	useEffect(() => {
		if (!result) {
			setFresh(null);
			return;
		}
		let timer: ReturnType<typeof setTimeout> | null = null;
		const check = () => {
			timer = null;
			setFresh(freshMeasure(editor, result));
		};
		const soon = () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(check, STALE_CHECK_MS);
		};
		check();
		const off = [editor.timeline.subscribe(soon), editor.scenes.subscribe(soon)];
		return () => {
			if (timer) clearTimeout(timer);
			for (const stop of off) stop();
		};
	}, [editor, result]);
	return fresh;
}

/** The number above the bars; the whole header cell is its button. */
export function LoudnessReadout() {
	const editor = useEditor();
	const t = useT();
	const target = useTarget();
	const fresh = useFreshMeasure();
	const open = useSoundUi((s) => s.loudnessOpen);
	const setOpen = useSoundUi((s) => s.setLoudnessOpen);
	const letterRef = useRef<HTMLSpanElement>(null);
	const valueRef = useRef<HTMLSpanElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const restRef = useRef({ fresh, target });
	restRef.current = { fresh, target };
	const paintRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		const live = liveLoudness(editor);
		const release = live.want();
		let shown = "";
		const paint = () => {
			const button = buttonRef.current;
			const letter = letterRef.current;
			const value = valueRef.current;
			if (!button || !letter || !value) return;
			const reading = live.reading();
			const rest = restRef.current;
			let mark = "";
			let text = "";
			let state = "idle";
			if (reading.running && reading.seconds > 0) {
				// short-term once three seconds have played, momentary until then
				const short = Number.isFinite(reading.shortTerm);
				mark = short ? "S" : "M";
				text = formatLufs(short ? reading.shortTerm : reading.momentary);
				state = "live";
			} else if (rest.fresh) {
				mark = "I";
				text = formatLufs(rest.fresh.now.integrated);
				state = isOnTarget(rest.fresh.now.integrated, rest.target) ? "on-target" : "whole";
			} else if (reading.seconds >= 3 && Number.isFinite(reading.integrated)) {
				mark = "I";
				text = formatLufs(reading.integrated);
				state = "played";
			}
			const next = `${state}|${mark}|${text}`;
			if (next === shown) return;
			shown = next;
			letter.textContent = mark;
			value.textContent = text || LUFS;
			button.dataset.state = state;
		};
		const off = live.subscribe(paint);
		paintRef.current = paint;
		paint();
		return () => {
			off();
			paintRef.current = null;
			release();
		};
	}, [editor]);
	// at rest the number follows the measure and the target
	// biome-ignore lint/correctness/useExhaustiveDependencies: repaint when what the rest state reads changes
	useEffect(() => paintRef.current?.(), [fresh, target]);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					ref={buttonRef}
					type="button"
					data-loudness-readout=""
					data-state="idle"
					aria-label={t("Loudness")}
					title={t("Loudness (LUFS): short-term while playing, the whole timeline at rest. Click for the numbers and the target.")}
					className="hover:bg-accent/60 focus-visible:ring-ring group absolute inset-0 flex cursor-pointer items-start justify-center rounded-[4px] pt-1 outline-hidden focus-visible:ring-1"
				>
					<span className="text-foreground/85 group-data-[state=idle]:text-muted-foreground group-data-[state=on-target]:text-constructive flex items-baseline gap-[2px] text-[9px] leading-[14px] font-medium tabular-nums">
						<span ref={letterRef} className="text-muted-foreground text-[8px] font-normal empty:hidden" />
						<span ref={valueRef}>{LUFS}</span>
					</span>
				</button>
			</PopoverTrigger>
			<PopoverContent side="left" align="start" sideOffset={6} collisionPadding={8} className="w-[344px] p-0" data-loudness-panel="">
				<LoudnessPanel fresh={fresh} close={() => setOpen(false)} />
			</PopoverContent>
		</Popover>
	);
}

/** The momentary loudness as a thin bar on the meter's own scale, and a tick where the target is. */
export function LoudnessBar({ top, bottom }: { top: number; bottom: number }) {
	const editor = useEditor();
	const target = useTarget();
	const fillRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const live = liveLoudness(editor);
		const release = live.want();
		let shown = -1;
		const paint = () => {
			const fill = fillRef.current;
			if (!fill) return;
			const reading = live.reading();
			const fraction = reading.running ? meterFraction(reading.momentary) : 0;
			const rounded = Math.round(fraction * 1000) / 1000;
			if (rounded === shown) return;
			shown = rounded;
			fill.style.transform = `scaleY(${rounded})`;
		};
		const off = live.subscribe(paint);
		paint();
		return () => {
			off();
			release();
		};
	}, [editor]);
	return (
		<div aria-hidden data-loudness-bar="" className="pointer-events-none absolute right-[3px] w-[3px]" style={{ top, bottom }}>
			<div className="bg-foreground/[0.07] absolute inset-0 rounded-[1.5px]" />
			<div ref={fillRef} className="bg-foreground/60 absolute inset-0 origin-bottom rounded-[1.5px] transition-transform duration-100 ease-linear" style={{ transform: "scaleY(0)" }} />
			{/* the target: where the bar should sit */}
			<div data-loudness-target-tick="" className="bg-foreground absolute -left-[2px] h-px w-[7px]" style={{ bottom: `${meterFraction(target) * 100}%` }} />
		</div>
	);
}

function useLive(): LiveReading {
	const editor = useEditor();
	const live = liveLoudness(editor);
	useEffect(() => live.want(), [live]);
	return useSyncExternalStore(
		(listener) => live.subscribe(listener),
		() => live.reading(),
		() => live.reading(),
	);
}

function Stat({ id, label, value, unit, tone }: { id: string; label: string; value: string; unit?: string; tone?: "warn" | "good" }) {
	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<span className="text-muted-foreground truncate text-[11px]">{label}</span>
			<span data-loudness-stat={id} className={cn("text-[13px] font-medium tabular-nums", tone === "warn" && "text-caution", tone === "good" && "text-constructive")}>
				{value}
				{unit && <span className="text-muted-foreground ml-1 text-[11px] font-normal">{unit}</span>}
			</span>
		</div>
	);
}

function TargetPicker() {
	const t = useT();
	const target = useTarget();
	const [custom, setCustom] = useState(!isDestination(target));
	const [draft, setDraft] = useState<string | null>(null);
	const value = custom || !isDestination(target) ? "custom" : String(target);
	const commit = () => {
		if (draft === null) return;
		const n = Number(draft.replace(",", ".").replace("−", "-"));
		setDraft(null);
		if (!Number.isFinite(n) || n === 0) return;
		// «18» means −18: nobody aims above full scale
		setTarget(-Math.abs(n));
	};
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex flex-col gap-1.5">
				<span className="text-muted-foreground text-[11px]">{t("Target by destination")}</span>
				<Segmented
					aria-label={t("Loudness target")}
					value={value}
					onValueChange={(next) => {
						if (next === "custom") setCustom(true);
						else {
							setCustom(false);
							setTarget(Number(next));
						}
					}}
					items={[...DESTINATIONS.map((d) => ({ value: String(d.value), label: `${t(d.label)} ${formatTarget(d.value)}`, title: t(d.hint) })), { value: "custom", label: t("Custom"), title: t("Any level from −36 to −6 LUFS") }]}
					itemProps={(id) => ({ "data-loudness-target": id })}
				/>
			</div>
			{value === "custom" && (
				<label className="flex items-center justify-end gap-2">
					<span className="text-muted-foreground text-[11px]">{t("Your target")}</span>
					<input
						data-loudness-custom=""
						inputMode="decimal"
						aria-label={t("Your target, LUFS")}
						value={draft ?? formatTarget(target)}
						onChange={(event) => setDraft(event.target.value)}
						onFocus={(event) => event.target.select()}
						onBlur={commit}
						onKeyDown={(event) => {
							event.stopPropagation();
							if (event.key === "Enter") (event.target as HTMLInputElement).blur();
							else if (event.key === "Escape") {
								setDraft(null);
								(event.target as HTMLInputElement).blur();
							} else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
								event.preventDefault();
								setDraft(null);
								setTarget(Math.min(TARGET_MAX, Math.max(TARGET_MIN, target + (event.key === "ArrowUp" ? 0.5 : -0.5))));
							}
						}}
						className="border-border bg-accent focus-visible:ring-ring h-6 w-14 rounded-md border px-1.5 text-right text-xs tabular-nums outline-hidden focus-visible:ring-1"
					/>
					<span className="text-muted-foreground text-[11px]">{LUFS}</span>
				</label>
			)}
		</div>
	);
}

function LoudnessPanel({ fresh, close }: { fresh: FreshMeasure | null; close: () => void }) {
	const editor = useEditor();
	const t = useT();
	const target = useTarget();
	const live = useLive();
	const progress = useTimelineLoudness((s) => s.progress);
	const stage = useTimelineLoudness((s) => s.stage);
	const error = useTimelineLoudness((s) => s.error);
	const stale = useTimelineLoudness((s) => !!s.result) && !fresh;
	const master = useEditor((e) => masterOf(e.scenes.getActiveSceneOrNull()?.tracks), ["timeline", "scenes"]);
	const seconds = useEditor((e) => e.timeline.getTotalDuration() / TICKS_PER_SECOND, ["timeline", "scenes"]);
	const [bringing, setBringing] = useState(isBringing());
	const busy = progress !== null;
	const ceiling = ceilingFor(target);

	// Opened with nothing measured: a short timeline is measured at once, a long one waits for the button.
	const asked = useRef(false);
	useEffect(() => {
		if (asked.current || fresh || busy) return;
		asked.current = true;
		if (seconds > 0 && seconds <= AUTO_MEASURE_SECONDS && !editor.playback.getIsPlaying()) void measureTimeline(editor).catch(() => {});
	}, [editor, fresh, busy, seconds]);

	const now = fresh?.now ?? null;
	const off = now && Number.isFinite(now.integrated) ? now.integrated - target : null;
	const onTarget = now ? isOnTarget(now.integrated, target) : false;
	const over = now ? now.truePeakDb > ceiling + 0.05 : false;
	const bring = async () => {
		setBringing(true);
		try {
			await runBringToTarget(editor);
		} finally {
			setBringing(false);
		}
	};

	return (
		<div className="flex flex-col text-xs">
			<div className="flex flex-col gap-2.5 px-3 pt-3 pb-2.5">
				<span className="text-[13px] font-medium">{t("Loudness")}</span>
				<TargetPicker />
			</div>

			<div className="flex flex-col gap-2 border-t px-3 py-2.5" data-loudness-whole="">
				<div className="flex h-6 items-center justify-between gap-2">
					<span className="text-muted-foreground text-[11px]">{t("Whole timeline")}</span>
					{!busy && seconds > 0 && (
						<Button variant="ghost" size="sm" className="h-6 px-2 text-xs" data-loudness-measure="" onClick={() => void measureTimeline(editor, { force: true }).catch(() => {})}>
							{now ? t("Measure again") : t("Measure")}
						</Button>
					)}
				</div>
				{busy ? (
					<div className="flex h-9 items-center gap-2" data-loudness-busy="">
						<Ring progress={progress ?? 0} />
						<span className="min-w-0 flex-1 truncate">
							{t(stage || "Mixing the timeline")} · <span className="tabular-nums">{Math.round((progress ?? 0) * 100)} %</span>
						</span>
						<Button
							variant="ghost"
							size="sm"
							className="h-6 px-2 text-xs"
							data-loudness-cancel=""
							onClick={() => {
								cancelMeasure();
								cancelBringToTarget();
							}}
						>
							{t("Cancel")}
						</Button>
					</div>
				) : now ? (
					<>
						<div className="flex items-baseline gap-2">
							<span data-loudness-stat="integrated" className={cn("text-[17px] leading-6 font-semibold tabular-nums", onTarget && "text-constructive")}>
								{formatLufs(now.integrated)}
							</span>
							<span className="text-muted-foreground text-[11px]">{LUFS}</span>
							<span data-loudness-off="" className="text-muted-foreground ml-auto flex items-center gap-1 text-[11px]">
								{onTarget ? (
									<>
										<HugeiconsIcon icon={CheckmarkCircle02Icon} className="text-constructive size-3.5" />
										{t("On target")}
									</>
								) : off !== null ? (
									off > 0 ? (
										t("{n} LU over the target", { n: formatDelta(off).replace("+", "") })
									) : (
										t("{n} LU under the target", { n: formatDelta(off).replace("−", "") })
									)
								) : (
									t("Silent")
								)}
							</span>
						</div>
						<div className="grid grid-cols-3 gap-2">
							<Stat id="truePeak" label={t("True peak")} value={formatLufs(now.truePeakDb)} unit="dBTP" tone={over ? "warn" : undefined} />
							<Stat id="shortTermMax" label={t("Loudest 3 s")} value={formatLufs(now.shortTermMax)} unit={LUFS} />
							<Stat id="range" label={t("Range")} value={now.range.toFixed(1)} unit="LU" />
						</div>
						{over && (
							<span className="text-caution flex items-center gap-1 text-[11px]" data-loudness-over="">
								<HugeiconsIcon icon={Alert02Icon} className="size-3.5 shrink-0" />
								{t("Peaks go over {tp} dBTP: the sound may clip after encoding.", { tp: formatTarget(ceiling) })}
							</span>
						)}
					</>
				) : (
					<span className="text-muted-foreground flex min-h-9 items-center text-[11px]" data-loudness-empty="">
						{error ? t(error) : seconds <= 0 ? t("The timeline is empty.") : stale ? t("The sound changed since it was measured.") : t("Not measured yet.")}
					</span>
				)}
				{!isNoMaster(master) && (
					<div className="flex h-6 items-center justify-between gap-2" data-loudness-master="">
						<span className="min-w-0 truncate">
							<span className="text-muted-foreground">{t("Master")}</span>{" "}
							<span className="tabular-nums">{formatDelta(master.gainDb)} dB</span>
							{master.ceilingDb !== undefined && <span className="text-muted-foreground"> · {t("limiter at {tp} dBTP", { tp: formatTarget(master.ceilingDb) })}</span>}
						</span>
						<Button variant="ghost" size="sm" className="h-6 shrink-0 px-2 text-xs" data-loudness-master-reset="" onClick={() => resetMaster(editor)}>
							{t("Reset")}
						</Button>
					</div>
				)}
			</div>

			<div className="flex flex-col gap-2 border-t px-3 py-2.5" data-loudness-live="">
				<div className="flex h-6 items-center justify-between gap-2">
					<span className="text-muted-foreground text-[11px]">{live.available ? t("While playing") : t("Live loudness is not available on this device.")}</span>
					{live.seconds > 0 && (
						<Button variant="ghost" size="sm" className="h-6 px-2 text-xs" data-loudness-reset="" onClick={() => liveLoudness(editor).reset()}>
							{t("Reset")}
						</Button>
					)}
				</div>
				<div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
					<Stat id="live-momentary" label={t("Momentary")} value={formatLufs(live.seconds > 0 ? live.momentary : null)} unit={LUFS} />
					<Stat id="live-shortTerm" label={t("Short-term")} value={formatLufs(live.seconds >= 3 ? live.shortTerm : null)} unit={LUFS} />
					<Stat id="live-integrated" label={t("Integrated")} value={formatLufs(live.seconds > 0 ? live.integrated : null)} unit={LUFS} tone={live.seconds >= 3 && isOnTarget(live.integrated, target) ? "good" : undefined} />
					<Stat id="live-truePeak" label={t("True peak")} value={formatLufs(live.seconds > 0 ? live.truePeakDb : null)} unit="dBTP" tone={live.seconds > 0 && live.truePeakDb > ceiling + 0.05 ? "warn" : undefined} />
				</div>
			</div>

			<div className="flex items-center justify-between gap-2 border-t px-3 py-2.5">
				<Seal />
				<Button
					size="sm"
					className="h-7 px-3 text-xs"
					data-loudness-bring=""
					disabled={busy || bringing || seconds <= 0}
					title={t("Sets the master so the whole timeline is at the target; a limiter only if the peaks need it. One ⌘Z takes it back.")}
					onClick={() => {
						void bring();
						if (seconds > AUTO_MEASURE_SECONDS) close();
					}}
				>
					{t("Bring to {target} LUFS", { target: formatTarget(target) })}
				</Button>
			</div>
		</div>
	);
}
