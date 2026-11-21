// Voice-over for the lipsync, the dub and Text to speech, on fal.ai (Qwen3-TTS by default, or MiniMax): the text in the
// clip's own voice (cloned from the selected clip once, then reused), in one of «My voices» or in a ready voice. The result's word
// timings come from the bundled Whisper (on this Mac).
import fs from "node:fs";
import path from "node:path";
import { recognize } from "@/transcribe/server/whisper";
import { provider } from "@/ai/provider";
import { modelFor } from "@/fal/server";
import { cloneVoice, speak, speaksLanguage, systemVoice } from "@/fal/voice";
import { StudioError } from "./errors";
import { getFile, newFile, workDir } from "./files";
import { type Job, startJob } from "./jobs";
import { probe, voiceSample } from "./media";
import type { Segment } from "./pipeline";
import { loadSettings } from "./settings";
import { applyTrendVoice } from "./voice-fx";
import { trendVoice } from "@/trending/voices";
import { isServiceVoice } from "./providers/voices";
import { freeSpeechTakesOver } from "./free-speech";
import { keepClipVoice, myVoice } from "./my-voices";
import { speechText } from "./speech-text";
import { findTool, reason, run } from "./tools";

async function toWav16k(input: string, dest: string, signal?: AbortSignal) {
	const r = await run(findTool("ffmpeg"), ["-y", "-v", "error", "-i", input, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", dest], { timeout: 300, signal });
	if (r.status !== 0) throw new StudioError(`Couldn't prepare the audio: ${reason(r)}`);
}

/** Whisper words of an audio file (any format). */
export async function hearSpeech(file: string, dir: string, job: Job, stage: string, signal: AbortSignal) {
	const wav = path.join(dir, `${path.basename(file)}.16k.wav`);
	await toWav16k(file, wav, signal);
	const { duration } = await probe(wav, signal);
	return recognize({ wav, outDir: dir, language: "auto", duration, signal, onProgress: (p) => job.progress(stage, p) });
}

/** A clip voice's name in «My voices»: the clip's file name without the extension. */
function clipVoiceName(fileId: string): string {
	try {
		return getFile(fileId).name.replace(/\.[^.]+$/, "").replace(/[_\s]+/g, " ").trim().slice(0, 60) || "Clip voice";
	} catch {
		return "Clip voice";
	}
}

/** The language speechText() expects («russian», «english»…) for an ISO code or the text itself. */
const LANG_NAMES: Record<string, string> = { ru: "russian", en: "english", de: "german", fr: "french", es: "spanish", it: "italian", pt: "portuguese", ja: "japanese", ko: "korean", zh: "chinese" };

export function startVoiceoverJob({ source, voiceId, text, language }: { source?: Segment; voiceId?: string; text: string; language?: string }) {
	if (language && !speaksLanguage(language)) throw new StudioError("The voice can't speak this language. Pick another language.");
	// One of «My voices» (its sample is kept for good), an older clip-sample voice (`local:<fileId>`), a trending look
	// (a ready voice + its sound) or a ready voice.
	const mine = myVoice(voiceId);
	const reuse = !mine && voiceId?.startsWith("local:") ? voiceId.slice(6) : null;
	const trend = voiceId?.startsWith("trend:") ? trendVoice(voiceId.slice(6)) : null;
	// (a service's voice, Settings → Services, speaks on its own key through speak())
	const ready = !mine && !reuse ? (isServiceVoice(voiceId) ? (voiceId as string) : systemVoice(trend ? trend.speaker : voiceId)) : null;
	if (!mine && !reuse && !ready && !source) throw new StudioError("Select the clip on the timeline to take the voice from");
	const settings = loadSettings();
	return startJob(
		"voiceover",
		[
			{ id: "sample", title: ready ? "Choosing the voice" : "Cloning the voice", timeout: 900 },
			// (a cloned voice is fal's whichever API is on)
			{ id: "speech", title: `Voicing on ${provider(ready ? modelFor("tts").api : "fal").label}`, timeout: 900 },
			{ id: "words", title: "Timing the words", timeout: 600 },
		],
		async (job) => {
			const work = workDir();
			try {
				// The voice: a ready one, or a clone of a sample (the clip's, or one of «My voices»).
				const voice = await job.step("sample", async (signal) => {
					if (ready) return { id: "", minimax: ready, cloned: false, refText: "" };
					let sample: { id: string; path: string };
					if (mine) sample = { id: "", path: mine.path };
					else if (reuse) {
						try {
							sample = { id: reuse, path: getFile(reuse).path };
						} catch {
							throw new StudioError("This voice's sample is no longer on this Mac — add the voice again in My voices, or clone it from the clip.");
						}
					} else {
						// Only the selected clip: in a podcast the next seconds are often the other speaker. A clip under
						// 10 s is repeated up to MiniMax's minimum (fal/voice.ts).
						const m4a = path.join(work.dir, "sample.m4a");
						const own = source!.length ?? settings.sampleLength;
						await voiceSample(getFile(source!.fileId).path, source!.start, Math.min(30, Math.max(3, own)), m4a, signal);
						const slot = newFile("Voice sample.m4a");
						fs.copyFileSync(m4a, slot.path);
						sample = { id: slot.id, path: slot.path };
					}
					// What the sample says: the voice is cloned closer with it (My voices keep theirs; a clip's is heard here).
					const refText = mine?.text ?? (await hearSpeech(sample.path, work.dir, job, "sample", signal).catch(() => null))?.words.map((w) => w.text).join(" ").trim() ?? "";
					const cloned = await cloneVoice(sample.path, work.dir, { signal, onStatus: (t) => job.detail("sample", t), onProgress: (p) => job.progress("sample", p) }, refText).catch((error) => {
						// no money / no key for the clone: the money-free voice speaks in the sample (speak, below)
						if (signal.aborted || !freeSpeechTakesOver(error)) throw error;
						return { voiceId: "", cost: 0 };
					});
					const { voiceId: minimax, cost } = cloned;
					if (cost) job.charge(cost);
					else job.detail("sample", "the voice was cloned before — no clone fee");
					// A clip's voice joins «My voices» on its first clone (paid once, picked there afterwards)
					const kept = !mine && !reuse && source ? keepClipVoice(sample.path, refText, clipVoiceName(source.fileId), (await probe(sample.path, signal)).duration) : null;
					return { id: sample.id, minimax, cloned: true, refText, kept: kept?.id, samplePath: sample.path };
				});
				const lang = language ?? (/[а-яё]/i.test(text) ? "ru" : "en");
				// The text as a person says it (no emoji or link mumble; «3,5 млн» as words).
				const say = speechText(text, LANG_NAMES[lang] ?? (lang === "ru" ? "russian" : "english"));
				// A trending look is treated after the speech (voice-fx writes WAV): the speech goes to a work file first.
				const out = newFile(trend ? "Voice.wav" : "Voice.m4a");
				const spoken = trend ? path.join(work.dir, "speech.wav") : out.path;
				await job.step("speech", async (signal) => {
					const { cost, note } = await speak(
						{ text: say, voiceId: voice.minimax, cloned: voice.cloned, referenceText: voice.refText, language: lang, style: trend?.style, speed: settings.speechSpeed, out: spoken, ...("samplePath" in voice && voice.samplePath ? { sample: { path: voice.samplePath, text: voice.refText } } : {}) },
						{ signal, onStatus: (t) => job.detail("speech", t), onProgress: (p) => job.progress("speech", p) },
					);
					job.charge(cost);
					if (note) job.detail("speech", note);
					if (trend) {
						job.detail("speech", trend.name);
						await applyTrendVoice(spoken, trend, out.path, signal);
					}
				});
				// Best effort: the voice is paid for by now, and a speech model that can't be fetched (offline, blocked) must not throw
				// it away. The words only time the subtitles; without them the clip's subtitles come from Whisper on the file later.
				const timed = await job.step("words", async (signal) =>
					hearSpeech(out.path, work.dir, job, "words", signal).catch((error) => {
						if (signal.aborted) throw error;
						return null;
					}),
				);
				const { duration } = await probe(out.path);
				const id = trend ? `trend:${trend.id}` : mine || ready ? String(voiceId) : (voice.kept ?? `local:${voice.id}`);
				return { voiceId: id, fileId: out.id, name: out.name, duration, words: timed?.words ?? [], text };
			} finally {
				work.dispose();
			}
		},
	);
}
