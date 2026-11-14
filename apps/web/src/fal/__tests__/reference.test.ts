import { describe, expect, test } from "bun:test";
import { referenceFor, writingOf } from "@/fal/reference";

describe("a clone hears its sample's transcript only in the text's own language", () => {
	test("the writing of a text is where most of its letters are", () => {
		expect(writingOf("Привет, это проверка")).toBe("cyrillic");
		expect(writingOf("You know, I grew up in Kansas")).toBe("latin");
		expect(writingOf("Скидка 50% на iPhone до конца недели")).toBe("cyrillic");
		expect(writingOf("こんにちは")).toBe("cjk");
		expect(writingOf("123 !?")).toBeNull();
	});

	test("an English sample under a Russian text: no transcript (it gave the English accent)", () => {
		expect(referenceFor("Сегодня я расскажу, почему…", "You know, I grew up in Kansas.")).toBeUndefined();
		expect(referenceFor("Hello there", "Привет всем")).toBeUndefined();
	});

	test("the same language keeps the transcript (the clone is closer with it); none stays none", () => {
		expect(referenceFor("Сегодня я расскажу", "  Ну вот, я вырос в Казани.  ")).toBe("Ну вот, я вырос в Казани.");
		expect(referenceFor("Today I'll tell you", "You know, I grew up in Kansas.")).toBe("You know, I grew up in Kansas.");
		expect(referenceFor("Сегодня", undefined)).toBeUndefined();
		expect(referenceFor("Сегодня", "   ")).toBeUndefined();
	});
});
