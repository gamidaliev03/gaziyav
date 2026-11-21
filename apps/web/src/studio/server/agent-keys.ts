// Gaziyav AI's AI is the user's own: one API key per provider (agent-providers.ts), kept in the macOS Keychain
// (service com.gaziyav.app.agent, account = the provider's id) through /usr/bin/security — the secret goes in on
// stdin, never in a process list, a file, a log or the page, which only ever sees a mask. The app carries no key of
// its own. Test runs keep keys in their own profile and never touch the real Keychain.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import {
	type AgentProvider,
	anthropicBase,
	baseFor,
	CLAUDE_MODELS,
	isProvider,
	type ListedModel,
	PROVIDER_IDS,
	PROVIDERS,
	providerInfo,
	recommendModel,
	usableModels,
} from "./agent-providers";
import { StudioError } from "./errors";
import { loadSettings, saveSettings, studioHome } from "./settings";

export type { AgentProvider } from "./agent-providers";
import { falKey } from "@/fal/server";
import { chosenModel, modelsFor as modelsFor_ } from "@/fal/models";

export const KEYCHAIN_SERVICE = "com.gaziyav.app.agent";
/** The Keychain service in use (a self-test of the Keychain itself runs on a stand-in service). */
const service = () => process.env.GAZIYAV_KEYCHAIN_SERVICE || KEYCHAIN_SERVICE;
/** Test runs (the app's self-tests, unit tests) keep keys in their profile, unless a test checks the Keychain itself. */
const fileStore = () => process.env.GAZIYAV_REAL_KEYCHAIN !== "1" && (process.env.STUDIO_TEST === "1" || process.env.NODE_ENV === "test");
const cache = new Map<AgentProvider, string>();
const testFile = () => path.join(studioHome(), "test-keychain.json");

function readTest(): Record<string, string> {
	try {
		return JSON.parse(fs.readFileSync(testFile(), "utf8")) as Record<string, string>;
	} catch {
		return {};
	}
}

/** The key for a provider ("" when none). fal's is the app's one fal key (fal/server.ts), never the Keychain's. */
export function getKey(provider: AgentProvider): string {
	if (provider === "fal") return falKey() ?? "";
	if (fileStore()) return readTest()[provider] ?? "";
	const hit = cache.get(provider);
	if (hit !== undefined) return hit;
	const r = spawnSync("/usr/bin/security", ["find-generic-password", "-s", service(), "-a", provider, "-w"], { encoding: "utf8" });
	const key = r.status === 0 ? r.stdout.trim() : "";
	cache.set(provider, key);
	return key;
}

export function storeKey(provider: AgentProvider, key: string) {
	if (provider === "fal") throw new StudioError("Paste the fal.ai key in Settings → Services (fal.ai).");
	if (fileStore()) {
		fs.mkdirSync(studioHome(), { recursive: true });
		fs.writeFileSync(testFile(), JSON.stringify({ ...readTest(), [provider]: key }), { mode: 0o600 });
		return;
	}
	// `security` asks for the secret twice; both answers go in on stdin.
	const r = spawnSync("/usr/bin/security", ["add-generic-password", "-s", service(), "-a", provider, "-l", `Gaziyav — ${providerInfo(provider)?.name ?? provider} key`, "-U", "-w"], {
		input: `${key}\n${key}\n`,
		encoding: "utf8",
	});
	if (r.status !== 0) throw new StudioError("The key couldn't be saved in the Keychain. Unlock the login keychain and try again.");
	cache.set(provider, key);
}

export function deleteKey(provider: AgentProvider) {
	if (fileStore()) {
		const all = readTest();
		delete all[provider];
		fs.mkdirSync(studioHome(), { recursive: true });
		fs.writeFileSync(testFile(), JSON.stringify(all), { mode: 0o600 });
		return;
	}
	spawnSync("/usr/bin/security", ["delete-generic-password", "-s", service(), "-a", provider], { stdio: "ignore" });
	cache.set(provider, "");
}

/** "•••• a1b2": enough to recognise the key, nothing to use it. */
export const mask = (key: string) => (key ? `•••• ${key.slice(-4)}` : "");

const models = () => (loadSettings().agentModels ?? {}) as Record<string, string>;

/** Set up = a key (Other: an address and a model; its key is optional). */
function configured(p: AgentProvider): boolean {
	if (p === "other") return !!loadSettings().agentBaseUrl && !!models().other;
	return !!getKey(p);
}

export interface ActiveAgent {
	provider: AgentProvider;
	name: string;
	key: string;
	model: string;
	base: string;
}

/** The AI Gaziyav AI and the other text features use now, or null when nothing is set up. */
export function activeAgent(): ActiveAgent | null {
	const s = loadSettings();
	const chosen = isProvider(s.agentProvider) && configured(s.agentProvider) ? s.agentProvider : null;
	// A key put into the Keychain by an update (no provider chosen yet) counts as chosen.
	const provider = chosen ?? PROVIDER_IDS.find((p) => p !== "other" && configured(p)) ?? null;
	if (!provider) return null;
	const own = provider === "fal" ? chosenModel("llm", loadSettings().falModels as Record<string, string>).id : models()[provider];
	const model =
		provider === "anthropic" ? (CLAUDE_MODELS.includes(own) ? own : CLAUDE_MODELS[0]) : own || (provider === "deepseek" ? s.deepseekModel || "deepseek-flash" : "");
	return { provider, name: providerInfo(provider)?.name ?? provider, key: getKey(provider), model, base: baseFor(provider, s.agentBaseUrl) };
}

export const agentReady = () => !!activeAgent();

export const NOT_SET_UP = "Gaziyav AI has no AI yet: press Enter in the prompt and choose one, or add a key in Settings → Services → API keys.";

/** What Settings and the chooser may see: no key, only its mask. */
export function agentSetup() {
	const a = activeAgent();
	const s = loadSettings();
	return {
		ready: !!a,
		provider: a?.provider ?? null,
		name: a?.name ?? null,
		model: a?.model ?? null,
		baseUrl: s.agentBaseUrl,
		providers: PROVIDERS.map((p) => ({
			id: p.id,
			name: p.name,
			keyHost: p.keyHost,
			keyUrl: p.keyUrl,
			keyOptional: !!p.keyOptional,
			mask: mask(getKey(p.id)),
			ready: configured(p.id),
			model: p.id === "anthropic" ? (CLAUDE_MODELS.includes(models().anthropic) ? models().anthropic : CLAUDE_MODELS[0]) : models()[p.id] || "",
		})),
	};
}

/** The provider's model list for this key (one cheap call, no tokens): also the check that the key works. */
export async function listModels(provider: AgentProvider, key: string, baseUrl: string, signal?: AbortSignal): Promise<string[]> {
	const name = providerInfo(provider)?.name ?? provider;
	// fal's router takes any OpenRouter model: the catalog's picks, nothing to ask.
	if (provider === "fal") return modelsFor_("llm").map((m) => m.id);
	if (provider === "anthropic") {
		// Only the user's key: never a token or an address from the environment (the SDK would read ANTHROPIC_*).
		const client = new Anthropic({ apiKey: key, authToken: null, baseURL: anthropicBase() ?? "https://api.anthropic.com", maxRetries: 1, timeout: 20_000 });
		try {
			await client.models.list({ limit: 20 });
		} catch (error) {
			if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
				throw new StudioError("Claude didn't accept this key. Copy the whole key (it starts with sk-ant-) from platform.claude.com → API keys.");
			}
			if (error instanceof Anthropic.RateLimitError) throw new StudioError("Claude is busy for this key right now. Try again in a minute.");
			if (error instanceof Anthropic.APIConnectionError) throw new StudioError("Claude can't be reached. Check the internet connection and try again.");
			if (error instanceof Anthropic.APIError) throw new StudioError(`Claude answered ${error.status ?? "an error"}. Try again in a minute.`);
			throw error;
		}
		return [...CLAUDE_MODELS];
	}
	const base = baseFor(provider, baseUrl);
	if (!/^https?:\/\//.test(base)) throw new StudioError("Type the service's address, e.g. http://localhost:1234/v1 for LM Studio.");
	let res: Response;
	try {
		res = await fetch(`${base}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: signal ?? AbortSignal.timeout(20_000) });
	} catch {
		throw new StudioError(provider === "other" ? `Nothing answers at ${base}. Is the app running, and is its server on?` : `${name} can't be reached. Check the internet connection and try again.`);
	}
	if (res.status === 401 || res.status === 403) throw new StudioError(`${name} didn't accept this key. Copy the whole key from ${providerInfo(provider)?.keyHost}.`);
	if (res.status === 402) throw new StudioError(`This ${name} key works, but its balance is empty.`);
	if (!res.ok) throw new StudioError(`${name} answered ${res.status}. Try again in a minute.`);
	const body = (await res.json().catch(() => ({}))) as { data?: ListedModel[] };
	const ids = usableModels(provider, Array.isArray(body.data) ? body.data : []);
	if (!ids.length) throw new StudioError(`${name} lists no model this key can use for Gaziyav AI.`);
	return ids;
}

/** Checks the key, keeps it in the Keychain, picks the recommended model and makes this provider Gaziyav AI's AI. */
export async function setKey(provider: AgentProvider, raw: string, { baseUrl = "", signal }: { baseUrl?: string; signal?: AbortSignal } = {}) {
	const info = providerInfo(provider);
	if (!info) throw new StudioError("Unknown provider.");
	const key = raw.trim().replace(/^Bearer\s+/i, "");
	if (!key && !info.keyOptional) throw new StudioError("Paste the key first.");
	if (key && (/\s/.test(key) || key.length < 8)) throw new StudioError("That doesn't look like a whole key. Copy it again and paste it here.");
	if (info.keyPrefix && !key.startsWith(info.keyPrefix)) throw new StudioError(`A ${info.name} key starts with ${info.keyPrefix}. This one looks like another service's key.`);
	const ids = await listModels(provider, key, provider === "other" ? baseUrl : "", signal);
	const kept = models()[provider];
	const model = kept && ids.includes(kept) ? kept : recommendModel(provider, ids);
	if (key) storeKey(provider, key);
	else deleteKey(provider);
	saveSettings({
		agentProvider: provider,
		agentModels: { ...models(), [provider]: model },
		...(provider === "other" ? { agentBaseUrl: baseUrl.trim().replace(/\/$/, "") } : {}),
	});
	return agentSetup();
}

/** The models for Settings' picker (asks the provider with the saved key). */
export async function modelsFor(provider: AgentProvider, signal?: AbortSignal): Promise<string[]> {
	return listModels(provider, getKey(provider), loadSettings().agentBaseUrl, signal);
}

export function setModel(provider: AgentProvider, model: string) {
	if (!model.trim()) throw new StudioError("Choose a model.");
	if (provider === "fal") {
		saveSettings({ falModels: { ...(loadSettings().falModels as Record<string, string>), llm: model.trim() } });
		return agentSetup();
	}
	if (provider === "anthropic" && !CLAUDE_MODELS.includes(model)) throw new StudioError("Unknown model.");
	saveSettings({ agentModels: { ...models(), [provider]: model.trim() } });
	return agentSetup();
}

export function setProvider(provider: AgentProvider) {
	if (!configured(provider)) throw new StudioError("Add that key first.");
	saveSettings({ agentProvider: provider });
	return agentSetup();
}

export function removeKey(provider: AgentProvider) {
	deleteKey(provider);
	const rest = { ...models() };
	delete rest[provider];
	const s = loadSettings();
	const next = s.agentProvider === provider ? (PROVIDER_IDS.find((p) => p !== provider && p !== "other" && configured(p)) ?? "") : s.agentProvider;
	saveSettings({ agentModels: rest, agentProvider: next, ...(provider === "other" ? { agentBaseUrl: "" } : {}) });
	return agentSetup();
}
