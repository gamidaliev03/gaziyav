// A voice cloned on fal from a sample, kept in this browser like the Mac's fal-voices.json: made once per sample and
// voice family (Qwen: a speaker embedding's link, MiniMax: a voice id), made again after six days unused (fal drops
// what is not used for seven). Shared by AI → Voice (web/voice) and the lipsync's voice-over (web/lipsync).
import type { Park } from "../lipsync/park";

export type CloneFamily = "qwen" | "minimax";

interface KeptClone {
	voice: string;
	at: number;
	used: number;
}

const DAYS = 6;
const factOf = (family: CloneFamily, hash: string) => `clone:${family}:${hash}`;

/** The clone of this sample, while it lives (no clone fee for it); null when there is none. */
export async function knownClone(park: Park, family: CloneFamily, hash: string, now: number): Promise<string | null> {
	const c = await park.getFact<KeptClone>(factOf(family, hash)).catch(() => undefined);
	return c?.voice && now - c.used < DAYS * 86_400_000 ? c.voice : null;
}

export async function keepClone(park: Park, family: CloneFamily, hash: string, voice: string, now: number): Promise<void> {
	await park.putFact(factOf(family, hash), { voice, at: now, used: now } satisfies KeptClone);
}

/** A clone spoke now (MiniMax keeps an unused one for seven days). */
export async function touchClone(park: Park, family: CloneFamily, hash: string, now: number): Promise<void> {
	const c = await park.getFact<KeptClone>(factOf(family, hash)).catch(() => undefined);
	if (c) await park.putFact(factOf(family, hash), { ...c, used: now });
}
