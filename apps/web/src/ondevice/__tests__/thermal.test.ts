import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { busyReason } from "../background";
import { configureThermal, isHot, onThermal, parseThermal, pausableTimeout, setThermalLevel, thermalStatus, trackProcess, waitCool } from "../thermal";

// The Mac got hot (docs/CLOUD-AND-MAC.md): serious / critical pauses every model process (SIGSTOP) and holds a model
// about to start; fair / nominal continues them. The quiet background download waits too. Nothing is cancelled.
const sent: Array<[number, string]> = [];
beforeEach(() => {
	sent.length = 0;
	configureThermal({ kill: (pid, signal) => void sent.push([pid, signal]) });
	setThermalLevel("nominal");
});
afterEach(() => {
	setThermalLevel("nominal");
	configureThermal();
});

test("the levels: serious and critical are hot, the shell's words are checked", () => {
	expect(parseThermal("serious")).toBe("serious");
	expect(parseThermal(" Critical ")).toBe("critical");
	expect(parseThermal("hot")).toBeNull();
	expect(parseThermal(undefined)).toBeNull();
	expect(isHot()).toBe(false);
	setThermalLevel("fair");
	expect(isHot()).toBe(false);
	setThermalLevel("serious");
	expect(isHot()).toBe(true);
	setThermalLevel("critical");
	expect(isHot()).toBe(true);
});

test("serious → every tracked model process stops (its group); fair → it continues; a process that joins while hot stops at once", () => {
	const off1 = trackProcess(101);
	const off2 = trackProcess(202, { group: false });
	expect(sent).toEqual([]);
	setThermalLevel("serious");
	expect(sent).toEqual([
		[-101, "SIGSTOP"],
		[202, "SIGSTOP"],
	]);
	expect(thermalStatus()).toMatchObject({ level: "serious", hot: true, paused: 2 });
	// critical after serious: still hot, nothing is signalled twice
	setThermalLevel("critical");
	expect(sent.length).toBe(2);
	const off3 = trackProcess(303);
	expect(sent.at(-1)).toEqual([-303, "SIGSTOP"]);
	off1();
	setThermalLevel("fair");
	expect(sent.slice(3)).toEqual([
		[202, "SIGCONT"],
		[-303, "SIGCONT"],
	]);
	expect(thermalStatus()).toMatchObject({ level: "fair", hot: false, paused: 0 });
	off2();
	off3();
	setThermalLevel("serious");
	expect(sent.length).toBe(5);
});

test("a model about to start waits while the Mac is hot and starts when it cools; its Cancel ends the wait", async () => {
	await waitCool(); // cool: at once
	setThermalLevel("serious");
	let started = false;
	const wait = waitCool().then(() => {
		started = true;
	});
	await new Promise((r) => setTimeout(r, 30));
	expect(started).toBe(false);
	setThermalLevel("critical");
	await new Promise((r) => setTimeout(r, 30));
	expect(started).toBe(false);
	setThermalLevel("nominal");
	await wait;
	expect(started).toBe(true);
	// cancelled while waiting
	setThermalLevel("serious");
	const ac = new AbortController();
	const cancelled = waitCool(ac.signal).then(
		() => "started",
		(e: Error) => e.name,
	);
	ac.abort();
	expect(await cancelled).toBe("CancelledError");
});

test("the quiet background download stands still while the Mac is hot", () => {
	expect(busyReason()).toBeNull();
	setThermalLevel("serious");
	expect(busyReason()).toMatch(/hot/);
	setThermalLevel("fair");
	expect(busyReason()).toBeNull();
});

test("a time limit counts only the time the Mac was not hot", async () => {
	let fired = 0;
	const timer = pausableTimeout(80, () => fired++);
	await new Promise((r) => setTimeout(r, 30));
	setThermalLevel("serious");
	await new Promise((r) => setTimeout(r, 120));
	expect(fired).toBe(0);
	expect(timer.elapsed()).toBeLessThan(80);
	setThermalLevel("nominal");
	await new Promise((r) => setTimeout(r, 100));
	expect(fired).toBe(1);
	const cleared = pausableTimeout(20, () => fired++);
	cleared.clear();
	await new Promise((r) => setTimeout(r, 40));
	expect(fired).toBe(1);
});

test("listeners hear every change once, and an unsubscribed one no more", () => {
	const seen: string[] = [];
	const off = onThermal((level, was) => seen.push(`${was}>${level}`));
	setThermalLevel("fair");
	setThermalLevel("fair");
	setThermalLevel("serious");
	off();
	setThermalLevel("nominal");
	expect(seen).toEqual(["nominal>fair", "fair>serious"]);
});

test("a real process: SIGSTOP leaves it stopped (ps says T), SIGCONT runs it again", async () => {
	configureThermal();
	const child = spawn("/bin/sh", ["-c", "while :; do sleep 0.1; done"], { detached: true, stdio: "ignore" });
	const pid = child.pid as number;
	const state = () => Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)]).stdout.toString().trim();
	const untrack = trackProcess(pid);
	try {
		await new Promise((r) => setTimeout(r, 100));
		expect(state()).not.toMatch(/^T/);
		setThermalLevel("serious");
		await new Promise((r) => setTimeout(r, 100));
		expect(state()).toMatch(/^T/);
		setThermalLevel("nominal");
		await new Promise((r) => setTimeout(r, 100));
		expect(state()).not.toMatch(/^T/);
	} finally {
		untrack();
		try {
			process.kill(-pid, "SIGKILL");
		} catch {}
	}
});
