import { afterAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appVersion, skillStamp } from "../server/claude";

// 10.11: the owner's Claude Code skill never refreshed. The app replaced it only when its version changed, and every
// build is «1.0.0», so the skill stayed the first copy Claude Code got (without the later rules). The stamp now
// carries a hash of the skill's files: a build that changes the skill replaces it on the next start.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gz-skill-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("the skill's stamp", () => {
	test("changes with any file of the skill, not only with the app's version", () => {
		fs.mkdirSync(path.join(dir, "references"));
		fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: gaziyav-editing\n---\nrules\n");
		fs.writeFileSync(path.join(dir, "references", "ai.md"), "money\n");
		const first = skillStamp(dir);
		expect(first.startsWith(`${appVersion()}+`)).toBe(true);
		expect(skillStamp(dir)).toBe(first);
		fs.writeFileSync(path.join(dir, "references", "ai.md"), "money\nA timed-out call: send the same call again.\n");
		const second = skillStamp(dir);
		expect(second).not.toBe(first);
		expect(second.startsWith(`${appVersion()}+`)).toBe(true);
		fs.writeFileSync(path.join(dir, "references", "ai.md"), "money\n");
		expect(skillStamp(dir)).toBe(first);
	});

	test("the app's own skill gets a stamp", () => {
		const own = path.join(import.meta.dir, "..", "..", "..", "mcp", "skill", "gaziyav-editing");
		expect(skillStamp(own)).toMatch(/^[\d.]+\+[0-9a-f]{12}$/);
	});
});
