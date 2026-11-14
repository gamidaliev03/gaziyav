"use client";

// The face of «Claude at work» (docs/design/for-agent.md): the header pill that says what Claude is doing in this
// project in plain words, and the card over the inspector with the steps of this sitting — each one can be taken back
// («back to here»), Claude can be paused or stopped, and one line can be left for it. Built to the same sheet as
// Assemble's card (docs/design/for-assemble.md §3–6): the ring, the seal, the row and the card's place are the same
// pieces and should become shared ones after the merge.
import {
	Alert02Icon,
	RedoIcon,
	Cancel01Icon,
	CheckmarkCircle02Icon,
	PauseIcon,
	PlayIcon,
	AiMagicIcon,
	StopIcon,
	Tick02Icon,
	ViewIcon,
	UndoIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invokeAction } from "@/actions";
import { ACTIONS } from "@/actions/definitions";
import { useActionHandler } from "@/actions/use-action-handler";
import { usePoint } from "@/cloud/client";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import { useLang } from "@/i18n";
import { RU_AGENT_WORDS } from "@/i18n/ru-agentview";
import { useJobsStore } from "@/jobs/store";
import { openSettings } from "@/settings/settings-store";
import { cn } from "@/utils/ui";
import { backToRow, bringBackAll, editorOpened, pauseClaude, resumeClaude, showCard, stopClaude, syncPause, undoAll } from "../feed";
import { canUndo, DONE_MS, isStruck, type Live, markSeen, money, pillState, type Row, rowsBackTo, spentIn, stepsOf, THINKING_MS, undoKind, useAgent } from "../store";
import { type Phrase, sayPhrase, wordsFor } from "../words";

/** This area's own `t`: the phrase in the language of the moment, with the right form of a counted word. */
function useSay() {
	const lang = useLang((s) => s.lang);
	return useMemo(() => {
		const say = (k: string | Phrase, v?: Record<string, string | number>) => sayPhrase(typeof k === "string" ? { k, v } : k, lang, RU_AGENT_WORDS);
		return say;
	}, [lang]);
}
type Say = ReturnType<typeof useSay>;

const upper = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const useProjectId = () => useEditor((e) => e.project.getActiveOrNull()?.metadata.id ?? "", ["project"]);

/** A 14 px progress ring (it fills, it does not spin): Assemble's. */
function Ring({ value, className }: { value: number; className?: string }) {
	const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
	return (
		<span
			aria-hidden
			className={cn("inline-block size-3.5 shrink-0 rounded-full", className)}
			style={{ background: `conic-gradient(var(--primary) ${pct}%, var(--muted) 0)`, WebkitMask: "radial-gradient(circle, transparent 5px, #000 5px)", mask: "radial-gradient(circle, transparent 5px, #000 5px)" }}
		/>
	);
}

/** The percent shown changes at most four times a second. */
function useThrottled<T>(value: T, ms = 250): T {
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

/** A clock that ticks only while the pill's words depend on the time (thinking → done → gone). */
function useNow(on: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!on) return;
		setNow(Date.now());
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, [on]);
	return now;
}

/** How far a call is, when the job it started says (the job center's newest running line since the call began), or the render itself for an export. */
function useProgress(call: Live | null): number | null {
	const since = call ? call.at - 1000 : 0;
	const job = useJobsStore((s) => {
		if (!since) return null;
		let best: { startedAt: number; progress?: number } | null = null;
		for (const j of s.jobs) if (j.status === "running" && j.startedAt >= since && (!best || j.startedAt > best.startedAt)) best = j;
		return best && typeof best.progress === "number" ? Math.max(0, Math.min(1, best.progress)) : null;
	});
	// (an export Claude asked for is not a job of the job center: the project's own export state says how far it is)
	const exporting = !!call && /^export(_project)?$/.test(call.tool);
	const render = useEditor((e) => {
		const x = e.project.getExportState();
		return x.isExporting ? Math.max(0, Math.min(1, x.progress)) : null;
	}, ["project"]);
	return useThrottled(job ?? (exporting ? render : null));
}

/** What a paid generation will cost: the price locked for the job it started. */
function useEstimate(call: Live | null): number | null {
	const since = call?.paid ? call.at - 1500 : 0;
	return usePoint((s) => {
		if (!since) return null;
		let best: { at: number; cost: number } | null = null;
		for (const j of s.jobs) if (j.at >= since && (j.state === "queued" || j.state === "running") && (!best || j.at > best.at)) best = j;
		return best && best.cost > 0 ? best.cost : null;
	});
}

/** The pill in the header bar: off — the one activity icon (jobs-chip.tsx) shows Claude now (the owner, 12.11). */
const SHOW_PILL = false;

const STYLE = `
.studio-titlebar:has([data-agent-pill]) [data-assemble-button] { display: none }
@keyframes agentview-breathe { 0%, 100% { opacity: .55 } 50% { opacity: 1 } }
.agentview-breathe { animation: agentview-breathe 1600ms ease-in-out infinite }
@media (prefers-reduced-motion: reduce) { .agentview-breathe { animation: none } }
`;

/**
 * Claude's state in this project for the header's one activity icon (polish3, 12.11 — the owner: no text pills in the
 * bar): what it is doing in words, and its card. The jobs icon shows it; AgentPill keeps the card, ⌘. and the actions.
 */
export function useClaudeActivity(): { kind: string; spoken: string; toggle: () => void } {
	const say = useSay();
	const project = useProjectId();
	const session = useAgent((s) => (project ? (s.sessions[project] ?? null) : null));
	const liveAll = useAgent((s) => s.live);
	const paused = useAgent((s) => s.paused);
	const open = useAgent((s) => s.open);
	const seenAt = useAgent((s) => (project ? (s.seen[project] ?? 0) : 0));
	const live = useMemo(() => liveAll.filter((c) => !c.project || c.project === project), [liveAll, project]);
	const idleFor = session ? Date.now() - session.lastAt : Number.POSITIVE_INFINITY;
	const now = useNow(!!session && !live.length && idleFor < THINKING_MS + DONE_MS + 2000);
	const kind = pillState({ session, live: live.length, paused, open, seenAt, now: Math.max(now, Date.now()) });
	const shown = [...live].reverse().find((c) => !c.waiting) ?? live[live.length - 1] ?? null;
	const steps = stepsOf(session);
	const phrase =
		kind === "working" && shown
			? `${say(shown.now)}…`
			: kind === "thinking"
				? say("thinking…")
				: kind === "paused"
					? say("paused")
					: kind === "error"
						? say("error in a step")
						: kind === "done"
							? say("done · {n} {n|step|steps}", { n: steps })
							: "";
	return { kind, spoken: ["Claude", phrase].filter(Boolean).join(" · "), toggle: () => showCard(!open) };
}

/** Claude's card, ⌘. and its actions; its state shows in the header's one activity icon (useClaudeActivity). */
export function AgentPill() {
	const say = useSay();
	const project = useProjectId();
	const session = useAgent((s) => (project ? (s.sessions[project] ?? null) : null));
	const liveAll = useAgent((s) => s.live);
	const paused = useAgent((s) => s.paused);
	const open = useAgent((s) => s.open);
	const seenAt = useAgent((s) => (project ? (s.seen[project] ?? 0) : 0));
	const live = useMemo(() => liveAll.filter((c) => !c.project || c.project === project), [liveAll, project]);
	const idleFor = session ? Date.now() - session.lastAt : Number.POSITIVE_INFINITY;
	const now = useNow(!!session && !live.length && idleFor < THINKING_MS + DONE_MS + 2000);
	const kind = pillState({ session, live: live.length, paused, open, seenAt, now: Math.max(now, Date.now()) });
	// the newest call that is not just waiting its turn
	const shown = [...live].reverse().find((c) => !c.waiting) ?? live[live.length - 1] ?? null;
	const progress = useProgress(kind === "working" ? shown : null);
	const estimate = useEstimate(kind === "working" ? shown : null);
	const steps = stepsOf(session);

	useEffect(() => {
		editorOpened(project);
		void syncPause();
	}, [project]);
	// the card of another project is not this one's
	useEffect(() => () => useAgent.setState({ open: false }), [project]);
	// while paused: what Claude is waiting to do
	useEffect(() => {
		if (!paused) return;
		const id = setInterval(() => void syncPause(), 1500);
		return () => clearInterval(id);
	}, [paused]);
	// ⌘. — the Mac's own «stop» — while Claude is at work here
	const busy = kind === "working" || kind === "thinking";
	useEffect(() => {
		if (!busy) return;
		const onKey = (e: KeyboardEvent) => {
			if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey || e.code !== "Period") return;
			e.preventDefault();
			e.stopPropagation();
			void stopClaude();
		};
		window.addEventListener("keydown", onKey, { capture: true });
		return () => window.removeEventListener("keydown", onKey, { capture: true });
	}, [busy]);
	useActionHandler("agent-card", () => showCard(!useAgent.getState().open), undefined);
	useActionHandler("agent-stop", () => void stopClaude(), undefined);
	useActionHandler("agent-pause", () => void pauseClaude(), undefined);
	useActionHandler("agent-resume", () => void resumeClaude(), undefined);

	const phrase =
		kind === "working" && shown
			? `${say(shown.now)}…`
			: kind === "thinking"
				? say("thinking…")
				: kind === "paused"
					? say("paused")
					: kind === "error"
						? say("error in a step")
						: kind === "done"
							? say("done · {n} {n|step|steps}", { n: steps })
							: "";
	const more = kind === "working" ? live.length - 1 : 0;
	const price = kind === "working" && estimate ? `≈ ${money(estimate)}` : "";
	const percent = kind === "working" && progress !== null ? `${Math.round(progress * 100)} %` : "";
	const title = kind === "done" || kind === "error" ? say("What Claude did in this project") : say("Claude is working in this project. Click to see its steps");
	const spoken = ["Claude", phrase, price, more > 0 ? say("and {n} more", { n: more }) : "", percent].filter(Boolean).join(" · ");
	return (
		<>
			<style>{STYLE}</style>
			{SHOW_PILL && kind !== "none" && (
				<button
					type="button"
					className="bg-accent animate-in fade-in flex h-[22px] max-w-[340px] shrink-0 items-center gap-1.5 rounded-full px-2 text-[12px] duration-[120ms] outline-none focus-visible:ring-1 focus-visible:ring-ring"
					data-agent-pill={kind}
					data-agent-ui
					data-no-translate
					aria-label={spoken}
					aria-expanded={open}
					title={`${title}\n${spoken}`}
					onClick={() => showCard(!open)}
				>
					<span className={cn("relative grid size-3.5 shrink-0 place-items-center", kind === "working" && progress === null && "agentview-breathe")}>
						{kind === "paused" ? (
							<HugeiconsIcon icon={PauseIcon} className="text-foreground size-3.5" />
						) : kind === "working" && progress !== null ? (
							<Ring value={progress} />
						) : (
							<HugeiconsIcon icon={AiMagicIcon} className="text-primary size-3.5" />
						)}
						{kind === "done" && seenAt < (session?.lastAt ?? 0) && <span className="bg-primary absolute -top-0.5 -right-0.5 size-1.5 rounded-full" data-agent-dot />}
					</span>
					<span className="text-foreground font-semibold">Claude</span>
					{kind === "error" && <span className="bg-destructive size-1.5 shrink-0 rounded-full" data-agent-error-dot />}
					{phrase && (
						<span className="text-muted-foreground max-w-[220px] truncate max-[1279px]:hidden" data-agent-phrase>
							· {phrase}
							{price && ` · ${price}`}
						</span>
					)}
					{more > 0 && (
						<span className="text-muted-foreground tabular-nums max-[1279px]:hidden" data-agent-more>
							+{more}
						</span>
					)}
					{percent && (
						<span className="text-foreground min-w-[32px] text-right tabular-nums" data-agent-percent>
							{percent}
						</span>
					)}
				</button>
			)}
			{open && <AgentCard project={project} kind={kind} say={say} live={live} shown={shown} progress={progress} />}
		</>
	);
}

/** Over the inspector, never over the player; under the header when there is no inspector (Assemble's placement). */
function useCardPlace(open: boolean) {
	const [place, setPlace] = useState<React.CSSProperties>({ top: 44, right: 12 });
	useLayoutEffect(() => {
		if (!open) return;
		const measure = () => {
			const r = document.querySelector("[data-inspector]")?.getBoundingClientRect();
			if (!r || r.width < 200) return setPlace({ top: 44, right: 12, maxHeight: "calc(100vh - 64px)" });
			const top = Math.round(r.top + 8);
			setPlace({ top, left: Math.max(8, Math.round(r.right - 328)), maxHeight: `calc(100vh - ${top}px - 20px)` });
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

/** The seal: free and on this Mac, or what was spent (the same line as Assemble's, Text's and Scenes'). */
function Seal({ text }: { text: string }) {
	return (
		<span className="text-muted-foreground flex items-center gap-1.5 text-[11px]" data-agent-seal>
			<HugeiconsIcon icon={CheckmarkCircle02Icon} className="text-constructive size-3.5 shrink-0" />
			{text}
		</span>
	);
}

function duration(ms: number, say: Say): string {
	const s = Math.max(1, Math.round(ms / 1000));
	return s < 90 ? say("{n} s", { n: s }) : say("{n} min", { n: Math.round(s / 60) });
}

function AgentCard({ project, kind, say, live, shown, progress }: { project: string; kind: ReturnType<typeof pillState>; say: Say; live: Live[]; shown: Live | null; progress: number | null }) {
	const session = useAgent((s) => (project ? (s.sessions[project] ?? null) : null));
	const line = useAgent((s) => s.line);
	const epoch = useAgent((s) => s.epoch);
	const pausedBy = useAgent((s) => s.pausedBy);
	const held = useAgent((s) => s.held);
	const budget = useAgent((s) => (project ? (s.budget[project] ?? null) : null));
	const place = useCardPlace(true);
	const [hover, setHover] = useState<string | null>(null);
	const listRef = useRef<HTMLUListElement>(null);
	const stick = useRef(true);
	const rows = session?.rows ?? [];
	const steps = stepsOf(session);
	const spent = spentIn(session);
	// a change of Claude's is being made right now: the history is not the person's to rewind under it
	const changing = live.some((c) => !c.read && !c.waiting);
	const preview = useMemo(() => new Set(hover ? rowsBackTo(rows, hover, line, epoch).map((r) => r.id) : []), [hover, rows, line, epoch]);
	const struck = rows.filter((r) => isStruck(r, line, epoch) && !r.gone);
	// «Undo all» goes by the history line from Claude's first step: only while none of the person's own edits stand above it
	const firstUndo = rows.find((r) => r.kind === "step" && canUndo(r, line, epoch));
	const anyUndo = !!firstUndo && undoKind(firstUndo, line, epoch) !== "yours";
	const undoAllTitle = firstUndo && !anyUndo ? say("You edited in between: take back Claude's steps one by one") : say("Take back everything Claude did here. ⌘⇧Z brings it back");
	const lastOld = rows.reduce((at, r, i) => (r.kind === "step" && r.epoch !== epoch && (r.had ?? 0) > 0 ? i : at), -1);

	// the list follows its newest row unless the person scrolled up
	const signature = `${rows.length}:${rows[rows.length - 1]?.state ?? ""}:${rows[rows.length - 1]?.reads?.length ?? 0}`;
	useLayoutEffect(() => {
		const el = listRef.current;
		if (el && stick.current) el.scrollTop = el.scrollHeight;
	}, [signature]);

	// what happens while the card is open has been looked at
	useEffect(() => {
		markSeen(project);
	}, [project, signature]);

	const close = () => showCard(false);
	const state = kind === "working" ? say("working") : kind === "thinking" ? say("thinking") : kind === "paused" ? (pausedBy === "stop" ? say("stopped") : say("paused")) : rows.length ? say("done") : "";
	const from = session?.startedAt ?? 0;
	const to = kind === "working" ? Date.now() : (session?.lastAt ?? 0);
	const over = budget && budget.capped && budget.budget > 0 ? budget.spent / budget.budget : 0;
	const sum = [steps ? say("{n} {n|step|steps}", { n: steps }) : rows.length ? say("only looked so far") : "", steps && to > from ? duration(to - from, say) : ""].filter(Boolean).join(" · ");
	const moneyNow = budget && budget.spent > 0 ? (budget.capped ? say("{spent} of {budget}", { spent: money(budget.spent), budget: money(budget.budget) }) : money(budget.spent)) : spent > 0 ? money(spent) : "";
	const waitingFor = held.length ? say("Claude is waiting to go on: {what}", { what: say(wordsFor(held[held.length - 1].tool, held[held.length - 1].args).now) }) : "";
	const canAssemble = Object.hasOwn(ACTIONS, "open-assemble");

	return (
		<aside
			className="bg-popover animate-in fade-in slide-in-from-top-1 fixed z-60 flex w-[320px] flex-col rounded-[12px] border p-3.5 shadow-lg duration-[180ms] motion-reduce:slide-in-from-top-0"
			style={place}
			data-agent-card={kind}
			data-agent-ui
			data-no-translate
			aria-label="Claude"
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.stopPropagation();
					close();
				}
			}}
		>
			<div className="flex items-center gap-1.5">
				<HugeiconsIcon icon={AiMagicIcon} className="text-primary size-3.5 shrink-0" />
				<span className="text-[13px] font-semibold">Claude</span>
				<span className="text-muted-foreground ml-auto text-[11.5px]" data-agent-card-state>
					{state}
				</span>
				<button type="button" className="text-muted-foreground hover:text-foreground hover:bg-accent -mr-1 flex size-6 shrink-0 items-center justify-center rounded-md" aria-label={say("Close")} title={say("Close")} onClick={close} data-agent-close>
					<HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
				</button>
			</div>
			{(sum || moneyNow) && (
				<div className="text-muted-foreground mt-0.5 text-[11.5px] tabular-nums" data-agent-sum>
					{sum}
					{sum && moneyNow ? " · " : ""}
					{moneyNow && (
						<span className={cn(over > 1 ? "text-destructive" : over >= 0.8 ? "text-caution" : "")} data-agent-money>
							{moneyNow}
						</span>
					)}
				</div>
			)}
			{rows.length === 0 ? (
				<div className="mt-3 flex flex-col items-start gap-2.5" data-agent-empty>
					<p className="text-muted-foreground text-[12.5px] leading-snug">{say("Claude has not worked in this project yet. Ask it in Claude: its steps show here.")}</p>
					<Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={() => openSettings("claude")}>
						{say("Connect Claude…")}
					</Button>
				</div>
			) : (
				<ul
					ref={listRef}
					className="-mx-1 mt-2 flex min-h-0 flex-1 flex-col overflow-y-auto px-1 scrollbar-thin"
					data-agent-rows
					onScroll={(e) => {
						const el = e.currentTarget;
						stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
					}}
				>
					{rows.map((row, i) => (
						<RowView
							key={row.id}
							row={row}
							say={say}
							struck={isStruck(row, line, epoch)}
							previewed={preview.has(row.id)}
							undo={undoKind(row, line, epoch)}
							after={Math.max(0, rowsBackTo(rows, row.id, line, epoch).length - 1)}
							bringsBack={struck[0]?.id === row.id}
							changing={changing}
							progress={shown && (shown.row === row.id || shown.id === row.id) ? progress : null}
							onHover={setHover}
							divider={i === lastOld ? say("The window was reloaded: the steps above can't be undone here") : ""}
						/>
					))}
				</ul>
			)}
			{kind === "paused" && (
				<p className="text-foreground mt-2.5 text-[12px] leading-snug" data-agent-paused>
					{pausedBy === "stop" ? say("Stopped. Claude is waiting.") : say("Paused. Claude's changes wait for you.")}
					{waitingFor && (
						<span className="text-muted-foreground block text-[11.5px]" data-agent-held>
							{waitingFor}
						</span>
					)}
				</p>
			)}
			{rows.length > 0 && (
				<div className="mt-2.5 flex flex-col gap-2.5">
					<Seal text={spent > 0 ? say("Spent {spent} · the rest on this Mac", { spent: money(spent) }) : say("On this Mac · free")} />
					<div className="flex items-center gap-2" data-agent-foot>
						{kind === "paused" ? (
							<>
								<Button size="sm" className="h-7 gap-1.5 px-2.5 text-[12px]" onClick={() => void resumeClaude()} title={say("Let Claude's changes through again")} data-agent-resume>
									<HugeiconsIcon icon={PlayIcon} className="size-3.5" />
									{say("Continue")}
								</Button>
								<Button variant="outline" size="sm" className="h-7 px-2.5 text-[12px]" disabled={!anyUndo || changing} onClick={() => undoAll()} title={undoAllTitle} data-agent-undo-all>
									{say("Undo all")}
								</Button>
							</>
						) : kind === "working" || kind === "thinking" ? (
							<>
								<Button variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-[12px]" onClick={() => void pauseClaude()} title={say("Claude's changes wait until you continue. It can still look")} data-agent-pause>
									<HugeiconsIcon icon={PauseIcon} className="size-3.5" />
									{say("Pause")}
								</Button>
								<Button variant="destructive-foreground" size="sm" className="ml-auto h-7 gap-1.5 px-2.5 text-[12px]" onClick={() => void stopClaude()} title={say("Stop what is running and pause · ⌘.")} data-agent-stop>
									<HugeiconsIcon icon={StopIcon} className="size-3.5" />
									{say("Stop")}
								</Button>
							</>
						) : (
							<>
								<Button variant="outline" size="sm" className="h-7 px-2.5 text-[12px]" disabled={!anyUndo} onClick={() => undoAll()} title={undoAllTitle} data-agent-undo-all>
									{say("Undo all")}
								</Button>
								{canAssemble && (
									<Button variant="ghost" size="sm" className="ml-auto h-7 px-2.5 text-[12px]" onClick={() => invokeAction("open-assemble" as never)}>
										{say("Assemble…")}
									</Button>
								)}
							</>
						)}
					</div>
				</div>
			)}
		</aside>
	);
}

/** «(−1:12)» never breaks across two lines. */
function Sentence({ text }: { text: string }) {
	const parts = text.split(/(\(−[^)]*\))/);
	return <>{parts.map((p, i) => (/^\(−/.test(p) ? <span key={`${i}-${p}`} className="whitespace-nowrap">{p}</span> : p))}</>;
}

function RowView({
	row,
	say,
	struck,
	previewed,
	undo,
	after,
	bringsBack,
	changing,
	progress,
	onHover,
	divider,
}: {
	row: Row;
	say: Say;
	struck: boolean;
	previewed: boolean;
	undo: ReturnType<typeof undoKind>;
	after: number;
	bringsBack: boolean;
	changing: boolean;
	progress: number | null;
	onHover: (id: string | null) => void;
	divider: string;
}) {
	const running = row.state === "running" || row.state === "waiting";
	const quiet = row.kind === "reads";
	const n = row.kind === "reads" ? (row.reads?.length ?? 0) : 0;
	let text: string;
	if (running && row.now) text = `${upper(say(row.now))}…`;
	else if (row.state === "stopped" && row.now) text = say("Stopped: {what}", { what: say(row.now) });
	else if (row.state === "failed" && row.now) text = upper(say(row.now));
	else text = row.done ? say(row.done) : row.now ? upper(say(row.now)) : "";
	const under = row.why && (row.state === "failed" || row.state === "stopped") ? say(row.why) : "";
	const off = struck || previewed;
	const icon =
		row.state === "running" ? (
			progress !== null ? <Ring value={progress} /> : <Ring value={0.28} className="agentview-breathe" />
		) : row.state === "waiting" ? (
			<span className="border-muted-foreground/50 size-3.5 shrink-0 rounded-full border" />
		) : row.state === "failed" ? (
			<HugeiconsIcon icon={Alert02Icon} className="text-destructive size-3.5 shrink-0" />
		) : row.state === "stopped" ? (
			<HugeiconsIcon icon={StopIcon} className="text-muted-foreground size-3.5 shrink-0" />
		) : struck ? (
			<span className="border-muted-foreground/50 size-3.5 shrink-0 rounded-full border" />
		) : row.kind === "reads" ? (
			<HugeiconsIcon icon={ViewIcon} className="text-muted-foreground size-3.5 shrink-0" />
		) : (
			<HugeiconsIcon icon={Tick02Icon} className="text-constructive size-3.5 shrink-0" />
		);
	// the person's own edits stand above this step: the history line would take them too, so the card does not
	const blocked = changing || undo === "yours";
	const undoTitle = changing ? say("Stop Claude first") : undo === "yours" ? say("You edited after this step: it can't be taken back alone") : after > 0 ? say("Undo this step and {n} built on it", { n: after }) : say("Undo this step");
	return (
		<>
			<li
				className="border-foreground/[0.06] flex min-h-8 shrink-0 items-start gap-2 border-b py-[7px] last:border-b-0"
				data-agent-row={row.kind}
				data-row-id={row.id}
				data-state={row.state}
				data-struck={struck ? "1" : undefined}
				data-preview={previewed ? "1" : undefined}
			>
				<span className="flex h-[18px] items-center">{icon}</span>
				<span className="min-w-0 flex-1">
					<span
						className={cn(
							"line-clamp-2 text-[12.5px] leading-[18px] transition-[color,text-decoration-color] duration-[120ms]",
							off ? "text-muted-foreground line-through decoration-current" : quiet ? "text-muted-foreground decoration-transparent" : "text-foreground decoration-transparent",
							running && "font-medium",
						)}
						data-agent-sentence
					>
						<Sentence text={text} />
						{n > 1 && <span className="tabular-nums"> · {n}</span>}
					</span>
					{under && (
						<span className={cn("block text-[11.5px] leading-[15px]", row.state === "failed" ? "text-destructive" : "text-muted-foreground")} data-agent-why>
							{under}
						</span>
					)}
				</span>
				{running && progress !== null && <span className="text-foreground text-[11px] leading-[18px] tabular-nums">{Math.round(progress * 100)} %</span>}
				{!!row.usd && (
					<span className="text-foreground text-[11.5px] leading-[18px] tabular-nums" data-agent-price>
						{row.state === "stopped" ? "≈ " : ""}
						{money(row.usd)}
					</span>
				)}
				{bringsBack ? (
					<button
						type="button"
						className="text-muted-foreground hover:text-foreground hover:bg-accent -my-[3px] flex size-6 shrink-0 items-center justify-center rounded-md"
						aria-label={say("Bring back")}
						title={say("Bring back what was undone (⌘⇧Z)")}
						onClick={() => bringBackAll()}
						data-agent-redo
					>
						<HugeiconsIcon icon={RedoIcon} className="size-3.5" />
					</button>
				) : undo !== "none" && !running ? (
					<button
						type="button"
						aria-disabled={blocked || undefined}
						className={cn("text-muted-foreground -my-[3px] flex size-6 shrink-0 items-center justify-center rounded-md", blocked ? "opacity-40" : "hover:text-foreground hover:bg-accent")}
						aria-label={undoTitle}
						title={undoTitle}
						onPointerEnter={() => !blocked && onHover(row.id)}
						onPointerLeave={() => onHover(null)}
						onFocus={() => !blocked && onHover(row.id)}
						onBlur={() => onHover(null)}
						onClick={() => {
							if (blocked) return;
							onHover(null);
							backToRow(row.id);
						}}
						data-agent-undo={undo}
					>
						<HugeiconsIcon icon={UndoIcon} className="size-3.5" />
					</button>
				) : null}
			</li>
			{divider && (
				<li className="text-muted-foreground border-foreground/[0.06] shrink-0 border-b py-1.5 text-[11px] leading-snug" data-agent-divider>
					{divider}
				</li>
			)}
		</>
	);
}
