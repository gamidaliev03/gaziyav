// The body of one OpenAI-compatible chat completion, in each provider's dialect — pure, so the Mac app's server
// (studio/server/openai-compat.ts) and the browser edition (web/agent: fal's OpenRouter from the page) send the same JSON.

/** The request body for one chat completion, in each provider's dialect. */
export function chatBody(
	a: { provider: string; model: string },
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
