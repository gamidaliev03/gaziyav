// Claude (Anthropic Messages API) as Gaziyav AI's language model, on the user's own key. The window keeps its
// conversation in the chat-completions shape it uses with DeepSeek; this turns it into Messages API turns and the answer
// back, with the same tools (agent/tools.ts). Claude's own content blocks (thinking, tool calls) travel back unchanged
// in `raw`, so every later request replays them as they were.
import Anthropic from "@anthropic-ai/sdk";
import { activeAgent, NOT_SET_UP } from "./agent-keys";
import { anthropicBase, CLAUDE_MODELS } from "./agent-providers";
import { StudioError } from "./errors";

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/** A message as the window sends it (chat-completions shape). */
export interface WireMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | Part[];
	tool_calls?: Array<{ id: string; type?: string; function: { name: string; arguments: string } }>;
	tool_call_id?: string;
	/** Claude's content blocks of an earlier answer, sent back unchanged. */
	raw?: unknown;
}

interface WireTool {
	type?: string;
	function?: { name: string; description?: string; parameters?: Record<string, unknown> };
}

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

function client(key: string, timeout = 180_000) {
	// Only the user's key: never a token or an address from the environment (the SDK would read ANTHROPIC_*).
	return new Anthropic({ apiKey: key, authToken: null, baseURL: anthropicBase() ?? "https://api.anthropic.com", maxRetries: 2, timeout });
}

function image(url: string): Anthropic.Beta.BetaImageBlockParam | null {
	const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([\s\S]+)$/.exec(url);
	return m ? { type: "image", source: { type: "base64", media_type: m[1] as "image/png", data: m[2] } } : null;
}

function blocks(content: WireMessage["content"]): Anthropic.Beta.BetaContentBlockParam[] {
	if (typeof content === "string") return content.trim() ? [{ type: "text", text: content }] : [];
	return content.flatMap((p): Anthropic.Beta.BetaContentBlockParam[] => {
		if (p.type === "text") return p.text.trim() ? [{ type: "text", text: p.text }] : [];
		const img = image(p.image_url.url);
		return img ? [img] : [];
	});
}

function parseArgs(raw: string): Record<string, unknown> {
	try {
		const v = JSON.parse(raw || "{}");
		return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/** The window's conversation as Messages API turns: system text, then user/assistant turns with tool blocks. */
export function toClaude(messages: WireMessage[]): { system: string; context: string; turns: Anthropic.Beta.BetaMessageParam[] } {
	const firstNonSystem = messages.findIndex((m) => m.role !== "system");
	const lead = firstNonSystem < 0 ? messages : messages.slice(0, firstNonSystem);
	const body = firstNonSystem < 0 ? [] : messages.slice(firstNonSystem);
	const system = lead.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n\n");
	// The editor's state of this moment comes last as a system message: it goes in front of the newest turn.
	const trailing: string[] = [];
	while (body.length && body[body.length - 1].role === "system") {
		const m = body.pop() as WireMessage;
		trailing.unshift(typeof m.content === "string" ? m.content : "");
	}
	const turns: Anthropic.Beta.BetaMessageParam[] = [];
	const push = (role: "user" | "assistant", content: Anthropic.Beta.BetaContentBlockParam[]) => {
		if (!content.length) return;
		const last = turns[turns.length - 1];
		if (last && last.role === role && Array.isArray(last.content)) last.content.push(...content);
		else turns.push({ role, content: [...content] });
	};
	for (const m of body) {
		if (m.role === "assistant") {
			if (Array.isArray(m.raw)) push("assistant", m.raw as Anthropic.Beta.BetaContentBlockParam[]);
			else
				push("assistant", [
					...blocks(m.content),
					...(m.tool_calls ?? []).map((c): Anthropic.Beta.BetaToolUseBlockParam => ({ type: "tool_use", id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) })),
				]);
		} else if (m.role === "tool") {
			push("user", [{ type: "tool_result", tool_use_id: m.tool_call_id ?? "", content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }]);
		} else if (m.role === "user") push("user", blocks(m.content));
		else trailing.push(typeof m.content === "string" ? m.content : "");
	}
	return { system, context: trailing.filter(Boolean).join("\n\n"), turns };
}

function toolsFor(tools: unknown[]): Anthropic.Beta.BetaTool[] {
	return (tools as WireTool[]).flatMap((t): Anthropic.Beta.BetaTool[] => {
		const f = t.function;
		if (!f?.name) return [];
		return [{ name: f.name, description: f.description ?? "", input_schema: { type: "object", ...(f.parameters ?? {}) } as Anthropic.Beta.BetaTool.InputSchema }];
	});
}

function explain(error: unknown): never {
	if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
		throw new StudioError("Claude didn't accept the key. Check it in Settings → Gaziyav AI.");
	}
	if (error instanceof Anthropic.RateLimitError) throw new StudioError("Claude is busy for this key right now (rate limit). Try again in a minute.");
	if (error instanceof Anthropic.APIConnectionError) throw new StudioError("Claude can't be reached. Check the internet connection and try again.");
	if (error instanceof Anthropic.APIError) throw new StudioError(`Claude answered ${error.status ?? "an error"}: ${error.message.slice(0, 160)}`);
	throw error;
}

function claudeKey(): { key: string; model: string } {
	const a = activeAgent();
	if (!a || a.provider !== "anthropic") throw new StudioError(NOT_SET_UP);
	return { key: a.key, model: a.model || CLAUDE_MODELS[0] };
}

function answerText(message: Anthropic.Beta.BetaMessage): string {
	if (message.stop_reason === "refusal") throw new StudioError("Claude declined this request. Rephrase it and try again.");
	return message.content
		.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
		.map((b) => b.text)
		.join("");
}

/** One Gaziyav AI step on Claude: the window's conversation and tools in, the next message (text and tool calls) out. */
export async function claudeAgentStep(messages: WireMessage[], tools: unknown[], signal?: AbortSignal) {
	const { key, model } = claudeKey();
	const { system, context, turns } = toClaude(messages);
	if (!turns.length || turns[0].role !== "user") throw new StudioError("Empty conversation");
	// A mid-conversation system message must come right after a user turn (the request or the tool results).
	if (context && turns[turns.length - 1].role === "user") turns.push({ role: "system", content: context } as unknown as Anthropic.Beta.BetaMessageParam);
	const message = await client(key)
		.beta.messages.create(
			{
				model,
				max_tokens: 16000,
				betas: [FALLBACK_BETA],
				fallbacks: "default",
				// The system prompt and the tool list are the same every step: cached after the first one.
				cache_control: { type: "ephemeral" },
				system: [{ type: "text", text: system }],
				tools: toolsFor(tools),
				output_config: { effort: "medium" },
				messages: turns,
			},
			{ signal },
		)
		.catch(explain);
	const text = answerText(message);
	const calls = message.content
		.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
		.map((b) => ({ id: b.id, type: "function" as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
	if (message.stop_reason === "max_tokens" && calls.length) throw new StudioError("Claude's answer was cut off. Ask for a smaller step.");
	return { message: { role: "assistant" as const, content: text, tool_calls: calls.length ? calls : undefined, raw: message.content } };
}

/** One answer for the text features (script, titles, translation, AI composition) when Claude is Gaziyav AI's model. */
export async function claudeComplete({
	system,
	messages,
	json,
	maxTokens = 8000,
	signal,
	timeout,
}: {
	system: string;
	messages: Array<{ role: "user" | "assistant"; content: string | Part[] }>;
	json?: boolean;
	maxTokens?: number;
	signal?: AbortSignal;
	timeout?: number;
}): Promise<string> {
	const { key, model } = claudeKey();
	const turns = messages.map((m) => ({ role: m.role, content: blocks(m.content) })).filter((m) => m.content.length) as Anthropic.Beta.BetaMessageParam[];
	if (!turns.length) throw new StudioError("Empty request");
	const message = await client(key, (timeout ?? 180) * 1000)
		.beta.messages.create(
			{
				model,
				max_tokens: Math.max(1024, maxTokens),
				betas: [FALLBACK_BETA],
				fallbacks: "default",
				system: json ? `${system}\n\nAnswer with one JSON object only: no prose, no code fences.` : system,
				output_config: { effort: "medium" },
				messages: turns,
			},
			{ signal },
		)
		.catch(explain);
	const text = answerText(message).trim();
	if (!json) return text;
	// The JSON object itself, even if a sentence slipped around it.
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}
