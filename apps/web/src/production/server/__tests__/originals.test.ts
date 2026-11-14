import { afterAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { originalFor } from "@/production/server/originals";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gz-originals-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const file = path.join(dir, "Interview A.mp4");
fs.writeFileSync(file, Buffer.alloc(4096, 7));
const st = fs.statSync(file);
const want = { path: file, size: st.size, lastModified: Math.floor(st.mtimeMs) };

test("the analysis reads the user's original only when it is the very file imported", () => {
	expect(originalFor(want)).toBe(file);
	expect(originalFor({ ...want, size: 4095 })).toBeNull();
	expect(originalFor({ ...want, lastModified: want.lastModified - 60_000 })).toBeNull();
	expect(originalFor({ ...want, path: path.join(dir, "gone.mp4") })).toBeNull();
});

test("nothing but a media file, by an absolute path", () => {
	const text = path.join(dir, "notes.txt");
	fs.writeFileSync(text, "x");
	const t = fs.statSync(text);
	expect(originalFor({ path: text, size: t.size, lastModified: Math.floor(t.mtimeMs) })).toBeNull();
	expect(originalFor({ ...want, path: "Interview A.mp4" })).toBeNull();
	expect(originalFor(null)).toBeNull();
	expect(originalFor({ path: file })).toBeNull();
	expect(originalFor({ path: dir, size: 0, lastModified: 0 })).toBeNull();
});
