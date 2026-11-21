// AI titles: DeepSeek writes the hook (first 2.5 s) and the CTA (last seconds) from the clip's speech.
// Server-only. Uses the lipsync pipeline's DeepSeek client and saved key (imports only).

export const TITLES_SYSTEM = `По расшифровке речи короткого видео (Reels, TikTok, Shorts) напиши два текста на экран.
- hook — заголовок первых 2 секунд, 3–7 слов: одна конкретная вещь из ролика — число, вопрос или результат. Никогда не
  приветствие, не имя автора и не «в этом видео»; обещай только то, что в ролике есть.
- cta — текст в конце, 2–5 слов, по сути ролика: в рекламе — конкретное действие (купить, перейти, записаться…); в
  остальных — вопрос к зрителю или что смотреть дальше. Не проси лайк, подписку, репост или подарок.
Пиши на языке речи. Без кавычек, эмодзи, хэштегов и точки в конце. Не выдумывай цены, скидки и факты, которых нет в речи.
Ответь только JSON: {"hook": "...", "cta": "..."}`;

export interface AiTitles {
	hook: string;
	cta: string;
}

const clean = (value: unknown, maxWords: number): string => {
	if (typeof value !== "string") return "";
	const text = value
		.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
		.replace(/#[\p{L}\p{N}_]+/gu, "")
		.replace(/^[\s«»"“”'„]+|[\s«»"“”'„.]+$/gu, "")
		.replace(/\s+/g, " ")
		.trim();
	const words = text.split(" ").filter(Boolean);
	return words.slice(0, maxWords).join(" ");
};

/** Parses DeepSeek's JSON answer; throws a readable error when it is unusable. */
export function parseAiTitles(answer: string): AiTitles {
	let data: Record<string, unknown>;
	try {
		const start = answer.indexOf("{");
		const end = answer.lastIndexOf("}");
		data = JSON.parse(answer.slice(start, end + 1));
	} catch {
		throw new Error("Gaziyav AI didn't manage this — nothing was changed.");
	}
	const titles = { hook: clean(data.hook, 9), cta: clean(data.cta, 6) };
	if (!titles.hook || !titles.cta) throw new Error("Gaziyav AI didn't manage this — nothing was changed.");
	return titles;
}

/** The speech, trimmed to what the model needs (start and end matter most). */
export function speechForPrompt(speech: string): string {
	const text = speech.replace(/\s+/g, " ").trim();
	if (text.length <= 3000) return text;
	return `${text.slice(0, 2000)} … ${text.slice(-900)}`;
}

export async function writeAiTitles({
	speech,
	signal,
}: {
	speech: string;
	signal?: AbortSignal;
}): Promise<AiTitles> {
	const { DeepSeek } = await import("@/studio/server/deepseek");
	const { loadSettings } = await import("@/studio/server/settings");
	const settings = loadSettings();
	const ds = new DeepSeek(settings.deepseekKey, settings.deepseekModel);
	const answer = await ds.chat({
		system: TITLES_SYSTEM,
		user: `Расшифровка речи ролика:\n${speechForPrompt(speech)}`,
		json: true,
		temperature: 0.9,
		maxTokens: 300,
		thinking: false,
		signal,
	});
	return parseAiTitles(answer);
}
