/**
 * The AAC encoder's priming told to the player. The encoder behind WebCodecs (AudioToolbox) puts 2112 samples of
 * warm-up before the first real sample; a player that is not told plays them as 44 ms of silence, so every export's
 * sound was 44 ms late — or, when the mix was fed 44 ms early to make up for it, the first 44 ms of the sound were
 * gone (check-export E7). The standard answer is an edit list («edts/elst») on the audio track that starts playback
 * that many samples into the media. mediabunny writes none, so it is added to the finished file here: the sound then
 * starts exactly where the picture does and nothing of the mix is lost.
 *
 * Two layouts of mediabunny's files: written to disk (fastStart «reserve») the «moov» sits between «ftyp» and a
 * «free» box that fills the reserved room — the edit list takes 36 bytes from that «free», nothing else moves; in
 * memory (fastStart «in-memory») the «moov» is followed by the «mdat» — the file grows by 36 bytes and every chunk
 * offset («stco» / «co64») is moved along.
 */

const te = new TextEncoder();
const type4 = (bytes: Uint8Array, at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
const u32 = (bytes: Uint8Array, at: number) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
const u64 = (bytes: Uint8Array, at: number) => u32(bytes, at) * 2 ** 32 + u32(bytes, at + 4);
const putU32 = (bytes: Uint8Array, at: number, value: number) => {
	bytes[at] = (value >>> 24) & 255;
	bytes[at + 1] = (value >>> 16) & 255;
	bytes[at + 2] = (value >>> 8) & 255;
	bytes[at + 3] = value & 255;
};
const putU64 = (bytes: Uint8Array, at: number, value: number) => {
	putU32(bytes, at, Math.floor(value / 2 ** 32));
	putU32(bytes, at + 4, value % 2 ** 32);
};

interface Box {
	type: string;
	/** Where the box starts (its size field). */
	start: number;
	/** Where its contents start (after the header). */
	body: number;
	end: number;
}

/** The boxes that sit side by side in [from, to) of `bytes`; stops at a box it cannot read. */
function boxesIn(bytes: Uint8Array, from: number, to: number): Box[] {
	const out: Box[] = [];
	for (let at = from; at + 8 <= to; ) {
		let size = u32(bytes, at);
		let header = 8;
		if (size === 1) {
			if (at + 16 > to) break;
			size = u64(bytes, at + 8);
			header = 16;
		} else if (size === 0) size = to - at;
		if (size < header || at + size > to) break;
		out.push({ type: type4(bytes, at + 4), start: at, body: at + header, end: at + size });
		at += size;
	}
	return out;
}

const child = (bytes: Uint8Array, box: Box, type: string) => boxesIn(bytes, box.body, box.end).find((b) => b.type === type);

/** A box with a version byte: its timescale and duration («mvhd», «mdhd»), and where the duration is written. */
function timed(bytes: Uint8Array, box: Box, idSlot: boolean): { timescale: number; duration: number; durationAt: number; wide: boolean } {
	const version = bytes[box.body];
	const times = version === 1 ? 8 : 4;
	// creation, modification, [track id + reserved], timescale | duration
	const after = box.body + 4 + times * 2 + (idSlot ? 8 : 0);
	if (idSlot) return { timescale: 0, duration: version === 1 ? u64(bytes, after) : u32(bytes, after), durationAt: after, wide: version === 1 };
	return { timescale: u32(bytes, after), duration: version === 1 ? u64(bytes, after + 4) : u32(bytes, after + 4), durationAt: after + 4, wide: version === 1 };
}

function elstBox(segmentDuration: number, mediaTime: number): Uint8Array {
	const wide = segmentDuration >= 2 ** 32 || mediaTime >= 2 ** 32;
	const entry = wide ? 20 : 12;
	const elst = 8 + 4 + 4 + entry;
	const out = new Uint8Array(8 + elst);
	putU32(out, 0, out.length);
	out.set(te.encode("edts"), 4);
	putU32(out, 8, elst);
	out.set(te.encode("elst"), 12);
	out[16] = wide ? 1 : 0; // version, then flags 0
	putU32(out, 20, 1); // one entry
	if (wide) {
		putU64(out, 24, segmentDuration);
		putU64(out, 32, mediaTime);
		putU32(out, 40, 0x00010000); // media rate 1.0
	} else {
		putU32(out, 24, segmentDuration);
		putU32(out, 28, mediaTime);
		putU32(out, 32, 0x00010000);
	}
	return out;
}

export interface PrimingEdit {
	/** The encoder's priming, in samples of the mix. */
	primingSamples: number;
	/** The mix's sample rate (the audio track's timescale is usually the same). */
	sampleRate: number;
	/**
	 * How many samples the sound really lasts (the picture's length): the edit ends there, not at the end of the
	 * encoder's last packet, which is padded to a whole 1024 samples (the sound ran 25–40 ms past the picture). Without
	 * it the edit shows everything after the priming.
	 */
	samples?: number;
}

interface MoovPatch {
	/** The moov with the edit list in its audio track (without any box after it). */
	moov: Uint8Array;
	/** How much longer it is. */
	grew: number;
}

/**
 * The «moov» at the start of `bytes` with an edit list added to its (first) audio track. Nothing to do — no audio
 * track, one that has an edit list already, a box this can't read — gives null.
 */
function patchMoov(bytes: Uint8Array, edit: PrimingEdit): MoovPatch | null {
	const [moov] = boxesIn(bytes, 0, bytes.length);
	if (!moov || moov.type !== "moov" || moov.body !== moov.start + 8) return null;
	const mvhd = child(bytes, moov, "mvhd");
	if (!mvhd) return null;
	const movieTimescale = timed(bytes, mvhd, false).timescale;
	for (const trak of boxesIn(bytes, moov.body, moov.end).filter((b) => b.type === "trak")) {
		const tkhd = child(bytes, trak, "tkhd");
		const mdia = child(bytes, trak, "mdia");
		const mdhd = mdia && child(bytes, mdia, "mdhd");
		const hdlr = mdia && child(bytes, mdia, "hdlr");
		if (!tkhd || !mdia || !mdhd || !hdlr || type4(bytes, hdlr.body + 8) !== "soun") continue;
		if (child(bytes, trak, "edts") || trak.body !== trak.start + 8) return null;
		const media = timed(bytes, mdhd, false);
		if (!(media.timescale > 0) || !(movieTimescale > 0)) return null;
		const mediaTime = Math.round((edit.primingSamples * media.timescale) / edit.sampleRate);
		const all = Math.max(0, media.duration - mediaTime);
		const shown = edit.samples && edit.samples > 0 ? Math.min(all, Math.round((edit.samples * media.timescale) / edit.sampleRate)) : all;
		const segment = Math.round((shown * movieTimescale) / media.timescale);
		const edts = elstBox(segment, mediaTime);
		const at = tkhd.end; // the edit list goes right after the track header
		const out = new Uint8Array(moov.end + edts.length);
		out.set(bytes.subarray(0, at), 0);
		out.set(edts, at);
		out.set(bytes.subarray(at, moov.end), at + edts.length);
		putU32(out, moov.start, moov.end - moov.start + edts.length);
		putU32(out, trak.start, trak.end - trak.start + edts.length);
		// the track lasts as long as its edit says
		const track = timed(out, { ...tkhd }, true);
		if (track.wide) putU64(out, track.durationAt, segment);
		else putU32(out, track.durationAt, segment);
		// …and the movie as long as its longest track says (a sound that now ends with the picture no longer makes the
		// file's duration longer than the picture)
		const [moov2] = boxesIn(out, 0, out.length);
		const mvhd2 = moov2 && child(out, moov2, "mvhd");
		if (moov2 && mvhd2) {
			let longest = 0;
			for (const t of boxesIn(out, moov2.body, moov2.end).filter((b) => b.type === "trak")) {
				const th = child(out, t, "tkhd");
				if (th) longest = Math.max(longest, timed(out, th, true).duration);
			}
			const movie = timed(out, mvhd2, false);
			if (longest > 0) {
				if (movie.wide) putU64(out, movie.durationAt, longest);
				else putU32(out, movie.durationAt, longest);
			}
		}
		return { moov: out, grew: edts.length };
	}
	return null;
}

/**
 * `region` starts with the «moov» and goes on with at least the header of the «free» box after it (the muxer's
 * last write is the «moov» and that header; the «free» box's body is zeros already on disk). The result is the
 * «moov» with the edit list in its audio track and the «free» header moved up and that much smaller: nothing after
 * the «free» box moves, and the bytes it covers are of no interest. Null when the «free» is too small (or anything
 * else stops the patch): the file is then left as it is.
 */
export function patchMoovRegion(region: Uint8Array, edit: PrimingEdit): Uint8Array | null {
	const patched = patchMoov(region, edit);
	if (!patched) return null;
	const moovEnd = patched.moov.length - patched.grew;
	if (region.length < moovEnd + 8 || type4(region, moovEnd + 4) !== "free") return null;
	const freeSize = u32(region, moovEnd);
	if (freeSize < patched.grew + 8) return null;
	const out = new Uint8Array(Math.max(region.length, patched.moov.length + 8));
	out.set(region, 0);
	out.set(patched.moov, 0);
	putU32(out, patched.moov.length, freeSize - patched.grew);
	out.set(te.encode("free"), patched.moov.length + 4);
	return out;
}

/**
 * A whole file («ftyp», «moov», «mdat» …) with the edit list added. When the «moov» comes before the «mdat» and no
 * «free» box can take the growth, every chunk offset moves by what was added. Null when nothing was changed.
 */
export function withAudioPrimingEdit(file: Uint8Array, edit: PrimingEdit): Uint8Array | null {
	const top = boxesIn(file, 0, file.length);
	const moov = top.find((b) => b.type === "moov");
	if (!moov) return null;
	const next = top[top.indexOf(moov) + 1];
	if (next?.type === "free") {
		const region = patchMoovRegion(file.subarray(moov.start, next.end), edit);
		if (region) {
			const out = file.slice();
			out.set(region, moov.start);
			return out;
		}
	}
	const patched = patchMoov(file.subarray(moov.start), edit);
	if (!patched) return null;
	const out = new Uint8Array(file.length + patched.grew);
	out.set(file.subarray(0, moov.start), 0);
	out.set(patched.moov, moov.start);
	out.set(file.subarray(moov.end), moov.end + patched.grew);
	const mdat = top.find((b) => b.type === "mdat");
	if (mdat && mdat.start > moov.start) shiftChunkOffsets(out, moov.start, patched.grew);
	return out;
}

/** Every «stco» / «co64» entry of every track moved by `by` (the media after the «moov» moved that much). */
function shiftChunkOffsets(bytes: Uint8Array, moovStart: number, by: number) {
	const [moov] = boxesIn(bytes, moovStart, bytes.length);
	if (!moov || moov.type !== "moov") return;
	for (const trak of boxesIn(bytes, moov.body, moov.end).filter((b) => b.type === "trak")) {
		const mdia = child(bytes, trak, "mdia");
		const minf = mdia && child(bytes, mdia, "minf");
		const stbl = minf && child(bytes, minf, "stbl");
		if (!stbl) continue;
		for (const table of boxesIn(bytes, stbl.body, stbl.end)) {
			if (table.type !== "stco" && table.type !== "co64") continue;
			const count = u32(bytes, table.body + 4);
			const wide = table.type === "co64";
			for (let i = 0; i < count; i++) {
				const at = table.body + 8 + i * (wide ? 8 : 4);
				if (wide) putU64(bytes, at, u64(bytes, at) + by);
				else putU32(bytes, at, u32(bytes, at) + by);
			}
		}
	}
}

/**
 * Patches the «moov» as the muxer writes it to a file (mediabunny's fastStart «reserve»: «ftyp», then the «moov» and
 * a «free» box over the reserved room, then the «mdat»). Hand it every write; it returns the bytes to write instead.
 */
export class PrimingEditWriter {
	private headSize: number | null = null;

	/** `edit` is asked when the index is written (the audio codec is known only after the output is set up). */
	constructor(private readonly edit: () => PrimingEdit | null) {}

	write(position: number, data: Uint8Array): Uint8Array {
		if (position === 0 && data.length >= 8 && type4(data, 4) === "ftyp") this.headSize = u32(data, 0);
		const head = this.headSize;
		if (head === null || position > head || position + data.length < head + 8) return data;
		const at = head - position;
		if (type4(data, at + 4) !== "moov") return data;
		const edit = this.edit();
		if (!edit) return data;
		const region = patchMoovRegion(data.subarray(at), edit);
		if (!region) return data;
		// (a few bytes longer when the write held only the «free» header: they land on the zeros of its body)
		const out = new Uint8Array(Math.max(data.length, at + region.length));
		out.set(data, 0);
		out.set(region, at);
		return out;
	}
}

/**
 * The sound of a finished file ends at `seconds` (exp, 14.11): ffmpeg's pass copies the master's AAC and writes its own
 * edit list, which shows every whole packet after the priming — up to a packet (21 ms) more or less than the picture.
 * The audio track's edit (its last entry) is made to end there, the track's and the movie's durations follow. Changed
 * in place (nothing grows or moves): `moov` is the whole «moov» box. False when there is nothing to change.
 */
export function endSoundAt(moov: Uint8Array, seconds: number): boolean {
	const [box] = boxesIn(moov, 0, moov.length);
	if (!box || box.type !== "moov" || !(seconds > 0)) return false;
	const mvhd = child(moov, box, "mvhd");
	if (!mvhd) return false;
	const movie = timed(moov, mvhd, false);
	if (!(movie.timescale > 0)) return false;
	let changed = false;
	for (const trak of boxesIn(moov, box.body, box.end).filter((b) => b.type === "trak")) {
		const mdia = child(moov, trak, "mdia");
		const hdlr = mdia && child(moov, mdia, "hdlr");
		if (!hdlr || type4(moov, hdlr.body + 8) !== "soun") continue;
		const edts = child(moov, trak, "edts");
		const elst = edts && child(moov, edts, "elst");
		const tkhd = child(moov, trak, "tkhd");
		if (!elst || !tkhd) continue;
		const wide = moov[elst.body] === 1;
		const count = u32(moov, elst.body + 4);
		if (count < 1) continue;
		const entry = elst.body + 8 + (count - 1) * (wide ? 20 : 12);
		if (entry + (wide ? 20 : 12) > elst.end) continue;
		// time before the last entry (an empty edit in front, if any) counts towards the end
		let before = 0;
		for (let i = 0; i < count - 1; i++) before += wide ? u64(moov, elst.body + 8 + i * 20) : u32(moov, elst.body + 8 + i * 12);
		const old = wide ? u64(moov, entry) : u32(moov, entry);
		const want = Math.max(0, Math.round(seconds * movie.timescale) - before);
		// never longer than what the track holds
		const segment = Math.min(old, want);
		if (segment === old) continue;
		if (wide) putU64(moov, entry, segment);
		else putU32(moov, entry, segment);
		const track = timed(moov, tkhd, true);
		if (track.wide) putU64(moov, track.durationAt, before + segment);
		else putU32(moov, track.durationAt, before + segment);
		changed = true;
	}
	if (!changed) return false;
	let longest = 0;
	for (const trak of boxesIn(moov, box.body, box.end).filter((b) => b.type === "trak")) {
		const tkhd = child(moov, trak, "tkhd");
		if (tkhd) longest = Math.max(longest, timed(moov, tkhd, true).duration);
	}
	if (longest > 0) {
		if (movie.wide) putU64(moov, movie.durationAt, longest);
		else putU32(moov, movie.durationAt, longest);
	}
	return true;
}

/** Where the top-level «moov» of a file is, from the box headers alone (`read(position, length)` gives bytes). */
export function findMoov(read: (position: number, length: number) => Uint8Array, size: number): { start: number; size: number } | null {
	for (let at = 0; at + 8 <= size; ) {
		const head = read(at, 16);
		if (head.length < 8) return null;
		let box = u32(head, 0);
		if (box === 1) {
			if (head.length < 16) return null;
			box = u64(head, 8);
		} else if (box === 0) box = size - at;
		if (box < 8) return null;
		if (type4(head, 4) === "moov") return { start: at, size: box };
		at += box;
	}
	return null;
}
