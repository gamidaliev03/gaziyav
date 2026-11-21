import { describe, expect, test } from "bun:test";
import { parseAiTitles, speechForPrompt } from "../server/ai-titles";

describe("AI titles parsing", () => {
	test("reads JSON, strips quotes, emoji, hashtags and the final dot", () => {
		expect(parseAiTitles('{"hook": "«Ты делаешь это неправильно» 🔥", "cta": "Жми на ссылку. #ad"}')).toEqual({
			hook: "Ты делаешь это неправильно",
			cta: "Жми на ссылку",
		});
	});
	test("tolerates text around the JSON and caps the length", () => {
		const titles = parseAiTitles('Вот: {"hook": "раз два три четыре пять шесть семь восемь девять десять", "cta": "купи"}');
		expect(titles.hook.split(" ").length).toBe(9);
		expect(titles.cta).toBe("купи");
	});
	test("unusable answers give a readable error", () => {
		// one plain line, never «unreadable» or «try again» (one brain, 21.11)
		expect(() => parseAiTitles("нет")).toThrow("nothing was changed");
		expect(() => parseAiTitles('{"hook": "", "cta": "x"}')).toThrow("nothing was changed");
	});
	test("long speech keeps its start and end", () => {
		const long = `${"а ".repeat(2000)}финал`;
		const prompt = speechForPrompt(long);
		expect(prompt.length).toBeLessThan(3000);
		expect(prompt.endsWith("финал")).toBe(true);
	});
});
