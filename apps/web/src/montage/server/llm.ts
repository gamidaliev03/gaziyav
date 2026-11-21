// Gaziyav AI (the connected Claude, one brain) for the AI Composition agent: multi-turn messages, the thinking model ("deepseek-reasoner") for full
// motion design, images for the art-director check of rendered frames. Never logs the key.
import { StudioError } from "@/studio/server/errors";
import { activeAgent } from "@/studio/server/agent-keys";
import { BRAIN_OFF, brainChat } from "@/studio/server/brain";
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
	/** The connected Claude's model for this step («fable» for library plates; default the app's, haiku). */
	brainModel?: string;
}

export async function chat(o: ChatOptions): Promise<string> {
	// One brain (studio/server/brain.ts): the connected Claude answers, whatever model the step would have picked; the
	// frames of the art director's check go with it as pictures (the one-shot's `images`).
	try {
		return await brainChat("plan", o.messages, { json: o.json, signal: o.signal, timeout: o.timeout, ...(o.brainModel ? { model: o.brainModel } : {}) });
	} catch (error) {
		// Claude not connected and an earlier AI set up (1.0.58's keys): that one, as before.
		const a = (error as Error)?.message === BRAIN_OFF ? activeAgent() : null;
		if (!a) throw error;
		return legacyChat(a, o);
	}
}

async function legacyChat(a: NonNullable<ReturnType<typeof activeAgent>>, o: ChatOptions): Promise<string> {
	if (a.provider === "anthropic") {
		const system = o.messages.filter((m) => m.role === "system").map((m) => (typeof m.content === "string" ? m.content : "")).join("\n\n");
		const rest = o.messages.filter((m) => m.role !== "system") as Array<{ role: "user" | "assistant"; content: Message["content"] }>;
		return claudeComplete({ system, messages: rest, json: o.json, maxTokens: o.maxTokens ?? 8000, signal: o.signal, timeout: o.timeout });
	}
	const r = await compatChat(a, { messages: o.messages, json: o.json, maxTokens: o.maxTokens ?? 8000, temperature: o.temperature, thinking: o.model === REASONER ? undefined : o.thinking, timeout: o.timeout, signal: o.signal });
	if (!r.content.trim()) {
		if (r.finish === "length") throw new StudioError("Gaziyav AI didn't manage this — nothing was changed.");
		throw new StudioError("Gaziyav AI didn't manage this — nothing was changed.");
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
		throw new StudioError("Gaziyav AI didn't manage this — nothing was changed.");
	}
}
