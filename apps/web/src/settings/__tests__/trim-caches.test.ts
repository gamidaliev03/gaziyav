import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gz-trim-"));
const HOUR = 3600 * 1000;
const NOW = Date.now();
let trimCaches: typeof import("../server/storage").trimCaches;

/** A cache entry of `kb` kilobytes last changed `hoursAgo` hours ago. */
function entry(dir: string, name: string, kb: number, hoursAgo: number, folder = false): string {
	const full = path.join(root, dir, name);
	const target = folder ? path.join(full, "data.bin") : full;
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, Buffer.alloc(kb * 1000));
	const at = new Date(NOW - hoursAgo * HOUR);
	fs.utimesSync(target, at, at);
	if (folder) fs.utimesSync(full, at, at);
	return full;
}

beforeAll(async () => {
	process.env.STUDIO_DATA_DIR = root;
	// (unsaved exports wait in the system's temp folder: the test gets its own, never the real one)
	process.env.TMPDIR = root;
	({ trimCaches } = await import("../server/storage"));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("the cache keeps itself under a size: the oldest entries make room", () => {
	test("over the limit the oldest go first, until it fits; under it nothing goes", () => {
		const oldest = entry("montage-cache", "a", 400, 72, true);
		const older = entry("ai-effects", "b.mp4", 400, 48);
		const newer = entry("transcripts", "c.json", 400, 24);
		expect(trimCaches({ limitBytes: 2_000_000, now: NOW }).removed).toBe(0);
		const report = trimCaches({ limitBytes: 900_000, now: NOW });
		expect(report.removed).toBe(1);
		expect(fs.existsSync(oldest)).toBe(false);
		expect(fs.existsSync(older)).toBe(true);
		expect(fs.existsSync(newer)).toBe(true);
		expect(report.total).toBeLessThanOrEqual(900_000);
	});
	test("what was made or used in the last minutes stays, whatever the limit", () => {
		const busy = entry("montage-cache", "now", 500, 0, true);
		const report = trimCaches({ limitBytes: 0, now: NOW });
		expect(fs.existsSync(busy)).toBe(true);
		expect(report.total).toBe(500_000);
	});
});
