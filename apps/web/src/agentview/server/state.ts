// «Claude at work», the app's side: the person's Pause. While it is on, a call of Claude's that would change the
// project is answered at once with one honest line and never runs; calls that only look go through. Kept in the app's
// memory for this sitting (a restart of Gaziyav starts unpaused: nothing waits behind a button nobody sees).
import { isRead } from "@/agentview/words";
import { callLabel, hhmm } from "@/mcp/compact";

type Args = Record<string, unknown>;

interface Held {
	tool: string;
	args: Args;
	at: number;
}

interface AgentState {
	paused: boolean;
	/** How it came to be paused: the Pause button, or Stop (which also cancelled what ran). */
	by: "pause" | "stop" | null;
	since: number;
	/** Claude's calls answered «paused» since then (the newest last): the card says what it is waiting to do. */
	held: Held[];
}

const g = globalThis as unknown as { __gaziyavAgentView?: AgentState };
if (!g.__gaziyavAgentView) g.__gaziyavAgentView = { paused: false, by: null, since: 0, held: [] };
const state: AgentState = g.__gaziyavAgentView;

// What Claude reads when its call waits for the person. Written for a model in the middle of a job: what state it is
// in (this call did not run, nothing changed, nothing was charged), what still works, and what to do next.
const WAIT = "This call was not run: nothing was changed and nothing was charged. Calls that only read or look still work (get_project, look, analyze, find_content, price_plan, status). Don't retry in a loop: tell the user in one line that you are waiting for them, and send this same call again when they say to continue.";
export const pausedAnswer = (by: "pause" | "stop" | null = "pause") => `${by === "stop" ? "The user pressed Stop in Gaziyav: editing is paused." : "The user paused editing in Gaziyav."} ${WAIT}`;
export const PAUSED_ANSWER = pausedAnswer("pause");
/** The reason a call still in the queue is given when the person pauses (hub.cancel writes it into «Not run: … was stopped (…)»). */
export const PAUSED_REASON = "the user paused editing in Gaziyav: wait for them and send the same call again when they say to continue";
export const STOPPED_REASON = "the user pressed Stop in Gaziyav";

export const agentPaused = () => state.paused;

/** Paused and this call would change something: the answer to give at once (the call is not run). */
export function agentHold(tool: string, args: Args): string | null {
	if (!state.paused || isRead(tool, args ?? {})) return null;
	state.held.push({ tool, args: brief(args ?? {}), at: Date.now() });
	if (state.held.length > 20) state.held.shift();
	return pausedAnswer(state.by);
}

/** The pause as the `status` tool says it ("" when editing is not paused). */
export function agentPauseLine(): string {
	if (!state.paused) return "";
	const waiting = [...new Set(state.held.map((h) => callLabel(h.tool, h.args)))].slice(-4);
	return `Editing is paused: the user pressed ${state.by === "stop" ? "Stop" : "Pause"} in Gaziyav at ${hhmm(state.since)}. Your calls that change the project are not run until they press Continue there; calls that only read or look still work.${waiting.length ? ` Not run so far: ${waiting.join(", ")}.` : ""} Don't retry in a loop: tell the user you are waiting, and send the held call again when they say to continue.`;
}

/** The arguments the card needs to name a held call, without the long ones (code, prompts in full). */
function brief(args: Args): Args {
	const out: Args = {};
	for (const [k, v] of Object.entries(args)) {
		if (typeof v === "string") out[k] = v.slice(0, 120);
		else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
		else if (Array.isArray(v)) out[k] = v.slice(0, 40).map((x) => (x && typeof x === "object" ? brief(x as Args) : typeof x === "string" ? x.slice(0, 120) : x));
	}
	return out;
}

export function setPaused(on: boolean, by: "pause" | "stop" = "pause") {
	if (on && !state.paused) {
		state.since = Date.now();
		state.held = [];
	}
	state.paused = on;
	state.by = on ? by : null;
	if (!on) state.held = [];
	return agentView();
}

export function agentView() {
	return { paused: state.paused, by: state.by, since: state.since, held: state.held.slice(-5) };
}
