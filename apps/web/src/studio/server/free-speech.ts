// The money-free voice-over (principle 1): when the paid voice can't run (the service's balance is empty, or it has
// no key), the SAME press goes on here and the job says once what spoke. This Mac first: the on-device voice model
// (local-tts.py, Qwen3-TTS on the Apple GPU — the clip's or the ready voice's own timbre, close to the paid one) when
// this build carries it and the model is installed; otherwise the Mac's system voice (`say`: Milena for Russian, the
// system's own voice for English — clear but robotic). Nothing is paid, nothing leaves the Mac.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ondevicePython, ondeviceUnavailable } from "@/ondevice/server";
import { modelDirs } from "@/platform/paths";
import { IS_MAC } from "@/platform/os";
import { CancelledError, StudioError } from "./errors";
import { probe } from "./media";
import { findTool, reason, run } from "./tools";

export interface FreeSpeechInput {
	text: string;
	/** ISO code (ru, en…) or the speech model's word (russian, english…). */
	language?: string;
	/** The file to write (.m4a → AAC, .wav → PCM, as the paid path writes). */
	out: string;
	signal?: AbortSignal;
	/** A recording of the voice to speak in (the clip's sample, one of «My voices», a ready voice's recording) and its words. */
	sample?: { path: string; text: string };
}

export interface FreeSpeech {
	seconds: number;
	/** Which route spoke: "local" (the on-device voice model) or "system" (the Mac's `say`). */
	by: "local" | "system";
	/** One line for the job and the chat. */
	line: string;
}

const ISO: Record<string, string> = { russian: "ru", english: "en", german: "de", french: "fr", spanish: "es", italian: "it", portuguese: "pt", japanese: "ja", korean: "ko", chinese: "zh" };
const WORD: Record<string, string> = Object.fromEntries(Object.entries(ISO).map(([w, c]) => [c, w]));
const iso = (l: string | undefined, text: string) => {
	const v = String(l ?? "").toLowerCase();
	if (/^[a-z]{2}$/.test(v)) return v;
	if (ISO[v]) return ISO[v];
	return /[а-яё]/i.test(text) ? "ru" : "en";
};

/** The voices `say` has for a language (locale prefix), the good ones first. */
async function systemVoice(lang: string, signal?: AbortSignal): Promise<string | null> {
	const r = await run("/usr/bin/say", ["-v", "?"], { timeout: 20, signal });
	if (r.status !== 0) return null;
	const voices = String(r.stdout ?? "")
		.split("\n")
		.map((line) => /^(.+?)\s{2,}([a-z]{2})[_-][A-Z]{2}\b/.exec(line))
		.filter((m): m is RegExpExecArray => !!m && m[2] === lang)
		.map((m) => m[1].trim());
	const prefer = lang === "ru" ? ["Milena", "Yuri", "Katya"] : lang === "en" ? ["Samantha", "Alex", "Daniel", "Karen"] : [];
	return prefer.find((p) => voices.includes(p)) ?? voices.find((v) => !/^(Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Wobble|Whisper|Zarvox|Trinoids|Jester|Organ|Superstar|Good News)\b/.test(v)) ?? null;
}

async function encode(input: string, out: string, signal?: AbortSignal) {
	const wav = out.toLowerCase().endsWith(".wav");
	const r = await run(findTool("ffmpeg"), ["-y", "-v", "error", "-i", input, "-ac", "1", ...(wav ? ["-ar", "48000", "-c:a", "pcm_s16le"] : ["-c:a", "aac", "-b:a", "160k"]), out], { timeout: 300, signal });
	if (r.status !== 0) throw new StudioError(`Couldn't save the voice: ${reason(r)}`);
}

/** Whether the on-device voice model can speak now (this build carries it and it is installed). */
export function localVoiceReady(): boolean {
	try {
		return !ondeviceUnavailable("voice") && fs.existsSync(path.join(process.env.STUDIO_BIN_DIR || "", "local-tts.py"));
	} catch {
		return false;
	}
}

/** The voice-over without money: the on-device voice model, else the Mac's own voice. */
export async function freeSpeech(s: FreeSpeechInput): Promise<FreeSpeech> {
	const text = s.text.trim().slice(0, 5000);
	if (!text) throw new StudioError("Type what the voice should say.");
	const lang = iso(s.language, text);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gz-free-voice-"));
	try {
		if (s.sample && localVoiceReady()) {
			const wav = path.join(dir, "voice.wav");
			const r = await run(ondevicePython("voice"), [path.join(process.env.STUDIO_BIN_DIR || "", "local-tts.py"), "--home", modelDirs.voice(), "--ref", s.sample.path, "--ref-text", s.sample.text || ".", "--lang", WORD[lang] ?? "english", "--text", text, "--out", wav], { heavy: true, timeout: 900, signal: s.signal });
			if (s.signal?.aborted) throw new CancelledError();
			if (r.status === 0 && fs.existsSync(wav) && fs.statSync(wav).size > 8000) {
				await encode(wav, s.out, s.signal);
				return { seconds: (await probe(s.out, s.signal)).duration, by: "local", line: "Voiced on this Mac for free (the voice model here): top up the service to get the paid voice back." };
			}
		}
		if (!IS_MAC) throw new StudioError("No free voice on this computer: top up the voice service, or pick another voice in Settings → Services.");
		const voice = await systemVoice(lang, s.signal);
		const aiff = path.join(dir, "voice.aiff");
		const said = await run("/usr/bin/say", [...(voice ? ["-v", voice] : []), "-o", aiff, text], { timeout: 300, signal: s.signal });
		if (s.signal?.aborted) throw new CancelledError();
		if (said.status !== 0 || !fs.existsSync(aiff)) throw new StudioError("The Mac's own voice didn't speak: top up the voice service, or pick another voice in Settings → Services.");
		await encode(aiff, s.out, s.signal);
		return { seconds: (await probe(s.out, s.signal)).duration, by: "system", line: `Voiced by the Mac's own voice${voice ? ` (${voice})` : ""} for free — it sounds simpler: top up the service to get the paid voice back.` };
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

/** Whether a paid voice's failure is one the free voice takes over: an empty balance or a missing / refused key. */
export const freeSpeechTakesOver = (error: unknown) => /balance|no money|top (it )?up|402|needs? (a|an) .{0,40}key|no key|didn't accept the key|not accept.*key|API key/i.test(String((error as Error)?.message ?? error));
