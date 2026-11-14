// What a cloned voice is told about its sample. Qwen3-TTS copies the manner of speaking from the sample's transcript:
// an English transcript under a Russian text gave Russian with an English accent (05.11: Whisper heard Russian at
// p 0.90–0.96 with it, 0.9997 without, the same as MiniMax HD). Another language gets the voice (the timbre) only.

const WRITINGS: Array<[string, RegExp]> = [
	["cyrillic", /[Ѐ-ӿ]/g],
	["latin", /[a-zÀ-ɏ]/gi],
	["greek", /[Ͱ-Ͽ]/g],
	["arabic", /[؀-ۿ]/g],
	["hebrew", /[֐-׿]/g],
	["cjk", /[぀-ヿ一-鿿가-힯]/g],
	["thai", /[฀-๿]/g],
	["devanagari", /[ऀ-ॿ]/g],
];

/** The writing system most of a text's letters are in; null when it has none. */
export function writingOf(text: string): string | null {
	let best: string | null = null;
	let most = 0;
	for (const [name, letters] of WRITINGS) {
		const n = text.match(letters)?.length ?? 0;
		if (n > most) [best, most] = [name, n];
	}
	return best;
}

/** The sample's transcript for a clone that says `text`: only when both are written the same way, else nothing. */
export function referenceFor(text: string, reference: string | undefined): string | undefined {
	const ref = reference?.trim();
	if (!ref) return undefined;
	const own = writingOf(ref);
	return own && own === writingOf(text) ? ref.slice(0, 2000) : undefined;
}
