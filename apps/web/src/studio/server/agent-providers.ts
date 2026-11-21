// The AIs Gaziyav AI can think with, on the user's own API key. Claude talks the Anthropic Messages API (claude.ts);
// every other one is the same OpenAI-compatible client at its own address (openai-compat.ts). Subscriptions
// (claude.ai, ChatGPT Plus…) can't be used by other apps: only API keys.

export type AgentProvider = "fal" | "anthropic" | "openai" | "gemini" | "xai" | "deepseek" | "openrouter" | "other";

export interface ProviderInfo {
	id: AgentProvider;
	name: string;
	/** OpenAI-compatible base address ("" for Claude; the user's own for Other). */
	base: string;
	keyUrl: string;
	/** Where the key comes from, as the UI says it. */
	keyHost: string;
	keyOptional?: boolean;
	keyPrefix?: string;
	/** Models in order of preference (the first one the account lists wins); else the first in its list. */
	prefer: RegExp[];
}

/** fal.ai: OpenRouter's models through fal's OpenAI-compatible endpoint, on the one fal key (Settings → Services (fal.ai)). */
const FAL: ProviderInfo = {
	id: "fal",
	name: "fal.ai",
	base: "https://fal.run/openrouter/router/openai/v1",
	keyUrl: "https://fal.ai/dashboard/keys",
	keyHost: "fal.ai → API Keys",
	prefer: [/^google\/gemini-2\.5-flash$/],
};

/** Gaziyav thinks with fal only (one key for all its AI); the other entries stay for old settings files. */
const ALL_PROVIDERS: ProviderInfo[] = [
	FAL,
	{
		id: "anthropic",
		name: "Claude",
		base: "",
		keyUrl: "https://platform.claude.com/settings/keys",
		keyHost: "platform.claude.com → API keys",
		keyPrefix: "sk-ant-",
		prefer: [/^claude-sonnet-5-5$/, /^claude-opus-5-5$/],
	},
	{
		id: "openai",
		name: "OpenAI",
		base: "https://api.openai.com/v1",
		keyUrl: "https://platform.openai.com/api-keys",
		keyHost: "platform.openai.com → API keys",
		prefer: [/^gpt-5(\.\d+)?$/, /^gpt-5(\.\d+)?-mini$/, /^gpt-4\.1$/, /^gpt-4o$/],
	},
	{
		id: "gemini",
		name: "Google Gemini",
		base: "https://generativelanguage.googleapis.com/v1beta/openai",
		keyUrl: "https://aistudio.google.com/apikey",
		keyHost: "aistudio.google.com → API key",
		prefer: [/^gemini-[\d.]+-pro$/, /^gemini-[\d.]+-flash$/, /^gemini-.*pro/],
	},
	{
		id: "xai",
		name: "xAI Grok",
		base: "https://api.x.ai/v1",
		keyUrl: "https://console.x.ai",
		keyHost: "console.x.ai → API keys",
		prefer: [/^grok-[\d.]+$/, /^grok-[\d.]+-fast/, /^grok/],
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		base: "https://api.deepseek.com",
		keyUrl: "https://platform.deepseek.com/api_keys",
		keyHost: "platform.deepseek.com → API keys",
		prefer: [/^deepseek-flash$/, /^deepseek-chat$/],
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		base: "https://openrouter.ai/api/v1",
		keyUrl: "https://openrouter.ai/keys",
		keyHost: "openrouter.ai → Keys",
		prefer: [/^anthropic\/claude-sonnet/, /^openai\/gpt-5/, /^google\/gemini-.*pro/],
	},
	{
		id: "other",
		name: "Other (OpenAI-compatible)",
		base: "",
		keyUrl: "https://lmstudio.ai",
		keyHost: "the service's settings (LM Studio and Ollama need no key)",
		keyOptional: true,
		prefer: [],
	},
];

export const PROVIDERS: ProviderInfo[] = [FAL];
export const PROVIDER_IDS = PROVIDERS.map((p) => p.id);
export const providerInfo = (id: string): ProviderInfo | undefined => ALL_PROVIDERS.find((p) => p.id === id);
export const isProvider = (id: unknown): id is AgentProvider => PROVIDER_IDS.includes(id as AgentProvider);

export const CLAUDE_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5"];

/** A model list entry as OpenAI-compatible /models answers it (OpenRouter adds what each model supports). */
export interface ListedModel {
	id: string;
	supported_parameters?: string[];
}

/** The ids worth offering: OpenRouter's that can call tools; Gemini's without the "models/" prefix. */
export function usableModels(provider: AgentProvider, list: ListedModel[]): string[] {
	const ids = list
		.filter((m) => provider !== "openrouter" || !m.supported_parameters || m.supported_parameters.includes("tools"))
		.map((m) => m.id.replace(/^models\//, ""))
		.filter((id) => id && !/embed|whisper|tts|dall-e|image|audio|moderation|realtime|transcribe/i.test(id));
	return [...new Set(ids)];
}

/** The model Gaziyav AI starts with: the first preferred one the account has (newest first), else the first listed. */
export function recommendModel(provider: AgentProvider, ids: string[]): string {
	if (provider === "anthropic") return CLAUDE_MODELS[0];
	const sorted = [...ids].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
	for (const re of providerInfo(provider)?.prefer ?? []) {
		const hit = sorted.find((id) => re.test(id));
		if (hit) return hit;
	}
	return ids[0] ?? "";
}

const isTest = () => process.env.STUDIO_TEST === "1" || process.env.NODE_ENV === "test";

/** The address to call: a test run points every provider at its own stand-in (never outside test mode). */
export function baseFor(provider: AgentProvider, userBase: string): string {
	const stand = isTest() ? process.env.GAZIYAV_TEST_LLM_BASE : undefined;
	if (stand) return `${stand.replace(/\/$/, "")}/${provider}`;
	if (provider === "deepseek" && isTest() && process.env.MONTAGE_LLM_URL) return process.env.MONTAGE_LLM_URL;
	return (provider === "other" ? userBase : (providerInfo(provider)?.base ?? "")).replace(/\/$/, "");
}

export const anthropicBase = () => {
	if (!isTest()) return undefined;
	const stand = process.env.GAZIYAV_TEST_LLM_BASE;
	return stand ? `${stand.replace(/\/$/, "")}/anthropic` : process.env.ANTHROPIC_TEST_URL || undefined;
};
