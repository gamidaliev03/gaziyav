// One OpenAI-compatible chat client for every AI but Claude (OpenAI, Gemini, Grok, DeepSeek, OpenRouter, any other
// address such as LM Studio or Ollama): the same request at each provider's own address, a few per-provider details.
import type { ActiveAgent } from "./agent-keys";
import { postJson } from "./http";
import { falModel } from "@/fal/models";
import { addSpend } from "@/fal/server";
import { chatBody } from "@/studio/shared/chat-body";

export { chatBody };

export async function compatChat(
	a: ActiveAgent,
	o: { messages: unknown[]; tools?: unknown[]; json?: boolean; maxTokens: number; temperature?: number; thinking?: boolean; timeout?: number; signal?: AbortSignal },
): Promise<{ content: string; tool_calls?: unknown[]; finish?: string }> {
	// A rejected key, an empty balance, "busy" or no internet come back as one clear sentence (http.ts);
	// 429/5xx and dropped connections are tried again first.
	const r = await postJson(`${a.base}/chat/completions`, a.key ? { Authorization: a.provider === "fal" ? `Key ${a.key}` : `Bearer ${a.key}` } : {}, chatBody(a, o), {
		signal: o.signal,
		service: a.name,
		timeout: o.timeout ?? 180,
		retry: "chat",
	});
	const choice = r?.choices?.[0];
	// The tokens of this call into «Spent so far» (fal bills them): at the model's input price (the output price isn't printed on
	// fal's pages, docs/PRICES.md), so the dollars are a floor — the token count itself is exact.
	const usage = r?.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
	const tokens = Number(usage?.total_tokens ?? (Number(usage?.prompt_tokens ?? 0) + Number(usage?.completion_tokens ?? 0)));
	if (a.provider === "fal" && tokens > 0) {
		const perMillion = falModel(a.model)?.usd ?? 0;
		addSpend("llm", (tokens * perMillion) / 1e6, tokens);
	}
	return { content: choice?.message?.content ?? "", tool_calls: choice?.message?.tool_calls ?? undefined, finish: choice?.finish_reason };
}
