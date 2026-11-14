// Keys of the other AI APIs (kie.ai): encrypted with the Mac's Keychain (Electron safeStorage) exactly like the fal.ai
// key in main.js, handed to the server as a message, never in its environment, never in a file in clear, never to the
// page. The page only sets or clears a key through the `gz:` channels; the server asks for it with «provider-key-request».
// Hooked up by one line in main.js, right after vpn.attachServer?.(server):
//   require("./modules/provider-keys").attachServer(server, { fromApp, test: TEST });
const fs = require("node:fs");
const path = require("node:path");
const { app, ipcMain, safeStorage } = require("electron");

// pexels / pixabay: free keys for stock video (B-roll for Claude's edits; Settings → AI), kept exactly like the others.
const PROVIDERS = { kie: { file: "kie-key", name: "kie.ai" }, argo: { file: "argo-key", name: "ArgoLink" }, pexels: { file: "pexels-key", name: "Pexels" }, pixabay: { file: "pixabay-key", name: "Pixabay" } };

let server = null;
let options = { fromApp: () => false, test: false };
let registered = false;

const keyFile = (id) => path.join(app.getPath("userData"), `${PROVIDERS[id].file}${options.test ? ".test.txt" : ".bin"}`);

function read(id) {
	try {
		const raw = fs.readFileSync(keyFile(id));
		if (options.test) return raw.toString("utf8").trim() || null;
		if (!safeStorage.isEncryptionAvailable()) return null;
		return safeStorage.decryptString(raw).trim() || null;
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
		if (!key || /\s/.test(key) || key.length < 16 || key.length > 400) return { ok: false, error: `That doesn't look like a whole ${PROVIDERS[id].name} key. Copy it again.` };
		try {
			if (options.test) fs.writeFileSync(keyFile(id), key, { mode: 0o600 });
			else {
				if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: "The Mac's Keychain isn't available. Unlock it and try again." };
				fs.writeFileSync(keyFile(id), safeStorage.encryptString(key), { mode: 0o600 });
			}
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
