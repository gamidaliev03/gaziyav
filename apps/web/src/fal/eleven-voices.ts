// ElevenLabs' own voices through fal.ai (fal-ai/elevenlabs/tts/*): fal takes a voice by its name, and the names it
// documents are ElevenLabs' premade voices (its schema's examples and default, read 21.11). These speak on the fal key the
// app already has; the rest of ElevenLabs' library needs an ElevenLabs key of its own. A picker card is `fal-el:<Name>`;
// its sample is the catalog's recording of the same voice (studio/server/providers/voices.json), when there is one.
// Shared by the page and the server (no Node imports here).

export interface ElevenVoice {
	name: string;
	gender: "f" | "m" | "n";
	accent: string;
	/** ElevenLabs' id of the same voice in the catalog (its sample), when the catalog has it. */
	catalog?: string;
}

export const ELEVEN_FAL_VOICES: ElevenVoice[] = [
	{ name: "Rachel", gender: "f", accent: "American" },
	{ name: "Aria", gender: "f", accent: "American", catalog: "TC0Zp7WVFzhA8zpTlRqV" },
	{ name: "Sarah", gender: "f", accent: "American", catalog: "EXAVITQu4vr4xnSDxMaL" },
	{ name: "Laura", gender: "f", accent: "American", catalog: "FGY2WhTYpPnrIDTdsKH5" },
	{ name: "Jessica", gender: "f", accent: "American", catalog: "cgSgspJ2msm6clMCkdW9" },
	{ name: "Matilda", gender: "f", accent: "American", catalog: "XrExE9yKIg1WjnnlVkGX" },
	{ name: "Alice", gender: "f", accent: "British", catalog: "Xb7hH8MSUJpSbSDYk0k2" },
	{ name: "Charlotte", gender: "f", accent: "Swedish" },
	{ name: "Lily", gender: "f", accent: "British", catalog: "pFZP5JQG7iQjIQuC4Bku" },
	{ name: "River", gender: "n", accent: "American", catalog: "SAz9YHcvj6GT2YYXdXww" },
	{ name: "Roger", gender: "m", accent: "American", catalog: "CwhRBWXzGAHq8TQ4Fs17" },
	{ name: "Charlie", gender: "m", accent: "Australian", catalog: "IKne3meq5aSn9XLyUdCD" },
	{ name: "George", gender: "m", accent: "British", catalog: "JBFqnCBsd6RMkjVDRZzb" },
	{ name: "Callum", gender: "m", accent: "American", catalog: "N2lVS1w4EtoT3dr4eOWO" },
	{ name: "Liam", gender: "m", accent: "American", catalog: "TX3LPaxmHKxFdv7VOQHJ" },
	{ name: "Will", gender: "m", accent: "American", catalog: "bIHbv24MWmeRgasZH58o" },
	{ name: "Eric", gender: "m", accent: "American", catalog: "cjVigY5qzO86Huf0OWal" },
	{ name: "Chris", gender: "m", accent: "American", catalog: "iP95p4xoKVk53GoZ742B" },
	{ name: "Brian", gender: "m", accent: "American", catalog: "nPczCjzI2devNBz1zQrb" },
	{ name: "Daniel", gender: "m", accent: "British", catalog: "onwK4e9ZLuTAKqWW03F9" },
	{ name: "Bill", gender: "m", accent: "American", catalog: "pqHfZKP75CvOlQylNhV4" },
];

export const ELEVEN_PREFIX = "fal-el:";
export const isFalElevenVoice = (id: string | undefined): boolean => !!id && id.startsWith(ELEVEN_PREFIX) && ELEVEN_FAL_VOICES.some((v) => v.name === id.slice(ELEVEN_PREFIX.length));

/** The voice's name as fal takes it, for a `fal-el:` card (null otherwise). */
export const elevenVoiceName = (id: string | undefined): string | null => (isFalElevenVoice(id) ? (id as string).slice(ELEVEN_PREFIX.length) : null);

/** The app's ready voices (and the trending looks built on them) speak as the nearest ElevenLabs voice on that model. */
export const READY_TO_ELEVEN: Record<string, string> = {
	ryan: "Roger",
	aiden: "Liam",
	eric: "Eric",
	dylan: "Callum",
	uncle_fu: "George",
	vivian: "Jessica",
	serena: "Sarah",
	ono_anna: "Lily",
	sohee: "Alice",
};

/** The catalog ids that speak through fal (the service list leaves them out: one voice, one place). */
export const ELEVEN_FAL_CATALOG = new Set(ELEVEN_FAL_VOICES.flatMap((v) => (v.catalog ? [v.catalog] : [])));
