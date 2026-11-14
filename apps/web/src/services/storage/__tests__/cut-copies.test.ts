import { expect, test } from "bun:test";
import { cutCopy, isLeftoverName } from "@/services/storage/cut-copies";

const source = { path: "/Volumes/CARD/DCIM/A001.mp4", size: 1000, lastModified: 1 };

test("a copy listed with its original is cut when its stored file is missing or not the listed size", () => {
	expect(cutCopy({ source, size: 1000 }, null)).toBe(true);
	expect(cutCopy({ source, size: 1000 }, { size: 0 })).toBe(true);
	expect(cutCopy({ source, size: 1000 }, { size: 880 })).toBe(true);
	expect(cutCopy({ source, size: 1000 }, { size: 1000 })).toBe(false);
});

test("a file used in place, or one without an original (made by the app, every older project), is never a cut copy", () => {
	expect(cutCopy({ source, size: 1000, inPlace: true }, null)).toBe(false);
	expect(cutCopy({ size: 1000 }, null)).toBe(false);
	expect(cutCopy({ size: 1000 }, { size: 10 })).toBe(false);
});

test("only Chromium's half-written files count as leftovers", () => {
	expect(isLeftoverName("00fd7215-58de-49cf-8dad-74afbb345f0e.crswap")).toBe(true);
	expect(isLeftoverName("00fd7215-58de-49cf-8dad-74afbb345f0e")).toBe(false);
	expect(isLeftoverName("clip.crswap.mp4")).toBe(false);
});
