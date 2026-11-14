import { describe, expect, test } from "bun:test";
import { factProblems } from "../server/facts";

const speech = "Честно, всех заебали уже вот эти инфоцегане с топ-пятью пронтами для чат-жи-пяти, топ-пять настроек для инстаграма, блять.".split(" ");
const src = { request: "lower third with a whoosh", words: speech, clipNames: ["Untitled"], onScreen: [] };

describe("fact guard", () => {
	test("an invented speaker name is caught", () => {
		const p = factProblems([{ kind: "LowerThird", from: 0, to: 3, props: { name: "Алекс Морган", role: "Автор канала" } }], src);
		expect(p.length).toBe(1);
		expect(p[0].problem).toContain("Алекс");
	});
	test("words from the speech pass, even misheard ones and spoken numbers", () => {
		const p = factProblems(
			[
				{ kind: "LowerThird", from: 0, to: 3, props: { name: "Топ-5 промтов", role: "для ChatGPT" } },
				{ kind: "HookTitle", from: 0, to: 2, props: { text: "Хватит этих\n*инфоцыган*" } },
				{ kind: "CTA", from: 5, to: 7, props: { text: "Сохрани себе" } },
			],
			{ ...src, request: "ChatGPT" },
		);
		expect(p).toEqual([]);
	});
	test("numbers that nobody said are caught", () => {
		const p = factProblems([{ kind: "Counter", from: 0, to: 2, props: { value: 87, suffix: "%" } }], src);
		expect(p.length).toBe(1);
	});
});
