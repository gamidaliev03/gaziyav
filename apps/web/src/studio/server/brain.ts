// One brain (the owner, 21.11): every text job of Gaziyav — the Post sheet's «Write with Gaziyav AI», titles and plates,
// caption rewriting and translation, the words to speak, AI Composition's plan — is answered by the Claude the user
// connected for the chat (the chat's own hidden connection, no API key, no model name outside the chat's picker). The
// app's main process forwards each request (GaziyavShell/modules/providers-ai-text.js → the chat's one-shot call):
//   server → app  { type: "ai-text-request", id, task, prompt, json }
//   app → server  { type: "ai-text", id, ok, text?, error? }
//   server → app  { type: "ai-status-request" }   app → server  { type: "ai-status", connected }
// Not connected: one plain line saying how to connect (BRAIN_OFF), nothing else breaks.
import { CancelledError, StudioError } from "./errors";

type Port = { on: (e: string, f: (m: unknown) => void) => void; postMessage: (m: unknown) => void };
type Pending = { resolve: (text: string) => void; reject: (e: Error) => void };
type Holder = {
	__gaziyavBrain?: { listening: boolean; connected: boolean | null; pending: Map<string, Pending>; waiters: Array<(v: boolean) => void>; seq: number };
	__gaziyavBrainTest?: ((r: BrainRequest) => Promise<string>) | null;
};
const g = globalThis as Holder;

export const BRAIN_OFF = "Gaziyav AI isn't connected: open the chat on the right and connect Claude.";

export interface BrainRequest {
	/** What the text is for, in a word or two (titles, captions, post, script, plan, translate…). */
	task: string;
	/** The feature's own instructions (the system text the old model got), sent as the call's system prompt. */
	system?: string;
	prompt: string;
	json?: boolean;
	/** A word of the model to answer with («fable», «sonnet»; default the app's, haiku). */
	model?: string;
	/** Pictures to look at (base64, the data: prefix allowed), up to 6. */
	images?: Array<{ data: string; mime: string }>;
	/** The language the user's words are wanted in ("ru", "en"…), when the feature knows it; else the app adds the
	 * interface's (providers-ai-text.js). */
	lang?: string;
}

const port = () => (process as unknown as { parentPort?: Port }).parentPort;

function state() {
	g.__gaziyavBrain ??= { listening: false, connected: null, pending: new Map(), waiters: [], seq: 0 };
	const s = g.__gaziyavBrain;
	const p = port();
	if (p && !s.listening) {
		s.listening = true;
		p.on("message", (m) => {
			const d = ((m as { data?: unknown })?.data ?? m) as { type?: string; id?: string; ok?: boolean; text?: unknown; error?: unknown; connected?: unknown };
			if (d?.type === "ai-status") {
				s.connected = d.connected === true;
				for (const w of s.waiters.splice(0)) w(s.connected);
			}
			if (d?.type === "ai-text" && typeof d.id === "string") {
				const job = s.pending.get(d.id);
				if (!job) return;
				s.pending.delete(d.id);
				if (d.ok && typeof d.text === "string") {
					s.connected = true;
					job.resolve(d.text);
				} else {
					const why = typeof d.error === "string" && d.error.trim() ? d.error.trim() : BRAIN_OFF;
					if (why === BRAIN_OFF) s.connected = false;
					job.reject(new StudioError(why));
				}
			}
		});
		p.postMessage({ type: "ai-status-request" });
	}
	return s;
}

/** Tests: answer every request with `fn` (null: back to the app). */
export function setBrainForTests(fn: ((r: BrainRequest) => Promise<string>) | null) {
	g.__gaziyavBrainTest = fn;
}

/**
 * Whether Gaziyav AI can answer, as last heard (no waiting): in the app it counts as yes until the app says no, so a
 * button is never greyed by a guess — the first request then answers in one line.
 */
export function brainReadyNow(): boolean {
	if (g.__gaziyavBrainTest) return true;
	if (!port()) return false;
	return state().connected !== false;
}

/**
 * Asks the app whether Claude is connected (at most `ms` of waiting). No answer at all (an app without the forwarding
 * module) is a no: the text features then keep their earlier AI, if one is set up (legacyReady in the callers).
 */
export async function brainReady(ms = 1500): Promise<boolean> {
	if (g.__gaziyavBrainTest) return true;
	const p = port();
	if (!p) return false;
	const s = state();
	const answer = new Promise<boolean>((resolve) => {
		s.waiters.push(resolve);
		setTimeout(() => resolve(s.connected === true), ms);
	});
	p.postMessage({ type: "ai-status-request" });
	return answer;
}

/** The JSON in an answer, whatever is around it (prose, a ```json fence), or null when there is none that parses. */
export function jsonIn(text: string): string | null {
	const tries: string[] = [];
	for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) tries.push(m[1].trim());
	tries.push(text.trim());
	for (const t of tries) {
		try {
			JSON.parse(t);
			return t;
		} catch {}
		// the widest object or array in it
		for (const [open, close] of [["{", "}"], ["[", "]"]] as const) {
			const a = t.indexOf(open);
			const b = t.lastIndexOf(close);
			if (a < 0 || b <= a) continue;
			const piece = t.slice(a, b + 1);
			try {
				JSON.parse(piece);
				return piece;
			} catch {}
		}
	}
	return null;
}

/** One call to the app (the chat's one-shot Claude): the text it answered. */
async function once(ask: BrainRequest, signal: AbortSignal | undefined, timeout: number): Promise<string> {
	if (g.__gaziyavBrainTest) return g.__gaziyavBrainTest(ask);
	const p = port();
	if (!p) throw new StudioError(BRAIN_OFF);
	const s = state();
	if (s.connected !== true && !(await brainReady())) throw new StudioError(BRAIN_OFF);
	const id = `b${Date.now().toString(36)}${(s.seq++).toString(36)}`;
	return new Promise<string>((resolve, reject) => {
		const done = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", stop);
		};
		const stop = () => {
			s.pending.delete(id);
			done();
			reject(new CancelledError());
		};
		const timer = setTimeout(() => {
			s.pending.delete(id);
			done();
			reject(new StudioError(BRAIN_SLOW));
		}, timeout * 1000);
		s.pending.set(id, {
			resolve: (t) => {
				done();
				resolve(t);
			},
			reject: (e) => {
				done();
				reject(e);
			},
		});
		signal?.addEventListener("abort", stop, { once: true });
		p.postMessage({ type: "ai-text-request", ...ask, id });
	});
}

export const BRAIN_SLOW = "Gaziyav AI took too long — nothing was changed.";
export const BRAIN_MISS = "Gaziyav AI didn't manage this — nothing was changed.";

/**
 * One answer as text. `json`: the JSON alone, whatever came around it; an answer with no JSON that parses is asked
 * again once, plainly, and failing that is one human line (BRAIN_MISS), never «unreadable».
 */
export async function brainAsk(r: BrainRequest, { signal, timeout = 240 }: { signal?: AbortSignal; timeout?: number } = {}): Promise<string> {
	if (signal?.aborted) throw new CancelledError();
	const ask: BrainRequest = {
		task: r.task || "text",
		...(r.system ? { system: r.system } : {}),
		prompt: r.prompt,
		json: !!r.json,
		...(r.lang ? { lang: r.lang } : {}),
		...(r.model ? { model: r.model } : {}),
		...(r.images?.length ? { images: r.images.slice(0, 6) } : {}),
	};
	const text = (await once(ask, signal, timeout)).trim();
	if (!ask.json) {
		if (!text) throw new StudioError(BRAIN_MISS);
		return text;
	}
	const got = jsonIn(text);
	if (got) return got;
	if (signal?.aborted) throw new CancelledError();
	const again = (
		await once({ ...ask, prompt: `${ask.prompt}\n\nYour previous answer was not valid JSON. Answer again with the JSON alone: no words, no code fences.` }, signal, timeout)
	).trim();
	const fixed = jsonIn(again);
	if (fixed) return fixed;
	throw new StudioError(BRAIN_MISS);
}

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type Turn = { role: "system" | "user" | "assistant"; content: string | Part[] };

const words = (c: Turn["content"]) => (typeof c === "string" ? c : c.map((p) => (p.type === "text" ? p.text : "[the picture below]")).join("\n"));

/** The pictures of a conversation (data: URLs of image_url parts), in order. */
export function imagesOf(messages: Turn[]): Array<{ data: string; mime: string }> {
	const out: Array<{ data: string; mime: string }> = [];
	for (const m of messages) {
		if (typeof m.content === "string") continue;
		for (const p of m.content) {
			if (p.type !== "image_url") continue;
			const hit = /^data:(image\/(?:png|jpeg|webp|gif));base64,([\s\S]+)$/.exec(p.image_url.url);
			if (hit) out.push({ mime: hit[1], data: hit[2] });
		}
	}
	return out.slice(0, 6);
}

/** A conversation (system + turns) as the one-shot call's system prompt and one prompt. */
export function promptOf(messages: Turn[], json?: boolean): { system: string; prompt: string } {
	const system = messages.filter((m) => m.role === "system").map((m) => words(m.content)).join("\n\n");
	const turns = messages.filter((m) => m.role !== "system");
	const talk =
		turns.length === 1 ? words(turns[0].content) : turns.map((m) => `${m.role === "user" ? "USER" : "YOU (earlier)"}:\n${words(m.content)}`).join("\n\n");
	return { system, prompt: [talk, json ? "Answer with one JSON object only, exactly in the shape the instructions give: no prose, no code fences." : ""].filter(Boolean).join("\n\n") };
}

/** The text features' old shape (system + messages): one brain behind it. */
export const brainChat = (task: string, messages: Turn[], o: { json?: boolean; signal?: AbortSignal; timeout?: number; lang?: string; model?: string } = {}) =>
	brainAsk({ task, ...promptOf(messages, o.json), json: o.json, ...(o.lang ? { lang: o.lang } : {}), ...(o.model ? { model: o.model } : {}), images: imagesOf(messages) }, { signal: o.signal, timeout: o.timeout });
