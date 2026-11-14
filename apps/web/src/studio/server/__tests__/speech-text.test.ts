import { describe, expect, test } from "bun:test";
import { speechText } from "../speech-text";

// What the voice model reads: the text as a person says it (emoji and links made it mumble, "3,5 млн" came out as
// "3 – 5 миллионет").
describe("speech text", () => {
	test("emoji go, links are said by name", () => {
		expect(speechText("Скидка 50% 🔥🔥 только сегодня! Заходи на https://gaziyav.app 👉", "russian")).toBe(
			"Скидка 50 процентов только сегодня! Заходи на gaziyav точка app",
		);
		expect(speechText("Visit www.gaziyav.app/pricing ✨ now", "english")).toBe("Visit gaziyav dot app now");
	});

	test("Russian numbers with units and decimal commas become words", () => {
		expect(speechText("В 2026 году 3,5 млн пользователей", "russian")).toBe("В 2026 году 3 целых 5 десятых миллиона пользователей");
		expect(speechText("1 млн, 3 млн, 25 тыс., 21%, 11%", "russian")).toBe("1 миллион, 3 миллиона, 25 тысяч, 21 процент, 11 процентов");
		expect(speechText("Цена $5 или 490 ₽", "russian")).toBe("Цена 5 долларов или 490 рублей");
		expect(speechText("Товар №7 & подарок", "russian")).toBe("Товар номер 7 и подарок");
	});

	test("English units", () => {
		expect(speechText("Save 30% — only $19.99 & free shipping", "english")).toBe("Save 30 percent — only 19.99 dollars and free shipping");
	});

	test("plain text is left as it is", () => {
		expect(speechText("Привет! Это проверка голоса.", "russian")).toBe("Привет! Это проверка голоса.");
		expect(speechText("Wait for it… this changes everything.", "english")).toBe("Wait for it… this changes everything.");
	});
});
