// Preferences in the app's own folder (~/Library/Application Support/Gaziyav/settings.json). Unknown fields are
// preserved on save. No API keys here: the fal.ai key is kept by the app in the Keychain (fal/server.ts); the light AI runs on this Mac;
// Gaziyav AI, which runs on the user's own DeepSeek or Claude key from the macOS Keychain (agent-keys.ts).
import fs from "node:fs";
import path from "node:path";
import { supportDir } from "@/platform/paths";
import { activeAgent, getKey } from "./agent-keys";

export interface StudioSettings {
	speechSpeed: number;
	/** The user's DeepSeek key while DeepSeek is Gaziyav AI's provider (from the Keychain; never saved here, never sent to the page). */
	deepseekKey: string;
	deepseekModel: string;
	/** Gaziyav AI's AI: a provider id of agent-providers.ts, or "" (not set up). */
	agentProvider: string;
	/** The model chosen for each provider (picked from its /models after the key check, changeable in Settings). */
	agentModels: Record<string, string>;
	/** Other (OpenAI-compatible): the service's address, e.g. http://localhost:1234/v1. */
	agentBaseUrl: string;
	sampleLength: number;
	denoise: boolean;
	/** The user's own sound/graphics library folder ("" = only the bundled open-licensed content). */
	libraryFolder: string;
	/**
	 * When YouTube asks this network to prove it's a person: the browser whose YouTube sign-in yt-dlp uses ("chrome",
	 * "safari"…; "" = none). Chosen by the user in Add from a link; only YouTube links use it.
	 */
	youtubeBrowser: string;
	/**
	 * Settings → AI → «Download large models in the background»: the lipsync, voice, picture, music and face-swap
	 * models (about 20 GB) come by themselves too, after the small ones (ondevice/background.ts). Off: they download on first use.
	 */
	backgroundLargeModels: boolean;
	/** The model each AI feature uses, fal's or kie's (src/fal/models.ts FalTask → model id); missing = the default. */
	falModels: Record<string, string>;
	/** Only read by older files: the fal/kie switch and kie's picks, carried into falModels once (fal/server.ts modelChoices). */
	aiApi: string;
	kieModels: Record<string, string>;
	/**
	 * Lipsync's pipeline (lipb, 14.11): { pieces, composite, pack, parallel, chroma444 } — all on by default (missing = the
	 * default, studio/server/pipeline.ts lipSettings). Off: the one-request path of before.
	 */
	lipsyncPipeline: Record<string, unknown>;
}

const DEFAULTS: StudioSettings = {
	speechSpeed: 1,
	deepseekKey: "",
	deepseekModel: "deepseek-flash",
	agentProvider: "",
	agentModels: {},
	agentBaseUrl: "",
	sampleLength: 30,
	denoise: true,
	libraryFolder: "",
	youtubeBrowser: "",
	backgroundLargeModels: false,
	falModels: {},
	aiApi: "fal",
	kieModels: {},
	lipsyncPipeline: {},
};

export function studioHome(): string {
	return process.env.LIPSYNC_HOME || supportDir();
}

function settingsFile() {
	return path.join(studioHome(), "settings.json");
}

function readRaw(): Record<string, unknown> {
	try {
		return JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
	} catch {
		return {};
	}
}

export function loadSettings(): StudioSettings {
	const raw = readRaw();
	const out = { ...DEFAULTS };
	for (const key of Object.keys(DEFAULTS) as (keyof StudioSettings)[]) {
		if (key === "deepseekKey") continue;
		const v = raw[key];
		if (v !== undefined && typeof v === typeof DEFAULTS[key]) {
			(out as Record<string, unknown>)[key] = v;
		}
	}
	// A DeepSeek key in the Keychain with no provider chosen (put there by an update) counts as chosen.
	const provider = out.agentProvider || (getKey("deepseek") ? "deepseek" : "");
	out.deepseekKey = provider === "deepseek" ? getKey("deepseek") : "";
	if (out.agentModels.deepseek) out.deepseekModel = out.agentModels.deepseek;
	return out;
}

export function saveSettings(patch: Partial<StudioSettings>): StudioSettings {
	const raw = readRaw();
	for (const [k, v] of Object.entries(patch)) {
		if (!(k in DEFAULTS) || k === "deepseekKey" || v === undefined) continue;
		if (typeof v !== typeof DEFAULTS[k as keyof StudioSettings]) continue;
		raw[k] = typeof v === "string" ? v.trim() : v;
	}
	fs.mkdirSync(studioHome(), { recursive: true });
	const tmp = `${settingsFile()}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(raw, null, 2), { mode: 0o600 });
	fs.renameSync(tmp, settingsFile());
	fs.chmodSync(settingsFile(), 0o600);
	return loadSettings();
}

/** What the panel may see: the preferences, and whether Gaziyav AI can answer (keys never leave here). */
export function publicSettings(s: StudioSettings) {
	const { deepseekKey, ...rest } = s;
	const a = activeAgent();
	return { ...rest, agent: !!a, brain: a ? { provider: a.provider, name: a.name, model: a.model } : null };
}

export type PublicSettings = ReturnType<typeof publicSettings>;
