import { describe, expect, test } from "bun:test";
import { faceLooksFor } from "../looks";
import { trendSampleUrl, trendVoicesFor, TREND_VOICES } from "../voices";
import fs from "node:fs";
import path from "node:path";

// The Trending rows follow the interface language: Russian names and the Russian market's order in a Russian
// interface, English ones in an English interface; every voice has a sample in both languages.
describe("trends by language", () => {
	test("voices: Russian interface → Russian names, storyteller-trailer-anchor first", () => {
		const ru = trendVoicesFor("ru");
		expect(ru.map((v) => v.id).slice(0, 3)).toEqual(["narrator", "trailer", "news"]);
		expect(ru.every((v) => /[а-яё]/i.test(v.label) || /^[A-Z]{3,}/.test(v.label))).toBe(true);
		expect(ru.find((v) => v.id === "trailer")?.label).toBe("Как в трейлере");
		const en = trendVoicesFor("en");
		expect(en.map((v) => v.id).slice(0, 2)).toEqual(["narrator", "ugc"]);
		expect(en.find((v) => v.id === "trailer")?.label).toBe("Movie trailer");
		expect(new Set(ru.map((v) => v.id))).toEqual(new Set(TREND_VOICES.map((v) => v.id)));
	});

	test("looks: Russian interface → statues first, English → Halloween first", () => {
		expect(faceLooksFor("ru").map((l) => l.label)).toEqual(["Золотая статуя", "Мраморная статуя", "Вампир", "Зомби"]);
		expect(faceLooksFor("en").map((l) => l.id)).toEqual(["zombie", "vampire", "marble", "gold"]);
	});

	test("every voice has its 2 s sample in Russian and in English", () => {
		const pub = path.join(import.meta.dir, "..", "..", "..", "public");
		for (const v of TREND_VOICES) for (const lang of ["ru", "en"] as const) expect(fs.existsSync(path.join(pub, trendSampleUrl(v.id, lang)))).toBe(true);
	});
});
