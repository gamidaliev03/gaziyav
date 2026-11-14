// The ready-made voices on a Mac: the voice model (the one that clones) speaking from a short recording of each voice in
// each style (Resources/voices, recorded once with Qwen3-TTS CustomVoice). One model and one download serve cloned and
// ready voices; the recordings sound as their voices (speaker similarity 0.987–0.991, as close as a voice to itself).
import fs from "node:fs";
import path from "node:path";

export const READY_STYLES = ["neutral", "energetic", "calm", "serious"] as const;
export type ReadyStyle = (typeof READY_STYLES)[number];

const dir = () => path.join(process.env.STUDIO_BIN_DIR || "", "..", "voices");

/** The style a free-text request asks for ("excited", "спокойно", "like a news anchor"…), else "neutral". */
export function styleOf(text: string): ReadyStyle {
	const t = text.toLowerCase();
	if (/excit|energ|happy|cheer|joy|fun|upbeat|hype|loud|радост|весел|весёл|энерг|бодр|восторг|громк|задор/.test(t)) return "energetic";
	if (/calm|soft|gentle|relax|quiet|whisper|slow|warm|tender|спокой|мягк|тих|шёпот|шепот|нежн|медлен|расслаб/.test(t)) return "calm";
	if (/serious|confident|news|formal|business|strong|deep|authorit|anchor|серьёз|серьез|уверен|строг|делов|новост|диктор/.test(t)) return "serious";
	return "neutral";
}

/** The recording and its words for a voice and a style (null when this build has no recordings). */
export function readyVoice(speaker: string, style: string): { ref: string; text: string } | null {
	try {
		const meta = JSON.parse(fs.readFileSync(path.join(dir(), "voices.json"), "utf8")) as { text: string; speakers: string[] };
		const who = meta.speakers.includes(speaker) ? speaker : meta.speakers[0];
		const ref = path.join(dir(), `${who}-${styleOf(style)}.m4a`);
		return fs.existsSync(ref) ? { ref, text: meta.text } : null;
	} catch {
		return null;
	}
}
