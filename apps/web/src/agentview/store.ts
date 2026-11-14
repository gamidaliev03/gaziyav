// «Claude at work»: what a Claude session did in each project during this sitting, as the rows the card shows, and
// what runs now, for the header pill. The window writes it as Claude's calls pass through its bridge (feed.ts) and as
// the editor's history moves (history.ts); it is kept in the window's session storage, so a reload keeps the list and
// a restart of Gaziyav starts clean. Nothing here runs a call or changes the project.
import { create } from "zustand";
import type { Phrase, ReadKind } from "./words";

type Args = Record<string, unknown>;

export type RowState = "waiting" | "running" | "ok" | "failed" | "stopped";

export interface Row {
	id: string;
	/** step: a call that changes something · reads: a run of calls that only looked. */
	kind: "step" | "reads";
	at: number;
	end?: number;
	state: RowState;
	/** What it is doing (the row while it runs; the words of a failed or stopped step). */
	now?: Phrase;
	/** What it did. */
	done?: Phrase;
	/** A failed step: the reason. A stopped one: what it had cost. */
	why?: Phrase;
	/** What a paid step charged. */
	usd?: number;
	/** reads: what each read was about. */
	reads?: ReadKind[];
	/** reads: how many are in flight now. */
	flying?: number;
	/** The call as Claude knows it («place ×3»), for the lines written to Claude. */
	label?: string;
	/** The history its undo entries belong to (another one: the window was reloaded or the history emptied since). */
	epoch?: number;
	/** How many undo entries it made (0: nothing of it is in the undo history). */
	had?: number;
	/** Its entries left the history line while this was on top: Claude's own undo, or the person. */
	offBy?: "claude" | "you";
	/** Claude was told that the person undid this step (it was named in an answer). */
	told?: boolean;
	/** A paid step whose history is gone: it stays in the list (the money was spent), struck, with nothing to press. */
	gone?: boolean;
}

export interface Session {
	rows: Row[];
	startedAt: number;
	/** The last time a call of Claude's started or ended here. */
	lastAt: number;
	/** Steps the person undid for good (their entries are gone from the history) that Claude has not been told about. */
	undone: string[];
	/** Steps Claude was told were undone that the person has brought back since (row ids): Claude is told that too. */
	back: string[];
}

/** A call of Claude's in flight in this window. */
export interface Live {
	id: string;
	tool: string;
	args: Args;
	/** The project open when it started ("" on the projects page). */
	project: string;
	at: number;
	/** Waiting for a render to end before it may start. */
	waiting: boolean;
	read: boolean;
	/** Runs beside other calls (a generation, an export). */
	background: boolean;
	paid: boolean;
	now: Phrase;
	/** Its row in the card ("" when it has none yet). */
	row: string;
	about?: ReadKind;
	/** The call's own stop: aborting it is what the hub's cancel does through the bridge's heartbeat. */
	own: AbortController;
}

export interface Held {
	tool: string;
	args: Args;
	at: number;
}

export interface BudgetNow {
	spent: number;
	budget: number;
	capped: boolean;
}

export interface LineOf {
	on: number;
	off: number;
	you: boolean;
	above: string[];
}

export interface AgentState {
	sessions: Record<string, Session>;
	live: Live[];
	paused: boolean;
	pausedBy: "pause" | "stop" | null;
	/** Claude's calls answered «paused» since the pause began. */
	held: Held[];
	/** The card. */
	open: boolean;
	/** project → when its card was last looked at. */
	seen: Record<string, number>;
	budget: Record<string, BudgetNow>;
	/**
	 * step → how many of its undo entries are on the history line and how many ⇧⌘Z would bring back; `you`: the person
	 * made entries after the step began (its undo by the line would take their work); `above`: Claude's other steps that
	 * have entries after it began (they go with it).
	 */
	line: Record<string, LineOf>;
	/** The history the line belongs to: it changes when the history is emptied (and with every load of the window). */
	epoch: number;
}

const KEY = "gaziyav.agentview.v1";
/** Rows kept per project (older ones leave from the top). */
const MAX_ROWS = 400;

function load(): Pick<AgentState, "sessions" | "seen"> {
	try {
		const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(KEY);
		const j = raw ? (JSON.parse(raw) as Partial<AgentState>) : null;
		if (!j?.sessions || typeof j.sessions !== "object") return { sessions: {}, seen: {} };
		const sessions: Record<string, Session> = {};
		for (const [project, s] of Object.entries(j.sessions)) {
			if (!s || !Array.isArray(s.rows)) continue;
			sessions[project] = { ...s, undone: Array.isArray(s.undone) ? s.undone : [], back: [], rows: s.rows.map(afterReload).filter((r): r is Row => !!r) };
		}
		return { sessions, seen: j.seen && typeof j.seen === "object" ? j.seen : {} };
	} catch {
		return { sessions: {}, seen: {} };
	}
}

/** A row as it reads after the window was loaded again: what was running then was cut by the reload. */
function afterReload(r: Row): Row | null {
	if (r.kind === "reads") {
		if (!r.reads?.length) return null;
		return { ...r, state: "ok", flying: 0 };
	}
	if (r.state === "running" || r.state === "waiting") return { ...r, state: "failed", end: r.end ?? r.at, why: { k: "The window was reloaded while it ran" } };
	return r;
}

// (empty until hydrate(): the server's render and the window's first one must agree)
export const useAgent = create<AgentState>()(() => ({
	sessions: {},
	seen: {},
	live: [],
	paused: false,
	pausedBy: null,
	held: [],
	open: false,
	budget: {},
	line: {},
	epoch: Date.now(),
}));

let hydrated = false;
/** Once per load of the window, before anything is read or written: what this sitting kept before the reload. */
export function hydrate() {
	if (hydrated || typeof sessionStorage === "undefined") return;
	hydrated = true;
	const kept = load();
	useAgent.setState((state) => ({ sessions: { ...kept.sessions, ...state.sessions }, seen: { ...kept.seen, ...state.seen } }));
}

let saving: ReturnType<typeof setTimeout> | null = null;
function save() {
	if (saving || typeof sessionStorage === "undefined") return;
	saving = setTimeout(() => {
		saving = null;
		try {
			const { sessions, seen } = useAgent.getState();
			sessionStorage.setItem(KEY, JSON.stringify({ sessions, seen }));
		} catch {}
	}, 250);
}

// ───────────────────────── rows ─────────────────────────

/** Change one project's session (made on first use); every change is kept for a reload. */
export function editSession(project: string, change: (s: Session) => Session | void) {
	if (!project) return;
	hydrate();
	useAgent.setState((state) => {
		const was = state.sessions[project] ?? { rows: [], startedAt: Date.now(), lastAt: Date.now(), undone: [], back: [] };
		const draft: Session = { ...was, rows: [...was.rows], undone: [...was.undone], back: [...(was.back ?? [])] };
		const next = change(draft) ?? draft;
		if (next.rows.length > MAX_ROWS) next.rows = next.rows.slice(-MAX_ROWS);
		return { sessions: { ...state.sessions, [project]: next } };
	});
	save();
}

export function editRow(project: string, id: string, change: (r: Row) => Row | null) {
	editSession(project, (s) => {
		const i = s.rows.findIndex((r) => r.id === id);
		if (i < 0) return;
		const next = change(s.rows[i]);
		if (next) s.rows[i] = next;
		else s.rows.splice(i, 1);
	});
}

export const sessionOf = (project: string): Session | null => useAgent.getState().sessions[project] ?? null;

export function markSeen(project: string) {
	if (!project) return;
	hydrate();
	useAgent.setState((s) => ({ seen: { ...s.seen, [project]: Date.now() } }));
	save();
}

// ───────────────────────── what the pill and the card derive ─────────────────────────

/** A row whose entries are all off the history line: it shows struck. */
export function isStruck(row: Row, line: AgentState["line"], epoch: number): boolean {
	if (row.gone) return true;
	if (row.epoch !== epoch) return false;
	const l = line[row.id];
	return !!l && l.on === 0 && l.off > 0;
}

/** A row the history can take back now (some of its entries are on the line). */
export function canUndo(row: Row, line: AgentState["line"], epoch: number): boolean {
	return row.epoch === epoch && (line[row.id]?.on ?? 0) > 0;
}

/** The steps that leave with this one when its undo goes by the history line: itself and Claude's steps made after it began. */
export function rowsBackTo(rows: Row[], id: string, line: AgentState["line"], epoch: number): Row[] {
	const l = line[id];
	const row = rows.find((r) => r.id === id);
	if (!l || !row || !canUndo(row, line, epoch)) return [];
	const ids = new Set([id, ...l.above]);
	return rows.filter((r) => ids.has(r.id));
}

/**
 * What the undo of a step can do now. "alone": it is the newest thing in the history, a plain undo. "with": Claude's
 * later steps stand on top and leave with it. "yours": the person edited after it — the history line would take their
 * work too, so the card does not offer it. "none": nothing of it is in the history.
 */
export function undoKind(row: Row, line: AgentState["line"], epoch: number): "alone" | "with" | "yours" | "none" {
	if (!canUndo(row, line, epoch)) return "none";
	const l = line[row.id];
	if (l.you) return "yours";
	return l.above.length ? "with" : "alone";
}

export type PillState = "none" | "working" | "thinking" | "paused" | "error" | "done";

/** Between calls for this long the pill says «thinking…». */
export const THINKING_MS = 20_000;
/** After that it says «done · N steps» for this long, unless the card was looked at. */
export const DONE_MS = 60_000;

export const stepsOf = (session: Session | null) => (session?.rows ?? []).filter((r) => r.kind === "step").length;

/** What the header slot shows for the open project (docs/design/for-agent.md §1). */
export function pillState(o: { session: Session | null; live: number; paused: boolean; open: boolean; seenAt: number; now: number }): PillState {
	if (o.paused) return "paused";
	if (o.live > 0) return "working";
	const s = o.session;
	if (!s || !s.rows.length) return "none";
	const idle = o.now - s.lastAt;
	const unseen = o.seenAt < s.lastAt;
	const last = [...s.rows].reverse().find((r) => r.kind === "step");
	if (last?.state === "failed" && unseen && idle < THINKING_MS + DONE_MS) return "error";
	if (idle < THINKING_MS) return "thinking";
	if ((unseen && idle < THINKING_MS + DONE_MS) || o.open) return "done";
	return "none";
}

/** Money as the card writes it: «$0.38», «$0.004» for less than a cent. */
export function money(usd: number): string {
	if (!(usd > 0)) return "$0";
	return usd < 0.01 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`;
}

/** What the paid steps of this sitting charged (undo never gives money back: a struck row counts too). */
export const spentIn = (session: Session | null) => Math.round((session?.rows ?? []).reduce((sum, r) => sum + (r.usd ?? 0), 0) * 1e6) / 1e6;
