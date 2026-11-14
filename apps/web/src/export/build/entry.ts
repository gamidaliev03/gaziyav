// A kept stretch as bytes (render, 11.11): what the encoder made for it — its packets, in order — with what a muxer
// needs to use them again (the decoder's configuration) and what the stretch looked like (fingerprints of its first
// and last frame, build/fingerprint.ts). The same shape holds the encoded mix (kind "audio").
//
//   "GZXB1\n" · u32 head length · head (JSON) · u32 packet count · count × (u8 key, u32 bytes, f64 seconds, f64 length)
//   · the packets' bytes, one after another
//
// The server (export/server/build-cache.ts) adds a SHA-256 of all of it at the end when it stores an entry and checks
// it when it reads one: an entry cut short or damaged on disk is never handed out.
export const ENTRY_MAGIC = "GZXB1\n";
const PACKET_ROW = 1 + 4 + 8 + 8;

export interface EntryHead {
	v: 1;
	kind: "video" | "audio";
	key: string;
	/** WebCodecs codec string of the packets ("avc1.640028", "mp4a.40.2") */
	codec: string;
	/** the decoder configuration's description (avcC, AudioSpecificConfig), base64; "" when there is none */
	description: string;
	/** video: the frame size and how many frames */
	width?: number;
	height?: number;
	frames?: number;
	/** video: what the first and the last frame looked like (base64 of a small picture) */
	first?: string;
	last?: string;
	/** audio */
	sampleRate?: number;
	channels?: number;
	/** audio: samples the encoder puts before the sound (skipped by an edit list) */
	primingSamples?: number;
	/** audio: samples of the mix (its length) */
	samples?: number;
	/** when it was made (ms) */
	made: number;
}

export interface EntryPacket {
	key: boolean;
	data: Uint8Array;
	/** audio: where the packet starts and how long it is, seconds; video: 0 (frames are counted) */
	timestamp: number;
	duration: number;
}

export function toBase64(bytes: Uint8Array): string {
	let text = "";
	for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(text);
}

export function fromBase64(text: string): Uint8Array {
	const raw = atob(text);
	const bytes = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
	return bytes;
}

export function encodeEntry(head: EntryHead, packets: readonly EntryPacket[]): Uint8Array {
	const headBytes = new TextEncoder().encode(JSON.stringify(head));
	const payload = packets.reduce((sum, packet) => sum + packet.data.byteLength, 0);
	const out = new Uint8Array(ENTRY_MAGIC.length + 4 + headBytes.length + 4 + packets.length * PACKET_ROW + payload);
	const view = new DataView(out.buffer);
	let at = 0;
	for (let i = 0; i < ENTRY_MAGIC.length; i++) out[at++] = ENTRY_MAGIC.charCodeAt(i);
	view.setUint32(at, headBytes.length, true);
	at += 4;
	out.set(headBytes, at);
	at += headBytes.length;
	view.setUint32(at, packets.length, true);
	at += 4;
	for (const packet of packets) {
		view.setUint8(at, packet.key ? 1 : 0);
		view.setUint32(at + 1, packet.data.byteLength, true);
		view.setFloat64(at + 5, packet.timestamp, true);
		view.setFloat64(at + 13, packet.duration, true);
		at += PACKET_ROW;
	}
	for (const packet of packets) {
		out.set(packet.data, at);
		at += packet.data.byteLength;
	}
	return out;
}

/** The head alone (the first bytes of an entry are enough), or null when they are not an entry's. */
export function decodeHead(bytes: Uint8Array): { head: EntryHead; end: number } | null {
	if (bytes.length < ENTRY_MAGIC.length + 4) return null;
	for (let i = 0; i < ENTRY_MAGIC.length; i++) if (bytes[i] !== ENTRY_MAGIC.charCodeAt(i)) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const length = view.getUint32(ENTRY_MAGIC.length, true);
	const start = ENTRY_MAGIC.length + 4;
	if (length > 1_000_000 || bytes.length < start + length) return null;
	try {
		const head = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + length))) as EntryHead;
		if (head?.v !== 1 || (head.kind !== "video" && head.kind !== "audio") || typeof head.key !== "string") return null;
		return { head, end: start + length };
	} catch {
		return null;
	}
}

/** An entry's head and packets (views into `bytes`), or null when the bytes are not a whole entry. */
export function decodeEntry(bytes: Uint8Array): { head: EntryHead; packets: EntryPacket[] } | null {
	const start = decodeHead(bytes);
	if (!start) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let at = start.end;
	if (bytes.length < at + 4) return null;
	const count = view.getUint32(at, true);
	at += 4;
	if (bytes.length < at + count * PACKET_ROW) return null;
	const rows: Array<{ key: boolean; size: number; timestamp: number; duration: number }> = [];
	let payload = 0;
	for (let i = 0; i < count; i++) {
		const size = view.getUint32(at + 1, true);
		rows.push({ key: view.getUint8(at) === 1, size, timestamp: view.getFloat64(at + 5, true), duration: view.getFloat64(at + 13, true) });
		payload += size;
		at += PACKET_ROW;
	}
	if (bytes.length !== at + payload) return null;
	const packets: EntryPacket[] = [];
	for (const row of rows) {
		packets.push({ key: row.key, data: bytes.subarray(at, at + row.size), timestamp: row.timestamp, duration: row.duration });
		at += row.size;
	}
	return { head: start.head, packets };
}
