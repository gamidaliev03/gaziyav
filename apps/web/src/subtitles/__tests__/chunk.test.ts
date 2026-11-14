import { describe, expect, test } from "bun:test";
import { chunkCaptionWords } from "../chunk";
import { isHangingWord } from "@/text/line-break";
import type { CaptionWord } from "@/transcription/types";

const PHRASES = [
	"Я пробовал всё и ничего не помогало",
	"Скидка 40 % только до пятницы",
	"Всего 500 ₽ за первый месяц",
	"Доставка за 2 часа в любой район",
	"Он же говорил что это не работает",
	"Без регистрации и без смс",
	"Посмотри на это видео до конца",
	"Мы сделали это для тех кто устал",
	"Через 3 дня кожа стала другой",
	"Не покупай крем пока не увидишь это",
	"10 000 клиентов уже с нами",
	"А вы знали что вода бывает разной",
	"Жми на ссылку в описании профиля",
	"Ёжик щёлкает орешки под ёлкой",
	"Работаем 24/7 без выходных и праздников",
	"Если бы я знал об этом раньше",
	"Это не реклама это мой личный опыт",
	"Сэкономьте до 30 % на каждом заказе",
	"Подписывайся чтобы не пропустить новое",
	"Только сегодня и только у нас",
];

function timed(phrase: string): CaptionWord[] {
	return phrase.split(" ").map((text, index) => ({
		text,
		startTime: index * 0.3,
		endTime: index * 0.3 + 0.28,
	}));
}

const MUST_STAY = [/500 ₽/, /40 %/, /2 часа/, /30 %/, /10 000/, /3 дня/];

describe("RU caption chunking", () => {
	for (const [name, limits] of [
		["Hormozi", { maxWords: 3, maxChars: 18 }],
		["Karaoke", { maxWords: 6, maxChars: 32 }],
	] as const) {
		test(`${name}: no hanging word at a chunk end, numbers keep their unit`, () => {
			for (const phrase of PHRASES) {
				const chunks = chunkCaptionWords({ words: timed(phrase), limits });
				expect(chunks.map((chunk) => chunk.text).join(" ")).toBe(phrase);
				chunks.forEach((chunk, index) => {
					const words = chunk.text.split(" ");
					if (index < chunks.length - 1) {
						expect(isHangingWord(words[words.length - 1])).toBe(false);
					}
					expect(chunk.words?.length).toBe(words.length);
				});
				for (const pattern of MUST_STAY) {
					if (pattern.test(phrase)) {
						expect(chunks.some((chunk) => pattern.test(chunk.text))).toBe(true);
					}
				}
			}
		});
	}

	test("Hormozi chunks are 1–3 words unless a glue group is longer", () => {
		for (const phrase of PHRASES) {
			for (const chunk of chunkCaptionWords({ words: timed(phrase), limits: { maxWords: 3, maxChars: 18 } })) {
				expect(chunk.text.split(" ").length).toBeLessThanOrEqual(4);
			}
		}
	});

	test("Karaoke chunks are at most 6 words", () => {
		for (const phrase of PHRASES) {
			for (const chunk of chunkCaptionWords({ words: timed(phrase), limits: { maxWords: 6, maxChars: 32 } })) {
				expect(chunk.text.split(" ").length).toBeLessThanOrEqual(6);
			}
		}
	});

	test("chunks never overlap and appear 2 frames early", () => {
		const chunks = chunkCaptionWords({ words: timed(PHRASES[0]), limits: { maxWords: 3, maxChars: 18 } });
		for (let index = 1; index < chunks.length; index++) {
			const previous = chunks[index - 1];
			expect(previous.startTime + previous.duration).toBeLessThanOrEqual(chunks[index].startTime + 1e-9);
		}
		expect(chunks[1].startTime).toBeLessThan(chunks[1].words![0].startTime);
	});

	test("fast speech: the 0.3 s minimum never makes one caption outlast the next one's start", () => {
		// 24 words, 0.12 s apart, one to three words a caption: before the fix every caption after the third
		// overlapped its neighbour by the two-frame early start (60 ms), and the timeline got two texts at once.
		const words: CaptionWord[] = Array.from({ length: 24 }, (_, index) => ({
			text: `word${index}`,
			startTime: index * 0.12,
			endTime: index * 0.12 + 0.1,
		}));
		const chunks = chunkCaptionWords({ words, limits: { maxWords: 3, maxChars: 18 } });
		expect(chunks.length).toBeGreaterThan(5);
		for (let index = 1; index < chunks.length; index++) {
			const previous = chunks[index - 1];
			expect(previous.startTime + previous.duration).toBeLessThanOrEqual(chunks[index].startTime + 1e-9);
		}
	});

	test("two words stamped at one instant leave no zero-length caption", () => {
		const words: CaptionWord[] = [
			{ text: "раз", startTime: 0, endTime: 0.2 },
			{ text: "два", startTime: 0, endTime: 0.2 },
			{ text: "три", startTime: 1, endTime: 1.2 },
		];
		const chunks = chunkCaptionWords({ words, limits: { maxWords: 1, maxChars: 18 } });
		expect(chunks.length).toBeGreaterThan(0);
		for (const chunk of chunks) expect(chunk.duration).toBeGreaterThan(0);
	});

	test("a capitalised word starts a new sentence chunk (not acronyms)", () => {
		const chunks = chunkCaptionWords({
			words: timed("за первый месяц Доставка за 2 часа"),
			limits: { maxWords: 6, maxChars: 40 },
		});
		expect(chunks.map((chunk) => chunk.text)).toEqual(["за первый месяц", "Доставка за 2 часа"]);
		const acronym = chunkCaptionWords({ words: timed("скидка от ООО Ромашка"), limits: { maxWords: 6, maxChars: 40 } });
		expect(acronym[0].text.startsWith("скидка от ООО")).toBe(true);
	});

	test("brands and names mid-sentence stay with their chunk", () => {
		const plain = chunkCaptionWords({ words: timed("Заказывай на Ozon сегодня"), limits: { maxWords: 6, maxChars: 40 } });
		expect(plain.map((chunk) => chunk.text)).toEqual(["Заказывай на Ozon сегодня"]);
		const punctuated = chunkCaptionWords({
			words: timed("Это Иван Петров. Он расскажет всё"),
			limits: { maxWords: 6, maxChars: 40 },
		});
		expect(punctuated.map((chunk) => chunk.text)).toEqual(["Это Иван Петров.", "Он расскажет всё"]);
	});

	test("a pause starts a new chunk", () => {
		const words = timed("раз два три");
		words[2] = { ...words[2], startTime: 2, endTime: 2.3 };
		const chunks = chunkCaptionWords({ words, limits: { maxWords: 6, maxChars: 32 } });
		expect(chunks.map((chunk) => chunk.text)).toEqual(["раз два", "три"]);
	});
});
