// Voice on fal.ai. Qwen3-TTS (the default): a voice is cloned from a sample of the clip for a fraction of a cent (a
// speaker embedding), the app's ready voices are its own. MiniMax: its voices, or a clone at $1.50 each. A clone is
// made once per sample and kept in fal-voices.json (made again after six days: fal's files and MiniMax's unused
// clones don't last for ever).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { StudioError } from "@/studio/server/errors";
import { probe } from "@/studio/server/media";
import { studioHome } from "@/studio/server/settings";
import { findTool, reason, run } from "@/studio/server/tools";
import { falModel, isQwenVoice, MINIMAX_VOICES, price } from "./models";
import { referenceFor } from "./reference";
import { addSpend, chosenTts, liveUnitPrice, modelFor, type RunOptions, runFal, uploadFile } from "./server";
import { minimaxCloneInput, minimaxSpeechInput, qwenCloneInput, qwenSpeechInput } from "./wire";
import { kieSpeechInput } from "../kie/catalog";
import { provider } from "@/ai/provider";

/** ISO code → MiniMax's language_boost name. */
const BOOST: Record<string, string> = {
	ru: "Russian", en: "English", de: "German", fr: "French", es: "Spanish", it: "Italian", pt: "Portuguese", ja: "Japanese", ko: "Korean", zh: "Chinese",
	tr: "Turkish", uk: "Ukrainian", ar: "Arabic", pl: "Polish", nl: "Dutch", hi: "Hindi", vi: "Vietnamese", id: "Indonesian", th: "Thai", cs: "Czech",
	ro: "Romanian", el: "Greek", fi: "Finnish", sv: "Swedish", da: "Danish", he: "Hebrew", hu: "Hungarian", bg: "Bulgarian",
	// The names local-tts used («russian», «english»…) map too.
	russian: "Russian", english: "English", german: "German", french: "French", spanish: "Spanish", italian: "Italian", portuguese: "Portuguese", japanese: "Japanese", korean: "Korean", chinese: "Chinese",
};

export const speaksLanguage = (code?: string) => !code || !!BOOST[code.toLowerCase()];

/** The old ready voices (and the trending looks built on them) speak in the closest MiniMax voice. */
const READY_TO_MINIMAX: Record<string, string> = {
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
const READY_TO_QWEN: Record<string, string> = { ryan: "Ryan", aiden: "Aiden", eric: "Eric", dylan: "Dylan", uncle_fu: "Uncle_Fu", vivian: "Vivian", serena: "Serena", ono_anna: "Ono_Anna", sohee: "Sohee" };

/** A ready voice as the chosen speech model names it (null when it isn't one). */
export function systemVoice(id: string | undefined, qwen = isQwenVoice(modelFor("tts").id)): string | null {
	if (!id) return null;
	// kie.ai's speech models take the app's own names (src/kie/catalog.ts turns them into its voices).
	if (modelFor("tts").api === "kie") return id;
	if (qwen) return READY_TO_QWEN[id] ?? (MINIMAX_VOICES.some((v) => v.id === id) ? "Ryan" : null);
	if (MINIMAX_VOICES.some((v) => v.id === id)) return id;
	return READY_TO_MINIMAX[id] ?? null;
}

/** Qwen's language names. */
const QWEN_LANG: Record<string, string> = { Russian: "Russian", English: "English", Chinese: "Chinese", Spanish: "Spanish", French: "French", German: "German", Italian: "Italian", Japanese: "Japanese", Korean: "Korean", Portuguese: "Portuguese" };

const EMOTION: Record<string, string> = { energetic: "happy", calm: "neutral", serious: "neutral", neutral: "neutral" };

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
}

/** Text → speech file. Returns its length and the price. */
export async function speak(s: SpeakInput, o: RunOptions = {}): Promise<{ seconds: number; cost: number }> {
	// A cloned voice is fal's (kie.ai has no clones): it speaks through fal's speech model whichever API is on.
	const model = s.cloned ? chosenTts() : modelFor("tts");
	const text = s.text.trim().slice(0, 5000);
	if (!text) throw new StudioError("Type what the voice should say.");
	const boost = BOOST[(s.language ?? "").toLowerCase()] ?? (/[а-яё]/i.test(text) ? "Russian" : "auto");
	let url: string | undefined;
	const api = provider(model.api);
	o.onStatus?.(`voicing on ${api.label}`);
	let charged: number | undefined;
	if (model.api === "kie") {
		o.onStatus?.("voicing on kie.ai");
		const r = await api.run(model.id, kieSpeechInput({ text, voice: s.voiceId, speed: s.speed, language: /^[a-z]{2}$/i.test(s.language ?? "") ? s.language : undefined }), "audio", { expectSeconds: 5 + text.length / 60, ...o });
		url = r.audio?.url;
		charged = r.usd;
	} else if (isQwenVoice(model.id)) {
		const r = await runFal<{ audio?: { url?: string } }>(
			model.id,
			qwenSpeechInput({ text, language: QWEN_LANG[boost] ?? "Auto", voice: s.voiceId, cloned: s.cloned, reference: referenceFor(text, s.referenceText), style: s.style }),
			{ expectSeconds: 6 + text.length / 25, ...o },
		);
		url = r.audio?.url;
	} else {
		const r = await runFal<{ audio?: { url?: string } }>(
			model.id,
			minimaxSpeechInput({ endpoint: model.id, text, voice: s.voiceId, speed: s.speed, emotion: s.style ? EMOTION[s.style] : undefined, boost }),
			{ expectSeconds: 5 + text.length / 60, ...o },
		);
		url = r.audio?.url;
		if (s.cloned) touchClone(s.voiceId);
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
