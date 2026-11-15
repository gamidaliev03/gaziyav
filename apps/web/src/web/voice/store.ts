// «My voices» in the browser edition, as the Mac keeps them in Application Support/Gaziyav/Voices (studio/server/
// my-voices.ts): each voice's sample and what the sample says, for good, for every project — here in this browser's
// own database (park.ts: the sample a file, the list a fact). The page sees the same public fields as the Mac's.
import type { Park } from "../lipsync/park";

export interface WebVoice {
	/** `local:<id>`: what voice pickers and voice-overs use. */
	id: string;
	name: string;
	/** Seconds since 2001-01-01, as the Mac's list keeps them. */
	createdAt: number;
	/** What the sample says ("" when this browser couldn't hear it: the clone then works from the sound alone). */
	text: string;
	/** The sample's file name. */
	file: string;
	/** Seconds of speech in the sample. */
	seconds: number;
	/** The sample's hash: its clone on fal is made once (clones.ts). */
	hash: string;
}

/** What the page sees of «My voices» (studio/server/my-voices.ts SavedVoice). */
export type SavedVoice = Pick<WebVoice, "id" | "name" | "createdAt" | "seconds">;
export const publicVoice = ({ id, name, createdAt, seconds }: WebVoice): SavedVoice => ({ id, name, createdAt, seconds });

/** At least this much speech makes a voice that sounds like the person; the sample keeps up to 30 s (the Mac's rule). */
export const MIN_SAMPLE = 8;
export const MAX_SAMPLE = 30;
const APPLE_EPOCH = 978307200;
const LIST = "my-voices";
const blobId = (voice: Pick<WebVoice, "id">) => `voice-${voice.id.slice(6)}`;

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const hashOf = async (blob: Blob) => hex(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())).slice(0, 32);

export function voiceStore(park: Park, o: { now?: () => number; key?: () => string } = {}) {
	const now = o.now ?? (() => Date.now());
	const newKey = o.key ?? (() => hex(crypto.getRandomValues(new Uint8Array(6)).buffer as ArrayBuffer));
	const read = async (): Promise<WebVoice[]> => {
		const list = await park.getFact<WebVoice[]>(LIST).catch(() => undefined);
		return Array.isArray(list) ? list.filter((v) => typeof v?.id === "string" && v.id.startsWith("local:")) : [];
	};
	const write = (list: WebVoice[]) => park.putFact(LIST, list);
	return {
		/** «My voices», newest first. */
		async list(): Promise<WebVoice[]> {
			return (await read()).sort((a, b) => b.createdAt - a.createdAt);
		},
		/** One voice with its sample, or null (gone, or its sample is no longer in this browser). */
		async sample(id: string): Promise<{ voice: WebVoice; blob: Blob } | null> {
			const voice = (await read()).find((v) => v.id === id);
			const file = voice ? await park.getFile(blobId(voice)).catch(() => undefined) : undefined;
			return voice && file ? { voice, blob: file.blob } : null;
		},
		/** Keeps a sample as one of «My voices». */
		async save(blob: Blob, text: string, name: string, seconds: number): Promise<WebVoice> {
			const key = newKey();
			const voice: WebVoice = { id: `local:${key}`, name: name.trim().slice(0, 60) || "My voice", createdAt: now() / 1000 - APPLE_EPOCH, text, file: `${key}.wav`, seconds, hash: await hashOf(blob) };
			await park.putFile({ id: blobId(voice), name: voice.file, type: blob.type || "audio/wav", blob, at: now() });
			await write([voice, ...(await read())]);
			return voice;
		},
		async remove(id: string): Promise<void> {
			const list = await read();
			const gone = list.find((v) => v.id === id);
			if (gone) await park.deleteFile(blobId(gone)).catch(() => {});
			await write(list.filter((v) => v.id !== id));
		},
		async rename(id: string, name: string): Promise<void> {
			await write((await read()).map((v) => (v.id === id ? { ...v, name: name.trim().slice(0, 60) || v.name } : v)));
		},
	};
}

export type VoiceStore = ReturnType<typeof voiceStore>;
