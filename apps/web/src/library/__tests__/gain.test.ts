import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import { CEILING_DBTP, gainFactor, gainFor, MAX_GAIN_DB, TARGET_LUFS } from "@/library/gain";
import gains from "@/library/gains.json";

describe("the library's level (library/gain.ts)", () => {
	test("music by integrated loudness, sounds by their loudest moment, to −14 LUFS; a boost stops at −1 dBTP; within ±12 dB", () => {
		expect([TARGET_LUFS, CEILING_DBTP, MAX_GAIN_DB]).toEqual([-14, -1, 12]);
		expect(gainFor({ kind: "music", integrated: -14, momentaryMax: -8, truePeak: -1 })).toBe(0);
		expect(gainFor({ kind: "music", integrated: -14.4, momentaryMax: -8, truePeak: -1 })).toBe(0);
		expect(gainFor({ kind: "music", integrated: -14.6, momentaryMax: -8, truePeak: -3 })).toBe(0.6);
		expect(gainFor({ kind: "music", integrated: -20, momentaryMax: -8, truePeak: -6 })).toBe(5);
		expect(gainFor({ kind: "music", integrated: -9.4, momentaryMax: -5, truePeak: 1.3 })).toBe(-4.6);
		// a quiet track with hot peaks comes up only to the ceiling; one at level with hot peaks is left alone
		expect(gainFor({ kind: "music", integrated: -20, momentaryMax: -8, truePeak: -2 })).toBe(1);
		expect(gainFor({ kind: "music", integrated: -14, momentaryMax: -8, truePeak: 1.2 })).toBe(0);
		expect(gainFor({ kind: "music", integrated: -16, momentaryMax: -8, truePeak: 0.5 })).toBe(0);
		expect(gainFor({ kind: "sfx", integrated: -70, momentaryMax: -26.5, truePeak: -14 })).toBe(12);
		expect(gainFor({ kind: "sfx", integrated: -16, momentaryMax: -6.4, truePeak: 0.2 })).toBe(-7.6);
		// nothing measured, or silence: left as it is
		expect(gainFor({ kind: "sfx", integrated: null, momentaryMax: null, truePeak: null })).toBe(0);
		expect(gainFor({ kind: "music", integrated: -70, momentaryMax: -70, truePeak: -60 })).toBe(0);
		expect(gainFactor(6)).toBeCloseTo(1.995, 2);
		expect(gainFactor(-6)).toBeCloseTo(0.501, 2);
	});

	test("the measured table covers the library: Music and Sound Effects rows, tenths of a dB within ±12, none under half a dB", () => {
		const entries = Object.entries(gains as Record<string, number>);
		expect(entries.length).toBeGreaterThan(1500);
		for (const [key, gain] of entries) {
			expect(key).toMatch(/^(Music|Sound Effects)\/[^/]+$/);
			expect(Math.abs(gain)).toBeGreaterThanOrEqual(0.5);
			expect(Math.abs(gain)).toBeLessThanOrEqual(MAX_GAIN_DB);
			expect(Math.round(gain * 10) / 10).toBe(gain);
		}
		// Kevin MacLeod's tracks were mastered to −14 LUFS: they need no gain
		expect(entries.filter(([key]) => /^Music\/km\d+$/.test(key)).length).toBeLessThan(10);
	});
});

describe("a library clip carries the gain", () => {
	beforeAll(() => installOpenCutWasm());

	test("the clip's volume is the gain in dB (so the player and the export have it); none when the file is at level", async () => {
		const { buildLibraryClip } = await import("@/library/client");
		const { mediaTimeFromSeconds } = await import("@/wasm");
		const at = mediaTimeFromSeconds({ seconds: 0 });
		const whoosh = buildLibraryClip({ entry: { url: "/api/library/file/ks-1", name: "Whoosh", dur: 1, kind: "sfx", gain: 7.5 }, startTime: at });
		expect(whoosh.params.volume).toBe(7.5);
		const level = buildLibraryClip({ entry: { url: "/api/library/file/ks-2", name: "Pop", dur: 1, kind: "sfx" }, startTime: at });
		expect(level.params.volume ?? 0).toBe(0);
		const track = buildLibraryClip({ entry: { url: "/api/library/file/km-1", name: "Track", dur: 100, kind: "music", gain: -4.6 }, startTime: at });
		expect([track.params.volume, track.params.duckUnderVoice]).toEqual([-4.6, true]);
	});
});
