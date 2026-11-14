// DeepSeek chat API (OpenAI-compatible): https://api-docs.deepseek.com — writes the words to speak.
import { activeAgent, agentReady, NOT_SET_UP } from "./agent-keys";
import { claudeComplete } from "./claude";
import { StudioError } from "./errors";
import { compatChat } from "./openai-compat";

export class DeepSeek {
	constructor(
		private apiKey: string,
		private model: string,
	) {
		if (!apiKey && !agentReady()) throw new StudioError(NOT_SET_UP);
	}

	/** V4.1 Flash is a reasoning model: thinking tokens count against max_tokens, so short tasks run with thinking off. */
	async chat({
		system,
		user,
		json,
		temperature = 0.8,
		maxTokens = 4000,
		thinking = true,
		signal,
	}: {
		system: string;
		user: string;
		json: boolean;
		temperature?: number;
		maxTokens?: number;
		thinking?: boolean;
		signal?: AbortSignal;
	}): Promise<string> {
		// Whichever AI the user chose writes these, with the same instructions.
		const a = activeAgent();
		if (!a) throw new StudioError(NOT_SET_UP);
		if (a.provider === "anthropic") return claudeComplete({ system, messages: [{ role: "user", content: user }], json, maxTokens, signal });
		const r = await compatChat(a.provider === "deepseek" ? { ...a, model: this.model || a.model } : a, {
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: user },
			],
			json,
			maxTokens,
			temperature,
			thinking,
			signal,
		});
		if (!r.content.trim()) {
			if (r.finish === "length") throw new StudioError("Gaziyav AI ran out of answer length. Try again: it usually works the second time.");
			throw new StudioError("Gaziyav AI returned an empty answer. Try again.");
		}
		return r.content;
	}
}

export const SCRIPT_SYSTEM = `Ты — сценарист коротких видео (Reels, TikTok, Shorts): обучающих, историй, обзоров, личных и рекламных. Ты пишешь ТОЛЬКО то, что человек в кадре скажет вслух своим голосом — это сразу уйдёт в синтез речи.

Как писать:
1. Первая фраза — хук на 1–2 секунды: боль, интрига, неожиданная цифра или прямое обращение. Никаких «Привет», «Сегодня расскажу», «Друзья».
2. Дальше — одна конкретная выгода или факт: цифра, срок, результат, деталь. Без воды, канцелярита и общих слов («качественно», «уникально», «лучший»).
3. Финал — короткий вывод или призыв к действию (подписаться, попробовать, купить), только если он уместен для темы.
4. Живая разговорная речь: короткие фразы, простые слова, ритм. Звучит как человек, а не как диктор.
5. Числа и символы пиши словами так, как их произносят: «пятьдесят процентов», «до двадцать третьего», «тысяча рублей».
6. Тема и детали — строго из задачи пользователя. Контекст видео нужен, чтобы попасть в тон и ситуацию, но не подменяй им задачу. Не выдумывай цены, проценты и сроки, которых нет в задаче.
7. Длина — строго как указано (±10%): речь ляжет на видеофрагмент такой длины.
8. Язык — язык задачи; по умолчанию русский.

Формат ответа — только JSON: {"text": "<текст речи одной строкой>"}. Внутри text — только произносимые слова: без кавычек, ремарок, таймкодов, эмодзи, хэштегов, пометок «Хук:», «CTA:» и пояснений.`;

/** Only the words to speak: strips quotes, labels, timecodes, stage directions and chatter the model may add. */
export function cleanSpeech(raw: string): string {
	let t = raw;
	try {
		const obj = JSON.parse(raw);
		if (typeof obj === "string") t = obj;
		else if (typeof obj?.text === "string") t = obj.text;
		else if (obj && typeof obj === "object") t = (Object.values(obj).find((v) => typeof v === "string") as string | undefined) ?? "";
	} catch {
		// A cut-off or broken JSON answer: take the text field if it is there, never the braces and keys.
		if (/^\s*[{[]/.test(raw)) {
			const m = /"text"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(raw);
			t = m ? m[1].replace(/\\n/g, " ").replace(/\\(["\\/])/g, "$1") : "";
		}
	}
	const patterns = [
		/\[[^\]]*\]/g,
		/\((пауза|смеётся|улыбается|[^)]{0,25}(пауза|голос|интонац)[^)]*)\)/gi,
		/\b\d{1,2}:\d{2}(\s*[-–—]\s*\d{1,2}:\d{2})?\b/g,
		/^\s*(хук|cta|призыв|текст|сценарий|вариант \d+|голос|диктор)\s*[:—-]\s*/gim,
		/[*_#`]/g,
	];
	for (const p of patterns) t = t.replace(p, " ");
	t = t.replace(/^(вот( ваш| готовый)? текст|конечно|понял|готово)[^:]*:\s*/i, "");
	t = t
		.split(/\n/)
		.map((l) => l.trim())
		.filter(Boolean)
		.join(" ")
		.replace(/\s{2,}/g, " ");
	return t.replace(/^["«»“” ]+|["«»“” ]+$/g, "").trim();
}

export type ScriptAction = { kind: "write"; idea: string } | { kind: "improve" } | { kind: "fit" };

export async function writeScript(
	ds: DeepSeek,
	{ action, current, seconds, context, signal }: { action: ScriptAction; current: string; seconds: number; context: string; signal?: AbortSignal },
): Promise<string> {
	const chars = Math.max(30, Math.round(seconds * 14));
	// The prompt is Russian; an English text came back Russian after «Shorten». Same language as the user's text.
	const length = `Длина: ${chars} символов (≈ ${Math.round(seconds)} с речи).${current.trim() ? " Пиши на том же языке, что и текст пользователя." : ""}`;
	let user: string;
	switch (action.kind) {
		case "write":
			user = `Задача: ${action.idea}\n${length}\nКонтекст видео: ${context}${current ? `\nЧерновик пользователя (можно опереться): ${current}` : ""}`;
			break;
		case "improve":
			user = `Сделай этот текст сильнее и живее, сохрани смысл.\n${length}\nКонтекст видео: ${context}\nТекст: ${current}`;
			break;
		case "fit":
			user = `Перепиши текст точно под длину, сохрани смысл и хук.\n${length}\nТекст: ${current}`;
			break;
	}
	const ask = (u: string, temperature: number) =>
		ds.chat({ system: SCRIPT_SYSTEM, user: u, json: true, temperature, maxTokens: 1500, thinking: false, signal });
	let text = cleanSpeech(await ask(user, 0.9));
	// One quick correction when the length is off by more than 15%.
	if (text.length < chars * 0.85 || text.length > chars * 1.15) {
		try {
			const fixed = cleanSpeech(
				await ask(
					`Сейчас в тексте ${text.length} символов, нужно ${chars} (±10%). Перепиши под эту длину на том же языке, сохрани смысл, хук и призыв.\nТекст: ${text}`,
					0.7,
				),
			);
			if (fixed && Math.abs(fixed.length - chars) < Math.abs(text.length - chars)) text = fixed;
		} catch {}
	}
	if (!text) throw new StudioError("Gaziyav AI sent no usable text. Press Retry.");
	// A runaway answer is not a script for a short clip.
	if (text.length > Math.max(chars * 4, 2000)) throw new StudioError("Gaziyav AI's answer was far longer than asked. Press Retry.");
	return text;
}
