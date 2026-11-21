// The services' voices (Settings → Services → Voice-over) as cards of the voice picker, beside Gaziyav's own: read once
// from the app (/api/services/voices) and again when Settings changes a key. A card whose service has no key yet is
// listed under «<service> · needs a key»; voicing with it asks for the key in one line.
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { useLang } from "@/i18n";
import { type VoiceCard, readyCards, trendCards } from "./components/voice-picker";
import { ELEVEN_FAL_VOICES, ELEVEN_PREFIX, isFalElevenVoice } from "@/fal/eleven-voices";
import { ELEVEN_DEFAULT, isElevenVoice } from "@/fal/models";
import { familyOf, isMinimaxVoice, langByCode, MINIMAX_DEFAULT, MINIMAX_VOICE_LIST } from "@/fal/model-voices";
import { falChoice, useChoice, useFal, useKeys } from "@/fal/client";

type Voice = { id: string; name: string; service: string; serviceName: string; gender: "f" | "m" | ""; language: string; sample: string | null; ready: boolean };

const useVoices = create<{ voices: Voice[] | null; at: number }>(() => ({ voices: null, at: 0 }));

async function load() {
	if (useVoices.getState().at && Date.now() - useVoices.getState().at < 30_000) return;
	useVoices.setState({ at: Date.now() });
	try {
		const r = await fetch("/api/services/voices", { headers: { "X-Studio": "1" } });
		const j = (await r.json()) as { voices?: Voice[] };
		if (Array.isArray(j.voices)) useVoices.setState({ voices: j.voices });
	} catch {}
}

/** The services' voices as picker cards (none outside the app, or until they are read). */
export function useServiceCards(): VoiceCard[] {
	const voices = useVoices((s) => s.voices);
	const ru = useLang((s) => s.lang) === "ru";
	useEffect(() => {
		void load();
	}, []);
	return useMemo(() => (voices ?? []).map((v): VoiceCard => ({
		id: v.id,
		name: v.name,
		hint: [v.gender === "f" ? (ru ? "Женский" : "Woman") : v.gender === "m" ? (ru ? "Мужской" : "Man") : "", v.language].filter(Boolean).join(" · ") || undefined,
		sample: v.sample,
		groups: ["service"],
		service: { id: v.service, name: v.serviceName, ready: v.ready },
	})), [voices, ru]);
}

/** ElevenLabs' own voices through fal (fal's key): picking one switches the voice model to fal's ElevenLabs model. */
export function useFalElevenCards(): VoiceCard[] {
	const keys = useKeys();
	const ru = useLang((s) => s.lang) === "ru";
	const ready = keys === undefined ? true : keys.fal;
	return useMemo(
		() =>
			ELEVEN_FAL_VOICES.map((v): VoiceCard => ({
				id: `${ELEVEN_PREFIX}${v.name}`,
				name: v.name,
				hint: `${v.gender === "f" ? (ru ? "Женский" : "Woman") : v.gender === "m" ? (ru ? "Мужской" : "Man") : ru ? "Нейтральный" : "Neutral"} · ${v.accent}`,
				sample: v.catalog ? `/api/services/voice-sample?p=elevenlabs&v=${v.catalog}` : null,
				groups: ["service"],
				service: { id: "fal-eleven", name: "ElevenLabs · fal.ai", ready, key: "fal.ai" },
			})),
		[ready, ru],
	);
}

/** MiniMax's own system voices (fal-ai/minimax/speech-*), one group per language: picking one switches to MiniMax. */
export function useMinimaxCards(): VoiceCard[] {
	const keys = useKeys();
	const ru = useLang((s) => s.lang) === "ru";
	const ready = keys === undefined ? true : keys.fal;
	return useMemo(
		() =>
			MINIMAX_VOICE_LIST.map((v): VoiceCard => {
				const lang = langByCode(v.lang);
				return { id: v.id, name: v.name, hint: lang ? (ru ? lang.ru : lang.en) : undefined, sample: null, groups: ["service"], service: { id: `mm-${v.lang}`, name: `MiniMax · ${lang ? (ru ? lang.ru : lang.en) : v.lang}`, ready, key: "fal.ai" } };
			}),
		[ready, ru],
	);
}

/** The library every voice picker offers after the clip's and his own voices: the looks, the ready voices, every speech
 * model's own voices (MiniMax by language, ElevenLabs on fal), then each service's (its key's route). */
export function useLibraryCards(ui: "en" | "ru", sample: "en" | "ru" = ui): VoiceCard[] {
	const eleven = useFalElevenCards();
	const minimax = useMinimaxCards();
	const services = useServiceCards();
	return useMemo(() => [...trendCards(ui, sample), ...readyCards(), ...minimax, ...eleven, ...services], [ui, sample, minimax, eleven, services]);
}

/** The language a voice speaks (a MiniMax voice's own), for the language control beside the picker. */
export const voiceLanguage = (id: string): string | null => MINIMAX_VOICE_LIST.find((v) => v.id === id)?.lang ?? null;

/** A voice of another model switches the voice model to it (its name and price then show where the model does). */
export function followVoiceModel(id: string) {
	if (isFalElevenVoice(id) && !isElevenVoice(falChoice("tts").id)) void useFal.getState().choose("tts", ELEVEN_DEFAULT).catch(() => {});
	if (isMinimaxVoice(id) && familyOf(falChoice("tts").id) !== "minimax") void useFal.getState().choose("tts", MINIMAX_DEFAULT).catch(() => {});
}

/**
 * The picked voice still fits the voice model (a model offers its own voices): a voice of fal's ElevenLabs list under
 * another model goes back to the default voice when the model is changed away from ElevenLabs.
 */
export function useVoiceFitsModel(voice: string, reset: (id: string) => void) {
	const model = useChoice("tts").id;
	useEffect(() => {
		if ((isFalElevenVoice(voice) && !isElevenVoice(model)) || (isMinimaxVoice(voice) && familyOf(model) !== "minimax")) reset("ryan");
		// biome-ignore lint/correctness/useExhaustiveDependencies: only a change of the model re-checks
	}, [model]);
}
