import { describe, expect, test } from "bun:test";
import { exportSaveName, FILE_NAME_MAX_BYTES, sameSavedName } from "../file-name";

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** What Chromium does to a download's suggested name (its illegal characters → «_»). */
const chromium = (name: string) => name.replace(/["~*/:<>?\\|\p{Cc}\p{Cf}]/gu, "_");

describe("export file names", () => {
	test("the characters Chromium changes in a download name are changed before: the saved name is the asked one", () => {
		const asked = exportSaveName('My "best" *clip*? <v2> | final.mp4');
		expect(asked).toBe("My _best_ _clip__ _v2_ _ final.mp4");
		expect(chromium(asked)).toBe(asked);
		expect(exportSaveName("Тест ~ ролик.mov")).toBe("Тест _ ролик.mov");
		// an emoji's joiner is a format character too
		expect(chromium(exportSaveName("Семья 👨‍👩‍👧.mp4"))).toBe(exportSaveName("Семья 👨‍👩‍👧.mp4"));
	});

	test("the app's reply with Chromium's version of a name still belongs to the export", () => {
		expect(sameSavedName('a "b".mp4', 'a "b".mp4')).toBe(true);
		expect(sameSavedName("a _b_.mp4", 'a "b".mp4')).toBe(true);
		expect(sameSavedName("Clip_1.mp4", "Clip?1.mp4")).toBe(true);
		expect(sameSavedName("Other.mp4", "Clip.mp4")).toBe(false);
		expect(sameSavedName("Clip.gif", "Clip.mp4")).toBe(false);
		expect(sameSavedName("x.mp4", "***")).toBe(false);
	});

	test("a name past the limit is shortened for the file, its extension kept", () => {
		const long = `${"Очень длинное название проекта ".repeat(20)}.mp4`;
		const saved = exportSaveName(long);
		expect(bytes(saved)).toBeLessThanOrEqual(FILE_NAME_MAX_BYTES);
		expect(saved.endsWith(".mp4")).toBe(true);
		expect(saved.startsWith("Очень длинное")).toBe(true);
		expect(saved).not.toMatch(/\s\.mp4$/);
		const ascii = exportSaveName(`${"a".repeat(400)}.wav`);
		expect(ascii).toBe(`${"a".repeat(FILE_NAME_MAX_BYTES - 4)}.wav`);
	});

	test("emoji are never cut in half; short names are left alone; an empty stem is «Video»", () => {
		const saved = exportSaveName(`${"🎬".repeat(80)}.mp4`, 30);
		expect(bytes(saved)).toBeLessThanOrEqual(30);
		expect(saved).toBe(`${"🎬".repeat(6)}.mp4`);
		expect(exportSaveName("Video_2024-11-04.mp4")).toBe("Video_2024-11-04.mp4");
		expect(exportSaveName(" .hidden.mp4")).toBe("hidden.mp4");
		expect(exportSaveName(".mp4")).toBe("Video.mp4");
	});
});
