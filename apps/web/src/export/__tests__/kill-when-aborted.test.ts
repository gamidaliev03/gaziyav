import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { killWhenAborted } from "../server/files";

const closed = (child: ReturnType<typeof spawn>) => new Promise<string | null>((resolve) => child.on("close", (_code, signal) => resolve(signal)));

describe("killWhenAborted", () => {
	test("stops a process whose signal aborted before it was spawned", async () => {
		const controller = new AbortController();
		controller.abort();
		const child = spawn("sleep", ["30"]);
		killWhenAborted(child, controller.signal);
		expect(await closed(child)).toBe("SIGKILL");
	});
	test("stops a running process when the signal aborts later", async () => {
		const controller = new AbortController();
		const child = spawn("sleep", ["30"]);
		killWhenAborted(child, controller.signal);
		setTimeout(() => controller.abort(), 20);
		expect(await closed(child)).toBe("SIGKILL");
	});
	test("leaves a process alone without a signal", async () => {
		const child = spawn("sleep", ["0.05"]);
		killWhenAborted(child, undefined);
		expect(await closed(child)).toBe(null);
	});
});
