import { describe, expect, test } from "bun:test";
import { splitEditingOriginals, withExportOriginals } from "@/media/editing-originals";
import type { MediaAsset } from "@/media/types";

// The preview edits an H.264 copy; the export renders the user's own file behind it (CapCut does the same).
const file = (name: string) => new File([name], name, { type: "video/mp4" });
const asset = (id: string, extra: Partial<MediaAsset> = {}): MediaAsset =>
	({ id, name: `${id}.mp4`, type: "video", file: file(`${id}.mp4`), ...extra }) as MediaAsset;

describe("editing originals", () => {
	test("loaded media: the originals stay out of the project's media, by the copy they belong to", () => {
		const copy = asset("copy");
		const original = asset("orig", { editingOriginalOf: "copy" });
		const plain = asset("plain");
		const { assets, originals } = splitEditingOriginals([copy, original, plain]);
		expect(assets.map((a) => a.id)).toEqual(["copy", "plain"]);
		expect(originals.get("copy")?.id).toBe("orig");
	});

	test("the export renders the original when it decodes, the copy otherwise — and for media from before", async () => {
		const copy = asset("copy", { url: "blob:copy" });
		const original = asset("orig", { editingOriginalOf: "copy", url: "blob:orig" });
		const old = asset("old");
		const originals = new Map([["copy", original]]);
		const decodes = await withExportOriginals({ assets: [copy, old], originals, canDecode: async () => true });
		expect(decodes.map((a) => [a.id, a.file.name, a.url])).toEqual([
			["copy", "orig.mp4", "blob:orig"],
			["old", "old.mp4", undefined],
		]);
		const cannot = await withExportOriginals({ assets: [copy], originals, canDecode: async () => false });
		expect(cannot[0].file.name).toBe("copy.mp4");
		const throws = await withExportOriginals({ assets: [copy], originals, canDecode: () => Promise.reject(new Error("no codec")) });
		expect(throws[0].file.name).toBe("copy.mp4");
	});
});
