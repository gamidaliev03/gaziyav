import { describe, expect, test } from "bun:test";
import { splitKnownFiles } from "../known-files";

const file = (name: string, size: number) => ({ name, size });
// Stored copies are named after the asset id; the picked name is the asset's name.
const asset = (id: string, name: string, size: number, ephemeral?: boolean) => ({ id, name, file: file(id, size), ephemeral });

// Picking the same file again added a second identical tile to Media.
describe("media: a file that is already in Media", () => {
	test("is not added again and points at the tile that is there", () => {
		const { fresh, known } = splitKnownFiles({
			files: [file("clip.mp4", 100), file("photo.png", 20)],
			assets: [asset("a1", "clip.mp4", 100)],
		});
		expect(fresh.map((f) => f.name)).toEqual(["photo.png"]);
		expect(known).toEqual([{ file: file("clip.mp4", 100), assetId: "a1" }]);
	});

	test("a different file with the same name is new", () => {
		const { fresh, known } = splitKnownFiles({ files: [file("clip.mp4", 101)], assets: [asset("a1", "clip.mp4", 100)] });
		expect(fresh).toHaveLength(1);
		expect(known).toHaveLength(0);
	});

	test("hidden working copies (ephemeral) don't count", () => {
		const { fresh } = splitKnownFiles({ files: [file("clip.mp4", 100)], assets: [asset("a1", "clip.mp4", 100, true)] });
		expect(fresh).toHaveLength(1);
	});

	// A 4K HEVC asset holds its editing copy (another size); the user's file is kept beside it.
	test("a 4K HEVC picked again is the asset whose editing copy came from it", () => {
		const { fresh, known } = splitKnownFiles({
			files: [file("drone.mp4", 500)],
			assets: [asset("a1", "drone.mp4", 200)],
			originalSizeOf: (id) => (id === "a1" ? 500 : undefined),
		});
		expect(fresh).toHaveLength(0);
		expect(known).toEqual([{ file: file("drone.mp4", 500), assetId: "a1" }]);
	});

	test("the same file picked twice at once is added once", () => {
		const { fresh } = splitKnownFiles({ files: [file("clip.mp4", 100), file("clip.mp4", 100)], assets: [] });
		expect(fresh).toHaveLength(1);
	});
});
