import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { baseFor, PROVIDERS, providerInfo, recommendModel, usableModels } from "../agent-providers";
import { chatBody } from "../openai-compat";

// Gaziyav AI's AIs: addresses, the model each starts with, the request each one gets, and the Keychain itself.
describe("Gaziyav AI's AI providers", () => {
	test("Gaziyav thinks with fal only; the old providers keep their OpenAI-compatible https addresses (Other: the user's own)", () => {
		expect(PROVIDERS.map((p) => p.id)).toEqual(["fal"]);
		expect(PROVIDERS[0].base).toBe("https://fal.run/openrouter/router/openai/v1");
		for (const id of ["openai", "gemini", "xai", "deepseek", "openrouter"]) expect(providerInfo(id)?.base).toMatch(/^https:\/\/[a-z.]+\.(com|ai)(\/[\w./-]+)?$/);
		expect(providerInfo("other")?.keyOptional).toBe(true);
		const saved = { ...process.env };
		(process.env as Record<string, string>).NODE_ENV = "production";
		delete process.env.GAZIYAV_TEST_LLM_BASE;
		expect(baseFor("gemini", "")).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
		expect(baseFor("other", "http://localhost:1234/v1/")).toBe("http://localhost:1234/v1");
		Object.assign(process.env, saved);
	});

	test("the model it starts with: the preferred one the account lists, newest first", () => {
		expect(recommendModel("anthropic", [])).toBe("claude-sonnet-5-5");
		expect(recommendModel("openai", usableModels("openai", [{ id: "gpt-4o" }, { id: "gpt-5" }, { id: "gpt-5.1" }, { id: "gpt-5-mini" }, { id: "text-embedding-3-large" }]))).toBe("gpt-5.1");
		expect(recommendModel("gemini", usableModels("gemini", [{ id: "models/gemini-2.5-flash" }, { id: "models/gemini-2.5-pro" }, { id: "models/text-embedding-004" }]))).toBe("gemini-2.5-pro");
		expect(recommendModel("xai", ["grok-3-mini", "grok-4"])).toBe("grok-4");
		expect(recommendModel("deepseek", ["deepseek-chat", "deepseek-flash"])).toBe("deepseek-flash");
		expect(recommendModel("other", ["qwen3-8b", "llama-3.3"])).toBe("qwen3-8b");
	});

	test("OpenRouter: only models that can call tools", () => {
		const ids = usableModels("openrouter", [
			{ id: "anthropic/claude-sonnet-4.5", supported_parameters: ["tools", "temperature"] },
			{ id: "some/model-without-tools", supported_parameters: ["temperature"] },
			{ id: "openai/gpt-5", supported_parameters: ["tools"] },
		]);
		expect(ids).toEqual(["anthropic/claude-sonnet-4.5", "openai/gpt-5"]);
		expect(recommendModel("openrouter", ids)).toBe("anthropic/claude-sonnet-4.5");
	});

	test("each one gets its own dialect of the same request", () => {
		const a = (provider: "openai" | "deepseek" | "other" | "xai") => ({ provider, name: provider, key: "k", model: "m", base: "https://x" });
		const tools = [{ type: "function", function: { name: "add_text", parameters: { type: "object" } } }];
		const openai = chatBody(a("openai"), { messages: [], tools, maxTokens: 4000, temperature: 0.3, thinking: false, json: true });
		expect(openai).toMatchObject({ model: "m", max_completion_tokens: 4000, tool_choice: "auto", response_format: { type: "json_object" } });
		expect(openai).not.toHaveProperty("temperature");
		expect(openai).not.toHaveProperty("thinking");
		expect(chatBody(a("deepseek"), { messages: [], maxTokens: 10, thinking: false })).toMatchObject({ max_tokens: 10, thinking: { type: "disabled" } });
		expect(chatBody(a("other"), { messages: [], maxTokens: 10, json: true })).not.toHaveProperty("response_format");
		expect(chatBody(a("xai"), { messages: [], maxTokens: 10, temperature: 0.5 })).toMatchObject({ max_tokens: 10, temperature: 0.5 });
	});
});

describe("the Keychain (a stand-in service, never the real one)", () => {
	const SERVICE = `com.gaziyav.app.agent.selftest-${process.pid}`;
	const saved = { s: process.env.GAZIYAV_KEYCHAIN_SERVICE, r: process.env.GAZIYAV_REAL_KEYCHAIN };
	afterAll(() => {
		spawnSync("/usr/bin/security", ["delete-generic-password", "-s", SERVICE, "-a", "openai"], { stdio: "ignore" });
		if (saved.s === undefined) delete process.env.GAZIYAV_KEYCHAIN_SERVICE;
		else process.env.GAZIYAV_KEYCHAIN_SERVICE = saved.s;
		if (saved.r === undefined) delete process.env.GAZIYAV_REAL_KEYCHAIN;
		else process.env.GAZIYAV_REAL_KEYCHAIN = saved.r;
	});

	test("write, read and delete through /usr/bin/security, the secret never on the command line", async () => {
		process.env.GAZIYAV_KEYCHAIN_SERVICE = SERVICE;
		process.env.GAZIYAV_REAL_KEYCHAIN = "1";
		const keys = await import("../agent-keys");
		const secret = `sk-selftest-${Date.now()}`;
		keys.storeKey("openai", secret);
		const read = spawnSync("/usr/bin/security", ["find-generic-password", "-s", SERVICE, "-a", "openai", "-w"], { encoding: "utf8" });
		expect(read.stdout.trim()).toBe(secret);
		expect(keys.getKey("openai")).toBe(secret);
		keys.deleteKey("openai");
		expect(spawnSync("/usr/bin/security", ["find-generic-password", "-s", SERVICE, "-a", "openai"], { stdio: "ignore" }).status).not.toBe(0);
		expect(keys.getKey("openai")).toBe("");
	});
});
