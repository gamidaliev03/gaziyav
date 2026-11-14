import { afterEach, describe, expect, test } from "bun:test";
import { rememberHardware } from "../hardware-client";
import type { Hardware, HardwareTier } from "../hardware";
import { BUDGETS, budgetLimit, budgetTable, joinBudget, noteUse, resetBudgetForTests, setBudgetSignal, type CacheName } from "../memory-budget";
import { relieveMemory } from "../memory-pressure";
import { LruBytes } from "../lru-bytes";

const machine = (tier: HardwareTier): Hardware => ({ chip: "Apple M1", memoryGB: tier === "base" ? 8 : 16, cpuCores: 8, performanceCores: 4, gpuCores: 7, tier, tierFrom: "memory" });
afterEach(() => {
	resetBudgetForTests();
	rememberHardware(null);
});

/** A cache of fake entries, least recently used first (Map order), as every real member keeps them. */
function fakeCache(name: CacheName) {
	const lru = new LruBytes<string, number>();
	const member = { name, used: () => lru.bytes, shrink: (limit: number) => lru.shrinkTo(limit) };
	joinBudget(member);
	return {
		lru,
		put(key: string, bytes: number) {
			lru.set(key, bytes, bytes);
			noteUse(member);
		},
	};
}

describe("the memory budget", () => {
	test("an 8 GB Mac gets the small column, 16 GB today's", () => {
		rememberHardware(machine("base"));
		expect(budgetLimit("thumbnails")).toBe(32 << 20);
		expect(budgetLimit("video.decoders")).toBe(3);
		rememberHardware(machine("standard"));
		expect(budgetLimit("thumbnails")).toBe(64 << 20);
		expect(budgetLimit("video.decoders")).toBe(6);
	});

	test("a cache never holds more than its limit; the least recently used go first", () => {
		rememberHardware(machine("base"));
		const c = fakeCache("waveforms");
		for (let i = 0; i < 40; i++) c.put(`s${i}`, 1 << 20);
		expect(c.lru.bytes).toBeLessThanOrEqual(16 << 20);
		expect(c.lru.has("s0")).toBe(false);
		expect(c.lru.has("s39")).toBe(true);
		// a hit moves an entry to the young end: it outlives the ones not used since
		c.lru.get("s30");
		for (let i = 40; i < 50; i++) c.put(`s${i}`, 1 << 20);
		expect(c.lru.has("s30")).toBe(true);
		expect(c.lru.has("s31")).toBe(false);
		expect(budgetTable().find((r) => r.name === "waveforms")?.peak).toBeLessThanOrEqual(16 << 20);
	});

	test("memory pressure drops every cache to its floor at once and caps it until «normal»", () => {
		rememberHardware(machine("standard"));
		const c = fakeCache("audio.decoded");
		for (let i = 0; i < 100; i++) c.put(`a${i}`, 4 << 20);
		expect(c.lru.bytes).toBe(400 << 20);
		// the shell's «warning»: listeners of the level first, then every registered drop (memory-pressure.ts)
		setBudgetSignal("warning");
		relieveMemory();
		expect(c.lru.bytes).toBe(BUDGETS["audio.decoded"].floor);
		for (let i = 0; i < 100; i++) c.put(`b${i}`, 4 << 20);
		expect(c.lru.bytes).toBeLessThanOrEqual(128 << 20);
		setBudgetSignal("normal");
		for (let i = 0; i < 100; i++) c.put(`c${i}`, 4 << 20);
		expect(c.lru.bytes).toBe(512 << 20);
		expect(c.lru.has("c0") && c.lru.has("c99")).toBe(true);
	});

	test("critical holds the floor; background halves; foreground lifts it", () => {
		rememberHardware(machine("base"));
		const t = fakeCache("thumbnails");
		for (let i = 0; i < 32; i++) t.put(`f${i}`, 1 << 20);
		setBudgetSignal("background");
		expect(t.lru.bytes).toBeLessThanOrEqual(16 << 20);
		setBudgetSignal("foreground");
		setBudgetSignal("critical");
		relieveMemory();
		t.put("x", 1 << 20);
		expect(t.lru.bytes).toBe(0);
		expect(budgetLimit("video.decoders")).toBe(BUDGETS["video.decoders"].floor);
	});

	test("an 8 GB answer that comes late shrinks what a «standard» start filled", () => {
		const t = fakeCache("thumbnails");
		for (let i = 0; i < 60; i++) t.put(`f${i}`, 1 << 20);
		expect(t.lru.bytes).toBe(60 << 20);
		rememberHardware(machine("base"));
		expect(t.lru.bytes).toBeLessThanOrEqual(32 << 20);
	});
});
