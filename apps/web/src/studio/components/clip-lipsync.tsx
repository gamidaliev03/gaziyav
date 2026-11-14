"use client";

// The clip's own lipsync marks on the timeline (lip3; the charter's rules D, F, G, M). The run's progress itself is
// the craft Job on the clip (jobs/components/clip-progress.tsx, fed by jobs/studio-source.ts); here, top-right, small
// and wordless: × stops a run (or takes it out of the line), a clock = waiting for a slot, «!» = it failed (its one
// sentence and «Повторить» a click away), the takes glyph (original ↔ lipsynced, ⇧⌥L), and «губы устарели» with
// «Переделать» and its price. On a narrow clip only a 2 px line of colour remains. Nothing for a clip with none of it.
import { useEffect, useMemo, useState } from "react";
import { bindAction } from "@/actions/registry";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import { preflight, speakAndLipsync } from "../client/actions";
import { cents } from "../client/money";
import { isStale } from "../client/stale";
import { type Run, useStudioStore } from "../client/studio-store";
import { flipTake, showTake, takeFits, takeIsStale, takesOf, useTakesStore } from "../client/takes";
import { openLipsync } from "./lipsync-inspector";
import { runError } from "./run-status";

const stop = (e: React.SyntheticEvent) => e.stopPropagation();
const guard = { onMouseDown: stop, onPointerDown: stop, onClick: stop, onDoubleClick: stop };

/** The clip's lipsync run worth a mark: the lipsync, or the voice of «voice → lipsync» while it is the stage. */
function pickRun(s: { clipRuns: Record<string, Run> }, key: string): Run | undefined {
	const lip = s.clipRuns[`lipsync|${key}`];
	const voice = s.clipRuns[`voiceover|${key}`];
	const live = (r?: Run) => !!r && !r.done && !/^(cancell?ed|Отменено)\.?$/i.test(r.error ?? "");
	if (live(lip)) return lip;
	if (voice?.chain && live(voice)) return voice;
	return undefined;
}

export function ClipLipsync({ trackId, elementId }: { trackId: string; elementId: string }) {
	const projectId = useEditor((e) => e.project.getActiveOrNull()?.metadata.id ?? "", ["project"]);
	const key = `${projectId}|${elementId}`;
	const run = useStudioStore((s) => pickRun(s, key));
	const linked = useTakesStore((s) => !!s.clips[key]);
	if (!run && !linked) return null;
	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden" data-clip-lip={key}>
			{run && <RunMark run={run} projectId={projectId} elementId={elementId} />}
			{linked && <TakeMarks trackId={trackId} projectId={projectId} elementId={elementId} shift={!!run} />}
		</div>
	);
}

const glyph = "pointer-events-auto flex size-3.5 items-center justify-center rounded-[3px] bg-black/55 text-[9px] leading-none text-white/90 hover:bg-black/75 group-data-[narrow]/clip:hidden";

function RunMark({ run, projectId, elementId }: { run: Run; projectId: string; elementId: string }) {
	const t = useT();
	const failed = !!run.error;
	if (!failed) {
		const queued = run.queued != null;
		return (
			<div className="absolute top-0.5 right-0.5 flex gap-0.5">
				{queued && (
					<span className={glyph} data-clip-lip-queued={run.queued} title={t("Waiting for a free slot")} aria-label={t("Waiting for a free slot")}>
						<svg viewBox="0 0 10 10" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
							<circle cx="5" cy="5" r="3.8" />
							<path d="M5 2.8V5l1.5 1" />
						</svg>
					</span>
				)}
				<button type="button" tabIndex={-1} className={`${glyph} opacity-0 group-hover/clip:opacity-100 focus:opacity-100`} data-clip-lip-stop="" title={t("Stop")} aria-label={t("Stop")} {...guard} onClick={(e) => (stop(e), run.cancel?.())}>
					×
				</button>
			</div>
		);
	}
	return (
		<>
			<div className="absolute inset-x-0 top-0 hidden h-0.5 bg-red-500/80 group-data-[narrow]/clip:block" />
			<div className="absolute top-0.5 right-0.5">
				<Popover>
					<PopoverTrigger asChild>
						<button type="button" tabIndex={-1} className={`${glyph} bg-red-600/80 hover:bg-red-600`} data-clip-lip-failed="" aria-label={t("Lipsync failed")} {...guard}>
							!
						</button>
					</PopoverTrigger>
					<PopoverContent className="w-64 p-3 text-xs" side="top" align="end" {...guard} data-clip-lip-pop="failed">
						<p className="mb-2 leading-snug" data-clip-lip-error="">
							{runError(run)}
						</p>
						<div className="flex justify-end gap-2">
							<button type="button" className="rounded px-2 py-1 text-muted-foreground hover:bg-accent" onClick={() => useStudioStore.getState().setRun(run.kind, undefined, run.key)}>
								{t("Hide")}
							</button>
							<button
								type="button"
								className="rounded bg-primary px-2 py-1 text-primary-foreground hover:opacity-90"
								data-clip-lip-retry=""
								onClick={() => void speakAndLipsync(EditorCore.getInstance(), projectId, elementId)}
							>
								{t("Retry")}
							</button>
						</div>
					</PopoverContent>
				</Popover>
			</div>
		</>
	);
}

function TakeMarks({ trackId, projectId, elementId, shift }: { trackId: string; projectId: string; elementId: string; shift: boolean }) {
	const t = useT();
	// re-read on every timeline change (undo included) and on the clip's voice changing
	const tracks = useEditor((e) => e.scenes.getActiveSceneOrNull()?.tracks, ["timeline", "scenes"]);
	const voice = useStudioStore((s) => `${s.drafts[`${projectId}|${elementId}`]?.voice ?? ""}|${s.drafts[`${projectId}|${elementId}`]?.speech?.fileId ?? ""}`);
	const groups = useTakesStore((s) => s.groups);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the inputs are what the takes are read from
	const state = useMemo(() => {
		const editor = EditorCore.getInstance();
		const info = takesOf(editor, projectId, elementId);
		return info
			? { count: info.group.takes.length, shown: info.shown, stale: takeIsStale(editor, projectId, elementId, isStale), fits: Array.from({ length: info.group.takes.length + 1 }, (_, i) => takeFits(editor, projectId, elementId, i)) }
			: null;
	}, [tracks, voice, groups, projectId, elementId]);
	if (!state) return null;
	return (
		<>
			{state.stale && <div className="absolute inset-x-0 top-0 hidden h-0.5 bg-amber-400/90 group-data-[narrow]/clip:block" />}
			<div className={`absolute top-0.5 flex gap-0.5 ${shift ? "right-5" : "right-0.5"}`}>
				{state.stale && <StaleMark trackId={trackId} projectId={projectId} elementId={elementId} />}
				<Popover>
					<PopoverTrigger asChild>
						<button
							type="button"
							tabIndex={-1}
							className={`${glyph} ${state.shown ? "" : "text-white/60"}`}
							data-clip-takes={state.count + 1}
							data-clip-take-shown={state.shown}
							aria-label={t("Takes")}
							{...guard}
						>
							<svg viewBox="0 0 10 10" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="1.1" aria-hidden="true">
								<rect x="1" y="3.2" width="6" height="5.3" rx="0.8" />
								<path d="M3 1.5h5.2a.8.8 0 0 1 .8.8v4.5" />
							</svg>
						</button>
					</PopoverTrigger>
					<PopoverContent className="w-44 p-1 text-xs" side="top" align="end" {...guard} data-clip-lip-pop="takes">
						{Array.from({ length: state.count + 1 }, (_, i) => (
							<button
								key={i}
								type="button"
								data-clip-take={i}
								disabled={i !== state.shown && !state.fits[i]}
								title={i !== state.shown && !state.fits[i] ? t("This take is shorter than the clip") : undefined}
								className={`flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent ${i === state.shown ? "font-medium text-foreground" : "text-muted-foreground"}`}
								onClick={() => showTake(EditorCore.getInstance(), projectId, elementId, i)}
							>
								<span>{i === 0 ? t("Original") : t("Take {n}", { n: i })}</span>
								{i === state.shown && <span aria-hidden="true">•</span>}
							</button>
						))}
					</PopoverContent>
				</Popover>
			</div>
		</>
	);
}

function StaleMark({ trackId, projectId, elementId }: { trackId: string; projectId: string; elementId: string }) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [usd, setUsd] = useState<number | null>(null);
	// the price first: the pre-flight of this clip as it is now (nothing is sent for it)
	useEffect(() => {
		if (!open) return;
		setUsd(null);
		const ac = new AbortController();
		preflight(EditorCore.getInstance(), projectId, ac.signal, elementId)
			.then((pf) => !ac.signal.aborted && setUsd((pf as { total?: number } | null)?.total ?? null))
			.catch(() => {});
		return () => ac.abort();
	}, [open, projectId, elementId]);
	const redo = () => {
		setOpen(false);
		const limit = useStudioStore.getState().confirmAbove;
		// above the spending limit the panel asks (its one dialog); under it the button with the price is the consent
		if (usd != null && usd > limit + 1e-9) openLipsync({ trackId, elementId });
		else void speakAndLipsync(EditorCore.getInstance(), projectId, elementId, usd != null ? { agreedUsd: usd } : {});
	};
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button type="button" tabIndex={-1} className={`${glyph} bg-amber-500/85 text-black hover:bg-amber-500`} data-clip-lip-stale="" aria-label={t("Lips are out of date")} {...guard}>
					<svg viewBox="0 0 10 10" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
						<path d="M1.5 5.2c1.2-1.6 5.8-1.6 7 0-1.2 1.8-5.8 1.8-7 0Z" />
						<path d="M1.5 5.2h7" />
					</svg>
				</button>
			</PopoverTrigger>
			<PopoverContent className="w-56 p-3 text-xs" side="top" align="end" {...guard} data-clip-lip-pop="stale">
				<p className="mb-2">{t("Lips are out of date")}</p>
				<div className="flex justify-end">
					<button
						type="button"
						disabled={usd == null}
						className="rounded bg-primary px-2 py-1 text-primary-foreground tabular-nums hover:opacity-90 disabled:opacity-50"
						data-clip-lip-redo=""
						data-usd={usd ?? undefined}
						onClick={redo}
					>
						{usd == null ? t("Redo the lipsync") : `${t("Redo the lipsync")} · ${cents(usd)}`}
					</button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

/** ⇧⌥L and the clip's menu: the selected clip flips original ↔ the newest lipsynced take, in place, one ⌘Z. */
export function flipSelectedTake(): boolean {
	const editor = EditorCore.getInstance();
	const projectId = editor.project.getActiveOrNull()?.metadata.id;
	if (!projectId) return false;
	for (const s of editor.selection.getSelectedElements()) if (flipTake(editor, projectId, s.elementId)) return true;
	return false;
}

bindAction("lipsync-take-flip", () => {
	flipSelectedTake();
});
