import { afterAll, describe, expect, test } from "bun:test";
import { QUALITY_HIGH, QUALITY_VERY_HIGH } from "mediabunny";
import { audioEncodingConfig, encoderDelaySamples, videoEncodingConfig } from "../encoder-config";
import { keepsAlpha, reportDecodeFailure } from "@/services/video-cache/decoder-config";

const globals = globalThis as unknown as { AudioEncoder?: unknown };
const original = globals.AudioEncoder;
afterAll(() => {
	globals.AudioEncoder = original;
});
const fakeAudioEncoder = (supported: boolean) => {
	globals.AudioEncoder = { isConfigSupported: async () => ({ supported }) };
};

describe("export encoder settings (moved from scene-exporter, same values)", () => {
	test("H.264 in MP4, VP9 in WebM, bitrate by quality", () => {
		expect(videoEncodingConfig({ format: "mp4", quality: "high" })).toEqual({ codec: "avc", bitrate: QUALITY_HIGH });
		// With the frame size the quality's rate is the platforms' recommended one (final-B D6: 6 Mbit/s was too light).
		expect(videoEncodingConfig({ format: "mp4", quality: "high", size: { width: 1920, height: 1080 }, fps: 30 })).toEqual({ codec: "avc", bitrate: 10_000_000 });
		expect(videoEncodingConfig({ format: "mp4", quality: "high", size: { width: 1080, height: 1920 }, fps: 60 })).toEqual({ codec: "avc", bitrate: 15_000_000 });
		expect(videoEncodingConfig({ format: "mp4", quality: "high", size: { width: 1920, height: 1080 }, bitrate: 4_000_000 })).toEqual({ codec: "avc", bitrate: 4_000_000 });
		expect(videoEncodingConfig({ format: "webm", quality: "very_high" })).toEqual({ codec: "vp9", bitrate: QUALITY_VERY_HIGH });
	});

	test("AAC 320k asked in MP4 (256k where the encoder refuses 320: mono), Opus when AAC is missing or in WebM", async () => {
		fakeAudioEncoder(true);
		expect(await audioEncodingConfig({ format: "mp4", quality: "high", sampleRate: 48000, numberOfChannels: 2 })).toEqual({
			codec: "aac",
			bitrate: 320000,
			bitrateMode: "constant",
		});
		expect((await audioEncodingConfig({ format: "mp4", quality: "very_high", sampleRate: 48000, numberOfChannels: 2 })).bitrate).toBe(320000);
		expect((await audioEncodingConfig({ format: "mp4", quality: "medium", sampleRate: 48000, numberOfChannels: 2 })).bitrate).toBe(256000);
		globals.AudioEncoder = { isConfigSupported: async (c: { bitrate: number }) => ({ supported: c.bitrate <= 256000 }) };
		expect((await audioEncodingConfig({ format: "mp4", quality: "high", sampleRate: 48000, numberOfChannels: 1 })).bitrate).toBe(256000);
		fakeAudioEncoder(false);
		expect((await audioEncodingConfig({ format: "mp4", quality: "high", sampleRate: 44100, numberOfChannels: 1 })).codec).toBe("opus");
		expect((await audioEncodingConfig({ format: "webm", quality: "high", sampleRate: 48000, numberOfChannels: 2 })).codec).toBe("opus");
	});

	test("AAC priming is skipped, Opus has none", () => {
		expect(encoderDelaySamples("aac")).toBe(2112);
		expect(encoderDelaySamples("opus")).toBe(0);
	});
});

describe("decoder settings", () => {
	test("HEVC and transparent streams keep alpha, others don't", () => {
		expect(keepsAlpha({ codec: "hevc", canBeTransparent: false })).toBe(true);
		expect(keepsAlpha({ codec: "vp9", canBeTransparent: true })).toBe(true);
		expect(keepsAlpha({ codec: "avc", canBeTransparent: false })).toBe(false);
	});

	test("a decode failure report never throws", () => {
		const warn = console.warn;
		const error = console.error;
		console.warn = () => {};
		console.error = () => {};
		try {
			expect(() => reportDecodeFailure({ mediaId: "m", time: 1.5, stage: "decode", error: new Error("x") })).not.toThrow();
			expect(() => reportDecodeFailure({ mediaId: "m", stage: "open", error: "x" })).not.toThrow();
		} finally {
			console.warn = warn;
			console.error = error;
		}
	});
});
