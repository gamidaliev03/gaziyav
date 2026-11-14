// «Claude at work» and the editor's own undo history. There is one history line (core/managers/commands.ts) and this
// file never keeps a second one: it only notes, for each entry of that line, whose it is — a step of Claude's (the row
// of the card that was running) or the person's — and reads the line back to say which steps are on it, which ⇧⌘Z would
// bring back, which are gone, and what stands above each step. The person's own edits are never rows and are never
// undone from the card (docs/design/for-agent.md §3): a step whose undo would take their work with it says so instead.
import { EditorCore } from "@/core";
import { type AgentState, editSession, type Row, useAgent } from "./store";

type Cmd = object;

/** The commands on the history line (oldest first) and the ones ⇧⌘Z would bring back, read from the manager itself. */
export function historyLine(command: unknown): { done: Cmd[]; undone: Cmd[] } | null {
	const c = command as { history?: Array<{ command?: Cmd }>; redoStack?: Array<{ command?: Cmd }> } | null;
	if (!c || !Array.isArray(c.history) || !Array.isArray(c.redoStack)) return null;
	const cmds = (list: Array<{ command?: Cmd }>) => list.map((e) => e?.command).filter((x): x is Cmd => !!x && typeof x === "object");
	return { done: cmds(c.history), undone: cmds(c.redoStack) };
}

/** Whose each entry is: a row's id, or "" for what was there before Claude came to this project. */
const owner = new WeakMap<Cmd, string>();
/** Projects whose earlier history has been marked as «before Claude» in this load of the window. */
const based = new Set<string>();
let watching: (() => void) | null = null;
let wasEmpty = true;
/** «Back to here» just made: the next ⇧⌘Z from this depth brings back all of it. */
let jump: { depth: number; count: number; undone: number } | null = null;
let chaining = false;

const ed = () => EditorCore.getInstance();
const openProject = () => ed().project.getActiveOrNull()?.metadata.id ?? "";

/** A step of the history made right inside the person's own click, key or drop (not by a call running beside it). */
function byHand(): boolean {
	const e = typeof window === "undefined" ? undefined : (window.event as Event | undefined);
	return !!e && e.isTrusted && /^(pointer|mouse|key|click|dblclick|contextmenu|drop|drag|input|change|paste|cut|touch|wheel)/.test(e.type);
}

/** Claude's change running in this project now (its row), or null: the step is the person's. */
function claudeRow(project: string): string | null {
	const live = useAgent.getState().live.filter((c) => !c.waiting && !c.read && c.row && (c.project === project || !c.project));
	if (!live.length || byHand()) return null;
	// changes run one at a time; a step running beside them (a generation) places its result at its very end
	const front = live.filter((c) => !c.background);
	return (front[front.length - 1] ?? live[live.length - 1]).row;
}

/** Claude's own `undo` runs now: rows that leave the line are taken back by it, not by the person. */
const claudeUndoing = () => useAgent.getState().live.some((c) => c.tool === "undo" && !c.waiting);

/** The person's own entries: never a row, never undone from the card. */
const YOU = "you";

/** Everything in the history before Claude's first call here is not part of the card. */
export function baseline(project: string) {
	if (!project || based.has(project)) return;
	based.add(project);
	const line = historyLine(ed().command);
	if (!line) return;
	for (const c of [...line.done, ...line.undone]) if (!owner.has(c)) owner.set(c, "");
}

function count(line: { done: Cmd[]; undone: Cmd[] }): AgentState["line"] {
	const out: AgentState["line"] = {};
	const at = (id: string) => (out[id] ??= { on: 0, off: 0, you: false, above: [] });
	// from the top of the line down: what was made after each step's first entry
	let you = false;
	const above: string[] = [];
	for (let i = line.done.length - 1; i >= 0; i--) {
		const id = owner.get(line.done[i]);
		if (id === YOU) you = true;
		if (!id || id === YOU) continue;
		const row = at(id);
		row.on++;
		// (set again at each of its entries on the way down: the last write is at its first entry)
		row.you = you;
		row.above = above.filter((x) => x !== id);
		if (!above.includes(id)) above.push(id);
	}
	for (const c of line.undone) {
		const id = owner.get(c);
		if (id && id !== YOU) at(id).off++;
	}
	return out;
}

const sameLine = (a: AgentState["line"], b: AgentState["line"]) => {
	const ka = Object.keys(a);
	if (ka.length !== Object.keys(b).length) return false;
	return ka.every((k) => b[k] && a[k].on === b[k].on && a[k].off === b[k].off && a[k].you === b[k].you && a[k].above.length === b[k].above.length && a[k].above.every((x, i) => x === b[k].above[i]));
};

/** After every step of the history: who made the new entries, and where each row stands on the line. */
function onHistory() {
	const cmd = ed().command;
	const line = historyLine(cmd);
	if (!line) return;
	const project = openProject();
	const state = useAgent.getState();
	if (!line.done.length && !line.undone.length) {
		// The history was emptied (another project opened, the app's own reset): nothing made before can be undone here.
		if (!wasEmpty) useAgent.setState({ epoch: Date.now(), line: {} });
		wasEmpty = true;
		jump = null;
		return;
	}
	wasEmpty = false;
	const session = project ? state.sessions[project] : null;
	if (!session) return;
	const fresh = line.done.filter((c) => !owner.has(c));
	if (fresh.length) {
		// (a session kept from before a reload whose project was not open yet: its earlier history is not the card's)
		const row = based.has(project) ? (claudeRow(project) ?? YOU) : "";
		for (const c of fresh) owner.set(c, row);
		based.add(project);
	}
	const next = count(line);
	const was = state.line;
	if (!sameLine(was, next)) {
		useAgent.setState({ line: next });
		settle(project, was, next);
	}
	// ⇧⌘Z right after «back to here»: one press brings back the whole jump (the editor redid one step; the rest follow).
	if (jump && !chaining) {
		if (line.done.length === jump.depth + 1 && line.undone.length === jump.undone - 1 && jump.count > 1) {
			const left = jump.count - 1;
			jump = null;
			chaining = true;
			queueMicrotask(() => {
				try {
					for (let i = 0; i < left && cmd.canRedo(); i++) cmd.redo();
				} finally {
					chaining = false;
				}
			});
		} else if (line.done.length !== jump.depth) jump = null;
	}
}

/** Rows follow the line: a step that left it is marked with who took it back; one whose entries are gone leaves the list. */
function settle(project: string, was: AgentState["line"], next: AgentState["line"]) {
	const epoch = useAgent.getState().epoch;
	const byClaude = claudeUndoing();
	editSession(project, (s) => {
		const rows: Row[] = [];
		for (const r of s.rows) {
			if (r.epoch !== epoch || r.gone) {
				rows.push(r);
				continue;
			}
			const l = next[r.id];
			const before = was[r.id];
			const had = Math.max(r.had ?? 0, l ? l.on + l.off : 0);
			if (had > 0 && !l) {
				// its entries are gone from the history (a new edit was made after it was undone)
				if (r.kind === "step" && r.offBy === "you" && !r.told && r.label) s.undone.push(r.label);
				if (r.usd) rows.push({ ...r, had, gone: true });
				continue;
			}
			let offBy = r.offBy;
			if (l && l.on === 0 && (before?.on ?? 0) > 0) offBy = byClaude ? "claude" : "you";
			if (l && l.on > 0) {
				// back on the line: if Claude was told it was undone, it is told this too
				if (r.offBy === "you" && r.told && !s.back.includes(r.id)) s.back.push(r.id);
				offBy = undefined;
			}
			rows.push(had !== r.had || offBy !== r.offBy ? { ...r, had, offBy, ...(offBy ? {} : { told: undefined }) } : r);
		}
		s.rows = rows;
		if (s.undone.length > 20) s.undone = s.undone.slice(-20);
	});
}

/** Start noting the history (once; the editor's command manager lives as long as the window). */
export function watchLine() {
	if (watching) return;
	watching = ed().command.subscribeHistory(onHistory);
	const line = historyLine(ed().command);
	wasEmpty = !line || (!line.done.length && !line.undone.length);
}

/** A row of Claude's begins: entries made from now on while it runs are its own. */
export function stepBegins(project: string) {
	watchLine();
	baseline(project);
}

/** The line as it stands (after a call ended: its entries are all made). */
export function recount() {
	if (watching) onHistory();
}

// ───────────────────────── back to here ─────────────────────────

/** How far «back to here» on this row goes: the number of history steps from the top down to the row's first entry. */
function stepsBackTo(rowId: string): number {
	const line = historyLine(ed().command);
	if (!line) return 0;
	const first = line.done.findIndex((c) => owner.get(c) === rowId);
	return first < 0 ? 0 : line.done.length - first;
}

/**
 * The project as it was before this step: the editor's own undo, as many times as it takes. Returns how many history
 * steps were taken back (0: the row is not on the line any more).
 */
export function backTo(rowId: string): number {
	const cmd = ed().command;
	const n = stepsBackTo(rowId);
	if (!n) return 0;
	const start = cmd.depth();
	for (let i = 0; i < n; i++) {
		const d = cmd.depth();
		cmd.undo();
		if (cmd.depth() >= d) break;
	}
	const gone = start - cmd.depth();
	// (a step whose undo failed drops what could be redone: then there is nothing to arm)
	jump = gone > 0 && cmd.canRedo() ? { depth: cmd.depth(), count: gone, undone: historyLine(cmd)?.undone.length ?? gone } : null;
	return gone;
}

/** Everything that was taken back comes back: the editor's own redo to the end of its line. */
export function bringBack(): number {
	const cmd = ed().command;
	jump = null;
	let n = 0;
	for (let guard = 0; guard < 5000 && cmd.canRedo(); guard++) {
		const d = cmd.depth();
		cmd.redo();
		if (cmd.depth() <= d) break;
		n++;
	}
	return n;
}

/** For the tests: a new editor instance, a clean slate. */
export function forgetLine() {
	watching?.();
	watching = null;
	based.clear();
	jump = null;
	chaining = false;
	wasEmpty = true;
}

/** For the tests: the owner table of the line as row ids, oldest first. */
export function lineOwners(): string[] {
	const line = historyLine(ed().command);
	return line ? line.done.map((c) => owner.get(c) ?? "?") : [];
}
