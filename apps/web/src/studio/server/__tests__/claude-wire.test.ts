import { describe, expect, test } from "bun:test";
import { toClaude, type WireMessage } from "../claude";

// Gaziyav AI's conversation (chat-completions shape) as Claude Messages API turns.
describe("Gaziyav AI on Claude: the conversation as Messages API turns", () => {
	const pic = "data:image/jpeg;base64,/9j/AAAA";
	const conversation: WireMessage[] = [
		{ role: "system", content: "You are Gaziyav AI." },
		{ role: "user", content: "Add a title" },
		{ role: "assistant", content: "Adding it.", tool_calls: [{ id: "call_1", type: "function", function: { name: "add_text", arguments: '{"text":"HELLO"}' } }] },
		{ role: "tool", tool_call_id: "call_1", content: '{"id":"abc"}' },
		{ role: "user", content: [{ type: "text", text: "What you looked at — frame" }, { type: "image_url", image_url: { url: pic } }] },
		{ role: "system", content: "Playhead at 2 s." },
	];

	test("system text, merged user turn with the tool result and the picture, the editor's state apart", () => {
		const { system, context, turns } = toClaude(conversation);
		expect(system).toBe("You are Gaziyav AI.");
		expect(context).toBe("Playhead at 2 s.");
		expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
		expect(turns[1].content as unknown).toEqual([
			{ type: "text", text: "Adding it." },
			{ type: "tool_use", id: "call_1", name: "add_text", input: { text: "HELLO" } },
		]);
		const last = turns[2].content as Array<{ type: string }>;
		expect(last.map((b) => b.type)).toEqual(["tool_result", "text", "image"]);
		expect(last[2] as unknown).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/AAAA" } });
	});

	test("Claude's own blocks of an earlier answer go back unchanged", () => {
		const raw = [
			{ type: "thinking", thinking: "", signature: "sig" },
			{ type: "tool_use", id: "toolu_1", name: "get_project", input: {} },
		];
		const { turns } = toClaude([
			{ role: "user", content: "Hi" },
			{ role: "assistant", content: "", tool_calls: [{ id: "toolu_1", function: { name: "get_project", arguments: "{}" } }], raw },
			{ role: "tool", tool_call_id: "toolu_1", content: "{}" },
		]);
		expect(turns[1].content as unknown).toEqual(raw);
	});
});
