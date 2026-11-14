import { describe, expect, test } from "bun:test";
import { PrimingEditWriter, patchMoovRegion, withAudioPrimingEdit } from "../mp4-edit-list";

// A small MP4 skeleton the way mediabunny lays one out: ftyp, moov (mvhd, a video trak, an audio trak), then either a
// free box over the reserved room (a file written to disk) or the mdat straight away (a file made in memory).
const te = new TextEncoder();
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u16 = (n: number) => new Uint8Array([(n >>> 8) & 255, n & 255]);
const cat = (...parts: Uint8Array[]) => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
};
const box = (type: string, ...parts: Uint8Array[]) => {
	const body = cat(...parts);
	return cat(u32(8 + body.length), te.encode(type), body);
};
const full = (type: string, version: number, ...parts: Uint8Array[]) => box(type, new Uint8Array([version, 0, 0, 0]), ...parts);

const MOVIE_TS = 1000;
const mvhd = () => full("mvhd", 0, u32(0), u32(0), u32(MOVIE_TS), u32(12_000), new Uint8Array(80));
const tkhd = (id: number, duration: number) => full("tkhd", 0, u32(0), u32(0), u32(id), u32(0), u32(duration), new Uint8Array(60));
const mdhd = (timescale: number, duration: number) => full("mdhd", 0, u32(0), u32(0), u32(timescale), u32(duration), u16(0), u16(0));
const hdlr = (handler: string) => full("hdlr", 0, u32(0), te.encode(handler), new Uint8Array(12), new Uint8Array([0]));
const stco = (...offsets: number[]) => full("stco", 0, u32(offsets.length), ...offsets.map(u32));
const trak = (id: number, handler: string, timescale: number, mediaDuration: number, offsets: number[]) =>
	box("trak", tkhd(id, Math.round((mediaDuration * MOVIE_TS) / timescale)), box("mdia", mdhd(timescale, mediaDuration), hdlr(handler), box("minf", box("stbl", stco(...offsets)))));
const AUDIO_SAMPLES = 48000 * 12 + 2112 + 1024;
const moov = () => box("moov", mvhd(), trak(1, "vide", 15360, 12 * 15360, [200, 300]), trak(2, "soun", 48000, AUDIO_SAMPLES, [250, 350]));
const ftyp = () => box("ftyp", te.encode("isom"), u32(512), te.encode("isomiso2mp41"));
const free = (size: number) => cat(u32(size), te.encode("free"), new Uint8Array(size - 8));
const mdat = () => box("mdat", new Uint8Array(64));

const typeAt = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const readU32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
/** [type, start, end] of the boxes side by side in [from, to). */
const list = (b: Uint8Array, from: number, to: number) => {
	const out: Array<[string, number, number]> = [];
	for (let at = from; at + 8 <= to; ) {
		const size = readU32(b, at);
		out.push([typeAt(b, at + 4), at, at + size]);
		at += size;
	}
	return out;
};
const find = (b: Uint8Array, from: number, to: number, type: string, nth = 0) => list(b, from, to).filter((x) => x[0] === type)[nth];

/** The audio track's edit list of a file: [segment duration, media time] and the track header's duration. */
function audioEdit(file: Uint8Array) {
	const m = find(file, 0, file.length, "moov");
	const audio = find(file, m[1] + 8, m[2], "trak", 1);
	const kids = list(file, audio[1] + 8, audio[2]);
	const edts = kids.find((k) => k[0] === "edts");
	if (!edts) return null;
	const elst = find(file, edts[1] + 8, edts[2], "elst");
	const tk = kids.find((k) => k[0] === "tkhd") as [string, number, number];
	return { order: kids.map((k) => k[0]), segment: readU32(file, elst[1] + 16), mediaTime: readU32(file, elst[1] + 20), rate: readU32(file, elst[1] + 24), trackDuration: readU32(file, tk[1] + 28), moovSize: m[2] - m[1] };
}
const chunkOffsets = (file: Uint8Array, nth: number) => {
	const m = find(file, 0, file.length, "moov");
	const t = find(file, m[1] + 8, m[2], "trak", nth);
	const mdia = find(file, t[1] + 8, t[2], "mdia");
	const minf = find(file, mdia[1] + 8, mdia[2], "minf");
	const stbl = find(file, minf[1] + 8, minf[2], "stbl");
	const s = find(file, stbl[1] + 8, stbl[2], "stco");
	const n = readU32(file, s[1] + 12);
	return Array.from({ length: n }, (_, i) => readU32(file, s[1] + 16 + i * 4));
};

const EDIT = { primingSamples: 2112, sampleRate: 48000 };

describe("the AAC priming as an edit list on the audio track (check-export E7)", () => {
	test("a file written to disk: the edit list takes its room from the free box, nothing after it moves", () => {
		const head = cat(ftyp(), moov(), free(300));
		const file = cat(head, mdat());
		const out = withAudioPrimingEdit(file, EDIT);
		expect(out).not.toBeNull();
		expect(out?.length).toBe(file.length);
		const edit = audioEdit(out as Uint8Array);
		expect(edit?.order).toEqual(["tkhd", "edts", "mdia"]);
		expect(edit?.mediaTime).toBe(2112);
		expect(edit?.rate).toBe(0x00010000);
		// the track plays 2112 samples less than its media: (media − 2112) in the movie's timescale
		const shown = Math.round(((AUDIO_SAMPLES - 2112) * MOVIE_TS) / 48000);
		expect(edit?.segment).toBe(shown);
		expect(edit?.trackDuration).toBe(shown);
		expect(edit?.moovSize).toBe(moov().length + 36);
		// the free box shrank by what the moov grew, the mdat is where it was
		const top = list(out as Uint8Array, 0, out?.length as number).map((x) => x[0]);
		expect(top).toEqual(["ftyp", "moov", "free", "mdat"]);
		const fr = find(out as Uint8Array, 0, out?.length as number, "free");
		expect(fr[2] - fr[1]).toBe(300 - 36);
		expect(chunkOffsets(out as Uint8Array, 0)).toEqual([200, 300]);
		expect(chunkOffsets(out as Uint8Array, 1)).toEqual([250, 350]);
		// the video track is untouched
		const m = find(out as Uint8Array, 0, out?.length as number, "moov");
		const video = find(out as Uint8Array, m[1] + 8, m[2], "trak", 0);
		expect(list(out as Uint8Array, video[1] + 8, video[2]).map((k) => k[0])).toEqual(["tkhd", "mdia"]);
	});

	test("a file made in memory (moov before mdat, no free box): the file grows and every chunk offset moves along", () => {
		const file = cat(ftyp(), moov(), mdat());
		const out = withAudioPrimingEdit(file, EDIT);
		expect(out?.length).toBe(file.length + 36);
		expect(audioEdit(out as Uint8Array)?.mediaTime).toBe(2112);
		expect(chunkOffsets(out as Uint8Array, 0)).toEqual([236, 336]);
		expect(chunkOffsets(out as Uint8Array, 1)).toEqual([286, 386]);
		expect(list(out as Uint8Array, 0, out?.length as number).map((x) => x[0])).toEqual(["ftyp", "moov", "mdat"]);
	});

	test("a moov after the mdat: the offsets stay (the media did not move)", () => {
		const file = cat(ftyp(), mdat(), moov());
		const out = withAudioPrimingEdit(file, EDIT);
		expect(out?.length).toBe(file.length + 36);
		expect(chunkOffsets(out as Uint8Array, 1)).toEqual([250, 350]);
	});

	test("nothing to do: no audio track, or an edit list already there", () => {
		const silent = cat(ftyp(), box("moov", mvhd(), trak(1, "vide", 15360, 12 * 15360, [200])), mdat());
		expect(withAudioPrimingEdit(silent, EDIT)).toBeNull();
		const once = withAudioPrimingEdit(cat(ftyp(), moov(), free(300), mdat()), EDIT) as Uint8Array;
		expect(withAudioPrimingEdit(once, EDIT)).toBeNull();
	});

	test("a free box too small for the edit list leaves the region alone", () => {
		expect(patchMoovRegion(cat(moov(), free(40)), EDIT)).toBeNull();
		expect(patchMoovRegion(cat(moov(), free(44)), EDIT)).not.toBeNull();
	});

	test("the writer patches the moov wherever the muxer's write puts it: one write with the whole file, or the index on its own", () => {
		const head = cat(ftyp(), moov(), free(300));
		const whole = new PrimingEditWriter(() => EDIT);
		const one = whole.write(0, cat(head, mdat()));
		expect(audioEdit(one)?.mediaTime).toBe(2112);
		expect(one.length).toBe(head.length + mdat().length);
		// a long file: the ftyp and the media went out earlier; at the end the moov and the free come as one write
		const later = new PrimingEditWriter(() => EDIT);
		expect(later.write(0, cat(ftyp(), free(300 + moov().length), mdat())).length).toBe(head.length + mdat().length);
		const index = later.write(ftyp().length, cat(moov(), free(300)));
		expect(index.length).toBe(moov().length + 300);
		expect(typeAt(index, 4)).toBe("moov");
		expect(readU32(index, 0)).toBe(moov().length + 36);
		expect(readU32(index, moov().length + 36)).toBe(300 - 36);
		// what the muxer really writes last: the moov and only the 8-byte header of the free box (its body is zeros on
		// disk already) — the answer is 36 bytes longer, the moved header says the free box is 36 bytes smaller
		const real = new PrimingEditWriter(() => EDIT);
		real.write(0, cat(ftyp(), free(300 + moov().length), mdat()));
		const header = real.write(ftyp().length, cat(moov(), free(300).subarray(0, 8)));
		expect(header.length).toBe(moov().length + 36 + 8);
		expect(readU32(header, 0)).toBe(moov().length + 36);
		expect(typeAt(header, moov().length + 36 + 4)).toBe("free");
		expect(readU32(header, moov().length + 36)).toBe(300 - 36);
		expect(audioEdit(cat(ftyp(), header))?.mediaTime).toBe(2112);
		// no edit asked (WebM, a file without sound): bytes pass through untouched
		const off = new PrimingEditWriter(() => null);
		const same = cat(head, mdat());
		expect(off.write(0, same)).toBe(same);
	});
});
