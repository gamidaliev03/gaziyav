// The speech request of fal's voice models as ONE pure function (no Node imports): the Mac app's server (fal/voice.ts
// speak) and the browser edition (web/voice) build the very same JSON from it — the language, the voice, the style.
import { type FalModel, isElevenVoice, isQwenVoice, MINIMAX_VOICES } from "./models";
import { elevenVoiceName, READY_TO_ELEVEN } from "./eleven-voices";
import { LANGS, minimaxVoiceId } from "./model-voices";
import { referenceFor } from "./reference";
import { elevenSpeechInput, minimaxSpeechInput, qwenSpeechInput } from "./wire";

/** ISO code → MiniMax's language_boost name. */
export const BOOST: Record<string, string> = {
	ru: "Russian", en: "English", de: "German", fr: "French", es: "Spanish", it: "Italian", pt: "Portuguese", ja: "Japanese", ko: "Korean", zh: "Chinese",
	tr: "Turkish", uk: "Ukrainian", ar: "Arabic", pl: "Polish", nl: "Dutch", hi: "Hindi", vi: "Vietnamese", id: "Indonesian", th: "Thai", cs: "Czech",
	ro: "Romanian", el: "Greek", fi: "Finnish", sv: "Swedish", da: "Danish", he: "Hebrew", hu: "Hungarian", bg: "Bulgarian",
	// The names local-tts used («russian», «english»…) map too.
	russian: "Russian", english: "English", german: "German", french: "French", spanish: "Spanish", italian: "Italian", portuguese: "Portuguese", japanese: "Japanese", korean: "Korean", chinese: "Chinese",
};

// every language MiniMax's language_boost takes, by its ISO code too (fal schema, read 21.11; model-voices.ts LANGS)
for (const l of LANGS) {
	BOOST[l.code] ??= l.boost;
	BOOST[l.boost.toLowerCase()] ??= l.boost;
}

/** The old ready voices (and the trending looks built on them) speak in the closest MiniMax voice. */
export const READY_TO_MINIMAX: Record<string, string> = {
	ryan: "Determined_Man",
	aiden: "Friendly_Person",
	eric: "Patient_Man",
	dylan: "Casual_Guy",
	uncle_fu: "Deep_Voice_Man",
	vivian: "Lively_Girl",
	serena: "Calm_Woman",
	ono_anna: "Exuberant_Girl",
	sohee: "Wise_Woman",
};

/** The ready voices of the app are Qwen3-TTS's own speakers (Resources/voices holds their recordings). */
export const READY_TO_QWEN: Record<string, string> = { ryan: "Ryan", aiden: "Aiden", eric: "Eric", dylan: "Dylan", uncle_fu: "Uncle_Fu", vivian: "Vivian", serena: "Serena", ono_anna: "Ono_Anna", sohee: "Sohee" };

/** Qwen's language names. */
export const QWEN_LANG: Record<string, string> = { Russian: "Russian", English: "English", Chinese: "Chinese", Spanish: "Spanish", French: "French", German: "German", Italian: "Italian", Japanese: "Japanese", Korean: "Korean", Portuguese: "Portuguese" };

export const EMOTION: Record<string, string> = { energetic: "happy", calm: "neutral", serious: "neutral", neutral: "neutral" };

/** A ready voice as a fal speech model names it (null when it isn't one). */
export function falReadyVoice(id: string | undefined, qwen: boolean, eleven = false): string | null {
	if (!id) return null;
	// ElevenLabs on fal: its own voices by name; the ready voices speak as the nearest of them
	if (eleven) return elevenVoiceName(id) ?? READY_TO_ELEVEN[id] ?? null;
	// a MiniMax system voice from its own list (`mm:<voice_id>`)
	const mm = minimaxVoiceId(id);
	if (mm) return qwen ? "Ryan" : mm;
	if (qwen) return READY_TO_QWEN[id] ?? (MINIMAX_VOICES.some((v) => v.id === id) ? "Ryan" : null);
	if (MINIMAX_VOICES.some((v) => v.id === id)) return id;
	return READY_TO_MINIMAX[id] ?? null;
}

export interface FalSpeech {
	text: string;
	/** A ready voice (as the model names it), a MiniMax clone id or a Qwen speaker embedding link. */
	voiceId: string;
	cloned?: boolean;
	/** What the clone's sample says (Qwen clones closer with it). */
	referenceText?: string;
	/** ISO code or a language name; else auto. */
	language?: string;
	style?: string;
	speed?: number;
}

/** The request one fal speech model (Qwen3-TTS or MiniMax) gets for a text, and how long it usually takes. */
export function falSpeechRequest(model: Pick<FalModel, "id">, s: FalSpeech): { endpoint: string; input: Record<string, unknown>; expectSeconds: number } {
	const text = s.text.trim().slice(0, 5000);
	const boost = BOOST[(s.language ?? "").toLowerCase()] ?? (/[а-яё]/i.test(text) ? "Russian" : "auto");
	if (isElevenVoice(model.id))
		return {
			endpoint: model.id,
			input: elevenSpeechInput({ endpoint: model.id, text, voice: s.voiceId, speed: s.speed, language: /^[a-z]{2}$/i.test(s.language ?? "") ? s.language : /[а-яё]/i.test(text) ? "ru" : undefined }),
			expectSeconds: 5 + text.length / 60,
		};
	if (isQwenVoice(model.id))
		return {
			endpoint: model.id,
			input: qwenSpeechInput({ text, language: QWEN_LANG[boost] ?? "Auto", voice: s.voiceId, cloned: s.cloned, reference: referenceFor(text, s.referenceText), style: s.style }),
			expectSeconds: 6 + text.length / 25,
		};
	return {
		endpoint: model.id,
		input: minimaxSpeechInput({ endpoint: model.id, text, voice: s.voiceId, speed: s.speed, emotion: s.style ? EMOTION[s.style] : undefined, boost }),
		expectSeconds: 5 + text.length / 60,
	};
}
