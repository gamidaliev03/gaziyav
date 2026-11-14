import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

// Every file shipped from public/ has a plain ASCII name. The DMG is HFS+, which stores names decomposed (ñ → n + ◌̃):
// the app's code seal lists them composed, so one «piñata.png» made the copy in the DMG fail codesign --strict
// («a sealed resource is missing or invalid» — «is damaged» after download).
const PUBLIC = path.resolve(import.meta.dir, "../../../public");

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else out.push(path.relative(PUBLIC, full));
	}
	return out;
}

describe("public files", () => {
	test("have ASCII names", () => {
		const files = walk(PUBLIC);
		expect(files.length).toBeGreaterThan(0);
		expect(files.filter((file) => !/^[\x20-\x7e]+$/.test(file))).toEqual([]);
	});

	test("Fluent 3D stickers point at files that exist", () => {
		const dir = path.join(PUBLIC, "stickers/emoji3d");
		const catalog = JSON.parse(fs.readFileSync(path.join(dir, "catalog.json"), "utf8")) as { id: string; file: string }[];
		expect(catalog.filter((entry) => entry.file !== `${entry.id}.png` || !fs.existsSync(path.join(dir, entry.file)))).toEqual([]);
	});

	test("cloud sticker sets: every sticker has its 64 px picture in the app and its file in cloud.json (size + checksum)", () => {
		for (const set of ["emoji3d", "noto-animated"]) {
			const dir = path.join(PUBLIC, "stickers", set);
			const catalog = JSON.parse(fs.readFileSync(path.join(dir, "catalog.json"), "utf8")) as { file: string }[];
			const cloud = new Map((JSON.parse(fs.readFileSync(path.join(dir, "cloud.json"), "utf8")) as { file: string; bytes: number; sha256: string }[]).map((c) => [c.file, c]));
			const lacking = catalog
				.map((entry) => path.basename(entry.file))
				.filter((name) => {
					const c = cloud.get(name);
					return !c || c.bytes <= 0 || c.sha256.length !== 64 || !fs.existsSync(path.join(PUBLIC, "stickers", `${set}-preview`, name.replace(/\.(png|json)$/, ".webp")));
				});
			expect(`${set}: ${lacking.slice(0, 5).join(", ")}`).toBe(`${set}: `);
		}
	});
});
