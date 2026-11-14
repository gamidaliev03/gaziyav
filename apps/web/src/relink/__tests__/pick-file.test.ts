import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

let pickRelinkFile: typeof import("@/relink/offline").pickRelinkFile;
beforeAll(async () => {
	await installOpenCutWasm();
	({ pickRelinkFile } = await import("@/relink/offline"));
});

const f = (name: string, size: number, type = "") => ({ name, size, type }) as unknown as File;

// pro-reliable 09.11: Relink looks for a lost file in the folder the user picks, by its stored name.
test("the same name wins, the same size first, any letter case", () => {
	const files = [f("Interview A.mp4", 10), f("interview a.MP4", 20), f("Other.mp4", 20)];
	expect(pickRelinkFile(files, { name: "Interview A.mp4", size: 20 })?.size).toBe(20);
	expect(pickRelinkFile(files, { name: "Interview A.mp4" })?.size).toBe(10);
	expect(pickRelinkFile(files, { name: "Missing.mp4" })).toBeNull();
});

// An import converted on the way in (MKV, AVI, WMV…) is stored as «name.mp4»; the user's folder has «name.mkv».
test("a file stored under its converted name is found by its first name, a video for a video", () => {
	const files = [f("Take 3.wav", 5, "audio/wav"), f("Take 3.mkv", 900, "video/x-matroska"), f("Take 4.mkv", 800, "video/x-matroska")];
	expect(pickRelinkFile(files, { name: "Take 3.mp4", size: 300, type: "video" })?.name).toBe("Take 3.mkv");
	expect(pickRelinkFile(files, { name: "Take 3.mp4", size: 300, type: "audio" })?.name).toBe("Take 3.wav");
});
