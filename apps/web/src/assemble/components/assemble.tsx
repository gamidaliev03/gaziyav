"use client";

// The face of «Assemble» (docs/design/for-assemble.md): the header button that never changes width, the one-screen
// sheet, and one card over the inspector that shows the same StepList as the sheet — what will happen (plan), what is
// happening (run), what was done (done, each step undoable) — plus the empty timeline's hint and the start page's
// first action.
import {
	Add01Icon,
	Alert02Icon,
	RedoIcon,
	BubbleChatIcon,
	Cancel01Icon,
	ComputerVideoIcon,
	Film01Icon,
	Image02Icon,
	Mic01Icon,
	ScissorIcon,
	SmartPhone01Icon,
	AiMagicIcon,
	Tick02Icon,
	UndoIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@/components/ui/icon";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { Button } from "@/components/ui/button";
import { chipClass } from "@/components/ui/chips";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { useEditor } from "@/editor/use-editor";
import { useLang, useT } from "@/i18n";
import { RU_ASSEMBLE_NAMES } from "@/i18n/ru-assemble";
import { cn } from "@/utils/ui";
import { clock } from "../cut";
import { type AssembleOptions, type Frame, type KindId, KINDS, kindOf, type LengthMode, MOODS, optionsFor, stepsFor } from "../kinds";
import { applyFix, cancelAssemble, historyId, runAssemble, toggleStep, undoAll } from "../run";
import { askSheetOnOpen, takeSheetOnOpen, useAssembleStore } from "../store";

const ICONS: Record<KindId, IconSvgElement> = { talking: Mic01Icon, interview: BubbleChatIcon, reel: SmartPhone01Icon, clip: ScissorIcon, tutorial: ComputerVideoIcon, story: Image02Icon, documentary: Film01Icon };

const usable = (a: { ephemeral?: boolean; motionProxy?: unknown; editingOriginalOf?: unknown }) => !a.ephemeral && !a.motionProxy && !a.editingOriginalOf;
const useHasMedia = () => useEditor((e) => e.media.getAssets().some(usable), ["media"]);
const useMaterial = () =>
	useEditor(
		(e) => {
			const list = e.media.getAssets().filter(usable);
			return `${list.length}|${list.reduce((s, a) => s + (a.duration ?? 0), 0)}`;
		},
		["media"],
	);
/** Some media that can carry speech (a video or a sound): a talking kind needs one. */
const useHasSound = () => useEditor((e) => e.media.getAssets().some((a) => usable(a) && a.type !== "image"), ["media"]);
/** A check's or a mood's name in the interface language. */
const useName = () => {
	const ru = useLang((s) => s.lang) === "ru";
	return (en: string) => (ru ? (RU_ASSEMBLE_NAMES[en] ?? en) : en);
};
const useProjectId = () => useEditor((e) => e.project.getActiveOrNull()?.metadata.id ?? "", ["project"]);

/** A price before money is spent; nothing when it is free (the owner, 12.11: no «on this Mac · free» reassurance). */
export function Seal({ price }: { price?: string }) {
	if (!price) return null;
	return (
		<span className="text-muted-foreground flex items-center gap-1.5 text-[11px]" data-assemble-price>
			{price}
		</span>
	);
}

/** A 14 px progress ring (it fills, it does not spin). */
function Ring({ value }: { value: number }) {
	const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
	return (
		<span
			aria-hidden
			className="inline-block size-3.5 shrink-0 rounded-full"
			style={{ background: `conic-gradient(var(--primary) ${pct}%, var(--muted) 0)`, WebkitMask: "radial-gradient(circle, transparent 5px, #000 5px)", mask: "radial-gradient(circle, transparent 5px, #000 5px)" }}
		/>
	);
}

/** The percent shown changes at most four times a second. */
function useThrottled(value: number, ms = 250) {
	const [shown, setShown] = useState(value);
	const last = useRef(0);
	useEffect(() => {
		const wait = Math.max(0, ms - (Date.now() - last.current));
		const id = setTimeout(() => {
			last.current = Date.now();
			setShown(value);
		}, wait);
		return () => clearTimeout(id);
	}, [value, ms]);
	return shown;
}

/** The Assemble window. Kept for the module's own history only: the owner retired the feature (17.11), so nothing
 *  mounts this and no action, menu item or button opens it. */
export function AssembleMount() {
	return <AssembleHost />;
}

export function AssembleButton() {
	const t = useT();
	const running = useAssembleStore((s) => s.running);
	const result = useAssembleStore((s) => s.result);
	const ended = useAssembleStore((s) => s.ended);
	const stripOpen = useAssembleStore((s) => s.stripOpen);
	const seen = useAssembleStore((s) => s.seen);
	const projectId = useProjectId();
	const mine = !!result && result.projectId === projectId;
	const progress = useThrottled(running?.progress ?? 0);
	const click = () => {
		if (running || mine || ended) return useAssembleStore.setState({ stripOpen: !stripOpen, seen: true });
		useAssembleStore.setState({ open: true });
	};
	return (
		<>
			<Button
				variant="secondary"
				size="sm"
				className="relative h-[22px] w-[26px] rounded-[5px] px-0"
				data-assemble-button
				aria-label={t("Assemble")}
				title={running ? `${t("Assemble")} · ${Math.round(progress * 100)} %` : t("Assemble")}
				onClick={click}
			>
				<span className="relative grid size-3.5 place-items-center">
					{running ? <Ring value={progress} /> : <HugeiconsIcon icon={AiMagicIcon} className="size-3.5" />}
					{mine && !seen && !running && <span className="bg-primary absolute -top-0.5 -right-0.5 size-1.5 rounded-full" data-assemble-dot />}
				</span>
			</Button>
			<AssembleHost />
		</>
	);
}

function AssembleHost() {
	const open = useAssembleStore((s) => s.open);
	const hasMedia = useHasMedia();
	const projectId = useProjectId();
	// files given on the start page: the sheet opens as soon as they are in the project
	useEffect(() => {
		if (projectId && hasMedia && takeSheetOnOpen()) useAssembleStore.setState({ open: true });
	}, [projectId, hasMedia]);
	return (
		<>
			{open && <AssembleSheet />}
			<ResultCard />
		</>
	);
}

type Mode = "plan" | "run";

/** The steps of a choice: plan (numbers) or run (✓ done, ring on the current one, numbers waiting). */
function StepList({ steps, mode, current = -1, currentProgress }: { steps: Array<{ id: string; title: string }>; mode: Mode; current?: number; currentProgress?: number }) {
	const t = useT();
	return (
		<ol className="flex flex-col" data-assemble-plan={mode}>
			{steps.map((s, i) => {
				const done = mode === "run" && i < current;
				const now = mode === "run" && i === current;
				return (
					<li key={s.id} className="flex h-5 items-center gap-2 text-[12px]" data-step={s.id} data-state={done ? "done" : now ? "now" : "wait"}>
						{done ? (
							<HugeiconsIcon icon={Tick02Icon} className="text-constructive size-3.5 shrink-0" />
						) : now ? (
							<Ring value={currentProgress ?? 0.5} />
						) : (
							<span className="bg-foreground/[0.06] text-muted-foreground flex size-4 shrink-0 items-center justify-center rounded-full text-[10.5px] tabular-nums">{i + 1}</span>
						)}
						<span className={cn("min-w-0 truncate", now ? "text-foreground font-medium" : mode === "run" && !done ? "text-muted-foreground" : "text-foreground/85")}>{t(s.title)}</span>
						{now && currentProgress !== undefined && <span className="text-muted-foreground ml-auto text-[11px] tabular-nums">{Math.round(currentProgress * 100)} %</span>}
					</li>
				);
			})}
		</ol>
	);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex h-7 items-center gap-0">
			<span className="text-muted-foreground w-[104px] shrink-0 text-[12px]">{label}</span>
			<div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden">{children}</div>
		</div>
	);
}

export function AssembleSheet() {
	const t = useT();
	const name = useName();
	const last = useAssembleStore((s) => s.last);
	const hasMedia = useHasMedia();
	const [count, seconds] = useMaterial().split("|").map(Number);
	const [o, setO] = useState<AssembleOptions>(() => optionsFor(kindOf(last.kind), last));
	const kind = kindOf(o.kind);
	const set = (patch: Partial<AssembleOptions>) => setO((x) => ({ ...x, ...patch }));
	const steps = stepsFor(o).map((s) => (s.id === "music" && kind.lead === "speech" ? { ...s, title: "Music — quieter under speech" } : s));
	const speech = kind.lead === "speech";
	const hasSound = useHasSound();
	// unfit material is refused before the run, with the reason and the way out
	const unfit = hasMedia && speech && !hasSound;
	const cards = useRef<HTMLDivElement>(null);
	const close = () => useAssembleStore.setState({ open: false });
	const go = () => {
		if (!hasMedia || unfit) return;
		useAssembleStore.setState({ last: o, open: false });
		void runAssemble(o);
	};
	// focus starts on the chosen card
	useEffect(() => {
		const id = setTimeout(() => cards.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(), 60);
		return () => clearTimeout(id);
	}, []);
	const onCardsKey = (e: React.KeyboardEvent) => {
		const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 }[e.key];
		if (!step) return;
		e.preventDefault();
		e.stopPropagation();
		const at = KINDS.findIndex((k) => k.id === o.kind);
		const next = KINDS[Math.max(0, Math.min(KINDS.length - 1, at + step))];
		setO(optionsFor(next, { language: o.language }));
		requestAnimationFrame(() => cards.current?.querySelector<HTMLElement>(`[data-assemble-kind="${next.id}"]`)?.focus());
	};
	return (
		<Dialog open onOpenChange={(v) => !v && close()}>
			<DialogContent
				className="flex max-h-[min(96vh,680px)] w-[min(94vw,780px)] max-w-none flex-col gap-0 overflow-hidden p-0"
				data-assemble-sheet
				onKeyDown={(e) => {
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						go();
					}
				}}
			>
				<div className="flex h-[76px] shrink-0 flex-col justify-center gap-1 px-6 pt-1">
					<DialogTitle className="text-[17px] font-semibold tracking-[-0.01em]">{t("Assemble")}</DialogTitle>
					<DialogDescription className="text-muted-foreground truncate pr-8 text-[12.5px]">{t("Choose what you are making: the first cut lands on the timeline, every step can be undone.")}</DialogDescription>
				</div>
				<div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-4">
					<section className="flex flex-col">
						<h3 className="mb-2 text-[13px] font-medium">{t("What are you making?")}</h3>
						<div ref={cards} className="grid auto-rows-fr grid-cols-4 gap-2" role="radiogroup" aria-label={t("What are you making?")} onKeyDown={onCardsKey}>
							{KINDS.map((k) => {
								const on = k.id === o.kind;
								return (
									<button
										key={k.id}
										type="button"
										role="radio"
										aria-checked={on}
										tabIndex={on ? 0 : -1}
										data-assemble-kind={k.id}
										onClick={() => setO(optionsFor(k, { language: o.language }))}
										className={cn(
											"focus-visible:ring-primary flex min-h-[108px] min-w-0 flex-col items-start gap-1 rounded-lg p-3 text-left transition-[background-color,transform] outline-none focus-visible:ring-2 active:scale-[0.98]",
											on ? "bg-primary/10 ring-primary/60 ring-1" : "bg-foreground/[0.045] hover:bg-foreground/[0.08]",
										)}
									>
										<span className="line-clamp-2 w-full text-[13px] leading-[1.25] font-semibold">{t(k.title)}</span>
										<span className="text-muted-foreground line-clamp-2 text-[11.5px] leading-snug">{t(k.line)}</span>
										<span className="text-muted-foreground mt-auto flex items-center gap-1.5 text-[11px] tabular-nums">
											<HugeiconsIcon icon={ICONS[k.id]} className={cn("size-3.5", on && "text-primary")} />
											{t(k.typical)}
										</span>
									</button>
								);
							})}
							<div
								className={cn("flex min-h-[108px] min-w-0 flex-col items-start gap-1 rounded-lg border border-dashed bg-transparent p-3", hasMedia ? "border-border" : "border-primary/60")}
								data-assemble-material
							>
								<span className="text-[13px] leading-[1.25] font-semibold">{t("Material")}</span>
								<span className="text-muted-foreground line-clamp-2 text-[11.5px] leading-snug tabular-nums">
									{hasMedia ? t("{n} files · {time}", { n: count, time: clock(seconds) }) : t("Add your footage and assemble")}
								</span>
								<Button
									variant={hasMedia ? "ghost" : "secondary"}
									size="sm"
									className="mt-auto -ml-1.5 h-6 gap-1 px-1.5 text-[11.5px]"
									onClick={() => {
										close();
										useAssetsPanelStore.getState().setActiveTab("media");
									}}
									data-assemble-add
								>
									<HugeiconsIcon icon={Add01Icon} className="size-3.5" />
									{t("Open Media")}
								</Button>
							</div>
						</div>
					</section>
					<section className="grid grid-cols-[minmax(0,1fr)_214px] gap-x-6">
						<div className="flex flex-col gap-2">
							<Row label={t("Length")}>
								<Segmented<LengthMode>
									size="sm"
									aria-label={t("Length")}
									value={o.length}
									onValueChange={(length) => set({ length })}
									items={[
										{ value: "all", label: t("Keep everything") },
										{ value: "tight", label: t("Tighten") },
										{ value: "minutes", label: t("About…") },
									]}
									itemProps={(v) => ({ "data-assemble-length": v })}
								/>
								{o.length === "minutes" && (
									<span className="flex shrink-0 items-center text-[12px] tabular-nums">
										<Button variant="ghost" size="sm" className="h-5 w-5 p-0" aria-label={t("Shorter")} onClick={() => set({ minutes: Math.max(0.5, o.minutes >= 2 ? o.minutes - 1 : o.minutes - 0.5) })}>
											−
										</Button>
										<span className="w-14 text-center" data-assemble-minutes>
											{o.minutes < 1 ? t("{n} s", { n: Math.round(o.minutes * 60) }) : t("{n} min", { n: o.minutes })}
										</span>
										<Button variant="ghost" size="sm" className="h-5 w-5 p-0" aria-label={t("Longer")} onClick={() => set({ minutes: o.minutes < 1 ? o.minutes + 0.5 : o.minutes + 1 })}>
											+
										</Button>
									</span>
								)}
							</Row>
							{speech && (
								<Row label={t("Captions")}>
									<Switch checked={o.captions} onCheckedChange={(captions) => set({ captions })} aria-label={t("Captions")} data-assemble-captions />
									{o.captions && (
										<Segmented<AssembleOptions["language"]>
											size="sm"
											aria-label={t("Language")}
											value={o.language}
											onValueChange={(language) => set({ language })}
											items={[
												{ value: "auto", label: t("As spoken") },
												{ value: "ru", label: <span data-no-translate>Русский</span> },
												{ value: "en", label: <span data-no-translate>English</span> },
											]}
										/>
									)}
								</Row>
							)}
							<Row label={t("Music")}>
								<Switch checked={o.music} onCheckedChange={(music) => set({ music })} aria-label={t("Music")} data-assemble-music />
								{o.music &&
									MOODS.map((m) => (
										<button key={m} type="button" className={chipClass(o.mood === m)} onClick={() => set({ mood: m })} data-assemble-mood={m}>
											{name(m.charAt(0).toUpperCase() + m.slice(1))}
										</button>
									))}
							</Row>
							<Row label={t("Format")}>
								<Segmented<Frame>
									size="sm"
									aria-label={t("Format")}
									value={o.frame}
									onValueChange={(frame) => set({ frame })}
									items={[
										{ value: "footage", label: t("As the footage") },
										{ value: "16:9", label: "16:9" },
										{ value: "9:16", label: "9:16" },
									]}
									itemProps={(v) => ({ "data-assemble-frame": v })}
								/>
							</Row>
						</div>
						<div className="flex flex-col gap-1.5">
							<h3 className="text-[13px] font-medium">{t("What will happen")}</h3>
							<StepList steps={steps} mode="plan" />
						</div>
					</section>
				</div>
				<div className="flex h-[52px] shrink-0 items-center justify-between gap-3 border-t px-6">
					<Seal />
					<div className="flex items-center gap-2">
						<Button variant="ghost" className="h-8" onClick={close}>
							{t("Cancel")}
						</Button>
						{unfit && <span className="text-muted-foreground text-[11.5px]" data-assemble-unfit>{t("Only pictures here: choose «Photo and video story».")}</span>}
						<Button onClick={go} disabled={!hasMedia || unfit} data-assemble-go className="h-8 gap-1.5 px-3.5">
							<HugeiconsIcon icon={AiMagicIcon} className="size-4" />
							{t("Assemble")}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

/** Over the inspector, never over the player; under the header when there is no inspector. */
function useCardPlace(open: boolean) {
	const [place, setPlace] = useState<React.CSSProperties>({ top: 44, right: 12 });
	useLayoutEffect(() => {
		if (!open) return;
		const measure = () => {
			// the inspector, else the media panel: never the player
			const wide = (sel: string) => {
				const r = document.querySelector(sel)?.getBoundingClientRect();
				return r && r.width >= 300 && r.height >= 200 ? r : null;
			};
			const r = wide("[data-inspector]");
			const left = r ? null : wide("[data-assets-panel]");
			// The card stays inside the panel it covers (polish, 11.11): at 1024×640 it ran down over the bottom panel's bar
			// and hid the Timeline | Text | Scenes switch and the timeline's first rows. It scrolls inside instead, with
			// its buttons pinned to its bottom edge.
			const inside = (p: DOMRect, top: number) => `${Math.max(180, Math.round(p.bottom - top - 8))}px`;
			if (left) {
				const top = Math.round(left.top + 8);
				return setPlace({ top, left: Math.round(left.left + 8), width: Math.min(320, Math.round(left.width - 16)), maxHeight: inside(left, top) });
			}
			if (!r) return setPlace({ top: 44, right: 12, maxHeight: "calc(100vh - 64px)" });
			const top = Math.round(r.top + 8);
			setPlace({ top, left: Math.max(8, Math.round(r.right - 328)), maxHeight: inside(r, top) });
		};
		measure();
		window.addEventListener("resize", measure);
		const id = setInterval(measure, 1000);
		return () => {
			window.removeEventListener("resize", measure);
			clearInterval(id);
		};
	}, [open]);
	return place;
}

/** One card, three moments: run (the steps as they happen), done (what was done), stopped or failed. */
function ResultCard() {
	const t = useT();
	const name = useName();
	const running = useAssembleStore((s) => s.running);
	const result = useAssembleStore((s) => s.result);
	const ended = useAssembleStore((s) => s.ended);
	const last = useAssembleStore((s) => s.last);
	const stripOpen = useAssembleStore((s) => s.stripOpen);
	const projectId = useProjectId();
	const depth = useEditor((e) => e.command.depth(), ["timeline", "scenes", "project"]);
	const [busy, setBusy] = useState<number | null>(null);
	const show = stripOpen && (!!running || !!ended || (!!result && result.projectId === projectId));
	const place = useCardPlace(show);
	const progress = useThrottled(running?.progress ?? 0);
	const stepProgress = useThrottled(running?.stepProgress ?? 0);
	// a stopped run's card goes by itself after 6 s
	useEffect(() => {
		if (!stripOpen || running || ended?.kind !== "cancelled") return;
		const id = setTimeout(() => useAssembleStore.setState({ stripOpen: false, ended: null }), 6000);
		return () => clearTimeout(id);
	}, [stripOpen, running, ended]);
	if (!show) return null;
	const closeCard = () => useAssembleStore.setState({ stripOpen: false, seen: true });
	const again = (kind?: KindId) => useAssembleStore.setState({ open: true, ended: null, stripOpen: false, ...(kind ? { last: { ...last, kind } } : {}) });
	const frame = (mode: string, children: React.ReactNode) => (
		<aside
			className="bg-popover animate-in fade-in slide-in-from-top-1 fixed z-60 flex w-[320px] scroll-pt-14 scroll-pb-12 flex-col gap-3 overflow-y-auto rounded-[12px] border p-3.5 shadow-lg duration-200 scrollbar-thin motion-reduce:slide-in-from-top-0"
			style={place}
			data-assemble-strip={mode}
			onKeyDown={(e) => e.key === "Escape" && closeCard()}
		>
			{children}
		</aside>
	);
	if (running) {
		const steps = stepsFor({ ...(last as AssembleOptions), ...optionsFor(kindOf(last.kind), last) });
		const at = Math.max(0, steps.findIndex((s) => s.title === running.stage || (running.stage === "Listening" && s.id === "listen")));
		return frame(
			"running",
			<>
				<div className="flex items-center justify-between">
					<span className="text-[13px] font-semibold">{t("Assembling")}</span>
					<span className="text-[13px] tabular-nums">{Math.round(progress * 100)} %</span>
				</div>
				<div className="bg-foreground/[0.08] h-0.5 overflow-hidden rounded-full">
					<div className="bg-primary h-full transition-[width] duration-[240ms] ease-linear" style={{ width: `${Math.round(progress * 100)}%` }} />
				</div>
				<StepList steps={steps} mode="run" current={at} currentProgress={running.stage === "Listening" ? stepProgress : undefined} />
				<div className="flex items-center justify-between">
					<Seal />
					<Button variant="ghost" size="sm" className="h-6 px-2 text-[12px]" onClick={cancelAssemble} data-assemble-cancel>
						{t("Cancel")}
					</Button>
				</div>
			</>,
		);
	}
	if (ended) {
		return frame(
			ended.kind,
			<>
				<div className="flex items-start gap-2">
					{ended.kind !== "cancelled" && <HugeiconsIcon icon={Alert02Icon} className="text-destructive mt-0.5 size-3.5 shrink-0" />}
					<p className="min-w-0 flex-1 text-[12.5px]" data-assemble-ended>
						{ended.kind === "cancelled" ? t("Stopped. The timeline is unchanged.") : ended.kind === "nospeech" ? ended.message : t("Could not assemble: {why}", { why: ended.message.slice(0, 50) })}
					</p>
					<button type="button" className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-6 items-center justify-center rounded-md" aria-label={t("Close")} onClick={() => useAssembleStore.setState({ stripOpen: false, ended: null })}>
						<HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
					</button>
				</div>
				<div>
					<Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => again(ended.kind === "nospeech" ? "story" : undefined)} data-assemble-again>
						{ended.kind === "cancelled" ? t("Assemble again") : ended.kind === "nospeech" ? t("Choose «Photo and video story»") : t("Retry")}
					</Button>
				</div>
			</>,
		);
	}
	if (!result) return null;
	const live = result.session === historyId();
	const undone = live ? depth <= result.startDepth : !!result.reverted;
	const score = result.score;
	const verdict = score === null ? "" : score >= 85 ? t("Ready to publish") : score >= 60 ? t("Worth fixing: {n}", { n: result.fixes.length || 1 }) : t("Needs attention: {n}", { n: result.fixes.length || result.hard.length || 1 });
	return frame(
		"done",
		<>
			<div className="bg-popover sticky -top-3.5 z-10 -mx-3.5 -mt-3.5 flex items-start justify-between gap-2 px-3.5 pt-3.5 pb-1" data-assemble-head>
				<div className="flex flex-col">
					<span className="text-[13px] font-semibold">{t("What was done")}</span>
					<span className="text-muted-foreground text-[11.5px] tabular-nums">
						{clock(result.before)} → {clock(result.after)} · {t("in {n} s", { n: Math.round(result.totalSeconds) })}
					</span>
				</div>
				<button type="button" className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-6 items-center justify-center rounded-md" aria-label={t("Close")} onClick={closeCard} data-assemble-strip-close>
					<HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
				</button>
			</div>
			{undone ? (
				<p className="text-muted-foreground text-[12px]" data-assemble-undone>
					{live ? t("Everything is undone. ⌘⇧Z brings it back.") : t("Everything is undone. ⌘Z brings it back.")}
				</p>
			) : (
				<ul className="flex flex-col" data-assemble-steps>
					{result.steps.map((s) => (
						<li key={s.id} className="border-foreground/[0.06] flex min-h-8 items-center gap-2 border-b py-1 last:border-b-0" data-assemble-step={s.id} data-off={s.off ? "1" : undefined}>
							{s.off ? <span className="border-muted-foreground/50 size-3.5 shrink-0 rounded-full border" /> : <HugeiconsIcon icon={Tick02Icon} className="text-constructive size-3.5 shrink-0" />}
							<span className={cn("min-w-0 flex-1 text-[12.5px] transition-[text-decoration-color] duration-[180ms]", s.off ? "text-muted-foreground line-through decoration-current" : "decoration-transparent")}>
								<Sentence text={s.line} />
							</span>
							{live && <button
								type="button"
								className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-6 shrink-0 items-center justify-center rounded-md"
								aria-label={s.off ? t("Bring back") : t("Undo this step")}
								title={s.off ? t("Bring back") : t("Undo this step")}
								onClick={() => toggleStep(s.id)}
								data-assemble-undo={s.id}
							>
								<HugeiconsIcon icon={s.off ? RedoIcon : UndoIcon} className="size-3.5" />
							</button>}
						</li>
					))}
				</ul>
			)}
			{!undone && !live && <p className="text-muted-foreground text-[11.5px]">{t("Reopened: «Undo all» still brings back the footage as it was.")}</p>}
			{!undone && score !== null && (
				<div className="bg-foreground/[0.04] flex flex-col gap-1.5 rounded-lg p-2.5" data-assemble-score={score}>
					<div className="flex items-baseline justify-between">
						<span className="text-[12px] font-medium">{t("Quality check")}</span>
						<span>
							<span className="text-[15px] font-semibold tabular-nums">{score}</span>
							<span className="text-muted-foreground text-[11.5px]"> {t("of 100")}</span>
						</span>
					</div>
					<div className="bg-foreground/[0.08] h-[3px] overflow-hidden rounded-full">
						<div className={cn("h-full rounded-full", score >= 85 ? "bg-constructive" : score >= 60 ? "bg-caution" : "bg-destructive")} style={{ width: `${score}%` }} />
					</div>
					<span className="text-muted-foreground text-[11.5px]">{verdict}</span>
					{result.fixes.map((f) =>
						f.auto ? (
							<Button
								key={f.index}
								variant="outline"
								size="sm"
								className="h-auto min-h-7 justify-start px-2 py-1 text-left text-[11.5px] whitespace-normal"
								disabled={busy !== null}
								onClick={async () => {
									setBusy(f.index);
									await applyFix(f.index);
									setBusy(null);
								}}
								data-assemble-fix={f.index}
							>
								{busy === f.index ? t("Fixing…") : t("Fix: {name}", { name: name(f.name) })}
							</Button>
						) : (
							<p key={f.index} className="text-muted-foreground text-[11.5px] leading-snug">
								{t("{name} — worth a look", { name: name(f.name) })}
							</p>
						),
					)}
				</div>
			)}
			<div className="bg-popover sticky -bottom-3.5 z-10 -mx-3.5 -mb-3.5 flex items-center justify-between gap-2 px-3.5 pt-1 pb-3.5" data-assemble-foot>
				{!undone ? (
					<Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={undoAll} data-assemble-undo-all>
						{t("Undo all")}
					</Button>
				) : (
					<span />
				)}
				<Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={() => again()} data-assemble-again>
					{t("Assemble again")}
				</Button>
			</div>
		</>,
	);
}

/** A result sentence that never breaks inside «(−1:12)». */
function Sentence({ text }: { text: string }) {
	const m = /^(.*?)(\s*\([^)]*\))$/.exec(text);
	if (!m) return <>{text}</>;
	return (
		<>
			{m[1]}
			<span className="whitespace-nowrap">{m[2]}</span>
		</>
	);
}

/** The empty timeline of a project that has media: one sentence, one button. */
export function AssembleEmptyHint() {
	const t = useT();
	const hasMedia = useHasMedia();
	if (!hasMedia) return null;
	return (
		<span className="pointer-events-auto ml-auto flex items-center gap-2">
			<Button variant="secondary" size="sm" className="h-6 gap-1 px-2 text-[12px]" onClick={() => useAssembleStore.setState({ open: true })} data-assemble-empty>
				<HugeiconsIcon icon={AiMagicIcon} className="size-3.5" />
				{t("Assemble")}
			</Button>
		</span>
	);
}

/** The start page's first action: pick or drop footage → a project with it, the sheet open. */
export function AssembleHomeCard({ onStart, starting }: { onStart: (opts: { files: File[] }) => void; starting: boolean }) {
	const t = useT();
	const input = useRef<HTMLInputElement>(null);
	const [over, setOver] = useState(false);
	const start = (files: File[]) => {
		if (!files.length) return;
		askSheetOnOpen();
		onStart({ files });
	};
	return (
		<div
			className={cn("bg-foreground/[0.045] flex min-w-0 items-center gap-4 rounded-2xl p-4 transition-colors", over && "ring-primary/60 bg-primary/10 ring-1")}
			data-home-assemble
			onDragOver={(e) => {
				if (!Array.from(e.dataTransfer.types).includes("Files")) return;
				e.preventDefault();
				e.stopPropagation();
				setOver(true);
			}}
			onDragLeave={() => setOver(false)}
			onDrop={(e) => {
				if (!Array.from(e.dataTransfer.types).includes("Files")) return;
				e.preventDefault();
				e.stopPropagation();
				setOver(false);
				start(Array.from(e.dataTransfer.files));
			}}
		>
			<span className="bg-primary/15 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
				<HugeiconsIcon icon={AiMagicIcon} className="size-5" />
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="text-[15px] font-semibold">{t("Assemble a video from your footage")}</span>
			</div>
			<Button variant="secondary" className="h-8 shrink-0 px-3 text-[13px]" disabled={starting} onClick={() => input.current?.click()} data-home-assemble-pick>
				{t("Choose files")}
			</Button>
			<input
				ref={input}
				type="file"
				hidden
				multiple
				accept="video/*,audio/*,image/*"
				data-home-assemble-file
				onChange={(event) => {
					const files = Array.from(event.currentTarget.files ?? []);
					event.currentTarget.value = "";
					start(files);
				}}
			/>
		</div>
	);
}
