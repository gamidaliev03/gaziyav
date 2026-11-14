// DeepSeek for the AI Composition agent: multi-turn messages, the thinking model ("deepseek-reasoner") for full
// motion design, images for the art-director check of rendered frames. Never logs the key.
import { StudioError } from "@/studio/server/errors";
import { activeAgent, NOT_SET_UP } from "@/studio/server/agent-keys";
import { claudeComplete } from "@/studio/server/claude";
import { compatChat } from "@/studio/server/openai-compat";

export type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export interface Message {
	role: "system" | "user" | "assistant";
	content: string | Part[];
}

/** The thinking model of DeepSeek (an alias the API maps to its current reasoning model). */
export const REASONER = "deepseek-reasoner";

export interface ChatOptions {
	key: string;
	model: string;
	messages: Message[];
	json?: boolean;
	/** false = answer directly (fast); true = think first (the reasoner always thinks). */
	thinking?: boolean;
	temperature?: number;
	maxTokens?: number;
	timeout?: number;
	signal?: AbortSignal;
}

export async function chat(o: ChatOptions): Promise<string> {
	const a = activeAgent();
	if (!a) throw new StudioError(NOT_SET_UP);
	if (a.provider === "anthropic") {
		const system = o.messages.filter((m) => m.role === "system").map((m) => (typeof m.content === "string" ? m.content : "")).join("\n\n");
		const rest = o.messages.filter((m) => m.role !== "system") as Array<{ role: "user" | "assistant"; content: Message["content"] }>;
		return claudeComplete({ system, messages: rest, json: o.json, maxTokens: o.maxTokens ?? 8000, signal: o.signal, timeout: o.timeout });
	}
	// The model the user chose for this AI (Settings → AI → API keys), whatever the step would have picked.
	const r = await compatChat(a, {
		messages: o.messages,
		json: o.json,
		maxTokens: o.maxTokens ?? 8000,
		temperature: o.temperature,
		thinking: o.model === REASONER ? undefined : o.thinking,
		timeout: o.timeout,
		signal: o.signal,
	});
	if (!r.content.trim()) {
		if (r.finish === "length") throw new StudioError("Gaziyav AI ran out of answer length. Try again or ask for something simpler.");
		throw new StudioError("Gaziyav AI returned an empty answer. Try again.");
	}
	return r.content;
}

/** JSON out of a model answer (tolerates a code fence or chatter around the object). */
export function parseJson(text: string): any {
	try {
		return JSON.parse(text);
	} catch {
		const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
		for (const candidate of [fenced?.[1], /\{[\s\S]*\}/.exec(text)?.[0]]) {
			if (!candidate) continue;
			try {
				return JSON.parse(candidate);
			} catch {}
		}
		throw new StudioError("Gaziyav AI returned an unreadable answer. Try again.");
	}
}
