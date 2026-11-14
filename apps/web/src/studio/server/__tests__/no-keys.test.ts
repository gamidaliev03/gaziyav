import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// No keys in files: whatever an old settings.json holds, nothing reads a cloud key from it, the page never sees one,
// the app carries no key of its own. Gaziyav's AI — the agent and lipsync included — runs on the one fal.ai key the
// app hands the server (fal/server.ts; in test runs STUDIO_TEST_FAL_KEY). Test mode: never the real Keychain.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "gaziyav-nokeys-"));
const saved = { LIPSYNC_HOME: process.env.LIPSYNC_HOME, STUDIO_TEST: process.env.STUDIO_TEST };
process.env.STUDIO_TEST = "1";
beforeAll(() => {
	process.env.LIPSYNC_HOME = home;
	fs.writeFileSync(
		path.join(home, "settings.json"),
		JSON.stringify({ minimaxKey: "mm-old", syncKey: "sync-old", falKey: "fal-old", wavespeedKey: "ws", dashscopeKey: "ds", deepseekKey: "sk-user", pexelsKey: "px", speechSpeed: 1.2 }),
	);
});
afterAll(() => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	fs.rmSync(home, { recursive: true, force: true });
});

describe("no API keys", () => {
	test("settings carry no keys; the app has no key of its own; the page sees none", async () => {
		const { loadSettings, publicSettings, saveSettings } = await import("../settings");
		const s = loadSettings();
		expect(Object.keys(s).filter((k) => /key/i.test(k))).toEqual(["deepseekKey"]);
		// An old key in settings.json is not used, and with no key in the Keychain Gaziyav AI isn't set up.
		expect(s.deepseekKey).toBe("");
		expect(publicSettings(s).agent).toBe(false);
		expect(s.speechSpeed).toBe(1.2);
		const pub = JSON.stringify(publicSettings(s));
		for (const secret of ["mm-old", "sync-old", "fal-old", "sk-user", "px"]) expect(pub).not.toContain(secret);
		// A key can't be saved through settings either.
		saveSettings({ deepseekKey: "sk-injected" } as never);
		expect(loadSettings().deepseekKey).toBe("");
		expect(fs.readFileSync(path.join(home, "settings.json"), "utf8")).not.toContain("sk-injected");
	});

	test("the fal key sets Gaziyav AI up and shows only as a mask", async () => {
		const keys = await import("../agent-keys");
		const { loadSettings, publicSettings } = await import("../settings");
		// The key the app handed over (other test files may have set one): none, as on a Mac without a key.
		const slot = globalThis as { __gaziyavFalKey?: string | null };
		const before = slot.__gaziyavFalKey;
		slot.__gaziyavFalKey = null;
		// A key left in the old Keychain file is not Gaziyav's: only fal's key (from the app) counts.
		fs.writeFileSync(path.join(home, "test-keychain.json"), JSON.stringify({ deepseek: "sk-test-0123456789abcdef" }));
		expect(keys.activeAgent()).toBeNull();
		slot.__gaziyavFalKey = "fal-test-0123456789abcdef";
		try {
			const a = keys.activeAgent();
			expect(a?.provider).toBe("fal");
			expect(a?.key).toBe("fal-test-0123456789abcdef");
			expect(a?.base).toBe("https://fal.run/openrouter/router/openai/v1");
			const setup = keys.agentSetup();
			expect(setup.providers.map((p) => p.id)).toEqual(["fal"]);
			expect(setup.providers[0].mask).toBe("•••• cdef");
			expect(JSON.stringify(setup)).not.toContain("0123456789");
			const pub = publicSettings(loadSettings());
			expect(pub.agent).toBe(true);
			expect(pub.brain?.name).toBe("fal.ai");
			expect(JSON.stringify(pub)).not.toContain("0123456789");
		} finally {
			slot.__gaziyavFalKey = before;
		}
	});

	test("no code reads a key carried by the app", () => {
		const root = path.join(import.meta.dir, "..", "..", "..");
		const hits: string[] = [];
		const walk = (dir: string) => {
			for (const name of fs.readdirSync(dir)) {
				const p = path.join(dir, name);
				if (name === "__tests__" || name === "node_modules") continue;
				if (fs.statSync(p).isDirectory()) walk(p);
				else if (/\.(ts|tsx)$/.test(name) && /["']agent\.key["']|STUDIO_AGENT_KEY|builtinAgentKey|spendFree/.test(fs.readFileSync(p, "utf8"))) hits.push(path.relative(root, p));
			}
		};
		walk(root);
		expect(hits).toEqual([]);
	});

	test("lipsync runs on fal: its models, LatentSync by default (an old model id falls back to it)", async () => {
		const { LIPSYNC_MODELS, getModel } = await import("@/studio/shared/models");
		expect(LIPSYNC_MODELS.length).toBeGreaterThan(1);
		expect(LIPSYNC_MODELS.every((m) => /^(fal-ai|veed)\//.test(m.id))).toBe(true);
		expect(getModel("localLipsync").id).toBe("fal-ai/latentsync");
		expect(getModel("syncDirect2").id).toBe("fal-ai/latentsync");
	});

	// fal's key is Gaziyav's one key (fal/server.ts falKey(), from the app): only the old per-service keys are banned.
	test("no code reads a cloud key any more", () => {
		const root = path.join(import.meta.dir, "..", "..", "..");
		const hits: string[] = [];
		const walk = (dir: string) => {
			for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
				const p = path.join(dir, d.name);
				if (d.isDirectory()) {
					if (d.name !== "__tests__" && d.name !== "node_modules") walk(p);
				} else if (/\.(ts|tsx)$/.test(d.name) && !/i18n\//.test(p)) {
					const text = fs.readFileSync(p, "utf8");
					if (/\b(minimaxKey|syncKey|wavespeedKey|dashscopeKey|pexelsKey|freesoundKey|getFreesoundKey|openSettings\("keys"\))\b/.test(text)) hits.push(path.relative(root, p));
				}
			}
		};
		walk(root);
		expect(hits).toEqual([]);
	});
});
