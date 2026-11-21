// The services' voices (Settings → Services → Voice-over) as cards of the voice picker, beside Gaziyav's own: read once
// from the app (/api/services/voices) and again when Settings changes a key. A card whose service has no key yet is
// listed under «<service> · needs a key»; voicing with it asks for the key in one line.
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { useLang } from "@/i18n";
import type { VoiceCard } from "./components/voice-picker";

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
