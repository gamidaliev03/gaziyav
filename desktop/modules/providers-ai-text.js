// One brain (the owner, 21.11): the web server's text jobs (titles, captions, the Post sheet's texts, the words to speak,
// AI Composition's plan — apps/web/src/studio/server/brain.ts) are answered by the chat's one-shot Claude call. This
// only carries the messages between the server and that call; it holds no key and no model choice.
//   server → app  { type: "ai-text-request", id, task, prompt, json }   app → server  { type: "ai-text", id, ok, text | error }
//     (+ optional `images: [{ data: base64, mime }]`, up to 6 pictures the answer is about, and `model`: «haiku» default,
//      «sonnet», «opus»… — a word of the session's own model list; agent-host.js oneShot)
//   server → app  { type: "ai-status-request" }                         app → server  { type: "ai-status", connected }
// Hooked up by one line in main.js, after the server starts (each time it starts), by the chat worker:
//   require("./modules/providers-ai-text").attachServer(server, { text: (req) => <one-shot>(req), status: () => <status>() });
// `text({ task, prompt, json })` resolves to the answer's text; `status()` resolves to { connected } (or a boolean);
// `language()` (optional) the interface's language code, said to Claude when the feature names none.
const OFF = "Gaziyav AI isn't connected: open the chat on the right and connect Claude.";
const MISS = "Gaziyav AI didn't manage this — nothing was changed.";
const SIGN_IN = "Sign in to Claude in the chat on the right.";
const OFFLINE = "No connection to Claude — check the internet. Nothing was changed.";
const LIMIT = "Claude's limit is used up for now — nothing was changed.";

/**
 * Why a call failed, as one line (the web side has each in Russian): from the call's code when it gives one
 * (agent-host oneShot: not-installed, sign-in, offline, limit, not-ready…), else from its words.
 */
function why(code, text) {
	const c = String(code ?? "");
	const t = String(text ?? "");
	if (c === "not-installed" || /not installed|не установлен/i.test(t)) return OFF;
	if (c === "sign-in" || /sign.?in|log.?in|logged out|authenticat|unauthori[sz]ed|войдите|не вошли/i.test(t)) return SIGN_IN;
	if (c === "offline" || /ENOTFOUND|ECONN|EAI_AGAIN|ETIMEDOUT|getaddrinfo|fetch failed|network|offline|socket hang up|нет (связи|сети|интернета)/i.test(t)) return OFFLINE;
	if (c === "limit" || /usage limit|rate.?limit|limit (reached|exceeded|hit)|quota|out of (usage|credits)|лимит/i.test(t)) return LIMIT;
	if (c === "not-ready" && t && t.length < 200) return t;
	return MISS;
}

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
const NAMES = { ru: "Russian", en: "English", av: "Avar", ce: "Chechen", dar: "Dargwa", kum: "Kumyk", lbe: "Lak", lez: "Lezgian", tg: "Tajik", hy: "Armenian" };

/** The language the user's words are written in: the feature's own (`lang`), else the interface's (`options.language`). */
function languageLine(m) {
	let code = typeof m.lang === "string" && m.lang ? m.lang : "";
	if (!code) {
		try {
			code = String(options.language?.() ?? "");
		} catch {}
	}
	code = code.toLowerCase().split(/[-_]/)[0];
	const name = NAMES[code];
	return name ? `\n\nLanguage: every word meant for the user (titles, texts, descriptions, labels, hashtags) is in ${name}, whatever language the material or these instructions are in; names stay as they are.` : "";
}

async function ask(m) {
	const r = await options.text({ task: String(m.task ?? "text").slice(0, 40), system: `${String(m.system ?? "")}${languageLine(m)}`.trim(), prompt: String(m.prompt ?? ""), json: false, ...(Array.isArray(m.images) && m.images.length ? { images: m.images } : {}), ...(typeof m.model === "string" && m.model ? { model: m.model } : {}) });
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
		post({ type: "ai-text", id, ok: false, error: why(r.code, r.error) });
	} catch (error) {
		// main.js's wrapper throws the call's own line (and its code, when it passes one)
		post({ type: "ai-text", id, ok: false, error: why(error?.code, error?.message) });
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
