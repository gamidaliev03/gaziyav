// A stored media file that is there but can't be read is found when the project opens — on definite evidence only
// (polish, 11.11).
import { expect, test } from "bun:test";
import { damagedOriginalOf, forgetDamaged, isDamaged, markDamaged, storedFileDamaged } from "@/relink/damaged";

const bytes = (n: number) => new Uint8Array(n);

test("a stored file shorter than it was stored is damaged, whatever its format", async () => {
	expect(await storedFileDamaged({ file: new File([bytes(100)], "a.mp4"), size: 5000, type: "video" })).toBe(true);
	expect(await storedFileDamaged({ file: new File([bytes(100)], "a.avi"), size: 5000, type: "video" })).toBe(true);
});

test("an empty stored file is damaged; a picture of the stored size is not probed", async () => {
	expect(await storedFileDamaged({ file: new File([], "a.mp3"), size: 0, type: "audio" })).toBe(true);
	expect(await storedFileDamaged({ file: new File([bytes(64)], "a.png"), size: 64, type: "image" })).toBe(false);
});

test("an .mp4 whose header is zeroed (same size) is damaged", async () => {
	expect(await storedFileDamaged({ file: new File([bytes(4096)], "a.mp4"), size: 4096, type: "video" })).toBe(true);
});

test("an original in a format the reader doesn't know (.avi, .mts, .aiff) is not checked: not damaged", async () => {
	for (const name of ["Holiday.avi", "Clip.MTS", "voice.aiff", "old.wmv"])
		expect(await storedFileDamaged({ file: new File([bytes(4096)], name), size: 4096, type: "video" })).toBe(false);
});

test("a reader that fails for another reason (its import, a read error) is not evidence", async () => {
	const file = new File([bytes(4096)], "a.mp4");
	expect(await storedFileDamaged({ file, size: 4096, type: "video", reader: async () => { throw new Error("Failed to fetch dynamically imported module"); } })).toBe(false);
	expect(await storedFileDamaged({ file, size: 4096, type: "video", reader: async () => { throw new DOMException("read", "NotReadableError"); } })).toBe(false);
	expect(await storedFileDamaged({ file, size: 4096, type: "video", reader: async () => 0 })).toBe(true);
	expect(await storedFileDamaged({ file, size: 4096, type: "video", reader: async () => 2 })).toBe(false);
});

test("damaged media and damaged originals are remembered apart", () => {
	markDamaged("m1", "a.mp4");
	markDamaged("o1", "Holiday.avi", { originalOf: "copy1" });
	expect(isDamaged("m1")).toBe(true);
	expect(isDamaged("o1")).toBe(false);
	expect(damagedOriginalOf("copy1")).toBe("Holiday.avi");
	forgetDamaged("o1", { originalOf: "copy1" });
	expect(damagedOriginalOf("copy1")).toBe(null);
});
