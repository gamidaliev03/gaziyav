// Review of stage 9, item 15: the two readers of a clip's sound (the whole-track decode for effects / pitch-kept speed and
// the mixdown's windowed reader) place the decoded chunks the same way, from the same zero: a source whose sound starts
// late keeps its silence in both (the whole decode used to pile the chunks up from sample 0, half a second early).
import { describe, expect, test } from "bun:test";
import { gatherChunks, trackBase } from "../audio-gather";

class FakeBuffer {
	readonly data: Float32Array[];
	constructor(
		readonly numberOfChannels: number,
		readonly length: number,
		readonly sampleRate: number,
	) {
		this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
	}
	getChannelData(c: number) {
		return this.data[c];
	}
	copyToChannel(src: Float32Array, c: number, offset: number) {
		this.data[c].set(src, offset);
	}
}
const context = { createBuffer: (ch: number, len: number, rate: number) => new FakeBuffer(ch, len, rate) } as unknown as BaseAudioContext;
const RATE = 10;
async function* chunks(list: Array<{ at: number; samples: number[] }>) {
	for (const c of list) {
		const b = new FakeBuffer(1, c.samples.length, RATE);
		b.getChannelData(0).set(c.samples);
		yield { buffer: b as unknown as AudioBuffer, timestamp: c.at };
	}
}
const read = (g: { buffer: AudioBuffer }, n: number) => Array.from((g.buffer as unknown as FakeBuffer).getChannelData(0).subarray(0, n));

describe("decoded chunks into one buffer", () => {
	test("a sound that starts at 0.5 s keeps its half second of silence (the whole-track decode, from 0)", async () => {
		const base = await trackBase(chunks([])); // nothing holds time 0
		expect(base).toBe(0);
		const g = await gatherChunks(chunks([{ at: 0.5, samples: [1, 1, 1, 1, 1] }, { at: 1, samples: [2, 2, 2, 2, 2] }]), { context, base, from: 0, to: 1.5, maxChannels: 2 });
		expect(g?.from).toBe(0);
		expect(g?.written).toBe(15);
		expect(read(g!, 15)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
	});
	test("a track with an AAC lead-in (the chunk that holds 0 starts at −0.021 s) lands at 0, as before", async () => {
		const base = await trackBase(chunks([{ at: -0.1, samples: [9, 9] }]));
		expect(base).toBe(-0.1);
		const g = await gatherChunks(chunks([{ at: -0.1, samples: [1, 1, 1] }, { at: 0.2, samples: [2, 2, 2] }]), { context, base, from: 0, to: 0.5, maxChannels: 2 });
		expect(g?.from).toBe(0);
		expect(read(g!, 6)).toEqual([1, 1, 1, 2, 2, 2]);
	});
	test("a window of the mixdown: a chunk that begins before `from` moves the start, one after it leaves silence", async () => {
		const early = await gatherChunks(chunks([{ at: 59.8, samples: [1, 1, 1, 1] }]), { context, base: 0, from: 60, to: 61, maxChannels: 2 });
		expect(early?.from).toBeCloseTo(59.8, 6);
		expect(read(early!, 4)).toEqual([1, 1, 1, 1]);
		const late = await gatherChunks(chunks([{ at: 60.3, samples: [1, 1] }]), { context, base: 0, from: 60, to: 61, maxChannels: 2 });
		expect(late?.from).toBe(60);
		expect(read(late!, 5)).toEqual([0, 0, 0, 1, 1]);
		expect(await gatherChunks(chunks([]), { context, base: 0, from: 0, to: 1, maxChannels: 2 })).toBeNull();
	});
	test("channels are capped and the buffer holds the span plus a second of room", async () => {
		async function* wide() {
			const b = new FakeBuffer(6, 3, RATE);
			yield { buffer: b as unknown as AudioBuffer, timestamp: 0 };
		}
		const g = await gatherChunks(wide(), { context, base: 0, from: 0, to: 2, maxChannels: 2 });
		expect(g?.buffer.numberOfChannels).toBe(2);
		expect(g?.buffer.length).toBe(30);
	});
});

describe("stereoChannel (pro-heavy 09.11: a 5.1 source lost its centre)", () => {
	const { stereoChannel } = require("../audio-gather") as typeof import("../audio-gather");
	const chunk = (channels: number[][]) => ({ numberOfChannels: channels.length, length: channels[0].length, getChannelData: (c: number) => Float32Array.from(channels[c]) });
	test("5.1: the centre (dialogue) is in both sides at −3 dB, the surrounds on their side, the LFE dropped", () => {
		const c = chunk([[0.1], [0.2], [1], [0.9], [0.3], [0.4]]);
		expect(stereoChannel(c, 0)[0]).toBeCloseTo(0.1 + Math.SQRT1_2 * (1 + 0.3), 5);
		expect(stereoChannel(c, 1)[0]).toBeCloseTo(0.2 + Math.SQRT1_2 * (1 + 0.4), 5);
	});
	test("a camera's 4 discrete channels: 1 and 2 at full level, as before", () => {
		const c = chunk([[1], [0], [0.5], [0.2]]);
		expect(stereoChannel(c, 0)[0]).toBeCloseTo(1, 5);
		expect(stereoChannel(c, 1)[0]).toBeCloseTo(0, 5);
	});
	test("mono plays on both sides, stereo and other layouts keep their first two channels", () => {
		expect(stereoChannel(chunk([[0.7]]), 1)[0]).toBeCloseTo(0.7, 5);
		expect(stereoChannel(chunk([[0.1], [0.2]]), 1)[0]).toBeCloseTo(0.2, 5);
		expect(stereoChannel(chunk([[0.1], [0.2], [0.3]]), 0)[0]).toBeCloseTo(0.1, 5);
	});
});

describe("stereoSources (the mixdown reads a 5.1 buffer from any decoder)", () => {
	const { stereoSources, stereoChannel } = require("../audio-gather") as typeof import("../audio-gather");
	const chunk = (channels: number[][]) => ({ numberOfChannels: channels.length, length: channels[0].length, getChannelData: (c: number) => Float32Array.from(channels[c]) });
	test("5.1: front, centre and surround of the side with their gains; the same sum as stereoChannel", () => {
		const c = chunk([[0.1], [0.2], [1], [0.9], [0.3], [0.4]]);
		const left = stereoSources(c, 0);
		expect(left.map(([, g]) => g)).toEqual([1, Math.SQRT1_2, Math.SQRT1_2]);
		expect(left.reduce((a, [d, g]) => a + g * d[0], 0)).toBeCloseTo(stereoChannel(c, 0)[0], 6);
	});
	test("stereo and mono: one channel at full gain", () => {
		expect(stereoSources(chunk([[0.1], [0.2]]), 1).length).toBe(1);
		expect(stereoSources(chunk([[0.7]]), 1)[0][0][0]).toBeCloseTo(0.7, 6);
	});
});
