import { describe, expect, test } from "bun:test";
import { MANIFEST_COLUMNS, MANIFEST_MEDIA, manifestCsvHeader, manifestCsvRow } from "../manifest";

const manifest = {
	file: 'Promo, "v2".mp4',
	project: "Promo",
	platform: "TikTok",
	format: "mp4",
	width: 1080,
	height: 1920,
	fps: 30,
	seconds: 8,
	quality: "high",
	video_kbps: 6000,
	audio: true,
	loudness_lufs: -14,
	captions: false,
	range: "whole",
	bytes: 4217817,
	exported_at: "2026-10-25T09:05:00.000Z",
};

describe("export manifest", () => {
	test("one CSV column per field, quoted where needed", () => {
		expect(manifestCsvHeader().split(",")).toEqual([...MANIFEST_COLUMNS]);
		expect(manifestCsvRow(manifest)).toBe('"Promo, ""v2"".mp4",Promo,TikTok,mp4,1080,1920,30,8,high,6000,true,-14,false,whole,4217817,2026-10-25T09:05:00.000Z');
		expect(manifestCsvRow({ ...manifest, width: null, height: null, fps: null }).split(",").slice(5, 8)).toEqual(["", "", ""]);
	});

	test("written only beside exported media", () => {
		expect(MANIFEST_MEDIA.test("/Users/me/Movies/a.mp4")).toBe(true);
		expect(MANIFEST_MEDIA.test("/Users/me/Movies/a.WAV")).toBe(true);
		expect(MANIFEST_MEDIA.test("/Users/me/.zshrc")).toBe(false);
	});
});

describe("ad marking (Russia)", () => {
	test("label text with and without an advertiser; erid tokens", async () => {
		const { adLabelText, isEridToken } = await import("../ad-label");
		expect(adLabelText({ advertiser: " ООО Ромашка ", erid: "2SDnjcVm4Fq" })).toBe("Реклама · ООО Ромашка · erid: 2SDnjcVm4Fq");
		expect(adLabelText({ erid: "2SDnjcVm4Fq" })).toBe("Реклама · erid: 2SDnjcVm4Fq");
		expect(isEridToken("2SDnjcVm4Fq")).toBe(true);
		expect(isEridToken("2SD njc")).toBe(false);
		expect(isEridToken("")).toBe(false);
	});
});
