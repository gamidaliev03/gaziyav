// The project's disk copy (server/project-files.ts): a previous copy is kept, versions live outside the copy, and a
// damaged copy is passed over for the last one that reads (IDEAL reliable §4).
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-versions-"));
const pf = await import("../server/project-files");
// (only while these tests run: other suites in the same process have their own data folder)
const before = process.env.STUDIO_DATA_DIR;
beforeEach(() => {
	process.env.STUDIO_DATA_DIR = dir;
});
afterEach(() => {
	if (before === undefined) delete process.env.STUDIO_DATA_DIR;
	else process.env.STUDIO_DATA_DIR = before;
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

test("a save keeps the copy before, and a first version outside it", () => {
	pf.writeProjectFile("p1", JSON.stringify({ n: 1 }));
	pf.writeProjectFile("p1", JSON.stringify({ n: 2 }));
	const base = path.join(dir, "projects", "p1.json");
	expect(JSON.parse(fs.readFileSync(base, "utf8")).n).toBe(2);
	expect(JSON.parse(fs.readFileSync(`${base}.prev`, "utf8")).n).toBe(1);
	const versions = pf.listProjectVersions("p1");
	expect(versions.length).toBe(1);
	expect(pf.listProjectFiles().map((x) => x.id)).toEqual(["p1"]);
});

test("a damaged copy is passed over: the previous one, then the newest version", () => {
	const base = path.join(dir, "projects", "p1.json");
	fs.writeFileSync(base, '{"n": 3, broken');
	// the copy before (n 1: the first save)
	expect(JSON.parse(pf.readProjectFile("p1") ?? "null").n).toBe(1);
	fs.writeFileSync(`${base}.prev`, "also broken");
	// the version, kept outside both
	expect(JSON.parse(pf.readProjectFile("p1") ?? "null").n).toBe(1);
	fs.rmSync(path.join(dir, "projects", "versions"), { recursive: true });
	expect(pf.readProjectFile("p1")).toBeNull();
});

test("removing a project removes its copies and versions", () => {
	pf.removeProjectFile("p1");
	expect(pf.readProjectFile("p1")).toBeNull();
	expect(fs.existsSync(path.join(dir, "projects", "versions", "p1"))).toBe(false);
});
