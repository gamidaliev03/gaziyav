// DeepSeek chat API (OpenAI-compatible): https://api-docs.deepseek.com — writes the words to speak.
import { activeAgent, agentReady, NOT_SET_UP } from "./agent-keys";
import { claudeComplete } from "./claude";
import { StudioError } from "./errors";
import { compatChat } from "./openai-compat";
import { writeScript as writeShared } from "@/studio/shared/script";

export class DeepSeek {
	constructor(
		private apiKey: string,
		private model: string,
	) {
		if (!apiKey && !agentReady()) throw new StudioError(NOT_SET_UP);
	}

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
		// Whichever AI the user chose writes these, with the same instructions.
		const a = activeAgent();
		if (!a) throw new StudioError(NOT_SET_UP);
		if (a.provider === "anthropic") return claudeComplete({ system, messages: [{ role: "user", content: user }], json, maxTokens, signal });
		const r = await compatChat(a.provider === "deepseek" ? { ...a, model: this.model || a.model } : a, {
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: user },
			],
			json,
			maxTokens,
			temperature,
			thinking,
			signal,
		});
		if (!r.content.trim()) {
			if (r.finish === "length") throw new StudioError("Gaziyav AI ran out of answer length. Try again: it usually works the second time.");
			throw new StudioError("Gaziyav AI returned an empty answer. Try again.");
		}
		return r.content;
	}
}

export { cleanSpeech, SCRIPT_SYSTEM, type ScriptAction } from "@/studio/shared/script";

/** The words to speak for a clip (studio/shared/script.ts: the same instructions the browser edition uses). */
export const writeScript = (ds: DeepSeek, o: Parameters<typeof writeShared>[1]) => writeShared(ds, o, (message) => new StudioError(message));
