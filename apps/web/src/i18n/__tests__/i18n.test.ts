import { describe, expect, test } from "bun:test";
import { setLanguage, t, useLang } from "@/i18n";
import { RU } from "@/i18n/ru";

describe("i18n", () => {
	test("English is the source text; Russian comes from the dictionary, a missing line falls back to English", () => {
		setLanguage("en");
		expect(t("Projects")).toBe("Projects");
		setLanguage("ru");
		expect(useLang.getState().lang).toBe("ru");
		expect(t("Projects")).toBe(RU.Projects);
		expect(t("A string nobody translated")).toBe("A string nobody translated");
		setLanguage("en");
	});

	test("values in braces are filled in both languages", () => {
		setLanguage("en");
		expect(t("{n} clips", { n: 3 })).toBe("3 clips");
		expect(t("{missing} stays", {})).toBe("{missing} stays");
	});
});
