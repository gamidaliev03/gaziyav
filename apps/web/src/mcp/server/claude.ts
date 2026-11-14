// The Gaziyav connector for Claude. Gaziyav doesn't put Claude inside itself: one «Connect Claude» press hands Claude
// everything — the Claude for Mac extension (Gaziyav.mcpb, opened in Claude, which installs it), the editing skill and
// the MCP server for Claude Code (~/.claude/skills, `claude mcp add`), and the skill as a zip for claude.ai (uploaded
// once by the user: Settings → Capabilities → Skills). The extension runs the installed app's own server file, and the
// skill is refreshed on every app start when its version is older: an app update updates Claude too.
// Tests (STUDIO_TEST=1) use a «home» inside the test profile and only record what would be opened or run.
import { STICKERS } from "../surface";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resourcesDir } from "@/platform/paths";
import { mcpDir } from "./hub";

export const SERVER_NAME = "gaziyav";
export const SKILL_NAME = "gaziyav-editing";
const FAMILY = false;
const VERSION_FILE = ".gaziyav-version";

/** Resources/mcp in the app; the source folder for a development server. */
export function mcpFolder(): string {
	const res = resourcesDir();
	if (res && fs.existsSync(path.join(res, "mcp", "server.mjs"))) return path.join(res, "mcp");
	return path.resolve(process.cwd(), "mcp");
}

/** The installed app this server runs from (…/Gaziyav.app), or the default place. */
function appBundle(): string {
	const res = resourcesDir();
	const bundle = res ? path.resolve(res, "..", "..") : "";
	return bundle.endsWith(".app") ? bundle : "/Applications/Gaziyav.app";
}

export function appVersion(): string {
	try {
		const plist = fs.readFileSync(path.join(appBundle(), "Contents", "Info.plist"), "utf8");
		return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1] ?? "1.0.0";
	} catch {
		return "1.0.0";
	}
}

const TEST = process.env.STUDIO_TEST === "1";
/** The user's home, or the test profile's own one (a test never writes into the real ~/.claude or Claude's folder). */
const home = () => (TEST ? path.join(mcpDir(), "test-home") : os.homedir());
const claudeApp = () => (TEST && process.env.STUDIO_TEST_CLAUDE_APP ? process.env.STUDIO_TEST_CLAUDE_APP : "/Applications/Claude.app");
const extensionsDir = () => path.join(home(), "Library", "Application Support", "Claude", "Claude Extensions");
const codeSkillDir = () => path.join(home(), ".claude", "skills", SKILL_NAME);
export const skillZipPath = () => path.join(mcpDir(), `${SKILL_NAME}.zip`);

/** What a test run would have opened or run: nothing appears on the user's screen during tests. */
const opened: string[][] = [];
const ran: string[][] = [];
export const claudeTestState = () => ({ opened, ran, skillDir: codeSkillDir(), home: home(), extensionsDir: extensionsDir() });

function open(args: string[]): boolean {
	if (TEST) {
		opened.push(args);
		return true;
	}
	return spawnSync("/usr/bin/open", args).status === 0;
}

/** Claude Code's command line, where an installer puts it (null: Claude Code isn't on this Mac). */
function claudeCli(): string | null {
	if (TEST) return process.env.STUDIO_TEST_CLAUDE_CLI || null;
	const h = os.homedir();
	const places = [path.join(h, ".claude", "local", "claude"), path.join(h, ".local", "bin", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude", path.join(h, ".npm-global", "bin", "claude")];
	const found = places.find((p) => fs.existsSync(p));
	if (found) return found;
	// Installed some other way (nvm, a custom prefix): the user's own login shell knows where (asked once, read-only).
	if (cliLookup === undefined) {
		const r = spawnSync("/bin/zsh", ["-lc", "command -v claude"], { encoding: "utf8", timeout: 4000 });
		const p = String(r.stdout ?? "").trim().split("\n").pop() ?? "";
		cliLookup = r.status === 0 && p.startsWith("/") && fs.existsSync(p) ? p : null;
	}
	return cliLookup;
}
let cliLookup: string | null | undefined;

/** Whether Claude for Mac has the Gaziyav extension (its folder holds our manifest), and which version. */
function installedExtension(): { version: string } | null {
	try {
		for (const d of fs.readdirSync(extensionsDir())) {
			try {
				const m = JSON.parse(fs.readFileSync(path.join(extensionsDir(), d, "manifest.json"), "utf8")) as { name?: string; version?: string };
				if (m.name === SERVER_NAME) return { version: String(m.version ?? "") };
			} catch {}
		}
	} catch {}
	return null;
}

const skillVersion = (): string | null => {
	try {
		return fs.readFileSync(path.join(codeSkillDir(), VERSION_FILE), "utf8").trim() || null;
	} catch {
		return fs.existsSync(path.join(codeSkillDir(), "SKILL.md")) ? "old" : null;
	}
};

/** Claude Code knows the server (its user config names it): read, never written here. */
function codeServerAdded(): boolean {
	try {
		const cfg = JSON.parse(fs.readFileSync(path.join(home(), ".claude.json"), "utf8")) as { mcpServers?: Record<string, unknown> };
		return !!cfg.mcpServers?.[SERVER_NAME];
	} catch {
		return false;
	}
}

export function claudeStatus() {
	const ext = installedExtension();
	const skill = skillVersion();
	const claudeInstalled = fs.existsSync(claudeApp());
	const codeInstalled = !!claudeCli();
	const connected = !!ext || (!!skill && (codeServerAdded() || ran.length > 0));
	return {
		// The one-time offer on the projects page (a test profile shows it only when a test asks for it).
		offer: !FAMILY && (!TEST || process.env.STUDIO_TEST_CLAUDE_OFFER === "1") && (claudeInstalled || codeInstalled) && !connected,
		version: appVersion(),
		claudeInstalled,
		connectorInstalled: !!ext,
		connectorVersion: ext?.version ?? null,
		codeInstalled,
		codeServer: codeServerAdded() || ran.some((r) => r.includes("add")),
		skillInstalled: !!skill,
		skillVersion: skill,
		skillZip: fs.existsSync(skillZipPath()) ? skillZipPath() : null,
		codeCommand: `claude mcp add ${SERVER_NAME} --scope user -- "${path.join(mcpFolder(), "gaziyav-mcp")}"`,
	};
}

// The tools Claude shows on the install page (the server lists every tool at run time: tools_generated).
const SHOWN_TOOLS: Array<[string, string]> = [
	["project", "Make, open and save projects (9:16, 16:9, 1:1, 4:5)"],
	["get_project", "The open project in a few lines: tracks, clips, times, media"],
	["find_content", `Every library and source: music, sounds, titles, motion, ${STICKERS ? "stickers, " : ""}your files, YouTube, web pictures`],
	["import_media", "Bring your clips, pictures and music into Media"],
	["edit", "Cut, trim, move, captions, music, titles, transitions, effects, keyframes — many steps in one call"],
	["motion_layer", "Remotion motion graphics and infographics, written by Claude"],
	["generate", "AI pictures, video, voice, lipsync and dubbing within your budget"],
	["price_plan", "The exact price of a plan, balances and the budget"],
	["look", "See preview frames and the timeline"],
	["export", "Render a file for a platform"],
	["post", "Publish to YouTube Shorts, Instagram Reels and TikTok after your OK"],
	["editing_guide", "Gaziyav's editing playbook"],
];

function manifest() {
	return {
		manifest_version: "0.3",
		name: SERVER_NAME,
		display_name: "Gaziyav",
		version: appVersion(),
		description: "Edit videos in Gaziyav on your Mac: Claude builds a real, editable project — cuts, captions, music, titles, motion graphics, AI — and posts it after your OK.",
		long_description:
			"Ask Claude to make a video and it edits in Gaziyav, the video editor on this Mac: it creates the project, imports your clips, cuts on the right words and beats, adds captions, music, titles and motion graphics, prices any AI step against your budget, checks the result frame by frame, exports it and posts it to your accounts when you say yes. Everything stays an ordinary Gaziyav project you can open and change. Gaziyav starts by itself when it is closed; the connector always runs the installed Gaziyav's own server, so it updates with the app.",
		author: { name: "Gaziyav", url: "https://fal.ai" },
		homepage: "https://fal.ai",
		icon: "icon.png",
		server: {
			type: "node",
			entry_point: "server.mjs",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: Claude fills in ${__dirname} (MCPB manifest placeholder).
			mcp_config: { command: "node", args: ["${__dirname}/server.mjs"], env: { GAZIYAV_APP: appBundle() } },
		},
		tools: SHOWN_TOOLS.map(([name, description]) => ({ name, description })),
		tools_generated: true,
		prompts: [
			{
				name: "make_video",
				description: "Make a finished video in Gaziyav from a one-line brief.",
				arguments: ["brief"],
				// biome-ignore lint/suspicious/noTemplateCurlyInString: Claude fills in ${arguments.brief} (MCPB prompt placeholder).
				text: "Make this in Gaziyav: ${arguments.brief}\n\nCall editing_guide first, then follow its loop to a finished, checked, exported video.",
			},
		],
		prompts_generated: true,
		keywords: ["video", "editing", "captions", "motion", "reels", "tiktok", "shorts"],
		license: "Proprietary",
		compatibility: { platforms: ["darwin"], runtimes: { node: ">=18.0.0" } },
	};
}

/**
 * The extension's own server.mjs: runs the installed Gaziyav's server file, so an app update is a connector update
 * with nothing to reinstall; the copy inside the extension is only for a Gaziyav that was moved or removed.
 */
const LOADER = `// Gaziyav connector: runs the server of the installed Gaziyav app (an app update updates Claude's tools too).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const app = process.env.GAZIYAV_APP || "/Applications/Gaziyav.app";
const live = path.join(app, "Contents", "Resources", "mcp", "server.mjs");
const own = path.join(path.dirname(fileURLToPath(import.meta.url)), "server-bundled.mjs");
await import(pathToFileURL(fs.existsSync(live) ? live : own).href);
`;

/** Gaziyav.mcpb (a zip with manifest.json at its root) in the app's folder, made fresh from this copy of Gaziyav. */
export function buildConnector(): string {
	const src = mcpFolder();
	const stage = fs.mkdtempSync(path.join(os.tmpdir(), "gaziyav-mcpb-"));
	try {
		fs.copyFileSync(path.join(src, "server.mjs"), path.join(stage, "server-bundled.mjs"));
		fs.writeFileSync(path.join(stage, "server.mjs"), LOADER);
		fs.copyFileSync(path.join(src, "icon.png"), path.join(stage, "icon.png"));
		fs.cpSync(path.join(src, "skill"), path.join(stage, "skill"), { recursive: true });
		fs.writeFileSync(path.join(stage, "manifest.json"), `${JSON.stringify(manifest(), null, 2)}\n`);
		const out = path.join(mcpDir(), "Gaziyav.mcpb");
		fs.rmSync(out, { force: true });
		const r = spawnSync("/usr/bin/ditto", ["-c", "-k", "--norsrc", stage, out]);
		if (r.status !== 0 || !fs.existsSync(out)) throw new Error("Couldn't make the connector file.");
		return out;
	} finally {
		fs.rmSync(stage, { recursive: true, force: true });
	}
}

/** The skill as a zip for claude.ai / Claude for Mac (Settings → Capabilities → Skills → Upload): its folder at the root. */
export function buildSkillZip(): string {
	const src = path.join(mcpFolder(), "skill", SKILL_NAME);
	if (!fs.existsSync(path.join(src, "SKILL.md"))) throw new Error("The skill is missing from this copy of Gaziyav.");
	const out = skillZipPath();
	fs.rmSync(out, { force: true });
	const r = spawnSync("/usr/bin/ditto", ["-c", "-k", "--norsrc", "--keepParent", src, out]);
	if (r.status !== 0 || !fs.existsSync(out)) throw new Error("Couldn't make the skill file.");
	return out;
}

/**
 * The app's version and a hash of the skill's files. Every build is «1.0.0», so the version alone never told an
 * installed skill it was old: Claude Code kept the first copy it got. A build that changes the skill changes this.
 */
export function skillStamp(src = path.join(mcpFolder(), "skill", SKILL_NAME)): string {
	const hash = crypto.createHash("sha256");
	const walk = (dir: string, rel: string) => {
		for (const name of fs.readdirSync(dir).sort()) {
			const full = path.join(dir, name);
			if (fs.statSync(full).isDirectory()) walk(full, `${rel}${name}/`);
			else hash.update(`${rel}${name}\0`).update(fs.readFileSync(full)).update("\0");
		}
	};
	walk(src, "");
	return `${appVersion()}+${hash.digest("hex").slice(0, 12)}`;
}

/** The editing skill into ~/.claude/skills for Claude Code, with its stamp beside it. */
export function installSkill(): string {
	const src = path.join(mcpFolder(), "skill", SKILL_NAME);
	if (!fs.existsSync(path.join(src, "SKILL.md"))) throw new Error("The skill is missing from this copy of Gaziyav.");
	const dest = codeSkillDir();
	fs.rmSync(dest, { recursive: true, force: true });
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	fs.cpSync(src, dest, { recursive: true });
	fs.writeFileSync(path.join(dest, VERSION_FILE), skillStamp(src));
	return dest;
}

/** On every app start: a skill this app put there before is replaced when this build's skill differs from it. */
let refreshed = false;
export function refreshInstalled(): void {
	if (refreshed || FAMILY) return;
	refreshed = true;
	try {
		const v = skillVersion();
		if (v && v !== skillStamp()) installSkill();
	} catch {}
	try {
		buildSkillZip();
	} catch {}
}

/**
 * «Connect Claude»: everything this Mac has — the extension opened in Claude for Mac, the skill and the server for Claude
 * Code, the zip for claude.ai. Says what was done and what the user does next (one line each).
 */
export function connectClaude(): { done: string[]; next: string[] } {
	if (FAMILY) return { done: [], next: [] };
	const done: string[] = [];
	const next: string[] = [];
	if (fs.existsSync(claudeApp())) {
		const file = buildConnector();
		if (open(["-a", claudeApp(), file])) {
			done.push("Claude for Mac: the Gaziyav extension is open in Claude");
			next.push("In Claude's window press Install (once).");
		} else next.push(`Double-click ${file} to add it to Claude.`);
	}
	const cli = claudeCli();
	if (cli || fs.existsSync(path.join(home(), ".claude"))) {
		installSkill();
		done.push("Claude Code: the editing skill is in ~/.claude/skills");
	}
	if (cli) {
		const args = ["mcp", "add", SERVER_NAME, "--scope", "user", "--", path.join(mcpFolder(), "gaziyav-mcp")];
		if (TEST) ran.push([cli, ...args]);
		else {
			spawnSync(cli, ["mcp", "remove", SERVER_NAME, "--scope", "user"], { stdio: "ignore", timeout: 20_000 });
			spawnSync(cli, args, { stdio: "ignore", timeout: 20_000 });
		}
		done.push("Claude Code: the Gaziyav server is added");
	}
	const zip = buildSkillZip();
	next.push(`For claude.ai: Settings → Capabilities → Skills → Upload skill → ${path.basename(zip)} (once).`);
	if (!done.length) next.unshift("Install Claude for Mac (claude.ai/download), then press Connect again.");
	return { done, next };
}

export function revealSkillZip(): string {
	const zip = fs.existsSync(skillZipPath()) ? skillZipPath() : buildSkillZip();
	open(["-R", zip]);
	return zip;
}
