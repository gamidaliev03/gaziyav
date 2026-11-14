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
	const ready = mine ? null : (systemVoice(String(body.speaker)) ?? systemVoice("ryan"));
	const lang = /[а-яё]/i.test(text) ? "ru" : clean(body.lang, 20) || "en";
	// The text as a person says it: no emoji or link mumble, «3,5 млн» and «50%» as words.
	const say = speechText(text, lang === "ru" ? "russian" : "english");
	return startJob("generate-voice", [{ id: "voice", title: `Voicing the text on ${provider(mine ? "fal" : modelFor("tts").api).label}`, timeout: 1800 }], async (job: Job) =>
		job.step("voice", async (signal) => {
			const work = workDir();
			try {
				// A trending look is treated after the speech (voice-fx writes WAV): the speech goes to a work file first.
				const out = newFile(trend ? "Voice-over.wav" : "Voice-over.m4a");
				const spoken = trend ? path.join(work.dir, "speech.wav") : out.path;
				let voiceId = ready as string;
				if (mine) {
					const c = await cloneVoice(mine.path, work.dir, { signal, onStatus: (t) => job.detail("voice", t) }, mine.text);
					job.charge(c.cost);
					voiceId = c.voiceId;
				}
				const { cost } = await speak({ text: say, voiceId, cloned: !!mine, referenceText: mine?.text, language: lang, style: clean(body.style, 40) || undefined, out: spoken }, { signal, onStatus: (t) => job.detail("voice", t), onProgress: (p) => job.progress("voice", p) });
				job.charge(cost);
				if (trend) {
					job.detail("voice", trend.name);
					await applyTrendVoice(spoken, trend, out.path, signal);
				}
				const { duration } = await probe(out.path);
				const name = trend?.name ?? mine?.name;
				return { fileId: out.id, name: name ? `${name.replace(/[\\/:*?"<>|]+/g, " ").trim()}${path.extname(out.path)}` : out.name, duration };
			} finally {
				work.dispose();
			}
		}),
	);
}
