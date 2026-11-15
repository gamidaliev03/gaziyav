// A short voice sample played over again until it is long enough — what the Mac's ffmpeg does for MiniMax's clone,
// which takes at least 10 s (fal/voice.ts longEnough: `-stream_loop … -t 11`). The page's samples are PCM WAV
// (lipsync/media.ts voiceSample), so it is done on the bytes: the same «fmt » chunk, the sound repeated, cut at 11 s.
import { WebLipError } from "../lipsync/sentences";

function chunks(view: DataView): { fmt?: { at: number; size: number }; data?: { at: number; size: number } } {
	const tag = (at: number) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
	if (view.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return {};
	const out: ReturnType<typeof chunks> = {};
	for (let at = 12; at + 8 <= view.byteLength; ) {
		const id = tag(at);
		const size = Math.min(view.getUint32(at + 4, true), view.byteLength - at - 8);
		if (id === "fmt ") out.fmt = { at: at + 8, size };
		if (id === "data") out.data = { at: at + 8, size };
		at += 8 + size + (size % 2);
	}
	return out;
}

/** Seconds of sound in a PCM WAV (0 when it isn't one). */
export async function wavSeconds(blob: Blob): Promise<number> {
	const view = new DataView(await blob.arrayBuffer());
	const { fmt, data } = chunks(view);
	const rate = fmt && fmt.size >= 12 ? view.getUint32(fmt.at + 8, true) : 0;
	return rate > 0 && data ? data.size / rate : 0;
}

/** The sample as it is when it lasts `min` seconds or more, else repeated and cut at `target` seconds. */
export async function loopWav(blob: Blob, min = 10.2, target = 11): Promise<Blob> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const view = new DataView(bytes.buffer);
	const { fmt, data } = chunks(view);
	const rate = fmt && fmt.size >= 16 ? view.getUint32(fmt.at + 8, true) : 0;
	const align = fmt ? Math.max(1, view.getUint16(fmt.at + 12, true)) : 1;
	if (!fmt || !data || !(rate > 0)) throw new WebLipError("web.prepare", "not a WAV sample");
	const seconds = data.size / rate;
	if (seconds >= min) return blob;
	if (seconds < 3) throw new WebLipError("web.too_short");
	const want = Math.floor((target * rate) / align) * align;
	const sound = bytes.subarray(data.at, data.at + data.size);
	const out = new Uint8Array(44 - 16 + fmt.size + want);
	const w = new DataView(out.buffer);
	const put = (at: number, s: string) => [...s].forEach((c, i) => w.setUint8(at + i, c.charCodeAt(0)));
	put(0, "RIFF");
	w.setUint32(4, out.length - 8, true);
	put(8, "WAVE");
	put(12, "fmt ");
	w.setUint32(16, fmt.size, true);
	out.set(bytes.subarray(fmt.at, fmt.at + fmt.size), 20);
	const head = 20 + fmt.size;
	put(head, "data");
	w.setUint32(head + 4, want, true);
	for (let filled = 0; filled < want; filled += sound.length) out.set(sound.subarray(0, Math.min(sound.length, want - filled)), head + 8 + filled);
	return new Blob([out], { type: "audio/wav" });
}
