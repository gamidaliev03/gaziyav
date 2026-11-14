// Gaziyav AI's conversation, per project: the user asks, the model answers with tool calls, the editor runs them
// (src/agent/tools.ts) and sends the results back, until the model has nothing left to do. Every edit is an ordinary
// ⌘Z step; a finished turn can be undone as a whole while nothing else was edited after it.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { EditorCore } from "@/core";
import { frameRateToFloat } from "@/fps/utils";
import { TICKS_PER_SECOND } from "@/wasm";
import { isPointMcpTool, pointAgentTools, pointMcpLabel, runPointMcpTool } from "@/cloud/agent";
import { parseToolArgs, runTool, stepLabel, TOOL_SPECS } from "./tools";
import { THIS_COMPUTER } from "@/utils/platform";

export type ChatItem =
	| { id: string; kind: "user"; text: string }
	| { id: string; kind: "agent"; text: string; undo?: { from: number; to: number } }
	| { id: string; kind: "step"; label: string; status: "running" | "done" | "error"; detail?: string }
	| { id: string; kind: "error"; text: string };

interface ApiMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
	tool_call_id?: string;
	/** Pictures from `look` (data URLs), sent with this message; never saved, and only the latest ones are resent. */
	images?: string[];
	/** Claude's own content blocks of this answer (thinking, tool calls): sent back unchanged on the next steps. */
	raw?: unknown;
}

type WirePart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type WireMessage = Omit<ApiMessage, "content" | "images"> & { content: string | WirePart[] };

interface Thread {
	items: ChatItem[];
	history: ApiMessage[];
}

interface AgentState {
	open: boolean;
	busy: boolean;
	threads: Record<string, Thread>;
	setOpen: (open: boolean) => void;
}

export const useAgentStore = create<AgentState>()(
	persist(
		(set) => ({
			open: false,
			busy: false,
			threads: {},
			setOpen: (open) => set({ open }),
		}),
		{
			name: "pointagent-chat",
			// Kept small: the last few turns of each project (long tool results are cut).
			partialize: (s) => ({
				threads: Object.fromEntries(
					Object.entries(s.threads).map(([id, t]) => [
						id,
						{
							items: t.items.filter((i) => i.kind !== "step" || i.status !== "running").slice(-80),
							history: fromUserTurn(t.history, 40).map((m) =>
								m.images ? { role: m.role, content: `${m.content} (pictures not kept)` } : m.role === "tool" ? { ...m, content: m.content.slice(0, 600) } : m,
							),
						},
					]),
				),
			}),
		},
	),
);

const EMPTY: Thread = { items: [], history: [] };
let controller: AbortController | null = null;
const uid = () => Math.random().toString(36).slice(2, 10);

function projectId(): string | null {
	return EditorCore.getInstance().project.getActiveOrNull()?.metadata.id ?? null;
}

function update(pid: string, change: (t: Thread) => Thread) {
	useAgentStore.setState((s) => ({ threads: { ...s.threads, [pid]: change(s.threads[pid] ?? EMPTY) } }));
}

const pushItem = (pid: string, item: ChatItem) => update(pid, (t) => ({ ...t, items: [...t.items, item] }));
const patchItem = (pid: string, id: string, patch: Partial<ChatItem>) =>
	update(pid, (t) => ({ ...t, items: t.items.map((i) => (i.id === id ? ({ ...i, ...patch } as ChatItem) : i)) }));
const pushHistory = (pid: string, m: ApiMessage) => update(pid, (t) => ({ ...t, history: [...t.history, m] }));

/** The last `max` messages, starting at a user message (a tool result never loses the call it answers). */
function fromUserTurn(history: ApiMessage[], max: number): ApiMessage[] {
	if (history.length <= max) return history;
	let start = history.length - max;
	while (start < history.length && (history[start].role !== "user" || history[start].images)) start++;
	return history.slice(start);
}

const SYSTEM = `You are Gaziyav AI, the editor's assistant inside Gaziyav, a video editor for Mac. You edit the user's open project yourself with the tools; the user watches the timeline and can fine-tune everything by hand afterwards.

How you work:
- Do it, don't ask. When a request is clear enough, act. Ask one short question only if you really can't guess (e.g. several clips and no hint which).
- Start with get_project (ids, times in seconds) once, plan the whole edit, then do it: several tool calls per step are fine. Read get_project again only after changes that create or remove clips (splits, imports, deletes, generation) — never twice in a row; re-reading without an edit in between gives you nothing new.
- "This clip", "it", "here" = the selected element, else the clip under the playhead.
- Use get_element before changing look/sound settings you don't know the keys of.
- Long jobs (YouTube download, generation, lipsync, tracking, AI effects) run on ${THIS_COMPUTER} and take from seconds to minutes; the tool returns when done.
- When the user asks for music: a ready track from the library (find_sound → add_sound, about −15 dB under speech); music is never generated.
- A step that failed twice: don't try it a third time; finish everything else and say what didn't work.
- Talk like a person, in the user's language: never show ids, parameter names, error codes or English error text; say in plain words what you did and what didn't work. Say only what you checked (don't claim a person is in frame unless you know).
- Whole tasks are yours: carry the request through to a finished result (e.g. "make a short from this YouTube video": download it, place it, cut it to the best parts, and whatever else the user asked).
- Lipsync, face changes and voice cloning: only for people who agreed; refuse to put words in a real public figure's mouth.
- Never invent ids, files or results. If a tool fails, try another way once, then tell the user plainly what's wrong.
- Don't write anything before or between tool calls; call the tools. At the end answer in the user's language, short: what you did in 1–2 sentences (no lists of steps, no markdown tables). They see the result on the timeline.

Your eyes (look) — you see what the user sees:
- Before choosing: look what='media' to see what each file shows; look frames to find the moment you need (who is in frame, where the face is, where there is room for text).
- After every visual change (titles, captions, effects, framing, B-roll, transitions): look at the frames where it shows, or what='playback' over the changed stretch, and fix what is off — text cut off or too small to read on a phone, text over a face or over other text, outside the safe zone, black or empty frames, a jump that looks wrong. Up to two fix rounds, then answer.
- Judge it as the viewer will see it, against what the user asked for.

What you make is what the user asks for — their words decide, not a formula. Do exactly what they ask, in the way they ask: no captions, music, titles, effects, transitions, sounds or voice they didn't ask for, and no fixed recipe applied to every video. When they hand you the whole job ("смонтируй", "make a reel", "make it interesting"), decide like a good editor what THIS footage needs — every video differently — and say in one line what you did.

Editor's know-how — use it when it serves the request, never as a checklist:
- Jump cuts on a talking head look smoother with a change of framing (e.g. scale 100 % ↔ 115 %).
- Text must be readable on a phone, off the face, out of the platform's UI zones (top ~12 %, bottom ~20 %, right ~15 % of a vertical frame).
- Music under speech sits around −15 dB; cuts on the beat (beat_markers) feel intentional; one transition style per video, hard cuts by default.
- Motion graphics: ready ones first (find_content kind=motion → add_motion, add_text_style for titles and plates); a plate, title or small infographic that doesn't exist yet: ai_template with the user's description (ordinary AI layers, editable).
- Facts on screen come from the speech, the user or web_search — never invented.
- Where content comes from: find_graphic / add_graphic (animated stickers, arrows, callouts), add_text_style (the Text tab's designed titles and plates), find_sound (music, effects), web_image (pictures), youtube (footage), local_files + import_file (the user's own files).
- Generating new footage or pictures (ai_generate, fal.ai) costs the user money: only when they ask to generate; pick the cheapest fitting model and length unless they ask for quality, and say what it cost in dollars.
- Voice-over only when the user asks, with the words they give: generate_voice (ready voices), revoice or lipsync (the person's own voice, only with their consent), dub (translation).

Editing raw talking footage when asked to (cut it, remove bad takes, clean it up):
- transcript first: retakes (the same line said again — keep the last complete one), false starts, stumbles, long pauses. One cut_out with all the ranges, then get_project again (times changed), then transcript again to check the remaining speech reads as whole, fluent sentences — fix if not.
- look what='playback' over the result to check the cuts, then do whatever else the user asked.`;

function context(): string {
	const ed = EditorCore.getInstance();
	const p = ed.project.getActiveOrNull();
	if (!p) return "";
	const sel = ed.selection.getSelectedElements().map((r) => r.elementId.slice(0, 8));
	return `\n\nNow: project "${p.metadata.name}", ${p.settings.canvasSize.width}×${p.settings.canvasSize.height}, ${Math.round(frameRateToFloat(p.settings.fps))} fps, ${(ed.timeline.getTotalDuration() / TICKS_PER_SECOND).toFixed(1)} s long, playhead ${(ed.playback.getCurrentTime() / TICKS_PER_SECOND).toFixed(1)} s${sel.length ? `, selected ${sel.join(", ")}` : ", nothing selected"}.`;
}

/**
 * Old tool results shrink: the model keeps the gist, the request stays small and fast — except the latest
 * get_project, kept whole: it holds the ids the edit needs (cut short, the model re-read it again and again).
 */
function compact(history: ApiMessage[]): WireMessage[] {
	const list = fromUserTurn(history, 60);
	const keepFull = list.length - 10;
	const projectCalls = new Set(list.flatMap((m) => (m.tool_calls ?? []).filter((c) => c.function.name === "get_project").map((c) => c.id)));
	let latestProject = -1;
	list.forEach((m, i) => {
		if (m.role === "tool" && projectCalls.has(m.tool_call_id ?? "")) latestProject = i;
	});
	const cut = list.map((m, i) => (m.role === "tool" && i < keepFull && i !== latestProject && m.content.length > 700 ? { ...m, content: `${m.content.slice(0, 700)}…` } : m));
	// Pictures: the last two looks are shown again (the model compares before / after), older ones only by name.
	const shown = new Set(cut.flatMap((m, i) => (m.images?.length ? [i] : [])).slice(-2));
	return cut.map((m, i): WireMessage => {
		const { images, ...rest } = m;
		if (!images?.length) return rest;
		if (!shown.has(i)) return { ...rest, content: `${m.content} (older pictures, not shown again)` };
		return { ...rest, content: [{ type: "text", text: m.content }, ...images.map((url): WirePart => ({ type: "image_url", image_url: { url } }))] };
	});
}

/** What a tool call acts on (its clip or media id), for counting failures per step. */
function failTarget(args: string): string {
	try {
		const a = JSON.parse(args) as Record<string, unknown>;
		return String(a.id ?? a.ids ?? a.media ?? "");
	} catch {
		return "";
	}
}

const READ_TOOLS = new Set(["get_project", "get_element", "list_effects", "list_transitions"]);

async function step(messages: WireMessage[], extraTools: unknown[], signal: AbortSignal): Promise<ApiMessage> {
	const send = () =>
		fetch("/api/studio/agent/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Studio": "1" },
			body: JSON.stringify({ messages, tools: [...TOOL_SPECS, ...extraTools] }),
			signal,
		});
	let res: Response;
	try {
		res = await send();
	} catch (error) {
		if (signal.aborted) throw error;
		// The app's own engine dropped the request (it restarts after a crash): a step only asks the model, nothing
		// was edited yet, so it is asked once more.
		await new Promise((r) => setTimeout(r, 1500));
		if (signal.aborted) throw new DOMException("Stopped", "AbortError");
		res = await send().catch((again) => {
			if (signal.aborted) throw again;
			throw new Error("Gaziyav AI lost the connection to the app's engine. Send your message again; if it repeats, restart Gaziyav.");
		});
	}
	const data = (await res.json().catch(() => null)) as { message?: ApiMessage; error?: string } | null;
	if (!res.ok || !data?.message) throw new Error(data?.error || "Gaziyav AI didn't answer. Check the internet connection and try again.");
	return data.message;
}

const MAX_STEPS = 80;

export async function sendToAgent(text: string) {
	const request = text.trim();
	const pid = projectId();
	if (!request || !pid || useAgentStore.getState().busy) return;
	const ed = EditorCore.getInstance();
	const depthBefore = ed.command.depth();
	controller = new AbortController();
	const { signal } = controller;
	useAgentStore.setState({ busy: true });
	pushItem(pid, { id: uid(), kind: "user", text: request });
	pushHistory(pid, { role: "user", content: request });
	let lastAgent: string | null = null;
	// The same read with nothing edited since: answered from memory, then refused (a model in a read loop
	// burnt every step on "Looking at the timeline" and never edited).
	const reads = new Map<string, { depth: number; content: string; repeats: number }>();
	const failures = new Map<string, number>();
	try {
		// Extra account tools (none since fal.ai: the generations are the agent's own tools).
		const pointTools = await pointAgentTools(signal).catch(() => []);
		for (let n = 0; n < MAX_STEPS; n++) {
			const history = useAgentStore.getState().threads[pid]?.history ?? [];
			// The state of the editor (playhead, selection) changes every step: it goes last, after the history, so
			// everything before it is the same request prefix as the step before and the model serves it from its
			// cache (measured: 7 % → 98 % of the prompt cached, first token 1.4 → 0.8 s).
			const now = context().trim();
			const message = await step([{ role: "system", content: SYSTEM }, ...compact(history), ...(now ? [{ role: "system" as const, content: now }] : [])], pointTools, signal);
			const calls = message.tool_calls?.filter((c) => c.type === "function" || c.function) ?? [];
			pushHistory(pid, { role: "assistant", content: message.content ?? "", ...(calls.length ? { tool_calls: calls } : {}), ...(message.raw ? { raw: message.raw } : {}) });
			// Notes the model writes between tool calls stay out of the chat: the steps say what is happening.
			if (message.content?.trim() && !calls.length) {
				lastAgent = uid();
				pushItem(pid, { id: lastAgent, kind: "agent", text: message.content.trim() });
			}
			if (!calls.length) break;
			// Pictures the tools saw go to the model right after all the tool answers of this step.
			const pictures: string[] = [];
			const picturesWhat: string[] = [];
			for (const call of calls) {
				const readKey = READ_TOOLS.has(call.function.name) ? `${call.function.name}:${call.function.arguments}` : null;
				const seen = readKey ? reads.get(readKey) : undefined;
				if (seen && seen.depth === ed.command.depth()) {
					seen.repeats++;
					pushHistory(pid, {
						role: "tool",
						tool_call_id: call.id,
						content:
							seen.repeats > 1
								? "Nothing changed since you read this. Stop reading: make the edit now with the editing tools, or answer the user."
								: `Unchanged since you read it (no edit since):\n${seen.content}`,
					});
					continue;
				}
				// Two strikes for the same step (tool + what it acts on), not for every use of that tool.
				const failKey = `${call.function.name}:${failTarget(call.function.arguments)}`;
				if ((failures.get(failKey) ?? 0) >= 2) {
					pushHistory(pid, { role: "tool", tool_call_id: call.id, content: "This failed twice already in this request: don't retry it. Finish the rest and tell the user what didn't work." });
					continue;
				}
				const id = uid();
				const point = isPointMcpTool(call.function.name);
				pushItem(pid, { id, kind: "step", label: point ? pointMcpLabel(call.function.name) : stepLabel(call.function.name, parseToolArgs(call.function.arguments)), status: "running" });
				const r = point ? await runPointMcpTool(call.function.name, call.function.arguments, signal) : await runTool(call.function.name, call.function.arguments, signal);
				if (!r.ok) failures.set(failKey, (failures.get(failKey) ?? 0) + 1);
				patchItem(pid, id, { status: r.ok ? "done" : "error", ...(r.ok ? {} : { detail: r.content.replace(/^Error: /, "") }) });
				pushHistory(pid, { role: "tool", tool_call_id: call.id, content: r.content });
				if (r.images?.length) {
					pictures.push(...r.images);
					picturesWhat.push(r.content);
				}
				if (readKey && r.ok) reads.set(readKey, { depth: ed.command.depth(), content: r.content, repeats: 0 });
			}
			if (pictures.length) pushHistory(pid, { role: "user", content: `What you looked at — ${picturesWhat.join(" Then: ")}`, images: pictures.slice(0, 6) });
			if (n === MAX_STEPS - 1) pushItem(pid, { id: uid(), kind: "agent", text: "That was a lot of steps — tell me if I should go on." });
		}
	} catch (error) {
		const e = error as Error;
		if (e.name === "AbortError" || signal.aborted) {
			pushItem(pid, { id: uid(), kind: "agent", text: "Stopped." });
			// The model must see an answer for every call it made: close the open ones.
			update(pid, (t) => ({ ...t, history: closeOpenCalls(t.history) }));
		} else {
			pushItem(pid, { id: uid(), kind: "error", text: e.message });
			update(pid, (t) => ({ ...t, history: closeOpenCalls(t.history) }));
		}
	} finally {
		update(pid, (t) => ({ ...t, items: t.items.map((i) => (i.kind === "step" && i.status === "running" ? { ...i, status: "error", detail: "Stopped" } : i)) }));
		const depthAfter = ed.command.depth();
		if (lastAgent && depthAfter > depthBefore) patchItem(pid, lastAgent, { undo: { from: depthBefore, to: depthAfter } });
		useAgentStore.setState({ busy: false });
		controller = null;
	}
}

function closeOpenCalls(history: ApiMessage[]): ApiMessage[] {
	const answered = new Set(history.filter((m) => m.role === "tool").map((m) => m.tool_call_id));
	const out: ApiMessage[] = [];
	for (const m of history) {
		out.push(m);
		for (const c of m.tool_calls ?? []) if (!answered.has(c.id)) out.push({ role: "tool", tool_call_id: c.id, content: "Stopped by the user." });
	}
	// A dangling assistant message with calls and nothing after is fine now; drop an empty trailing assistant.
	return out;
}

export function stopAgent() {
	controller?.abort();
}

/** Undoes a whole turn of the agent — only while nothing else was edited after it. */
export function canUndoTurn(undo: { from: number; to: number }): boolean {
	return EditorCore.getInstance().command.depth() === undo.to;
}

export function undoTurn(itemId: string, undo: { from: number; to: number }) {
	const ed = EditorCore.getInstance();
	if (!canUndoTurn(undo)) return;
	for (let i = undo.to; i > undo.from; i--) ed.command.undo();
	const pid = projectId();
	if (pid) patchItem(pid, itemId, { undo: undefined });
}

export function clearThread() {
	const pid = projectId();
	if (!pid || useAgentStore.getState().busy) return;
	useAgentStore.setState((s) => {
		const threads = { ...s.threads };
		delete threads[pid];
		return { threads };
	});
}
