// AI → Voice (text to speech) and «＋ Your voice» in the browser edition, on the visitor's own fal.ai key: what the
// Mac app's server does for jobs/generate-voice (studio/server/generate.ts) and jobs/voice-clone (studio/server/
// my-voices.ts) — the same stages, the same fal models and requests (fal/speech.ts, fal/wire.ts), the same prices
// (fal/models.ts) — run on the lipsync engine's jobs (one job list; every paid request parked before the page waits).
// The one thing the browser leaves to the app: the trending looks' sound treatment (ffmpeg filter chains).
import { chosenModel, cloneTts, type FalModel, type FalTask, isQwenVoice, price } from "@/fal/models";
import { falReadyVoice, falSpeechRequest } from "@/fal/speech";
import { minimaxCloneInput, qwenCloneInput } from "@/fal/wire";
import type { JobState } from "@/studio/server/jobs";
import { speechText } from "@/studio/server/speech-text";
import { trendVoice } from "@/trending/voices";
import { type Engine, runKeyOf } from "../lipsync/engine";
import type { Media } from "../lipsync/media";
import type { Park, ParkedJob } from "../lipsync/park";
import type { Provider } from "../lipsync/provider";
import { WebLipError } from "../lipsync/sentences";
import { keepClone, knownClone, touchClone } from "./clones";
import { MAX_SAMPLE, MIN_SAMPLE, publicVoice, type VoiceStore } from "./store";
import { loopWav, wavSeconds } from "./wav";

/** The page's one key is fal's: the picks of other APIs give way to fal's defaults (fal/models.ts chosenModel). */
const KEYS = { fal: true, kie: false, argo: false } as const;

/** Hears what a sample says (the browser edition's captions model, in the page: transcribe/in-page.ts). */
export type Hear = (sample: Blob, signal: AbortSignal, onProgress: (stage: string, progress?: number) => void) => Promise<{ words: Array<{ text: string; start: number; end: number }> }>;

export interface VoiceDeps {
	engine: Engine;
	provider: Provider;
	park: Park;
	media: Media;
	voices: VoiceStore;
	hasKey: () => boolean;
	/** The visitor's model picks (web/account): the voice model and, by its family, the clone. */
	choices: () => Partial<Record<FalTask, string>>;
	hear?: Hear;
	now?: () => number;
	uid?: () => string;
}

const clean = (text: unknown, max: number) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const extOf = (url: string, type: string) => (/\.mp3(\?|$)/i.test(url) || /mpeg|mp3/.test(type) ? ".mp3" : /\.(m4a|mp4|aac)(\?|$)/i.test(url) || /mp4|aac/.test(type) ? ".m4a" : ".wav");
const typeOf = (ext: string) => (ext === ".mp3" ? "audio/mpeg" : ext === ".m4a" ? "audio/mp4" : "audio/wav");

export function createVoice(d: VoiceDeps) {
	const now = d.now ?? (() => Date.now());
	const uid = d.uid ?? (() => crypto.randomUUID());
	const tts = (cloned: boolean): FalModel => (cloned ? cloneTts(d.choices()) : chosenModel("tts", d.choices(), KEYS));

	// ── jobs/generate-voice: a ready voice, or one of «My voices» cloned once, speaking the text ──
	d.engine.register("generate-voice", (rec, signal, t) =>
		t.step(rec, "voice", async () => {
			const s = rec.input as { text: string; say: string; lang: string; style?: string; ready?: string; mine?: string; model: string };
			const model = tts(!!s.mine);
			let voiceId = s.ready ?? "";
			let reference: string | undefined;
			let mine: Awaited<ReturnType<VoiceStore["sample"]>> = null;
			const family = isQwenVoice(model.id) ? ("qwen" as const) : ("minimax" as const);
			if (s.mine) {
				mine = await d.voices.sample(s.mine);
				if (!mine) throw new WebLipError("web.voice_gone");
				reference = mine.voice.text || undefined;
				const known = await knownClone(d.park, family, mine.voice.hash, now());
				if (known) voiceId = known;
				else {
					const clone = chosenModel("clone", d.choices(), KEYS);
					t.patchStage(rec, "voice", { detail: "taking the voice from the sample" });
					if (family === "qwen") {
						const answer = await t.follow<{ speaker_embedding?: { url?: string } }>(
							rec,
							"voice",
							signal,
							async () => d.provider.submit(clone.id, qwenCloneInput(await d.provider.upload(mine?.blob as Blob, `gz_voice_${uid().slice(0, 8)}.wav`, signal), reference), signal),
							10,
							"clone",
						);
						voiceId = answer.speaker_embedding?.url ?? "";
						if (voiceId) rec.state.cost += price(clone, (await wavSeconds(mine.blob)) || mine.voice.seconds);
					} else {
						// MiniMax takes at least 10 s: a shorter sample is played over again (fal/voice.ts longEnough)
						const answer = await t.follow<{ custom_voice_id?: string }>(
							rec,
							"voice",
							signal,
							async () => d.provider.submit(clone.id, minimaxCloneInput(await d.provider.upload(await loopWav(mine?.blob as Blob), `gz_voice_${uid().slice(0, 8)}.wav`, signal)), signal),
							25,
							"clone",
						);
						voiceId = answer.custom_voice_id ?? "";
						if (voiceId) rec.state.cost += price(clone);
					}
					if (!voiceId) throw new WebLipError("web.failed", "fal.ai didn't return the cloned voice");
					await keepClone(d.park, family, mine.voice.hash, voiceId, now());
				}
			}
			t.patchStage(rec, "voice", { detail: "voicing on fal.ai" });
			const req = falSpeechRequest(model, { text: s.say, voiceId, cloned: !!s.mine, referenceText: reference, language: s.lang, style: s.style });
			const answer = await t.follow<{ audio?: { url?: string } }>(rec, "voice", signal, () => d.provider.submit(req.endpoint, req.input, signal), req.expectSeconds, "speech");
			if (mine && family === "minimax") await touchClone(d.park, family, mine.voice.hash, now());
			const raw = await d.provider.download(answer.audio?.url, signal);
			const ext = extOf(String(answer.audio?.url ?? ""), raw.type);
			const blob = new Blob([raw], { type: typeOf(ext) });
			const named = mine?.voice.name;
			const name = named ? `${named.replace(/[\\/:*?"<>|]+/g, " ").trim()}${ext}` : `Voice-over${ext}`;
			const fileId = await t.keepResult(blob, name);
			rec.state.cost += price(model, s.say.trim().slice(0, 5000).length);
			return { fileId, name, duration: (await d.media.probe(blob)).duration };
		}),
	);

	// ── jobs/voice-clone: up to 30 s of a recording, heard for its words, kept in «My voices» (no fal call) ──
	d.engine.register("voice-clone", async (rec, signal, t) => {
		const s = rec.input as { fileId: string; start: number; name: string };
		const sample = await t.step(rec, "sample", async () => {
			const src = await t.getBlob(s.fileId);
			if (!src) throw new WebLipError("web.closed_before_send");
			const cut = await d.media.voiceSample(src.blob, s.start, MAX_SAMPLE);
			const id = await t.keepResult(cut.file, "sample.wav");
			return { id, seconds: cut.seconds };
		});
		const heard = await t.step(rec, "words", async () => {
			const file = await t.getBlob(sample.id);
			if (!file) throw new WebLipError("web.closed_before_send");
			try {
				if (!d.hear) throw new Error("no recogniser");
				const { words } = await d.hear(file.blob, signal, (stage, p) => t.patchStage(rec, "words", { detail: stage, ...(p != null ? { progress: p } : {}) }));
				const said = words.filter((w) => w.text.trim());
				const text = said.map((w) => w.text.trim()).join(" ").replace(/\s+([,.!?;:…])/g, "$1").trim();
				return { text, seconds: said.length ? said[said.length - 1].end - said[0].start : 0, heard: true };
			} catch (error) {
				if (signal.aborted || (error as Error)?.name === "AbortError") throw error;
				// this browser couldn't run the recogniser: the voice is kept from its sound alone (Qwen clones without words)
				t.patchStage(rec, "words", { detail: "the words weren't heard in this browser: the voice is taken from the sound" });
				return { text: "", seconds: sample.seconds, heard: false };
			}
		});
		if (heard.seconds < MIN_SAMPLE) {
			await d.park.deleteFile(sample.id).catch(() => {});
			throw new WebLipError(heard.heard && heard.seconds < 1 ? "web.no_speech" : "web.little_speech");
		}
		const file = await t.getBlob(sample.id);
		if (!file) throw new WebLipError("web.closed_before_send");
		const voice = await d.voices.save(file.blob, heard.text, s.name, Math.min(MAX_SAMPLE, heard.seconds));
		await d.park.deleteFile(sample.id).catch(() => {});
		return { voice: { ...publicVoice(voice), text: voice.text, file: voice.file } };
	});

	return {
		/** POST jobs/generate-voice {text, speaker, style, lang, trend} (studio/server/generate.ts startGenerateVoice). */
		async startGenerateVoice(body: { text?: string; speaker?: string; style?: string; lang?: string; trend?: string }): Promise<JobState> {
			const text = String(body.text ?? "").trim().slice(0, 5000);
			if (!text) throw new WebLipError("web.no_text");
			if (!d.hasKey()) throw new WebLipError("web.no_key");
			if (trendVoice(body.trend)) throw new WebLipError("web.trend_app_only");
			const speaker = String(body.speaker ?? "");
			const mine = speaker.startsWith("local:") ? await d.voices.sample(speaker) : null;
			if (speaker.startsWith("local:") && !mine) throw new WebLipError("web.voice_gone");
			const model = tts(!!mine);
			const qwen = isQwenVoice(model.id);
			const ready = mine ? undefined : (falReadyVoice(speaker, qwen) ?? (falReadyVoice("ryan", qwen) as string));
			const lang = /[а-яё]/i.test(text) ? "ru" : clean(body.lang, 20) || "en";
			// the text as a person says it: no emoji or link mumble, «3,5 млн» and «50%» as words
			const say = speechText(text, lang === "ru" ? "russian" : "english");
			const style = mine ? undefined : clean(body.style, 40) || undefined;
			const input: ParkedJob["input"] = { text, say, lang, model: model.id, ...(style ? { style } : {}), ...(mine ? { mine: speaker } : { ready }) };
			return d.engine.start("generate-voice", [{ id: "voice", title: "Voicing the text on fal.ai", timeout: 1800 }], await runKeyOf("generate-voice", model.id, speaker, say, style ?? "", lang), input);
		},

		/** POST jobs/voice-clone {fileId, start, name} (studio/server/my-voices.ts startVoiceClone). */
		async startVoiceClone(body: { fileId?: string; start?: number; name?: string }): Promise<JobState> {
			const fileId = String(body.fileId ?? "");
			const src = await d.engine.file(fileId);
			if (!src) throw new WebLipError("web.closed_before_send");
			const start = Math.max(0, Number(body.start) || 0);
			const name = String(body.name ?? "").trim() || src.name.replace(/\.[^.]+$/, "") || "My voice";
			return d.engine.start(
				"voice-clone",
				[
					{ id: "sample", title: "Taking the voice sample", timeout: 300 },
					{ id: "words", title: "Hearing what it says", timeout: 600 },
				],
				await runKeyOf("voice-clone", fileId, start, uid()),
				{ fileId, start, name },
			);
		},
	};
}

export type WebVoice = ReturnType<typeof createVoice>;
