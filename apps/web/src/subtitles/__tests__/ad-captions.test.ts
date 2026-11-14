import { describe, expect, test } from "bun:test";
import { BUNDLED_FONTS } from "@/fonts/bundled";
import { FONT_SIZE_SCALE_REFERENCE } from "@/text/typography";
import { isHangingWord } from "@/text/line-break";
import { chunkCaptionWords } from "../chunk";
import { AD_CAPTION_STYLES, CAPTION_STYLES, getCaptionStyle } from "../styles";

// Ten ad caption presets for Cyrillic (docs/MARKETING.md): 1–3 words a screen, the spoken word highlighted,
// Montserrat / Inter / Manrope / Rubik / Golos ExtraBold, white with a 6–8 px stroke, 64–80 px at 1080×1920.
const HEIGHT = 1920;
const fontPx = (fontSize: number) => (fontSize * HEIGHT) / FONT_SIZE_SCALE_REFERENCE;

describe("ad caption presets", () => {
	test("ten of them, listed in the Captions tab and found by id", () => {
		expect(AD_CAPTION_STYLES).toHaveLength(10);
		expect(new Set(AD_CAPTION_STYLES.map((style) => style.id)).size).toBe(10);
		for (const style of AD_CAPTION_STYLES) {
			expect(CAPTION_STYLES).toContain(style);
			expect(getCaptionStyle(style.id)).toBe(style);
		}
	});

	test("the brief's fonts, ExtraBold, each bundled with an 800 weight", () => {
		const families = new Set(AD_CAPTION_STYLES.map((style) => style.params.fontFamily));
		expect([...families].sort()).toEqual(["Golos Text", "Inter", "Manrope", "Montserrat", "Rubik"]);
		for (const style of AD_CAPTION_STYLES) {
			expect(style.params.fontWeight).toBe("800");
			const font = BUNDLED_FONTS.find((bundled) => bundled.family === style.params.fontFamily);
			const [low, high] = (font?.faces[0]?.weight ?? "0 0").split(" ").map(Number);
			expect(low <= 800 && 800 <= high).toBe(true);
		}
	});

	test("white letters 64–80 px with a black 6–8 px stroke, 1–3 words, the spoken word highlighted", () => {
		for (const style of AD_CAPTION_STYLES) {
			const px = fontPx(Number(style.params.fontSize));
			const strokePx = (Number(style.params["stroke.width"]) / 100) * px;
			expect(px).toBeGreaterThanOrEqual(63.5);
			expect(px).toBeLessThanOrEqual(80.5);
			expect(strokePx).toBeGreaterThanOrEqual(5.9);
			expect(strokePx).toBeLessThanOrEqual(8.1);
			expect(style.params.color).toBe("#ffffff");
			expect(style.params["stroke.enabled"]).toBe(true);
			expect(style.params["stroke.color"]).toBe("#000000");
			expect(style.limits.maxWords).toBeGreaterThanOrEqual(1);
			expect(style.limits.maxWords).toBeLessThanOrEqual(3);
			expect(["color", "karaoke", "box", "pop"].includes(String(style.params["highlight.mode"]))).toBe(true);
		}
	});

	test("a Russian ad line splits into screens of at most the preset's words, nothing lost", () => {
		const phrase = "Скидка 40 % только до пятницы жми на ссылку в описании";
		const words = phrase.split(" ").map((text, index) => ({ text, startTime: index * 0.3, endTime: index * 0.3 + 0.28 }));
		for (const style of AD_CAPTION_STYLES) {
			const chunks = chunkCaptionWords({ words, limits: style.limits });
			expect(chunks.map((chunk) => chunk.text).join(" ")).toBe(phrase);
			// A preposition rides with its word («на ссылку») and «40 %» is one unit: they do not count as extra words.
			for (const chunk of chunks) {
				const counted = chunk.text.replace(" %", "%").split(" ").filter((word) => !isHangingWord(word));
				expect(counted.length).toBeLessThanOrEqual(style.limits.maxWords);
			}
		}
	});
});
