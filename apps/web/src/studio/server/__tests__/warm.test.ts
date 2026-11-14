import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { heavy, heavyIdle } from "../ml-queue";
import { prewarm, runWarm, warmSupported } from "../warm";

// A stand-in helper with --serve: "loads" for 300 ms, then answers each job line with a STATUS line and DONE 0.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "warm-test-"));
const helper = path.join(dir, "helper.mjs");
fs.writeFileSync(
	helper,
	`setTimeout(() => console.log("READY"), 300);
process.stdin.setEncoding("utf8");
let buf = "";
process.stdin.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\\n")) >= 0) { const job = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); console.log("STATUS " + job.say); console.log("DONE 0"); } });
process.stdin.on("end", () => process.exit(0));`,
);

describe("heavy queue", () => {
	test("idle only when nothing runs or waits", async () => {
		expect(heavyIdle()).toBe(true);
		let release = () => {};
		const first = heavy(() => new Promise<void>((r) => (release = r)));
		const second = heavy(async () => {});
		expect(heavyIdle()).toBe(false);
		await Bun.sleep(10);
		release();
		await first;
		await second;
		await Bun.sleep(0);
		expect(heavyIdle()).toBe(true);
	});
});

describe.if(warmSupported())("prewarm", () => {
	test("loads the model ahead; the first job uses that worker; a second prewarm does nothing", async () => {
		expect(prewarm({ key: "t", bin: process.execPath, argv: [helper], idleSeconds: 30 })).toBe(true);
		expect(prewarm({ key: "t", bin: process.execPath, argv: [helper], idleSeconds: 30 })).toBe(false);
		const lines: string[] = [];
		// Sent before READY: it waits for the model and runs on the same worker.
		const r = await runWarm({ key: "t", bin: "/nonexistent", argv: [], request: { say: "hi" }, idleSeconds: 1, timeout: 10, onLine: (l) => lines.push(l) });
		expect(r.status).toBe(0);
		expect(lines).toEqual(["STATUS hi"]);
		// Another key sends the idle one away (one warm model at a time under 32 GB).
		expect(prewarm({ key: "u", bin: process.execPath, argv: [helper], idleSeconds: 30 })).toBe(true);
		if (os.totalmem() < 32e9) expect(prewarm({ key: "t", bin: process.execPath, argv: [helper], idleSeconds: 30 })).toBe(true);
	});
});
