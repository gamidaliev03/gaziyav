// AI → Text to speech: a voice-over from text on fal.ai (Qwen3-TTS by default, or MiniMax) — one job with progress and Cancel; the result is a
// plain file the editor imports into Media and places on the timeline. A ready voice speaks as it is; one of «My
// voices» is cloned once (then reused); a trending look is a ready voice plus its sound.
import path from "node:path";
import { provider } from "@/ai/provider";
import { modelFor } from "@/fal/server";
import { cloneVoice, speak, systemVoice } from "@/fal/voice";
import { StudioError } from "./errors";
import { newFile, workDir } from "./files";
import { type Job, startJob } from "./jobs";
import { probe } from "./media";
import { myVoice } from "./my-voices";
import { speechText } from "./speech-text";
import { applyTrendVoice } from "./voice-fx";
import { trendVoice } from "@/trending/voices";
import { isServiceVoice } from "./providers/voices";
import { familyOf, isMinimaxVoice, langByCode, MINIMAX_VOICE_LIST } from "@/fal/model-voices";
import { elevenVoiceName } from "@/fal/eleven-voices";
import { freeSpeechTakesOver } from "./free-speech";

/** A voice's name as a person reads it (MiniMax / ElevenLabs / a service card id), for the clip's name. */
const voiceLabel = (id: string): string => MINIMAX_VOICE_LIST.find((v) => v.id === id)?.name ?? elevenVoiceName(id) ?? (id.startsWith("svc:") ? "" : id.replace(/_/g, " "));

const clean = (text: unknown, max: number) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export const VOICE_CHARACTERS = ["ryan", "aiden", "eric", "dylan", "uncle_fu", "vivian", "serena", "ono_anna", "sohee"] as const;

/**
 * A voice-over from text: a ready voice, a trending voice (a ready voice + its sound) or one of «My voices»
 * (`local:<id>`, cloned on fal once).
 */
export function startGenerateVoice(body: { text?: string; speaker?: string; style?: string; lang?: string; trend?: string }) {
	const text = String(body.text ?? "").trim().slice(0, 5000);
	if (!text) throw new StudioError("Type what the voice should say.");
	const trend = trendVoice(body.trend);
	if (trend) body = { ...body, speaker: trend.speaker, style: trend.style };
	const mine = trend ? null : myVoice(body.speaker);
	if (!mine && String(body.speaker).startsWith("local:")) throw new StudioError("This voice is no longer on this computer — clone it again in My voices.");
	const ready = mine ? null : isServiceVoice(String(body.speaker)) ? String(body.speaker) : (systemVoice(String(body.speaker)) ?? systemVoice("ryan"));
	// The language picked beside the voice wins; «Auto» (or none) = the text's own (Cyrillic → Russian, else the model's auto)
	const picked = clean(body.lang, 20);
	const lang = picked && picked !== "auto" ? picked : /[а-яё]/i.test(text) ? "ru" : clean(body.lang, 20) === "auto" ? "" : "en";
	// The text as a person says it: no emoji or link mumble, «3,5 млн» and «50%» as words.
	const say = speechText(text, lang === "ru" ? "russian" : "english");
	// what the clip was made with, kept in its name and in the job's answer (the connector reads it)
	const modelTitle = isMinimaxVoice(String(body.speaker)) && familyOf(modelFor("tts").id) !== "minimax" ? "MiniMax Speech-02 HD" : modelFor("tts").title;
	const made = { model: modelTitle, voice: String(body.speaker ?? ""), language: lang || "auto" };
	return startJob("generate-voice", [{ id: "voice", title: `Voicing the text on ${provider(mine ? "fal" : modelFor("tts").api).label}`, timeout: 1800 }], async (job: Job) =>
		job.step("voice", async (signal) => {
			const work = workDir();
			try {
				// A trending look is treated after the speech (voice-fx writes WAV): the speech goes to a work file first.
				const out = newFile(trend ? "Voice-over.wav" : "Voice-over.m4a");
				const spoken = trend ? path.join(work.dir, "speech.wav") : out.path;
				let voiceId = ready as string;
				if (mine) {
					try {
						const c = await cloneVoice(mine.path, work.dir, { signal, onStatus: (t) => job.detail("voice", t) }, mine.text);
						job.charge(c.cost);
						voiceId = c.voiceId;
					} catch (error) {
						// no money / no key for the clone: the money-free voice speaks in the sample instead (speak below)
						if (signal.aborted || !freeSpeechTakesOver(error)) throw error;
						voiceId = "";
					}
				}
				const { cost, note } = await speak({ text: say, voiceId, cloned: !!mine, referenceText: mine?.text, language: lang, style: clean(body.style, 40) || undefined, out: spoken, ...(mine ? { sample: { path: mine.path, text: mine.text ?? "" } } : {}) }, { signal, onStatus: (t) => job.detail("voice", t), onProgress: (p) => job.progress("voice", p) });
				job.charge(cost);
				// the money-free voice spoke (the paid one was refused): its one line stays on the job
				if (note) job.detail("voice", note);
				if (trend) {
					job.detail("voice", trend.name);
					await applyTrendVoice(spoken, trend, out.path, signal);
				}
				const { duration } = await probe(out.path);
				const label = trend?.name ?? mine?.name ?? voiceLabel(String(body.speaker ?? ""));
				const name = `${[label, langByCode(lang)?.en, made.model].filter(Boolean).join(" · ").replace(/[\\/:*?"<>|]+/g, " ").trim()}${path.extname(out.path)}`;
				return { fileId: out.id, name: label ? name : out.name, duration, made };
			} finally {
				work.dispose();
			}
		}),
	);
}
