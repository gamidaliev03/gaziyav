// K9, 10.11 12:00: after a restart every media file came back from the app's storage as a File named by its id with no
// type, so an MP4 export of a song piece was taken for an MP3 («audio/mpeg» guessed) and an avatar model refused it.
// The file comes back with its name and the type its name says.
import { beforeAll, expect, mock, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// the stub file is 8 bytes of a header, not a whole MP4: the damage check on open is not what this file tests
// (relink/__tests__/damaged.test.ts does) — polish, 11.11
mock.module("@/relink/damaged", () => ({ storedFileDamaged: async () => false, markDamaged: () => {}, forgetDamaged: () => {}, isDamaged: () => false }));

let S: typeof import("@/services/storage/service");
beforeAll(async () => {
	await installOpenCutWasm();
	S = await import("@/services/storage/service");
});

const stored = (bytes: number[]) => new File([new Uint8Array(bytes)], "4f6c2a9e-media-id");

test("a media file loaded from the app's storage has its name and its type again", async () => {
	const service = new S.StorageService();
	const file = stored([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);
	const meta = { id: "4f6c2a9e-media-id", name: "mama-v5.mp4", type: "video", size: 8, lastModified: 1, duration: 3.8, hasAudio: true };
	(service as unknown as { getProjectMediaAdapters: () => unknown }).getProjectMediaAdapters = () => ({
		mediaAssetsAdapter: { get: async () => file },
		mediaMetadataAdapter: { get: async () => meta },
	});
	const asset = await service.loadMediaAsset({ projectId: "p", id: meta.id });
	expect(asset?.file.type).toBe("video/mp4");
	expect(asset?.file.name).toBe("mama-v5.mp4");
	expect(asset?.file.size).toBe(8);
	expect(new Uint8Array(await (asset as { file: File }).file.arrayBuffer())[4]).toBe(0x66);
});

test("the type by the name; a file that has a type keeps it", () => {
	expect(S.mimeOfName("Song.MP3")).toBe("audio/mpeg");
	expect(S.mimeOfName("voice.m4a")).toBe("audio/mp4");
	expect(S.mimeOfName("pic.jpeg")).toBe("image/jpeg");
	expect(S.mimeOfName("noext")).toBe("");
	const typed = new File([new Uint8Array([1])], "x", { type: "audio/wav" });
	expect(S.asNamedFile(typed, "y.mp3")).toBe(typed);
	expect(S.asNamedFile(stored([1]), "clip.mov").type).toBe("video/quicktime");
});
