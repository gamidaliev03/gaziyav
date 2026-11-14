// «My voices»: voices cloned on this Mac from 10–30 s of someone's speech. Each keeps its sample and what the sample
// says (the voice model clones from both) in Application Support/Gaziyav/Voices — for good: the pipeline's working
// files are cleared after two days, and a voice cloned last week must still speak (a voice that lived there broke the
// next voice-over with "file not found").
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { supportDir } from "@/platform/paths";
import { StudioError } from "./errors";
import { getFile, workDir } from "./files";
import { type Job, startJob } from "./jobs";
import { hearSpeech } from "./voiceover";
import { voiceSample } from "./media";
import { findTool, reason, run } from "./tools";

export interface MyVoice {
	/** `local:<id>`: what voice pickers and voice-overs use. */
	id: string;
	name: string;
	/** Seconds since 2001-01-01, as the Swift app wrote them. */
	createdAt: number;
	/** What the sample says (the model clones the voice from the sample and these words). */
	text: string;
	/** The sample, a file in the Voices folder. */
	file: string;
	/** Seconds of speech in the sample. */
	seconds: number;
}

/** At least this much speech makes a voice that sounds like the person; the sample keeps up to 30 s. */
export const MIN_SAMPLE = 8;
export const MAX_SAMPLE = 30;
const APPLE_EPOCH = 978307200;

export const voicesDir = () => path.join(supportDir(), "Voices");
const indexFile = () => path.join(voicesDir(), "voices.json");

function readIndex(): MyVoice[] {
	try {
		const list = JSON.parse(fs.readFileSync(indexFile(), "utf8"));
		return Array.isArray(list) ? list.filter((v) => typeof v?.id === "string" && v.id.startsWith("local:") && typeof v.file === "string") : [];
	} catch {
		return [];
	}
}

function writeIndex(list: MyVoice[]) {
	fs.mkdirSync(voicesDir(), { recursive: true });
	const tmp = `${indexFile()}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
	fs.renameSync(tmp, indexFile());
}

/** «My voices» whose sample is on this Mac, newest first. */
export function loadVoices(): MyVoice[] {
	return readIndex()
		.filter((v) => fs.existsSync(path.join(voicesDir(), v.file)))
		.sort((a, b) => b.createdAt - a.createdAt);
}

/** What the page sees of «My voices» (no paths). */
export type SavedVoice = Pick<MyVoice, "id" | "name" | "createdAt" | "seconds">;
export const publicVoices = (): SavedVoice[] => loadVoices().map(({ id, name, createdAt, seconds }) => ({ id, name, createdAt, seconds }));

/** The sample and its words of one of «My voices» (`local:<id>`), or null. */
export function myVoice(id: string | undefined): { path: string; text: string; name: string } | null {
	const v = id ? readIndex().find((x) => x.id === id) : undefined;
	const file = v ? path.join(voicesDir(), v.file) : "";
	return v && v.text && fs.existsSync(file) ? { path: file, text: v.text, name: v.name } : null;
}

/**
 * A clip's voice, kept in «My voices» the first time it is cloned: a new clip of the same speaker then picks it there
 * instead of paying for another clone (MiniMax: $1.50 each). The same sample twice is one voice.
 */
export function keepClipVoice(sample: string, text: string, name: string, seconds: number): MyVoice {
	const hash = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
	const own = hash(sample);
	const known = readIndex().find((v) => {
		try {
			return hash(path.join(voicesDir(), v.file)) === own;
		} catch {
			return false;
		}
	});
	return known ?? saveVoice(sample, text, name, seconds);
}

/** Keeps a sample (any audio file) as one of «My voices». */
export function saveVoice(sample: string, text: string, name: string, seconds: number): MyVoice {
	const key = crypto.randomBytes(6).toString("hex");
	const file = `${key}.wav`;
	fs.mkdirSync(voicesDir(), { recursive: true });
	fs.copyFileSync(sample, path.join(voicesDir(), file));
	const voice: MyVoice = { id: `local:${key}`, name: name.trim().slice(0, 60) || "My voice", createdAt: Date.now() / 1000 - APPLE_EPOCH, text, file, seconds };
	writeIndex([voice, ...readIndex()]);
	return voice;
}

export function removeVoice(id: string) {
	const list = readIndex();
	const gone = list.find((v) => v.id === id);
	if (gone) fs.rmSync(path.join(voicesDir(), gone.file), { force: true });
	writeIndex(list.filter((v) => v.id !== id));
}

export function renameVoice(id: string, name: string) {
	writeIndex(readIndex().map((v) => (v.id === id ? { ...v, name: name.trim().slice(0, 60) || v.name } : v)));
}

/**
 * «Your voice»: up to 30 s of speech from a recording or a clip (from `start`), heard for its words and kept in «My
 * voices». Less than 8 s of speech is refused: the clone wouldn't sound like the person.
 */
export function startVoiceClone(body: { fileId?: string; start?: number; name?: string }) {
	const src = getFile(String(body.fileId ?? ""));
	const start = Math.max(0, Number(body.start) || 0);
	const name = String(body.name ?? "").trim() || src.name.replace(/\.[^.]+$/, "") || "My voice";
	return startJob(
		"voice-clone",
		[
			{ id: "sample", title: "Taking the voice sample", timeout: 300 },
			{ id: "words", title: "Hearing what it says", timeout: 600 },
		],
		async (job: Job) => {
			const work = workDir();
			try {
				const wav = await job.step("sample", async (signal) => {
					const m4a = path.join(work.dir, "sample.m4a");
					await voiceSample(src.path, start, MAX_SAMPLE, m4a, signal);
					const out = path.join(work.dir, "sample.wav");
					const r = await run(findTool("ffmpeg"), ["-y", "-v", "error", "-i", m4a, "-ac", "1", "-ar", "24000", out], { timeout: 120, signal });
					if (r.status !== 0) throw new StudioError(`Couldn't prepare the voice sample: ${reason(r)}`);
					return out;
				});
				const heard = await job.step("words", (signal) => hearSpeech(wav, work.dir, job, "words", signal));
				const words = heard.words.filter((w) => w.text.trim());
				const text = words.map((w) => w.text.trim()).join(" ").replace(/\s+([,.!?;:…])/g, "$1").trim();
				const seconds = words.length ? words[words.length - 1].end - words[0].start : 0;
				if (seconds < MIN_SAMPLE) {
					throw new StudioError(
						seconds < 1
							? "No speech found in this recording — use 10–30 s of one person talking."
							: `Only ${seconds.toFixed(0)} s of speech here — use 10–30 s of one person talking, so the voice sounds like them.`,
					);
				}
				const voice = saveVoice(wav, text, name, Math.min(MAX_SAMPLE, seconds));
				return { voice };
			} finally {
				work.dispose();
			}
		},
	);
}
