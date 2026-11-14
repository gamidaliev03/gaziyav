// «Claude at work»: where Claude's calls enter the card. The window's bridge (mcp/bridge.tsx) tells this file when a
// call starts, when it leaves the queue behind a render, and when it ends with its answer; this file turns that into
// rows (store.ts) and hands back the answer with the person's lines for Claude on top: the steps they took back in
// the card. Also the person's own buttons: Pause, Continue, Stop (through the app's hub).
import { EditorCore } from "@/core";
import { callLabel } from "@/mcp/compact";
import { laneOf, navigates } from "@/mcp/surface";
import { baseline, bringBack, backTo, lineOwners, recount, stepBegins, watchLine } from "./history";
import { type BudgetNow, canUndo, editRow, editSession, type Held, hydrate, isStruck, type Live, markSeen, type Row, sessionOf, undoKind, useAgent } from "./store";
import { chargedIn, doneFor, type Phrase, readsRow, reasonOf, wordsFor } from "./words";

type Args = Record<string, unknown>;

interface Call {
	id: string;
	tool: string;
	args: Args;
}

interface Answer {
	ok: boolean;
	content: string;
}

const HEADERS = { "X-Studio": "1", "Content-Type": "application/json" };
const openProject = () => EditorCore.getInstance().project.getActiveOrNull()?.metadata.id ?? "";

/** A row for a step that starts (or, for a call that began with no project open, the row of what it did). */
function stepRow(call: Call, now: Phrase, state: Row["state"], at: number): Row {
	return { id: call.id, kind: "step", at, state, now, label: callLabel(call.tool, call.args), epoch: useAgent.getState().epoch, had: 0 };
}

export const agentFeed = {
	/** A call was taken by the window. `own` is its stop (what the hub's cancel aborts through the heartbeat). */
	started(call: Call, own: AbortController, waiting: boolean) {
		try {
			hydrate();
			const args = call.args ?? {};
			const w = wordsFor(call.tool, args);
			const project = openProject();
			const at = Date.now();
			let row = "";
			// (a call that goes to another project gets its row there, when it has arrived)
			if (project && !navigates(call.tool, args)) {
				stepBegins(project);
				if (w.read && !w.own) {
					editSession(project, (s) => {
						const last = s.rows[s.rows.length - 1];
						if (last?.kind === "reads") {
							row = last.id;
							s.rows[s.rows.length - 1] = { ...last, state: "running", now: w.now, flying: (last.flying ?? 0) + 1 };
						} else {
							row = `reads-${call.id}`;
							s.rows.push({ id: row, kind: "reads", at, state: "running", now: w.now, reads: [], flying: 1 });
						}
						s.lastAt = at;
					});
				} else {
					row = call.id;
					editSession(project, (s) => {
						s.rows.push(stepRow(call, w.now, waiting ? "waiting" : "running", at));
						s.lastAt = at;
					});
				}
			}
			const live: Live = { id: call.id, tool: call.tool, args, project, at, waiting, read: w.read, background: laneOf(call.tool, args) === "background", paid: !!w.paid, now: w.now, row, about: w.about, own };
			useAgent.setState((s) => ({ live: [...s.live.filter((c) => c.id !== call.id), live] }));
		} catch (error) {
			console.warn("[agentview] started", error);
		}
	},

	/** It waited for a render and starts now. */
	running(id: string) {
		try {
			const live = useAgent.getState().live.find((c) => c.id === id);
			if (!live?.waiting) return;
			useAgent.setState((s) => ({ live: s.live.map((c) => (c.id === id ? { ...c, waiting: false } : c)) }));
			if (live.row && live.project) editRow(live.project, live.row, (r) => (r.kind === "step" ? { ...r, state: "running" } : r));
		} catch (error) {
			console.warn("[agentview] running", error);
		}
	},

	/**
	 * A call ended. Returns the answer Claude gets: the same one, with the person's lines on top when there are any.
	 * `landed`: the project the call left open (the one it opened, else the one that was open); `stopped`: why its own
	 * stop fired (Stop in the editor or in Claude).
	 */
	finished<T extends Answer>(call: Call, out: T, info: { landed?: { id: string } | null; stopped?: string } = {}): T {
		try {
			hydrate();
			const state = useAgent.getState();
			const live = state.live.find((c) => c.id === call.id);
			useAgent.setState((s) => ({ live: s.live.filter((c) => c.id !== call.id) }));
			const args = call.args ?? {};
			const w = wordsFor(call.tool, args);
			// (a call that has its row finishes there, whatever project is open by now)
			const project = live?.row ? live.project : info.landed?.id || live?.project || "";
			if (!project) return out;
			const end = Date.now();
			const stopped = info.stopped !== undefined;
			// its entries are all in the history now
			recount();
			if (w.read && !w.own) {
				const rowId = live?.row ?? "";
				const about = w.about ?? "project";
				editSession(project, (s) => {
					const i = s.rows.findIndex((r) => r.id === rowId);
					if (i < 0) {
						// (a read that began with no project open says nothing)
						return;
					}
					const r = s.rows[i];
					const reads = out.ok && !stopped ? [...(r.reads ?? []), about] : (r.reads ?? []);
					const flying = Math.max(0, (r.flying ?? 1) - 1);
					if (!reads.length && !flying) s.rows.splice(i, 1);
					else s.rows[i] = { ...r, reads, flying, state: flying ? "running" : "ok", end, done: reads.length ? readsRow(reads) : r.done };
					s.lastAt = end;
				});
			} else {
				const usd = chargedIn(out.content);
				const paid = live?.paid ?? !!w.paid;
				const result = (r: Row): Row => {
					if (stopped) {
						const why: Phrase | undefined = usd > 0 ? { k: "≈ {price} was already charged; the result lands in Media", v: { price: priceText(usd) } } : paid ? { k: "Nothing was charged" } : undefined;
						return { ...r, state: "stopped", end, now: w.now, ...(usd > 0 ? { usd } : {}), ...(why ? { why } : {}) };
					}
					if (!out.ok) return { ...r, state: "failed", end, now: w.now, why: reasonOf(out.content), ...(usd > 0 ? { usd } : {}) };
					const d = doneFor(call.tool, args, out);
					return { ...r, state: "ok", end, done: d.done, ...(d.usd ? { usd: d.usd } : {}) };
				};
				editSession(project, (s) => {
					const i = s.rows.findIndex((r) => r.id === call.id);
					if (i >= 0) s.rows[i] = result(s.rows[i]);
					else s.rows.push(result(stepRow(call, w.now, "running", live?.at ?? end)));
					s.lastAt = end;
				});
				if (usd > 0) void refreshBudget(project);
			}
			const lines = linesForClaude(project);
			// (stopped by the person's own Stop here, not by Claude's: it must know editing is paused now)
			const tail = stopped && /Stop in Gaziyav/.test(info.stopped ?? "") && useAgent.getState().paused ? `\n${STOPPED_NOTE}` : "";
			return lines.length || tail ? ({ ...out, content: `${lines.length ? `${lines.join("\n")}\n` : ""}${out.content}${tail}` } as T) : out;
		} catch (error) {
			console.warn("[agentview] finished", error);
			return out;
		}
	},
};

const priceText = (usd: number) => (usd < 0.01 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`);

// ───────────────────────── the person's lines for Claude ─────────────────────────

/** «your step «edit (2 steps)»» / «your 3 steps «a», «b», «c»» (at most six named). */
function named(labels: string[]): string {
	const list = labels.slice(0, 6).map((l) => `«${l}»`).join(", ");
	return `your ${labels.length === 1 ? "step" : `${labels.length} steps`} ${list}${labels.length > 6 ? ` and ${labels.length - 6} more` : ""}`;
}

/**
 * What Claude must know with its next answer, said once and written for a model in the middle of a job — what state
 * the project is in and what to do next: its steps the person took back in the editor (they are off the history line,
 * nothing may be built on them), and steps the person brought back after Claude was told they were gone.
 */
function linesForClaude(project: string): string[] {
	const state = useAgent.getState();
	const session = state.sessions[project];
	if (!session) return [];
	const lines: string[] = [];
	const struck = session.rows.filter((r) => r.kind === "step" && r.offBy === "you" && !r.told && r.label && isStruck(r, state.line, state.epoch));
	const gone = [...session.undone, ...struck.map((r) => r.label as string)];
	if (gone.length) {
		const [it, they, them] = gone.length === 1 ? ["it", "it", "it"] : ["they", "they", "them"];
		lines.push(
			`The user went back in Gaziyav: they took back ${named(gone)}. What ${it} made is gone from the project and the ids ${they} created no longer exist. It was on purpose: don't redo ${them} unless they ask. Read the project as it is now (get_project) before your next change.`,
		);
	}
	const returned = (session.back ?? []).map((id) => session.rows.find((r) => r.id === id)).filter((r): r is Row => !!r && !!r.label && !isStruck(r, state.line, state.epoch) && !r.gone);
	if (returned.length) lines.push(`The user brought ${named(returned.map((r) => r.label as string))} back in Gaziyav: what ${returned.length === 1 ? "it" : "they"} made is in the project again, with the same ids.`);
	if (!lines.length && !(session.back ?? []).length) return [];
	const toldIds = new Set(struck.map((r) => r.id));
	editSession(project, (s) => {
		s.undone = [];
		s.back = [];
		s.rows = s.rows.map((r) => (toldIds.has(r.id) ? { ...r, told: true } : r));
	});
	return lines;
}

/** After a call was stopped from the editor: where things stand and what Claude does next. */
const STOPPED_NOTE = "The user pressed Stop in Gaziyav and editing is paused now. Don't start this again by yourself: tell them in one line what was stopped (and what it had cost, if the line above says), then wait — your next change runs only after they press Continue and tell you to go on.";

// ───────────────────────── the person's buttons ─────────────────────────

async function ask(body?: Record<string, unknown>): Promise<{ paused?: boolean; by?: "pause" | "stop" | null; held?: Held[] } | null> {
	try {
		const res = await fetch("/api/agentview", body ? { method: "POST", headers: HEADERS, body: JSON.stringify(body) } : { headers: HEADERS });
		return res.ok ? ((await res.json()) as { paused?: boolean; by?: "pause" | "stop" | null; held?: Held[] }) : null;
	} catch {
		return null;
	}
}

function take(view: Awaited<ReturnType<typeof ask>>) {
	if (!view) return;
	useAgent.setState({ paused: view.paused === true, pausedBy: view.paused ? (view.by ?? "pause") : null, held: view.paused && Array.isArray(view.held) ? view.held : [] });
}

/** What the app says about the pause (on load, and while paused: what Claude is waiting to do). */
export const syncPause = async () => take(await ask());

/** Pause: Claude's calls that would change the project wait; what runs now goes on to its end. */
export async function pauseClaude() {
	useAgent.setState({ paused: true, pausedBy: "pause", held: [] });
	take(await ask({ pause: true }));
}

/** Continue: calls go through again. */
export async function resumeClaude() {
	useAgent.setState({ paused: false, pausedBy: null, held: [] });
	take(await ask({ pause: false }));
}

/**
 * Stop: every call of Claude's that has no answer yet is cancelled by the app's hub (a queued one never runs; a
 * running one is aborted in this window, a paid generation stops being followed), and editing is paused so the next
 * call does not start under the person's hand. The window's own running calls are aborted right away rather than at
 * their next heartbeat.
 */
export async function stopClaude() {
	useAgent.setState({ paused: true, pausedBy: "stop", held: [] });
	const view = await ask({ stop: true });
	const live = useAgent.getState().live;
	for (const c of live) {
		if (!c.own.signal.aborted) c.own.abort(new DOMException("the user pressed Stop in Gaziyav", "AbortError"));
	}
	// (a render does not hear the call's own stop: it has its own cancel, the one the Export window's button presses)
	if (live.some((c) => /^export(_project)?$/.test(c.tool))) EditorCore.getInstance().project.cancelExport();
	if (view) take(view);
}

/**
 * Undo of a step from the card, by the editor's own history: the step and Claude's later steps that stand on it. Never
 * when the person's own edits stand above it (the line would take their work too): 0 then.
 */
export function backToRow(id: string): number {
	recount();
	const state = useAgent.getState();
	const row = (sessionOf(openProject())?.rows ?? []).find((r) => r.id === id);
	if (!row) return 0;
	const kind = undoKind(row, state.line, state.epoch);
	if (kind !== "alone" && kind !== "with") return 0;
	const n = backTo(id);
	recount();
	return n;
}

/** Everything Claude did here in this sitting, taken back: back to before its first step that the history still has. */
export function undoAll(): number {
	const state = useAgent.getState();
	const first = (sessionOf(openProject())?.rows ?? []).find((r) => r.kind === "step" && canUndo(r, state.line, state.epoch));
	return first ? backToRow(first.id) : 0;
}

/** «Bring back»: the editor's own redo, to the end of its line. */
export function bringBackAll(): number {
	const n = bringBack();
	recount();
	return n;
}

export async function refreshBudget(project: string) {
	if (!project) return;
	try {
		const res = await fetch(`/api/mcp/budget?project=${encodeURIComponent(project)}`, { headers: HEADERS });
		if (!res.ok) return;
		const b = (await res.json()) as Partial<BudgetNow>;
		const now: BudgetNow = { spent: Number(b.spent) || 0, budget: Number(b.budget) || 0, capped: b.capped === true };
		useAgent.setState((s) => ({ budget: { ...s.budget, [project]: now } }));
	} catch {}
}

/** The card opens or closes; opening it is looking at it. */
export function showCard(open: boolean) {
	const project = openProject();
	useAgent.setState({ open });
	if (project) {
		markSeen(project);
		if (open) void refreshBudget(project);
	}
}

/** The editor is on screen with this project: its history is noted from here on. */
export function editorOpened(project: string) {
	hydrate();
	watchLine();
	if (project && sessionOf(project)) baseline(project);
}

// A handle for the tests that drive the built app (GaziyavShell/test/ideal-agent*.mjs): what the card knows, whose each
// entry of the history is, and the project as it is saved on disk (after the pending save was written).
if (typeof window !== "undefined") {
	(window as unknown as { __agentview?: unknown }).__agentview = {
		state: () => {
			const s = useAgent.getState();
			return { sessions: s.sessions, live: s.live.map((c) => ({ id: c.id, tool: c.tool, project: c.project, waiting: c.waiting, read: c.read, row: c.row })), paused: s.paused, pausedBy: s.pausedBy, held: s.held, open: s.open, line: s.line, epoch: s.epoch, budget: s.budget };
		},
		owners: () => lineOwners(),
		open: () => showCard(true),
		saved: async () => {
			const { storageService } = await import("@/services/storage/service");
			await EditorCore.getInstance().save.flush();
			const loaded = await storageService.loadProject({ id: openProject() });
			const project = loaded?.project;
			return project ? (project.scenes.find((s) => s.id === project.currentSceneId) ?? project.scenes[0])?.tracks ?? null : null;
		},
	};
}
