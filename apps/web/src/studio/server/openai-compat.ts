// One OpenAI-compatible chat client for every AI but Claude (OpenAI, Gemini, Grok, DeepSeek, OpenRouter, any other
// address such as LM Studio or Ollama): the same request at each provider's own address, a few per-provider details.
import type { ActiveAgent } from "./agent-keys";
import { postJson } from "./http";
import { falModel } from "@/fal/models";
import { addSpend } from "@/fal/server";

/** The request body for one chat completion, in each provider's dialect. */
export function chatBody(
	a: ActiveAgent,
	{ messages, tools, json, maxTokens, temperature, thinking }: { messages: unknown[]; tools?: unknown[]; json?: boolean; maxTokens: number; temperature?: number; thinking?: boolean },
) {
	const body: Record<string, unknown> = { model: a.model, messages, stream: false };
	if (tools?.length) {
		body.tools = tools;
		body.tool_choice = "auto";
	}
	// OpenAI's current models take max_completion_tokens and only their default temperature.
	if (a.provider === "openai") body.max_completion_tokens = maxTokens;
	else {
		body.max_tokens = maxTokens;
		if (temperature !== undefined) body.temperature = temperature;
	}
	if (json && a.provider !== "other") body.response_format = { type: "json_object" };
	// DeepSeek's flash model thinks unless told not to; quick steps and short texts run without it.
	if (a.provider === "deepseek" && thinking === false) body.thinking = { type: "disabled" };
	return body;
}

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
