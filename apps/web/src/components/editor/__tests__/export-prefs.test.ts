import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import { DEFAULT_EXPORT_OPTIONS } from "@/export/defaults";

let TICKS_PER_SECOND: number;
let prefs: typeof import("../export-prefs");

beforeAll(async () => {
	await installOpenCutWasm();
	({ TICKS_PER_SECOND } = await import("@/wasm"));
	prefs = await import("../export-prefs");
});

function memoryStorage(initial: Record<string, string> = {}) {
	const data = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value),
	};
}

// The export popover opens the way it was left: WebM / Max chosen once stays chosen.
describe("export choices are remembered", () => {
	test("nothing saved yet: the defaults", () => {
		const read = prefs.readExportPrefs(memoryStorage());
		expect(read.format).toBe(DEFAULT_EXPORT_OPTIONS.format);
		expect(read.quality).toBe(DEFAULT_EXPORT_OPTIONS.quality);
		expect(read.includeAudio).toBe(true);
		// off until asked: what is heard while editing is what is exported (check-export E1)
		expect(read.normalizeLoudness).toBe(false);
	});

	test("what was written is what is read back", () => {
		const storage = memoryStorage();
		prefs.writeExportPrefs({ format: "webm", quality: "very_high", includeAudio: false, normalizeLoudness: false }, storage);
		expect(prefs.readExportPrefs(storage)).toEqual({
			format: "webm",
			quality: "very_high",
			includeAudio: false,
			normalizeLoudness: false,
		});
	});

	test("an unknown or broken value falls back to the default, the rest is kept", () => {
		const storage = memoryStorage({
			[prefs.EXPORT_PREFS_KEY]: JSON.stringify({ format: "gif", quality: "high", includeAudio: "yes" }),
		});
		const read = prefs.readExportPrefs(storage);
		expect(read.format).toBe(DEFAULT_EXPORT_OPTIONS.format);
		expect(read.quality).toBe("high");
		expect(read.includeAudio).toBe(true);
	});

	test("unreadable storage never breaks the popover", () => {
		expect(prefs.readExportPrefs(memoryStorage({ [prefs.EXPORT_PREFS_KEY]: "{not json" })).format).toBe(DEFAULT_EXPORT_OPTIONS.format);
		expect(prefs.readExportPrefs(memoryStorage({ [prefs.EXPORT_PREFS_KEY]: "null" })).format).toBe(DEFAULT_EXPORT_OPTIONS.format);
		const throwing = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("full");
			},
		};
		expect(prefs.readExportPrefs(throwing).quality).toBe(DEFAULT_EXPORT_OPTIONS.quality);
		expect(() => prefs.writeExportPrefs(prefs.readExportPrefs(throwing), throwing)).not.toThrow();
		expect(prefs.readExportPrefs(undefined).format).toBe(DEFAULT_EXPORT_OPTIONS.format);
	});
});

describe("export length in the summary line", () => {
	const at = (seconds: number) => seconds * TICKS_PER_SECOND;
	test("minutes and seconds, hours only when there are some", () => {
		expect(prefs.formatLength(at(0))).toBe("0:00");
		expect(prefs.formatLength(at(7.4))).toBe("0:07");
		expect(prefs.formatLength(at(7.6))).toBe("0:08");
		expect(prefs.formatLength(at(64))).toBe("1:04");
		expect(prefs.formatLength(at(3849))).toBe("1:04:09");
	});
	test("a negative length reads as zero", () => {
		expect(prefs.formatLength(-5)).toBe("0:00");
	});
});

describe("platform presets", () => {
	test("suggests TikTok for vertical, YouTube for wide, nothing for square", () => {
		expect(prefs.suggestPlatform({ width: 1080, height: 1920 })).toBe("tiktok");
		expect(prefs.suggestPlatform({ width: 1920, height: 1080 })).toBe("youtube");
		expect(prefs.suggestPlatform({ width: 1080, height: 1080 })).toBeNull();
	});

	test("flags the wrong shape, a video over the limit and a soft size", () => {
		expect(prefs.platformIssues("reels", { width: 1080, height: 1920 }, 60)).toEqual({ aspect: null, tooLong: null, lowRes: false });
		expect(prefs.platformIssues("shorts", { width: 1920, height: 1080 }, 200)).toEqual({ aspect: "9:16", tooLong: 180, lowRes: false });
		expect(prefs.platformIssues("youtube", { width: 1280, height: 720 }, 4000)).toEqual({ aspect: null, tooLong: null, lowRes: true });
	});

	test("keeps a saved platform and drops an unknown one", () => {
		expect(prefs.readExportPrefs(memoryStorage({ [prefs.EXPORT_PREFS_KEY]: JSON.stringify({ platform: "reels" }) })).platform).toBe("reels");
		expect(prefs.readExportPrefs(memoryStorage({ [prefs.EXPORT_PREFS_KEY]: JSON.stringify({ platform: "myspace" }) })).platform).toBeUndefined();
	});
});

describe("size estimate and file name", () => {
	test("Recommended targets the platforms' rate over the encoder's yield: 10 Mbit/s at 1080p for 8 in the file (15 above 30 fps, 20 at 2K, 44 at 4K), Higher 1.5×, Lower 0.6×, WebM 0.6×", () => {
		expect(prefs.videoBitrate({ width: 1920, height: 1080, format: "mp4", quality: "high" })).toBe(10_000_000);
		expect(prefs.videoBitrate({ width: 1080, height: 1920, format: "mp4", quality: "high" })).toBe(10_000_000);
		expect(prefs.videoBitrate({ width: 1920, height: 1080, fps: 60, format: "mp4", quality: "high" })).toBe(15_000_000);
		expect(prefs.videoBitrate({ width: 2560, height: 1440, format: "mp4", quality: "high" })).toBe(20_000_000);
		expect(prefs.videoBitrate({ width: 3840, height: 2160, format: "mp4", quality: "high" })).toBe(43_750_000);
		expect(prefs.videoBitrate({ width: 1280, height: 720, format: "mp4", quality: "high" })).toBe(6_250_000);
		expect(prefs.videoBitrate({ width: 1920, height: 1080, format: "mp4", quality: "very_high" })).toBe(15_000_000);
		expect(prefs.videoBitrate({ width: 1920, height: 1080, format: "mp4", quality: "medium" })).toBe(6_000_000);
		expect(prefs.videoBitrate({ width: 1080, height: 1080, format: "mp4", quality: "high" })).toBe(5_625_000);
		expect(prefs.videoBitrate({ width: 1920, height: 1080, format: "webm", quality: "high" })).toBe(6_000_000);
	});

	test("10 s at 1080p Recommended with sound (the file carries the platforms' 8 Mbit/s, speech 0.7 of the AAC target) is about 10 MB; a slideshow half of it", () => {
		const bytes = prefs.estimateExportBytes({ width: 1080, height: 1920, seconds: 10, format: "mp4", quality: "high", includeAudio: true, stillShare: 0 });
		expect(bytes).toBe(10_280_000);
		expect(prefs.formatBytes(bytes)).toBe("10 MB");
		expect(prefs.estimateExportBytes({ width: 1080, height: 1920, seconds: 10, format: "mp4", quality: "high", includeAudio: false, stillShare: 1 })).toBe(5_000_000);
		expect(prefs.estimateExportBytes({ width: 1080, height: 1920, seconds: 10, format: "mp4", quality: "high", includeAudio: false, stillShare: 0.5 })).toBe(7_500_000);
		expect(prefs.formatBytes(840_000)).toBe("840 KB");
		expect(prefs.formatBytes(1_400_000_000)).toBe("1.4 GB");
	});

	test("file names lose : and / and are never empty", () => {
		expect(prefs.exportFileBase("Video Oct 25, 09:31")).toBe("Video Oct 25, 09.31");
		expect(prefs.exportFileBase("  a/b  ")).toBe("a.b");
		expect(prefs.exportFileBase("   ")).toBe("Video");
	});
});

describe("file name tokens", () => {
	const values = { project: "Promo", platform: "TikTok", now: new Date(2026, 9, 25, 9, 5), width: 1080, height: 1920, fps: 30 };

	test("fills every token", () => {
		expect(prefs.resolveFileName("{project}_{platform}_{date}_{time}_{size}_{fps}", values)).toBe("Promo_TikTok_2026-10-25_09.05_1080x1920_30fps");
	});

	test("an empty platform takes its separator with it, unknown tokens stay", () => {
		expect(prefs.resolveFileName("{project}_{platform}_{date}", { ...values, platform: undefined })).toBe("Promo_2026-10-25");
		expect(prefs.resolveFileName("{platform} - {project}", { ...values, platform: "" })).toBe("Promo");
		expect(prefs.resolveFileName("{project} {hook}", values)).toBe("Promo {hook}");
	});

	test("4:5 suggests the Feed preset and is checked like the others", () => {
		expect(prefs.suggestPlatform({ width: 1080, height: 1350 })).toBe("feed");
		expect(prefs.platformIssues("feed", { width: 1080, height: 1920 }, 30).aspect).toBe("4:5");
	});
});
