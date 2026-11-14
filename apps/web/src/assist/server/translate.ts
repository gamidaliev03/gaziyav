// Translate & dub: Gaziyav AI translates what the person says into the language to dub into, as words to
// speak — natural spoken language that takes about as long to say as the original (the dub replaces it).
import { cleanSpeech, DeepSeek } from "@/studio/server/deepseek";
import { StudioError } from "@/studio/server/errors";
import { loadSettings } from "@/studio/server/settings";
import { DUB_LANGUAGES } from "../languages";

const SYSTEM = `You are a professional dubbing translator for short videos (ads, Reels, TikTok, Shorts).
You get the transcript of what a person says on camera. Translate it into the target language so it can be voiced over the same video in the same voice.

Rules:
1. Spoken, natural language a native speaker would actually say; keep the meaning, tone, hook and call to action. Not word for word.
2. About the same speaking time as the original (the duration is given): shorten or merge phrases if the target language is longer. Never add content.
3. Write numbers, prices, percentages and symbols as words, the way they are said aloud.
4. Keep brand and product names as they are. Do not translate names of people.
5. The transcript comes from speech recognition and may have small mistakes: translate what was meant.
6. Only the words to say: no quotes, notes, timecodes, stage directions, emoji or explanations.

Answer with JSON only: {"text": "<the translation as one line>"}`;

export async function translateSpeech(
	body: { text?: string; language?: string; from?: string; seconds?: number },
	signal?: AbortSignal,
): Promise<{ text: string; language: string }> {
	const text = String(body.text ?? "").trim();
	if (!text) throw new StudioError("No speech found in the clip to translate.");
	if (text.length > 20000) throw new StudioError("The speech is too long to translate at once. Select a shorter clip or set In/Out.");
	const target = DUB_LANGUAGES.find((l) => l.code === body.language);
	if (!target) throw new StudioError("Pick the language to dub into.");
	const source = DUB_LANGUAGES.find((l) => l.code === body.from);
	const seconds = Math.max(1, Number(body.seconds) || 0);
	const s = loadSettings();
	const ds = new DeepSeek(s.deepseekKey, s.deepseekModel);
	const user = [
		`Target language: ${target.name}`,
		source ? `Spoken language: ${source.name}` : "",
		`Duration of the original speech: ${seconds.toFixed(1)} s (${text.length} characters)`,
		`Transcript: ${text}`,
	]
		.filter(Boolean)
		.join("\n");
	const answer = await ds.chat({ system: SYSTEM, user, json: true, temperature: 0.3, maxTokens: 3000, thinking: false, signal });
	const out = cleanSpeech(answer);
	if (!out) throw new StudioError("Gaziyav AI sent no usable translation. Press Translate again.");
	if (out.length > Math.max(text.length * 4, 400)) throw new StudioError("Gaziyav AI's translation was far longer than the speech. Press Translate again.");
	return { text: out, language: target.code };
}
