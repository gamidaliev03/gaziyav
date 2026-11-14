import { describe, expect, test } from "bun:test";
import { getAudioBufferPeak, limitAudioBufferInPlace } from "../audio-mastering";

/** A bare AudioBuffer stand-in: channels of Float32 at a sample rate. */
function buffer(channels: Float32Array[], sampleRate = 48000): AudioBuffer {
	return { numberOfChannels: channels.length, length: channels[0].length, sampleRate, duration: channels[0].length / sampleRate, getChannelData: (c: number) => channels[c] } as unknown as AudioBuffer;
}

describe("the in-place limiter of a long mix (final-B D7)", () => {
	test("loud peaks come down under the headroom, quiet sound keeps its level, both channels the same gain", () => {
		const n = 48000;
		const left = new Float32Array(n);
		const right = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			const quiet = 0.3 * Math.sin(i / 7);
			left[i] = i > 20000 && i < 22000 ? 1.5 * Math.sin(i / 3) : quiet;
			right[i] = left[i] * 0.5;
		}
		const b = buffer([left, right]);
		limitAudioBufferInPlace({ audioBuffer: b });
		expect(getAudioBufferPeak({ audioBuffer: b })).toBeLessThanOrEqual(0.9801);
		// far from the loud part the level is the headroom gain only (0.98), on both channels alike
		expect(Math.abs(left[5000] / (0.3 * Math.sin(5000 / 7)) - 0.98)).toBeLessThan(0.02);
		expect(Math.abs(right[5000] / left[5000] - 0.5)).toBeLessThan(0.001);
		expect(Math.abs(left[40000] / (0.3 * Math.sin(40000 / 7)) - 0.98)).toBeLessThan(0.02);
	});
});
