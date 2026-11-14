// pro-heavy 09.11 (pro-reliable's soak): mediabunny's BlobSource kept idle `blob.stream()` readers open after dispose —
// each an open file in the app's main process. The editor's source reads with slice().arrayBuffer() only.
import { afterEach, describe, expect, test } from "bun:test";
import { ALL_FORMATS, AudioSampleSink, Input } from "mediabunny";
import { fileSource } from "../file-source";

/** A 48 kHz mono 16-bit WAV of a 440 Hz tone, `seconds` long. */
function wav(seconds = 2): Blob {
	const rate = 48000;
	const n = rate * seconds;
	const view = new DataView(new ArrayBuffer(44 + n * 2));
	const text = (at: number, s: string) => {
		for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
	};
	text(0, "RIFF");
	view.setUint32(4, 36 + n * 2, true);
	text(8, "WAVE");
	text(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, rate, true);
	view.setUint32(28, rate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	text(36, "data");
	view.setUint32(40, n * 2, true);
	for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), true);
	return new Blob([view.buffer], { type: "audio/wav" });
}

const realStream = Blob.prototype.stream;
const realArrayBuffer = Blob.prototype.arrayBuffer;
afterEach(() => {
	Blob.prototype.stream = realStream;
	Blob.prototype.arrayBuffer = realArrayBuffer;
});

describe("fileSource", () => {
	test("reads a file whole and right without ever opening a blob stream", async () => {
		let streams = 0;
		Blob.prototype.stream = function (this: Blob) {
			streams++;
			return realStream.call(this);
		};
		const input = new Input({ source: fileSource(wav()), formats: ALL_FORMATS });
		try {
			const track = await input.getPrimaryAudioTrack();
			expect(track).not.toBeNull();
			expect(await input.computeDuration()).toBeCloseTo(2, 3);
			let frames = 0;
			if (track) for await (const sample of new AudioSampleSink(track).samples()) {
				frames += sample.numberOfFrames;
				sample.close();
			}
			expect(frames).toBe(96000);
		} finally {
			input.dispose();
		}
		expect(streams).toBe(0);
	});

	test("a long sequential read goes in 1 MiB blocks (a few calls, not one per packet) and every sample is right", async () => {
		let calls = 0;
		Blob.prototype.arrayBuffer = function (this: Blob) {
			calls++;
			return realArrayBuffer.call(this);
		};
		const blob = wav(60); // 5.8 MB
		const input = new Input({ source: fileSource(blob), formats: ALL_FORMATS });
		let worst = 0;
		let frames = 0;
		try {
			const track = await input.getPrimaryAudioTrack();
			if (track) for await (const sample of new AudioSampleSink(track).samples()) {
				const data = new Float32Array(sample.numberOfFrames);
				sample.copyTo(data, { planeIndex: 0, format: "f32-planar" });
				for (let i = 0; i < data.length; i++) {
					const want = Math.round(8000 * Math.sin((2 * Math.PI * 440 * (frames + i)) / 48000)) / 32768;
					worst = Math.max(worst, Math.abs(data[i] - want));
				}
				frames += sample.numberOfFrames;
				sample.close();
			}
		} finally {
			input.dispose();
		}
		expect(frames).toBe(48000 * 60);
		expect(worst).toBeLessThan(1e-6);
		expect(calls).toBeLessThanOrEqual(12);
	});
});
