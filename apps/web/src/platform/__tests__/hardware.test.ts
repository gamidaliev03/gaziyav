import { afterEach, describe, expect, test } from "bun:test";
import { hardware, parseTier, tierForMemory } from "../hardware";

const saved = process.env.STUDIO_HW_TIER;
afterEach(() => {
	if (saved === undefined) delete process.env.STUDIO_HW_TIER;
	else process.env.STUDIO_HW_TIER = saved;
});

describe("platform/hardware", () => {
	test("the tier from memory: 8 GB base; 16, 18, 24 GB standard; 32 GB and more pro", () => {
		expect([8, 16, 18, 24, 32, 36, 64, 128].map(tierForMemory)).toEqual(["base", "standard", "standard", "standard", "pro", "pro", "pro", "pro"]);
	});

	test("STUDIO_HW_TIER names a tier in any case; anything else is no tier", () => {
		expect(parseTier("BASE")).toBe("base");
		expect(parseTier(" pro ")).toBe("pro");
		expect(parseTier("max")).toBeNull();
		expect(parseTier(undefined)).toBeNull();
	});

	test("this machine: its chip, memory and cores; STUDIO_HW_TIER sets the tier, the rest stays", () => {
		delete process.env.STUDIO_HW_TIER;
		const real = hardware();
		expect(real.memoryGB).toBeGreaterThan(0);
		expect(real.cpuCores).toBeGreaterThan(0);
		expect(real.chip.length).toBeGreaterThan(0);
		expect(real.tierFrom).toBe("memory");
		expect(real.tier).toBe(tierForMemory(real.memoryGB));
		process.env.STUDIO_HW_TIER = "base";
		const base = hardware();
		expect({ tier: base.tier, tierFrom: base.tierFrom, memoryGB: base.memoryGB, chip: base.chip }).toEqual({ tier: "base", tierFrom: "override", memoryGB: real.memoryGB, chip: real.chip });
	});
});
