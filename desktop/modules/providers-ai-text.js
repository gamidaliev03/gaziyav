// One brain (the owner, 21.11): the web server's text jobs (titles, captions, the Post sheet's texts, the words to speak,
// AI Composition's plan — apps/web/src/studio/server/brain.ts) are answered by the chat's one-shot Claude call. This
// only carries the messages between the server and that call; it holds no key and no model choice.
//   server → app  { type: "ai-text-request", id, task, prompt, json }   app → server  { type: "ai-text", id, ok, text | error }
//   server → app  { type: "ai-status-request" }                         app → server  { type: "ai-status", connected }
// Hooked up by one line in main.js, after the server starts (each time it starts), by the chat worker:
//   require("./modules/providers-ai-text").attachServer(server, { text: (req) => <one-shot>(req), status: () => <status>() });
// `text({ task, prompt, json })` resolves to the answer's text; `status()` resolves to { connected } (or a boolean).
const OFF = "Gaziyav AI isn't connected: open the chat on the right and connect Claude.";
const MISS = "Gaziyav AI didn't manage this one: nothing was changed. Press the button once more.";

let server = null;
let options = { text: null, status: null };

const post = (m) => {
	try {
		server?.postMessage(m);
	} catch {}
};

async function connected() {
	try {
		const s = await options.status?.();
		return typeof s === "boolean" ? s : s?.connected === true || s?.ready === true;
	} catch {
		return false;
	}
}

/**
 * One call of the one-shot. It may answer a string, or (agent-host's oneShot) `{ ok, text, json?, error?, code? }`: the
 * text is taken from it — never the object itself (1.0.59: «[object Object]» reached the server as the answer). The
 * JSON is checked by the server (brain.ts), so the call is made as plain text; the feature's own system text goes as
 * the call's system prompt.
 */
async function ask(m) {
	const r = await options.text({ task: String(m.task ?? "text").slice(0, 40), system: String(m.system ?? ""), prompt: String(m.prompt ?? ""), json: false });
	if (typeof r === "string") return { ok: true, text: r };
	if (r && typeof r === "object") {
		if (r.ok === false) return { ok: false, error: typeof r.error === "string" ? r.error : "", code: r.code };
		if (typeof r.text === "string") return { ok: true, text: r.text };
		if (r.json !== undefined) return { ok: true, text: JSON.stringify(r.json) };
	}
	return { ok: false, error: "", code: "failed" };
}

async function answer(m) {
	const id = String(m.id ?? "");
	if (!id) return;
	if (typeof options.text !== "function" || !(await connected())) return post({ type: "ai-text", id, ok: false, error: OFF });
	try {
		let r = await ask(m);
		// a call that just didn't come back is made once more before anything is said
		if (!r.ok && r.code === "failed") r = await ask(m);
		if (r.ok) return post({ type: "ai-text", id, ok: true, text: r.text });
		const off = r.code === "sign-in" || r.code === "not-installed";
		post({ type: "ai-text", id, ok: false, error: off ? OFF : r.code === "failed" || !r.error || r.error.length >= 200 ? MISS : r.error });
	} catch (error) {
		// main.js's wrapper throws the call's own line (a connection to make, «still starting»): it is said as it is
		const said = String(error?.message ?? "");
		post({ type: "ai-text", id, ok: false, error: said && said.length < 200 ? said : MISS });
	}
}

/** The server was started (again): it is answered from now on. */
function attachServer(next, opts = {}) {
	options = { ...options, ...opts };
	server = next;
	next.on("message", (m) => {
		if (m?.type === "ai-text-request") void answer(m);
		if (m?.type === "ai-status-request") void connected().then((c) => post({ type: "ai-status", connected: c }));
	});
	void connected().then((c) => post({ type: "ai-status", connected: c }));
}

/** The chat connected or disconnected Claude: the server hears it at once. */
function statusChanged() {
	void connected().then((c) => post({ type: "ai-status", connected: c }));
}

module.exports = { attachServer, statusChanged };
