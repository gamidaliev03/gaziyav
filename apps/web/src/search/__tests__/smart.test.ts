import { describe, expect, test } from "bun:test";
import { smartFilter, swapLayout, translit } from "../smart";

type Item = { name: string; group: string };

// Kadr self-test catalogue (KadrSelfTest/CoreTests.swift).
const ITEMS: Item[] = [
	{ name: "Fast rocket whoosh", group: "Transitions" },
	{ name: "Gaussian Blur", group: "Blur & Sharpen" },
	{ name: "Digital glitch", group: "Glitch & Tech" },
	{ name: "Sleepy Cat", group: "Lo-fi & Chill" },
	{ name: "Crowd applause", group: "Funny & Reactions" },
	{ name: "Cross Dissolve", group: "Transitions" },
	{ name: "Sad piano", group: "Emotional & Sad" },
	{ name: "Door knock", group: "Everyday" },
];

const fields = (item: Item) => [item.name, item.group];
const top = (query: string) =>
	smartFilter({ items: ITEMS, query, fields })[0]?.name;

describe("smart search (Kadr self-test)", () => {
	test.each(["WHOOSH", "whosh", "цщщыр", "свуш", "вжух"])("%s → whoosh", (q) => {
		expect(top(q)).toBe("Fast rocket whoosh");
	});
	test.each(["bulr", "размытие"])("%s → blur", (q) => {
		expect(top(q)).toBe("Gaussian Blur");
	});
	test("глитч → glitch", () => expect(top("глитч")).toBe("Digital glitch"));
	test.each(["лофи", "lofi"])("%s → lo-fi", (q) => {
		expect(top(q)).toBe("Sleepy Cat");
	});
	test("аплодисменты", () => expect(top("аплодисменты")).toBe("Crowd applause"));
	test("переходы contains Cross Dissolve", () => {
		const names = smartFilter({ items: ITEMS, query: "переходы", fields }).map(
			(item) => item.name,
		);
		expect(names).toContain("Cross Dissolve");
	});
	test.each(["грустная", "пиано"])("%s → sad piano", (q) => {
		expect(top(q)).toBe("Sad piano");
	});
	test("zzqx → nothing", () => {
		expect(smartFilter({ items: ITEMS, query: "zzqx", fields })).toHaveLength(0);
	});
	test("empty query returns everything in order", () => {
		expect(smartFilter({ items: ITEMS, query: "  ", fields })).toEqual(ITEMS);
	});
	test("layout swap and translit helpers", () => {
		expect(swapLayout("ghbdtn")).toBe("привет");
		expect(swapLayout("цщщыр")).toBe("woosh");
		expect(translit("глитч")).toBe("glitch");
	});
	test("2000 items: under 45 ms per keystroke", () => {
		const many: Item[] = [];
		for (let i = 0; i < 2000; i++) {
			many.push({ name: `${ITEMS[i % ITEMS.length].name} ${i}`, group: ITEMS[i % 7].group });
		}
		smartFilter({ items: many, query: "w", fields });
		const started = performance.now();
		for (const q of ["в", "вж", "вжу", "вжух"]) {
			smartFilter({ items: many, query: q, fields });
		}
		const perKeystroke = (performance.now() - started) / 4;
		expect(perKeystroke).toBeLessThan(45);
	});
});
