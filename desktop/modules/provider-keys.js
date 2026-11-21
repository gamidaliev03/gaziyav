// Keys of the other AI APIs (kie.ai): encrypted with the Mac's Keychain (Electron safeStorage) exactly like the fal.ai
// key in main.js, handed to the server as a message, never in its environment, never in a file in clear, never to the
// page. The page only sets or clears a key through the `gz:` channels; the server asks for it with «provider-key-request».
// Hooked up by one line in main.js, right after vpn.attachServer?.(server):
//   require("./modules/provider-keys").attachServer(server, { fromApp, test: TEST });
const fs = require("node:fs");
const path = require("node:path");
const { app, ipcMain, safeStorage } = require("electron");
const sealed = require("./seal").make({ userData: () => app.getPath("userData"), test: false, safeStorage });

// pexels / pixabay: free keys for stock video (B-roll for Claude's edits; Settings → AI), kept exactly like the others.
const PROVIDERS = { kie: { file: "kie-key", name: "kie.ai" }, argo: { file: "argo-key", name: "ArgoLink" }, pexels: { file: "pexels-key", name: "Pexels" }, pixabay: { file: "pixabay-key", name: "Pixabay" } };
// Settings → Services (21.11): the keys of the services each ability can use, kept exactly like the ones above.
Object.assign(PROVIDERS, {
	elevenlabs: { file: "elevenlabs-key", name: "ElevenLabs", min: 8 },
	inworld: { file: "inworld-key", name: "Inworld", min: 8 },
	cartesia: { file: "cartesia-key", name: "Cartesia", min: 8 },
	openai: { file: "openai-key", name: "OpenAI", min: 8 },
	google: { file: "google-key", name: "Google", min: 8 },
	openrouter: { file: "openrouter-key", name: "OpenRouter", min: 8 },
	brave: { file: "brave-key", name: "Brave Search", min: 8 },
	tavily: { file: "tavily-key", name: "Tavily", min: 8 },
	groq: { file: "groq-key", name: "Groq", min: 8 },
	azure: { file: "azure-key", name: "Microsoft Azure", min: 8 },
	doubao: { file: "doubao-key", name: "Doubao", min: 8 },
	mimo: { file: "mimo-key", name: "Xiaomi MiMo", min: 8 },
	keenable: { file: "keenable-key", name: "Keenable", min: 8 },
});

let server = null;
let options = { fromApp: () => false, test: false };
let registered = false;

const keyFile = (id) => path.join(app.getPath("userData"), `${PROVIDERS[id].file}${options.test ? ".test.txt" : ".bin"}`);

// Sealed with modules/seal.js (not the Mac's Keychain): no password prompt on launch, and the keys survive updates.
function read(id) {
	try {
		const file = keyFile(id);
		if (options.test) return fs.readFileSync(file).toString("utf8").trim() || null;
		return sealed.read(file);
	} catch {
		return null;
	}
}

function send(id) {
	try {
		server?.postMessage({ type: "provider-key", provider: id, key: read(id) ?? "" });
	} catch {}
}

function register() {
	if (registered) return;
	registered = true;
	ipcMain.handle("gz:keys:set", (event, id, value) => {
		if (!options.fromApp(event) || !PROVIDERS[id]) return { ok: false, error: "Refused" };
		const key = String(value ?? "").trim().replace(/^Bearer\s+/i, "");
		if (!key || /\s/.test(key) || key.length < (PROVIDERS[id].min ?? 16) || key.length > 400) return { ok: false, error: `That doesn't look like a whole ${PROVIDERS[id].name} key. Copy it again.` };
		try {
			if (options.test) fs.writeFileSync(keyFile(id), key, { mode: 0o600 });
			else sealed.write(keyFile(id), key);
			fs.chmodSync(keyFile(id), 0o600);
		} catch (error) {
			return { ok: false, error: `The key couldn't be saved: ${String(error?.message ?? error)}` };
		}
		send(id);
		return { ok: true };
	});
	ipcMain.handle("gz:keys:clear", (event, id) => {
		if (!options.fromApp(event) || !PROVIDERS[id]) return { ok: false };
		fs.rmSync(keyFile(id), { force: true });
		send(id);
		return { ok: true };
	});
}

/** The server was started (again): it gets the keys now and whenever it asks. */
function attachServer(next, opts) {
	options = { ...options, ...opts };
	server = next;
	register();
	next.on("message", (m) => {
		if (m?.type === "provider-key-request" && PROVIDERS[m.provider]) send(m.provider);
	});
	for (const id of Object.keys(PROVIDERS)) send(id);
}

module.exports = { attachServer };
