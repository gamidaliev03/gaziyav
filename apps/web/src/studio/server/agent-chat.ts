// Gaziyav AI chat: one step of the conversation with tool calling, on the user's own model (DeepSeek or Claude). The
// editor (in the window) runs the tools on the open project; this only talks to the model, so the key never leaves
// the app's server.
import { activeAgent, NOT_SET_UP } from "./agent-keys";
import { claudeAgentStep, type WireMessage } from "./claude";
import { StudioError } from "./errors";
import { compatChat } from "./openai-compat";


export interface AgentStepRequest {
	messages: unknown[];
	tools: unknown[];
}

export async function agentStep(body: Partial<AgentStepRequest>, signal?: AbortSignal) {
	const agent = activeAgent();
	if (!agent) throw new StudioError(NOT_SET_UP);
	if (!Array.isArray(body.messages) || !body.messages.length) throw new StudioError("Empty conversation");
	if (agent.provider === "anthropic") return claudeAgentStep(body.messages as WireMessage[], body.tools ?? [], signal);
	// Claude's own blocks of earlier steps (after a switch of AI) mean nothing to the others.
	const messages = (body.messages as WireMessage[]).map(({ raw: _raw, ...m }) => m);
	// Quick tool steps: DeepSeek's thinking model would spend the answer on reasoning.
	const step = agent.provider === "deepseek" && agent.model === "deepseek-reasoner" ? { ...agent, model: "deepseek-flash" } : agent;
	const r = await compatChat(step, { messages, tools: body.tools, maxTokens: 4000, temperature: 0.3, thinking: false, timeout: 120, signal });
	if (!r.content && !r.tool_calls) throw new StudioError("Gaziyav AI returned an empty answer. Try again.");
	return { message: { role: "assistant", content: r.content, tool_calls: r.tool_calls } };
}
