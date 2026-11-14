import { describe, expect, test } from "bun:test";
import { encodeWav, estimateWavBytes } from "../audio-wav";

const source = (channels: Float32Array[], sampleRate = 48_000) => ({
	numberOfChannels: channels.length,
	sampleRate,
	length: channels[0].length,
	getChannelData: (channel: number) => channels[channel],
});

/** The signed 24-bit little-endian sample at byte `at`. */
const int24 = (view: DataView, at: number) => {
	const v = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16);
	return v & 0x800000 ? v - 0x1000000 : v;
};

describe("encodeWav (24-bit, pro-heavy 09.11: it was 16-bit)", () => {
	test("writes a 24-bit PCM RIFF header with the right sizes", () => {
		const view = new DataView(encodeWav(source([new Float32Array(10), new Float32Array(10)])));
		const tag = (at: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(at + i)));
		expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
		expect(view.byteLength).toBe(44 + 10 * 2 * 3);
		expect(view.getUint32(4, true)).toBe(36 + 60);
		expect(view.getUint16(20, true)).toBe(1);
		expect(view.getUint16(22, true)).toBe(2);
		expect(view.getUint32(24, true)).toBe(48_000);
		expect(view.getUint32(28, true)).toBe(48_000 * 6);
		expect(view.getUint16(32, true)).toBe(6);
		expect(view.getUint16(34, true)).toBe(24);
		expect(view.getUint32(40, true)).toBe(60);
	});

	test("interleaves channels and clips past full scale", () => {
		const view = new DataView(encodeWav(source([Float32Array.from([1, -1, 2]), Float32Array.from([0.5, -0.5, -3])])));
		const samples = Array.from({ length: 6 }, (_, i) => int24(view, 44 + i * 3));
		expect(samples).toEqual([8388607, 4194304, -8388608, -4194304, 8388607, -8388608]);
	});

	test("a −110 dBFS tone survives (16 bits made it digital silence)", () => {
		const quiet = Float32Array.from({ length: 480 }, (_, i) => 3.16e-6 * Math.sin((2 * Math.PI * 1000 * i) / 48_000));
		const view = new DataView(encodeWav(source([quiet])));
		const peak = Math.max(...Array.from({ length: 480 }, (_, i) => Math.abs(int24(view, 44 + i * 3))));
		expect(peak).toBeGreaterThanOrEqual(25);
		expect(peak).toBeLessThanOrEqual(28);
	});

	test("size estimate matches 48 kHz stereo 24-bit", () => {
		expect(estimateWavBytes(10)).toBe(44 + 480_000 * 6);
		expect(estimateWavBytes(-1)).toBe(44);
	});
});
