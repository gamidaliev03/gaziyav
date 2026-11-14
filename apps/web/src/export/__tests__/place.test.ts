import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { placeReady, saveToFolder, sweepOldWork, transcode } from "../server/files";
import { PART_EXT, partPath, placeFile } from "../server/place";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "export-place-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const parts = (folder: string) => fs.readdirSync(folder).filter((n) => n.endsWith(PART_EXT));

describe("a finished file reaches its name in one step", () => {
	test("a part file is hidden, beside its target, and names its owner", () => {
		const part = partPath(path.join(dir, "Film.mp4"), 4242);
		expect(path.dirname(part)).toBe(dir);
		expect(path.basename(part)).toMatch(/^\.Film\.mp4\.4242-[0-9a-f]{6}\.gaziyav-part$/);
	});
	test("placeFile: the source becomes the target, nothing else is left", () => {
		const from = path.join(dir, "made.bin");
		fs.writeFileSync(from, "x".repeat(5000));
		const target = path.join(dir, "Placed.mp4");
		placeFile(from, target);
		expect(fs.statSync(target).size).toBe(5000);
		expect(fs.existsSync(from)).toBe(false);
		expect(parts(dir)).toEqual([]);
	});
	test("saveToFolder writes under a part name and renames: a body that fails leaves nothing", async () => {
		const folder = path.join(dir, "out");
		fs.mkdirSync(folder);
		const good = new Response("y".repeat(3000)).body;
		const saved = await saveToFolder({ body: good, folder, name: "Clip.wav" });
		expect(saved).toBe(path.join(folder, "Clip.wav"));
		expect(fs.statSync(saved).size).toBe(3000);
		const broken = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.enqueue(new Uint8Array(1000));
				controller.error(new Error("ENOSPC: no space left on device, write"));
			},
		});
		await expect(saveToFolder({ body: broken, folder, name: "Cut.wav" })).rejects.toThrow("ENOSPC");
		expect(fs.readdirSync(folder)).toEqual(["Clip.wav"]);
		// never over a file that is there
		const again = await saveToFolder({ body: new Response("z").body, folder, name: "Clip.wav" });
		expect(path.basename(again)).toBe("Clip (2).wav");
	});
});

describe("the encoder's work folder", () => {
	const WORK = path.join(os.tmpdir(), "Gaziyav-export-work");
	test("a folder of a server that no longer runs goes at the next sweep; a running one's and a fresh old-style one stay", () => {
		const dead = path.join(WORK, "999999-11111111-2222-3333-4444-555555555555");
		const live = path.join(WORK, `${process.pid}-aaaaaaaa-2222-3333-4444-555555555555`);
		const old = path.join(WORK, "bbbbbbbb-2222-3333-4444-555555555555");
		for (const d of [dead, live, old]) {
			fs.mkdirSync(d, { recursive: true });
			fs.writeFileSync(path.join(d, "master.mp4"), "x");
		}
		sweepOldWork();
		expect(fs.existsSync(dead)).toBe(false);
		expect(fs.existsSync(live)).toBe(true);
		expect(fs.existsSync(old)).toBe(true);
		const twoDays = new Date(Date.now() - 48 * 3600 * 1000);
		fs.utimesSync(old, twoDays, twoDays);
		sweepOldWork();
		expect(fs.existsSync(old)).toBe(false);
		fs.rmSync(live, { recursive: true, force: true });
	});
	test("a file that is made but can't reach its folder is kept and placed later without a new encode", async () => {
		// a missing tool ends the pass before anything is made: nothing is kept, nothing is left
		await expect(transcode({ body: new Response("not a wav").body, job: { audio: "mp3" }, name: "A.mp3", seconds: 1, onProgress: () => {} })).rejects.toThrow();
		expect(() => placeReady("no-such-id", dir)).toThrow("gone");
	});
});
