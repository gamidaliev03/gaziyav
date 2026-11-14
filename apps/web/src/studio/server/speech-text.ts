// What the voice model is given to read: the text as a person would say it. The model reads plain words and numbers
// well, but an emoji or a link came out as mumble ("Скидка 50% 🔥 … https://gaziyav.app" → "Скидка 50% LHI", 10 s of
// noise), "3,5 млн" as "3 – 5 миллионет". Emoji go, links are said by their name, Russian decimal commas, «млн / тыс /
// %» and currency signs become words. Digits stay digits: the model says them right in both languages.

type Lang = "russian" | "english" | string;

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu;
const URL = /\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?:\/[^\s]*)?/gi;

/** Russian noun form for a number: 1 → one, 2–4 → few, else many (11–14 → many); a fraction takes «few». */
function ruForm(n: string, one: string, few: string, many: string): string {
	if (/[.,]/.test(n)) return few;
	const v = Math.abs(Number.parseInt(n.replace(/\s/g, ""), 10)) % 100;
	if (v >= 11 && v <= 14) return many;
	const d = v % 10;
	return d === 1 ? one : d >= 2 && d <= 4 ? few : many;
}

const RU_UNITS: Array<[RegExp, [string, string, string]]> = [
	[/млрд\.?/, ["миллиард", "миллиарда", "миллиардов"]],
	[/млн\.?/, ["миллион", "миллиона", "миллионов"]],
	[/тыс\.?/, ["тысяча", "тысячи", "тысяч"]],
	[/%/, ["процент", "процента", "процентов"]],
	[/₽|руб\.?/, ["рубль", "рубля", "рублей"]],
	[/\$/, ["доллар", "доллара", "долларов"]],
	[/€/, ["евро", "евро", "евро"]],
];

const EN_UNITS: Array<[RegExp, string]> = [
	[/%/, "percent"],
	[/\$/, "dollars"],
	[/€/, "euros"],
	[/£/, "pounds"],
];

export function speechText(text: string, lang: Lang): string {
	const ru = lang === "russian" || (lang !== "english" && /[а-яё]/i.test(text));
	let t = text.replace(EMOJI, " ");
	// Links: their name ("gaziyav.app" → "gaziyav точка app"), never "эйч ти ти пи эс".
	t = t.replace(URL, (_m, host: string) => host.replace(/\./g, ru ? " точка " : " dot "));
	if (ru) {
		// «$5» / «5 $» → «5 долларов»; «3,5 млн» → «3,5 миллиона»; «50%» → «50 процентов».
		t = t.replace(/([$€₽])\s?(\d+(?:[\s\u00a0]\d{3})*(?:[.,]\d+)?)/g, "$2 $1");
		for (const [unit, [one, few, many]] of RU_UNITS) {
			t = t.replace(new RegExp(`(\\d+(?:[\\s\\u00a0]\\d{3})*(?:[.,]\\d+)?)\\s?${unit.source}`, "g"), (_m, n: string) => `${n} ${ruForm(n, one, few, many)}`);
		}
		// A Russian decimal comma is read as a pause between two numbers ("3 – 5"): «3,5» → «3 целых 5 десятых».
		t = t.replace(/\b(\d+),(\d{1,2})\b/g, (_m, a: string, b: string) => {
			const part = b.length === 1 ? ruForm(b, "десятая", "десятых", "десятых") : ruForm(b, "сотая", "сотых", "сотых");
			return `${a} ${ruForm(a, "целая", "целых", "целых")} ${b} ${part}`;
		});
		t = t.replace(/&/g, " и ").replace(/№\s?/g, "номер ");
	} else {
		t = t.replace(/([$€£])\s?(\d[\d,]*(?:\.\d+)?)/g, "$2 $1");
		for (const [unit, word] of EN_UNITS) t = t.replace(new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s?${unit.source}`, "g"), `$1 ${word}`);
		t = t.replace(/&/g, " and ");
	}
	return t
		.replace(/[#*_~^|<>{}[\]\\]/g, " ")
		.replace(/\s+([,.!?;:…])/g, "$1")
		.replace(/\s{2,}/g, " ")
		.trim();
}
