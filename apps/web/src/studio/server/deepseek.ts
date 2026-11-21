// The text features' writer (the name is historical): every answer comes from Gaziyav AI, the connected Claude (brain.ts).
import { activeAgent } from "./agent-keys";
import { BRAIN_OFF, brainChat } from "./brain";
import { claudeComplete } from "./claude";
import { StudioError } from "./errors";
import { compatChat } from "./openai-compat";
import { writeScript as writeShared } from "@/studio/shared/script";

export class DeepSeek {
	constructor(
		_apiKey: string,
		private model: string,
	) {}

	/** V4.1 Flash is a reasoning model: thinking tokens count against max_tokens, so short tasks run with thinking off. */
	async chat({
		system,
		user,
		json,
		temperature = 0.8,
		maxTokens = 4000,
		thinking = true,
		signal,
	}: {
		system: string;
		user: string;
		json: boolean;
		temperature?: number;
		maxTokens?: number;
		thinking?: boolean;
		signal?: AbortSignal;
	}): Promise<string> {
		// One brain (brain.ts): the connected Claude writes these, with the same instructions. Claude not connected and an
		// earlier AI set up (1.0.58's keys): that one, as before, so nothing that worked stops.
		const messages = [
			{ role: "system" as const, content: system },
			{ role: "user" as const, content: user },
		];
		try {
			return await brainChat("text", messages, { json, signal });
		} catch (error) {
			const a = (error as Error)?.message === BRAIN_OFF ? activeAgent() : null;
			if (!a) throw error;
			if (a.provider === "anthropic") return claudeComplete({ system, messages: [{ role: "user", content: user }], json, maxTokens, signal });
			const r = await compatChat(a.provider === "deepseek" ? { ...a, model: this.model || a.model } : a, { messages, json, maxTokens, temperature, thinking, signal });
			if (!r.content.trim()) {
				if (r.finish === "length") throw new StudioError("Gaziyav AI didn't manage this one: nothing was changed. Press the button once more.");
				throw new StudioError("Gaziyav AI didn't manage this one: nothing was changed. Press the button once more.");
			}
			return r.content;
		}
	}
}

export { cleanSpeech, SCRIPT_SYSTEM, type ScriptAction } from "@/studio/shared/script";

/** The words to speak for a clip (studio/shared/script.ts: the same instructions the browser edition uses). */
export const writeScript = (ds: DeepSeek, o: Parameters<typeof writeShared>[1]) => writeShared(ds, o, (message) => new StudioError(message));
