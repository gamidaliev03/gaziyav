// Voice on fal.ai. Qwen3-TTS (the default): a voice is cloned from a sample of the clip for a fraction of a cent (a
// speaker embedding), the app's ready voices are its own. MiniMax: its voices, or a clone at $1.50 each. A clone is
// made once per sample and kept in fal-voices.json (made again after six days: fal's files and MiniMax's unused
// clones don't last for ever).
import { chosen, keysReady } from "@/studio/server/providers/services";
import { isServiceVoice, speakService, stand_in } from "@/studio/server/providers/voices";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { StudioError } from "@/studio/server/errors";
import { probe } from "@/studio/server/media";
import { studioHome } from "@/studio/server/settings";
import { findTool, reason, run } from "@/studio/server/tools";
import { ELEVEN_DEFAULT, falModel, isElevenVoice, isQwenVoice, price } from "./models";
import { freeSpeech, freeSpeechTakesOver } from "@/studio/server/free-speech";
import { readyVoice } from "@/studio/server/ready-voices";
import { elevenVoiceName, isFalElevenVoice, READY_TO_ELEVEN } from "./eleven-voices";
import { familyOf, isMinimaxVoice, MINIMAX_DEFAULT, minimaxVoiceId } from "./model-voices";
import { BOOST, falReadyVoice, falSpeechRequest, READY_TO_MINIMAX, READY_TO_QWEN } from "./speech";
import { addSpend, chosenTts, liveUnitPrice, modelFor, type RunOptions, runFal, uploadFile } from "./server";
import { minimaxCloneInput, qwenCloneInput } from "./wire";
import { kieSpeechInput } from "../kie/catalog";
import { provider } from "@/ai/provider";

export const speaksLanguage = (code?: string) => !code || !!BOOST[code.toLowerCase()];

/** A ready voice as the chosen speech model names it (null when it isn't one). */
export function systemVoice(id: string | undefined, qwen = isQwenVoice(modelFor("tts").id)): string | null {
	if (!id) return null;
	// a voice of fal's ElevenLabs list keeps its card id: speak() runs it on fal's ElevenLabs model whatever is picked
	if (isFalElevenVoice(id) || isMinimaxVoice(id)) return id;
	// kie.ai's speech models take the app's own names (src/kie/catalog.ts turns them into its voices).
	if (modelFor("tts").api === "kie") return id;
	return falReadyVoice(id, qwen, isElevenVoice(modelFor("tts").id));
}

// ───────────────────────── clones ─────────────────────────

interface Clone {
	/** MiniMax: the voice id; Qwen: the speaker embedding's link. */
	voiceId: string;
	/** ms: when fal made it and when it last spoke (fal drops a clone unused for 7 days). */
	at: number;
	used: number;
}

const clonesFile = () => path.join(studioHome(), "fal-voices.json");

function readClones(): Record<string, Clone> {
	try {
		const j = JSON.parse(fs.readFileSync(clonesFile(), "utf8"));
		return j && typeof j === "object" ? j : {};
	} catch {
		return {};
	}
}

function writeClones(all: Record<string, Clone>) {
	fs.mkdirSync(studioHome(), { recursive: true });
	fs.writeFileSync(clonesFile(), JSON.stringify(all, null, 1), { mode: 0o600 });
}

const sampleHash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 32);

const cloneKey = (sample: string) => `${isQwenVoice(chosenTts().id) ? "qwen" : "minimax"}:${sampleHash(sample)}`;

/** Whether this sample already has a live clone (no clone fee for it). */
export function hasClone(sample: string): boolean {
	try {
		const c = readClones()[cloneKey(sample)];
		return !!c && Date.now() - c.used < 6 * 24 * 3600 * 1000;
	} catch {
		return false;
	}
}

/** A sample of at least 10 s (MiniMax's minimum): a shorter one is played twice in a row. */
async function longEnough(sample: string, dir: string, signal?: AbortSignal): Promise<string> {
	const { duration } = await probe(sample, signal);
	if (duration >= 10.2) return sample;
	if (duration < 3) throw new StudioError("The voice sample is too short to clone: take at least 10 s of the person speaking.");
	const out = path.join(dir, "sample-10s.m4a");
	const loops = Math.ceil(10.5 / duration);
	const r = await run(findTool("ffmpeg"), ["-y", "-v", "error", "-stream_loop", String(loops), "-i", sample, "-t", "11", "-ac", "1", "-c:a", "aac", "-b:a", "128k", out], { timeout: 120, signal });
	if (r.status !== 0) throw new StudioError(`Couldn't prepare the voice sample: ${reason(r)}`);
	return out;
}

/** The clone of a sample (made once, then reused). Returns its voice (id or embedding link) and what was paid now. */
export async function cloneVoice(sample: string, dir: string, o: RunOptions = {}, referenceText?: string): Promise<{ voiceId: string; cost: number }> {
	const key = cloneKey(sample);
	const all = readClones();
	const known = all[key];
	if (known && Date.now() - known.used < 6 * 24 * 3600 * 1000) return { voiceId: known.voiceId, cost: 0 };
	const model = modelFor("clone");
	o.onStatus?.("taking the voice from the sample");
	let voiceId: string;
	let cost: number;
	if (isQwenVoice(model.id)) {
		// Any length from 3 s: Qwen clones from what it hears.
		const url = await uploadFile(sample, o.signal);
		const r = await runFal<{ speaker_embedding?: { url?: string } }>(model.id, qwenCloneInput(url, referenceText), { expectSeconds: 10, ...o, resumeKey: key });
		if (!r.speaker_embedding?.url) throw new StudioError("fal.ai didn't return the cloned voice. Press Retry.");
		voiceId = r.speaker_embedding.url;
		cost = price(model, (await probe(sample, o.signal)).duration);
	} else {
		const file = await longEnough(sample, dir, o.signal);
		const url = await uploadFile(file, o.signal);
		const r = await runFal<{ custom_voice_id?: string }>(model.id, minimaxCloneInput(url), { expectSeconds: 25, ...o, resumeKey: key });
		if (!r.custom_voice_id) throw new StudioError("fal.ai didn't return the cloned voice. Press Retry.");
		voiceId = r.custom_voice_id;
		cost = price(model);
	}
	addSpend("clone", cost);
	all[key] = { voiceId, at: Date.now(), used: Date.now() };
	writeClones(all);
	return { voiceId, cost };
}

function touchClone(voiceId: string) {
	const all = readClones();
	for (const c of Object.values(all)) if (c.voiceId === voiceId) c.used = Date.now();
	writeClones(all);
}

// ───────────────────────── speech ─────────────────────────

export interface SpeakInput {
	text: string;
	/** A ready voice (as the model names it), a MiniMax clone id or a Qwen speaker embedding link. */
	voiceId: string;
	cloned?: boolean;
	/** What the clone's sample says (Qwen clones closer with it). */
	referenceText?: string;
	/** ISO code or a language name; else auto. */
	language?: string;
	/** ready-voices.ts styles: energetic / calm / serious / neutral (or free words for a ready voice). */
	style?: string;
	speed?: number;
	/** Where the speech goes: AAC in .m4a, or 16-bit WAV in .wav. */
	out: string;
	/** The voice's own recording and its words (a cloned voice's sample): the money-free voice speaks in it. */
	sample?: { path: string; text: string };
}

/** A ready voice's id from the name a speech model knows it by (Determined_Man, Ryan, Roger… → ryan). */
function readyIdOf(voiceId: string): string | null {
	for (const map of [READY_TO_MINIMAX, READY_TO_QWEN, READY_TO_ELEVEN]) for (const [id, name] of Object.entries(map)) if (name === voiceId) return id;
	return /^[a-z_]+$/.test(voiceId) ? voiceId : null;
}

/** Text → speech file. Returns its length and the price. */
export async function speak(s: SpeakInput, o: RunOptions = {}): Promise<{ seconds: number; cost: number; note?: string }> {
	// The money-free voice (studio/server/free-speech.ts: the on-device voice model, else the Mac's own) when the paid one is
	// refused for an empty balance or has no key: the job goes on, and its one line says so.
	const sample = s.sample ?? (() => {
		const id = readyIdOf(s.voiceId);
		const r = id ? readyVoice(id, s.style ?? "neutral") : null;
		return r ? { path: r.ref, text: r.text } : undefined;
	})();
	const free = async () => {
		const f = await freeSpeech({ text: s.text.trim().slice(0, 5000), language: s.language, out: s.out, signal: o.signal, sample });
		o.onStatus?.(f.line);
		return { seconds: f.seconds, cost: 0, note: f.line };
	};
	try {
		return await paidSpeak(s, o);
	} catch (error) {
		if (o.signal?.aborted || !freeSpeechTakesOver(error)) throw error;
		return free();
	}
}

async function paidSpeak(s: SpeakInput, o: RunOptions): Promise<{ seconds: number; cost: number }> {
	// Settings → Services: a service's voice speaks on its service (billed there, to its key); with another service chosen
	// for Voice-over, a Gaziyav voice speaks as that service's featured voice of the same sex. Not cloned voices.
	if (!s.cloned) {
		await keysReady();
		const pick = isServiceVoice(s.voiceId) ? s.voiceId : chosen("tts").provider ? await stand_in(chosen("tts").provider as string, /vivian|serena|anna|sohee/i.test(s.voiceId)) : null;
		if (pick) {
			const { seconds } = await speakService(pick, s.text.trim().slice(0, 5000), s.out, { signal: o.signal, onStatus: o.onStatus, language: s.language });
			return { seconds, cost: 0 };
		}
	}
	// A cloned voice is fal's (kie.ai has no clones): it speaks through fal's speech model whichever API is on.
	// A voice of fal's ElevenLabs list speaks on fal's ElevenLabs model (the one picked, else Multilingual v2) by its name.
	const eleven = !s.cloned && isFalElevenVoice(s.voiceId);
	const picked = s.cloned ? chosenTts() : modelFor("tts");
	// a MiniMax system voice speaks on MiniMax (the one picked, else Speech-02 HD) by its voice_id
	const mm = !s.cloned && isMinimaxVoice(s.voiceId);
	const model = eleven && !isElevenVoice(picked.id) ? (falModel(ELEVEN_DEFAULT) ?? picked) : mm && familyOf(picked.id) !== "minimax" ? (falModel(MINIMAX_DEFAULT) ?? picked) : picked;
	if (eleven) s = { ...s, voiceId: elevenVoiceName(s.voiceId) ?? s.voiceId };
	if (mm) s = { ...s, voiceId: minimaxVoiceId(s.voiceId) ?? s.voiceId };
	const text = s.text.trim().slice(0, 5000);
	if (!text) throw new StudioError("Type what the voice should say.");
	let url: string | undefined;
	const api = provider(model.api);
	// no key for the voice's API at all: the money-free voice speaks (speak() catches this line)
	if (!api.hasKey()) throw new StudioError("no key for the voice");
	o.onStatus?.(`voicing on ${api.label}`);
	let charged: number | undefined;
	if (model.api === "kie") {
		o.onStatus?.("voicing on kie.ai");
		const r = await api.run(model.id, kieSpeechInput({ text, voice: s.voiceId, speed: s.speed, language: /^[a-z]{2}$/i.test(s.language ?? "") ? s.language : undefined }), "audio", { expectSeconds: 5 + text.length / 60, ...o });
		url = r.audio?.url;
		charged = r.usd;
	} else {
		// fal's speech models: the request is fal/speech.ts's, the one the browser edition sends too
		const req = falSpeechRequest(model, { text, voiceId: s.voiceId, cloned: s.cloned, referenceText: s.referenceText, language: s.language, style: s.style, speed: s.speed });
		const r = await runFal<{ audio?: { url?: string } }>(req.endpoint, req.input, { expectSeconds: req.expectSeconds, ...o });
		url = r.audio?.url;
		if (s.cloned && !isQwenVoice(model.id)) touchClone(s.voiceId);
	}
	const raw = `${s.out}.download`;
	try {
		await api.save(url, raw, o.signal);
		// One format for every model (Qwen sends WAV, MiniMax MP3): AAC .m4a, or WAV for the voice effects.
		const wav = s.out.toLowerCase().endsWith(".wav");
		const r = await run(findTool("ffmpeg"), ["-y", "-v", "error", "-i", raw, "-ac", "1", ...(wav ? ["-ar", "48000", "-c:a", "pcm_s16le"] : ["-c:a", "aac", "-b:a", "160k"]), s.out], { timeout: 300, signal: o.signal });
		if (r.status !== 0) throw new StudioError(`Couldn't save the voice: ${reason(r)}`);
	} finally {
		fs.rmSync(raw, { force: true });
	}
	// The ledger holds the price the button showed: fal's live unit price when it is known (the page prices by it too).
	const billed = falModel(model.id) ?? model;
	const cost = charged ?? price(billed, text.length, model.api ? billed.usd : liveUnitPrice(billed));
	api.spend("tts", cost);
	return { seconds: (await probe(s.out, o.signal)).duration, cost };
}

/** What a voice-over will cost before it runs: the speech, plus a clone when the sample has none yet. */
export function voicePrice(chars: number, needsClone: boolean, cloned = needsClone): number {
	// A cloned voice speaks on fal's speech model whatever voice model is picked (kie.ai has no clones).
	const tts = cloned ? chosenTts() : modelFor("tts");
	return price(tts, chars, tts.api ? tts.usd : liveUnitPrice(tts)) + (needsClone ? price(modelFor("clone")) : 0);
}
