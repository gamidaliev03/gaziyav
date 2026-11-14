// "Voice only" dub: the new voice keeps the original's timing — it starts where the person starts talking and lasts
// as long as they talk (sped up or slowed down a little, pitch kept); the original speech is replaced (muted) or
// ducked under it. Pure seconds; editor-bridge turns it into timeline elements.

/** Where the original speech is on the timeline (seconds). */
export interface DubTiming {
	at: number;
	span: number;
}

/** The furthest the voice is sped up or slowed down to fit (beyond it the voice just runs longer or shorter). */
export const DUB_RATE = { min: 0.8, max: 1.25 } as const;
/** "Duck" instead of "replace": the original speech plays this much quieter (dB) under the new voice. */
export const DUB_DUCK_DB = -14;

export function dubPlacement({ clipAt, voiceSeconds, timing }: { clipAt: number; voiceSeconds: number; timing?: DubTiming | null }) {
	if (!timing || timing.span < 0.5 || voiceSeconds <= 0) return { start: clipAt, rate: 1, duration: voiceSeconds };
	const exact = voiceSeconds / timing.span;
	const rate = Math.abs(exact - 1) < 0.03 ? 1 : Math.min(DUB_RATE.max, Math.max(DUB_RATE.min, exact));
	return { start: timing.at, rate, duration: voiceSeconds / rate };
}

/** Word times of the new voice (seconds from its start) moved to where it plays at its rate. */
export const placeWords = <W extends { start: number; end: number }>(words: W[], rate: number): W[] =>
	rate === 1 ? words : words.map((w) => ({ ...w, start: w.start / rate, end: w.end / rate }));
