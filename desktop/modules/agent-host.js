// The chat column beside the editor: the person's own Claude Code (their subscription, over the Agent Client Protocol)
// editing the open project through Gaziyav's own connector (Resources/mcp, the `mcp__Gaziyav__*` tools).
//
// Taken from OpenFilm's desktop app (MIT, © OpenFilm contributors; modules/agent/LICENSE-OpenFilm): its agent host
// (modules/agent/*.mjs: agents, local-agents-ipc, chat-ipc, chat-store, skills-ipc, agent-skills…) and its chat page
// (modules/agent/page, built from GaziyavShell/chat). Here only the wiring: where the chat keeps its data, the view it
// is shown in, the tools its agent gets.
//
// Isolation: the chat is a page of its own in a view of its own; the agent host is loaded the first time the chat is
// opened. Claude missing, slow or failing never reaches the editor: every call here is caught, and the editor page is
// never touched (it is only told it is narrower while the column is shown, by viewport emulation).
"use strict";
const { app, ipcMain, WebContentsView, shell, dialog, protocol, net, nativeTheme, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SCHEME = "gaziyav-chat";
const PAGE_DIR = path.join(__dirname, "agent", "page");
const AGENT_DIR = path.join(__dirname, "agent");
const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const EDITOR_MIN = 640;

// before the app is ready: the chat's page is served from its own scheme (modules load from it as from a site)
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let opts = null; // { getWindow, origin, test, log, language }
let view = null;
let shown = false;
let docked = false;
let project = null; // { id, name, path }
let layout = { open: true, width: 400 };
let host = null; // the ESM modules, once loaded
let lipc = null; // registerLocalAgentIpc's handle
const listeners = new Set();

const dataDir = () => path.join(app.getPath("userData"), "Chat");
const layoutFile = () => path.join(dataDir(), "layout.json");
const projectsDir = () => path.join(dataDir(), "projects");
const log = (...a) => {
	try {
		opts?.log?.("[chat]", ...a);
	} catch {}
};

function readLayout() {
	try {
		const raw = JSON.parse(fs.readFileSync(layoutFile(), "utf8"));
		layout = { open: raw.open !== false, width: clampWidth(Number(raw.width) || 400) };
	} catch {}
}
function saveLayout() {
	try {
		fs.mkdirSync(dataDir(), { recursive: true });
		fs.writeFileSync(layoutFile(), JSON.stringify(layout));
	} catch {}
}
function clampWidth(w) {
	return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(w)));
}

/** The folder the chat keeps a project's conversations in (and its agent works in): Chat/projects/<id>. */
function projectFolder(id) {
	const safe = String(id).replace(/[^\w.-]/g, "_").slice(0, 120) || "project";
	const dir = path.join(projectsDir(), safe);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

/** The project the editor shows, from its address (/editor/<id>); null on the projects list. */
function projectOf(win) {
	try {
		const u = new URL(win.webContents.getURL());
		const m = /^\/editor\/([^/?#]+)/.exec(u.pathname);
		if (!m) return null;
		const id = decodeURIComponent(m[1]);
		const title = String(win.getTitle() || "").replace(/\s*[—–-]\s*Gaziyav\s*$/i, "").trim();
		return { id, name: title && !/^gaziyav$/i.test(title) ? title : id, path: projectFolder(id) };
	} catch {
		return null;
	}
}

function tell(channel, value) {
	if (view && !view.webContents.isDestroyed()) view.webContents.send(channel, value);
}

function language() {
	try {
		const code = opts.language();
		return code === "ru" ? "ru" : code === "en" ? "en-US" : code;
	} catch {
		return "ru";
	}
}

// ---------- the column ----------

function ensureView(win) {
	if (view && !view.webContents.isDestroyed()) return view;
	view = new WebContentsView({
		webPreferences: {
			preload: path.join(__dirname, "agent-chat-preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			spellcheck: false,
			// a long job keeps going with the window in the background (its turn's updates, its timers)
			backgroundThrottling: false,
		},
	});
	view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#0b0d10" : "#ffffff");
	view.webContents.loadURL(`${SCHEME}://chat/index.html`).catch((e) => log("page", e.message));
	// links in replies open in the browser, never in the column
	view.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:\/\//.test(url)) shell.openExternal(url).catch(() => {});
		return { action: "deny" };
	});
	view.webContents.on("will-navigate", (e, url) => {
		if (!url.startsWith(`${SCHEME}://`)) e.preventDefault();
	});
	view.webContents.on("render-process-gone", (_e, d) => {
		log("chat page gone", d?.reason);
		setTimeout(() => {
			if (view && !view.webContents.isDestroyed()) view.webContents.reload();
		}, 1000);
	});
	if (opts.test && process.env.GZ_CHAT_DEVTOOLS === "1") view.webContents.openDevTools({ mode: "detach" });
	return view;
}

/** Puts the column at the right of the window (or takes it away) and tells the editor how wide it is now. */
function place() {
	const win = opts?.getWindow?.();
	if (!win || win.isDestroyed()) return;
	const p = projectOf(win);
	const want = layout.open && Boolean(p);
	if (p && (!project || project.id !== p.id || project.name !== p.name)) {
		project = p;
		tell("gz-chat:project", project);
	}
	const wc = win.webContents;
	const [w, h] = win.getContentSize();
	if (!want) {
		if (docked) {
			try {
				win.contentView.removeChildView(view);
			} catch {}
			docked = false;
			try {
				wc.disableDeviceEmulation();
			} catch {}
		}
		shown = false;
		return;
	}
	const v = ensureView(win);
	const width = Math.min(clampWidth(layout.width), Math.max(0, w - EDITOR_MIN));
	if (!docked) {
		win.contentView.addChildView(v);
		docked = true;
	}
	v.setBounds({ x: w - width, y: 0, width, height: h });
	try {
		wc.enableDeviceEmulation({
			screenPosition: "desktop",
			screenSize: { width: 0, height: 0 },
			viewPosition: { x: 0, y: 0 },
			deviceScaleFactor: 0,
			viewSize: { width: w - width, height: h },
			scale: 1,
		});
	} catch (e) {
		log("emulation", e.message);
	}
	if (!shown) {
		shown = true;
		void loadHost().catch((e) => log("host", e.message));
	}
}

function setOpen(open) {
	layout.open = open === true;
	saveLayout();
	place();
	tell("gz-chat:open", layout.open);
	for (const l of listeners) l(layout.open);
}

// ---------- the agent host (OpenFilm's modules, ESM) ----------

const resources = () => (app.isPackaged ? process.resourcesPath : process.env.GZ_RESOURCES || process.resourcesPath);
const mcpScript = () => path.join(resources(), "mcp", "server.mjs");
const bundleDir = () => path.resolve(process.execPath, "..", "..", "..");
/** the skills the app brings: Gaziyav's editing skill and the ported ones (modules/agent/skills) */
const bundledSkills = () => path.join(AGENT_DIR, "skills");

/** Gaziyav's connector as the agent's MCP server (stdio), on the app's own Node, pointed at this running editor. */
function gaziyavMcp() {
	const script = mcpScript();
	if (!fs.existsSync(script)) return [];
	const env = {
		ELECTRON_RUN_AS_NODE: "1",
		GAZIYAV_SUPPORT_DIR: app.getPath("userData"),
		GAZIYAV_URL: opts.origin,
		GAZIYAV_NO_LAUNCH: "1",
		GAZIYAV_APP: bundleDir(),
	};
	return [{ name: "Gaziyav", command: process.execPath, args: [script], env: Object.entries(env).map(([name, value]) => ({ name, value })) }];
}

let hostLoading = null;
function loadHost() {
	if (host) return Promise.resolve(host);
	if (hostLoading) return hostLoading;
	hostLoading = (async () => {
		// where OpenFilm's modules keep things: all inside Gaziyav's own data (a test copy: its throwaway profile)
		const ud = app.getPath("userData");
		process.env.OPENFILM_HOME = path.join(ud, "Chat", "home");
		process.env.OPENFILM_SKILLS = path.join(ud, "Skills");
		process.env.OPENFILM_OFFICIAL_SKILLS = bundledSkills();
		process.env.OPENFILM_LIBRARY = path.join(ud, "Chat", "library");
		const imp = (f) => import(pathToFileURL(path.join(AGENT_DIR, f)).href);
		const [agents, lipcMod, chatIpc, skillsIpc] = await Promise.all([imp("agents.mjs"), imp("local-agents-ipc.mjs"), imp("chat-ipc.mjs"), imp("skills-ipc.mjs")]);
		host = { agents, lipcMod, chatIpc, skillsIpc };
		registerHostIpc();
		return host;
	})().catch((e) => {
		hostLoading = null;
		throw e;
	});
	return hostLoading;
}

const trusted = (event) => Boolean(view && !view.webContents.isDestroyed() && event.sender === view.webContents);
const knownProjects = async () => {
	try {
		return fs.readdirSync(projectsDir()).map((n) => path.join(projectsDir(), n));
	} catch {
		return [];
	}
};

/** The conversation's opening words: where it is and how to act (agents.mjs GZ_ONE_INSTRUCTIONS), the connector's tools
    as the editor last listed them, and the skills switched on now. */
function openingWords(skillNames) {
	let tools = [];
	try {
		tools = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "mcp", "tools.json"), "utf8")).map((t) => t?.name).filter(Boolean);
	} catch {}
	const lines = [host.agents.GZ_ONE_INSTRUCTIONS, ""];
	if (tools.length) lines.push(`Your Gaziyav tools now: ${tools.join(", ")} (all allowed, none needs approval).`);
	if (skillNames?.length) lines.push(`Your skills now (read the one a task needs with the Skill tool): ${skillNames.map((n) => n.replace(/^gaziyav-/, "")).join(", ")}.`);
	return lines.join("\n");
}

/** Claude Code as the chat's one agent: ready, to sign in, or not on this Mac. */
async function roster(fresh = false) {
	let state = null;
	try {
		state = host ? await host.agents.localAgent("claude", { fresh }) : null;
	} catch (e) {
		log("roster", e.message);
	}
	const status = !host ? "checking" : !state?.cli ? "missing" : state.signedIn === false ? "sign-in" : "ready";
	return [
		{
			id: "claude",
			name: "Claude",
			shown: true,
			status,
			install: status === "missing" ? "https://claude.com/download" : null,
			...(state?.account ? { account: { method: state.account.method, ...(state.account.plan ? { plan: state.account.plan } : {}) } } : {}),
		},
	];
}
async function tellRoster(fresh) {
	tell("desktop:agents", await roster(fresh));
}

function registerHostIpc() {
	const { agents, lipcMod, chatIpc, skillsIpc } = host;
	lipc = lipcMod.registerLocalAgentIpc(ipcMain, {
		trusted,
		env: { OPENFILM_HOME: process.env.OPENFILM_HOME },
		log: (line) => log(String(line).trim()),
		skills: { dataDir: dataDir(), prefsHome: process.env.OPENFILM_HOME, mine: process.env.OPENFILM_SKILLS },
		sessionExtra: {
			// Gaziyav's tools without asking; Skill (to read a skill), Read (its files), nothing that changes files or runs
			gaziyav: { mcp: async () => gaziyavMcp(), tools: ["Skill", "Read", "TodoWrite"], allowed: ["mcp__Gaziyav", "Skill", "Read", "TodoWrite"], instructions: openingWords },
		},
		onConnectionResult: () => void tellRoster(false),
	});
	chatIpc.registerChatIpc(ipcMain, {
		trusted,
		projects: knownProjects,
		dataDir: dataDir(),
		reveal: (p) => shell.showItemInFolder(p),
		trash: (p) => shell.trashItem(p),
		tell,
		log: (line) => log(String(line).trim()),
		filmPutBack: async () => {},
	});
	skillsIpc.registerSkillsIpc(ipcMain, {
		trusted,
		projects: knownProjects,
		dataDir: dataDir(),
		mine: process.env.OPENFILM_SKILLS,
		prefsHome: process.env.OPENFILM_HOME,
		reveal: (p) => shell.openPath(p),
		pickFolder: async (words) => {
			const win = opts.getWindow?.();
			const r = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, {
				properties: ["openDirectory"],
				title: words?.title ?? undefined,
				buttonLabel: words?.button ?? undefined,
			});
			return r.canceled ? null : r.filePaths[0] ?? null;
		},
		refreshSkills: (agent) => lipc?.refreshSkills(agent),
		log: (line) => log(String(line).trim()),
	});
	registerSkillScreen();
	ipcMain.handle("desktop:agents:list", async (event) => (trusted(event) ? roster(false) : []));
	ipcMain.handle("desktop:agents:connect", async (event) => {
		if (!trusted(event)) return { ok: false };
		const r = await agents.openAgentSignIn("claude", { track: true }).catch((e) => ({ ok: false, error: e.message }));
		// signed in in Terminal: the roster is asked again a few times while the person does it
		for (const ms of [5000, 15000, 30000, 60000]) setTimeout(() => void tellRoster(true), ms).unref?.();
		return r;
	});
	ipcMain.handle("desktop:agents:refresh", async (event) => (trusted(event) ? roster(true) : []));
	ipcMain.handle("desktop:diagnostics:copy", async () => ({ ok: false }));
}

// ---------- the skills screen: Gaziyav's catalog (skills-gaziyav/catalog.json), grouped, each on or off ----------

const catalogFile = () => path.join(bundledSkills(), "catalog.json");
function readCatalog() {
	try {
		return JSON.parse(fs.readFileSync(catalogFile(), "utf8"));
	} catch {
		return { groups: [], skills: [] };
	}
}
const pick = (words, lang) => (words && typeof words === "object" ? words[lang] ?? words.en ?? words.ru ?? "" : String(words ?? ""));
const firstLine = (text) => String(text ?? "").split(/(?<=[.!?])\s|\n/)[0].trim();

/** Every skill of the catalog (its groups, its order) and the person's own (group «Мои»), each with its switch. */
async function skillScreen() {
	const lib = await import(pathToFileURL(require.resolve("openfilm/skills", { paths: [AGENT_DIR] })).href);
	const home = process.env.OPENFILM_HOME;
	const off = new Set(lib.skillsOff(home));
	const listed = lib.listSkills({});
	const lang = language() === "ru" ? "ru" : "en";
	const cat = readCatalog();
	const groups = (cat.groups ?? []).map((g) => ({ id: g.id, title: pick(g.title, lang) }));
	const skills = [];
	for (const e of cat.skills ?? []) {
		if (e.available === false) continue;
		const found = listed.find((s) => s.source === "official" && s.name === e.name);
		if (!found) continue;
		skills.push({ name: e.name, uid: found.uid, group: e.group, icon: e.icon ?? null, title: pick(e.title, lang) || e.name, line: firstLine(pick(e.description, lang)) || firstLine(found.description), on: !lib.keeps(off, found), locked: e.locked === true });
	}
	const mine = listed.filter((s) => s.source === "mine");
	if (mine.length) groups.push({ id: "mine", title: lang === "ru" ? "Мои" : "Mine" });
	for (const s of mine) skills.push({ name: s.name, uid: s.uid, group: "mine", icon: null, title: s.shown?.title?.[lang] ?? s.name, line: firstLine(s.description), on: !lib.keeps(off, s), locked: false });
	return { groups, skills };
}

/** The catalog's skills that start off (`default: "off"`), turned off once, the first time (the person's choice wins after). */
async function seedDefaults() {
	const mark = path.join(process.env.OPENFILM_HOME, "skills-seeded.json");
	if (fs.existsSync(mark)) return;
	try {
		const lib = await import(pathToFileURL(require.resolve("openfilm/skills", { paths: [AGENT_DIR] })).href);
		const listed = lib.listSkills({});
		for (const e of readCatalog().skills ?? []) {
			const found = listed.find((s) => s.source === "official" && s.name === e.name);
			if (found && e.default === "off" && e.locked !== true) lib.setSkillOn(found.uid, false, process.env.OPENFILM_HOME);
		}
		fs.mkdirSync(path.dirname(mark), { recursive: true });
		fs.writeFileSync(mark, JSON.stringify({ at: new Date().toISOString() }));
	} catch (e) {
		log("skills seed", e.message);
	}
}

function registerSkillScreen() {
	void seedDefaults();
	ipcMain.handle("gz-skills:list", async (event) => (trusted(event) ? skillScreen() : null));
	ipcMain.handle("gz-skills:set", async (event, a) => {
		if (!trusted(event)) return null;
		const screen = await skillScreen();
		const skill = screen.skills.find((s) => s.uid === a?.uid);
		if (!skill || skill.locked) return screen;
		const lib = await import(pathToFileURL(require.resolve("openfilm/skills", { paths: [AGENT_DIR] })).href);
		lib.setSkillOn(skill.uid, a.on === true, process.env.OPENFILM_HOME);
		// the conversations take it up: each agent session closes (one at work once its turn ends) and opens again with it
		lipc?.refreshSkills();
		return skillScreen();
	});
	// the cards of an empty conversation: the catalog's skills that are on, in its order (not the editing basics)
	ipcMain.handle("gz-skills:starters", async (event) => {
		if (!trusted(event)) return [];
		const { skills } = await skillScreen();
		return skills.filter((s) => s.on && !s.locked && s.group !== "mine").slice(0, 6).map((s) => ({ name: s.uid.replace("/", "-"), description: s.line, icon: s.icon, title: s.title }));
	});
}

// ---------- the page's own channels (no agent needed) ----------

function registerPageIpc() {
	ipcMain.handle("desktop:hello", async (event) => {
		if (!trusted(event)) return null;
		return {
			flavor: "gaziyav",
			version: app.getVersion(),
			ffmpeg: true,
			update: null,
			chatOpen: layout.open,
			chatWidth: layout.width,
			chatMin: MIN_WIDTH,
			studioMin: EDITOR_MIN,
			fullScreen: false,
			language: language(),
			theme: nativeTheme.shouldUseDarkColors ? "dark" : "light",
			project,
		};
	});
	ipcMain.handle("desktop:reveal", (event, p) => {
		if (trusted(event) && typeof p === "string") shell.showItemInFolder(p);
	});
	ipcMain.handle("desktop:pick-folder", async (event, o) => {
		if (!trusted(event)) return null;
		const win = opts.getWindow?.();
		const r = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, { properties: ["openDirectory"], title: o?.title, buttonLabel: o?.button });
		return r.canceled ? null : r.filePaths[0] ?? null;
	});
	ipcMain.on("gz-chat:width", (event, width, done) => {
		if (!trusted(event) || !Number.isFinite(width)) return;
		layout.width = clampWidth(width);
		place();
		if (done) saveLayout();
	});
	ipcMain.on("gz-chat:set-open", (event, open) => {
		if (trusted(event)) setOpen(open === true);
	});
	ipcMain.handle("gz-chat:ready", async (event) => {
		if (!trusted(event)) return null;
		await loadHost().catch((e) => log("host", e.message));
		void tellRoster(false);
		return { ok: Boolean(host) };
	});
	// the editor's own button for the column (preload.js studioApp.chat)
	ipcMain.handle("gz-chat:toggle", (event, open) => {
		const win = opts.getWindow?.();
		if (!win || event.sender !== win.webContents) return layout.open;
		setOpen(typeof open === "boolean" ? open : !layout.open);
		return layout.open;
	});
	ipcMain.handle("gz-chat:state", (event) => {
		const win = opts.getWindow?.();
		if (!win || event.sender !== win.webContents) return null;
		return { open: layout.open, width: layout.width };
	});
}

// ---------- one question to Claude, no tools (Gaziyav AI's text jobs) ----------

/**
 * One text answer from the person's Claude: no tools, no MCP, no settings files, the app's words as the whole system
 * prompt. `task`: what kind of job (logs only); `json`: the answer is parsed as JSON (the first {…} or […] in it).
 * @returns {Promise<{ ok: true, text: string, json?: unknown } | { ok: false, error: string, code?: string }>}
 */
async function oneShot({ task = "text", prompt = "", system = "", json = false, model = "" } = {}) {
	try {
		await loadHost();
	} catch {
		return { ok: false, error: words().notReady, code: "not-ready" };
	}
	const text = String(prompt ?? "").slice(0, 200_000);
	if (!text.trim()) return { ok: false, error: words().empty, code: "empty" };
	let said = "";
	const dir = path.join(dataDir(), "oneshot");
	fs.mkdirSync(dir, { recursive: true });
	const session = new host.agents.AgentSession({
		agent: "claude",
		cwd: dir,
		answerOnly: true,
		env: {},
		minimal: { tools: [], systemPrompt: system || "You are Gaziyav AI, the writing helper of a video editor. Answer with exactly the text asked for, in the language asked for, nothing around it." },
		onUpdate: (u) => {
			if (u?.sessionUpdate === "agent_message_chunk" && u.content?.type === "text") said += u.content.text ?? "";
		},
		onQuestion: async () => null,
	});
	const started = Date.now();
	try {
		const info = await session.start();
		const want = String(model || "haiku").toLowerCase();
		const opt = info.configOptions?.find((o) => o?.category === "model");
		const choice = opt?.options?.find((c) => `${c.value} ${c.name ?? ""}`.toLowerCase().includes(want));
		if (choice && opt.currentValue !== choice.value) await session.setConfigOption(opt.id, choice.value).catch(() => {});
		await session.prompt([{ type: "text", text: json ? `${text}\n\nAnswer with JSON only.` : text }]);
		log(`oneshot ${task}: ${Date.now() - started} ms`);
		if (!json) return { ok: true, text: said.trim() };
		const m = /[[{][\s\S]*[\]}]/.exec(said);
		try {
			return { ok: true, text: said.trim(), json: JSON.parse(m ? m[0] : said) };
		} catch {
			return { ok: false, error: words().failed, code: "bad-json" };
		}
	} catch (e) {
		log(`oneshot ${task} failed: ${String(e?.message ?? e).slice(0, 300)}`);
		const code = e?.code === "not-installed" ? "not-installed" : e?.code === "sign-in" ? "sign-in" : "failed";
		return { ok: false, error: code === "failed" ? words().failed : words().connect, code };
	} finally {
		session.close();
	}
}
async function oneShotStatus() {
	try {
		await loadHost();
	} catch {
		return { ready: false, state: "checking", line: words().notReady };
	}
	const [a] = await roster(false);
	return { ready: a.status === "ready", state: a.status, line: a.status === "ready" ? "" : words().connect };
}
function words() {
	const ru = language() === "ru";
	return ru
		? { connect: "Подключите Claude: откройте чат справа и нажмите «Подключить».", failed: "Gaziyav AI сейчас не ответил.", empty: "Нечего отправить.", notReady: "Gaziyav AI ещё запускается." }
		: { connect: "Connect Claude: open the chat on the right and press Connect.", failed: "Gaziyav AI didn't answer.", empty: "Nothing to send.", notReady: "Gaziyav AI is still starting." };
}

/**
 * @param {{ getWindow: () => BrowserWindow | null, origin: string, test: boolean, log: (...a: any[]) => void, language: () => string }} o
 */
function register(o) {
	opts = o;
	readLayout();
	protocol.handle(SCHEME, (req) => {
		const u = new URL(req.url);
		const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "") || "index.html";
		const file = path.resolve(PAGE_DIR, rel);
		if (!file.startsWith(PAGE_DIR + path.sep)) return new Response("", { status: 404 });
		return net.fetch(pathToFileURL(file).href);
	});
	registerPageIpc();
	ipcMain.handle("gaziyav-ai:text", async (event, a) => oneShot(a ?? {}));
	ipcMain.handle("gaziyav-ai:status", async () => oneShotStatus());
	setImmediate(place);
}

/** Follows the editor window: its address (a project or the list), its size. */
function attach(win) {
	const again = () => setImmediate(() => {
		if (opts) place();
	});
	win.on("resize", again);
	win.on("enter-full-screen", again);
	win.on("leave-full-screen", again);
	win.on("page-title-updated", again);
	win.webContents.on("did-navigate", again);
	win.webContents.on("did-navigate-in-page", again);
	win.webContents.on("did-finish-load", again);
	win.on("closed", () => {
		docked = false;
		shown = false;
		if (view && !view.webContents.isDestroyed()) view.webContents.close();
		view = null;
	});
}

module.exports = {
	register,
	attach,
	toggle: () => setOpen(!layout.open),
	/** the editor's language changed (Settings → General → Language): the chat's words follow it */
	languageChanged: () => tell("gz-chat:language", language()),
	isOpen: () => layout.open,
	onOpen: (l) => listeners.add(l),
	busy: () => Boolean(lipc?.isBusy?.()),
	/** the chat page, when it has the keyboard (the Edit menu's commands are then its own) */
	focusedChat: () => (docked && view && !view.webContents.isDestroyed() && view.webContents.isFocused() ? view.webContents : null),
	closeAll: () => lipc?.closeAll?.(),
	oneShot,
	oneShotStatus,
};
