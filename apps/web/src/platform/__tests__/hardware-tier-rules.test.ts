import { afterEach, describe, expect, test } from "bun:test";
import { rememberHardware } from "../hardware-client";
import type { Hardware, HardwareTier } from "../hardware";

const machine = (tier: HardwareTier): Hardware => ({ chip: "Apple M1", memoryGB: tier === "base" ? 8 : 16, cpuCores: 8, performanceCores: 4, gpuCores: 7, tier, tierFrom: "memory" });
afterEach(() => rememberHardware(null));

describe("an 8 GB Mac (base)", () => {
	test("edits every 4K file from a copy; a bigger Mac only 4K HEVC", async () => {
		const { needsEditingProxy } = await import("@/media/editing-proxy");
		const uhd264 = { width: 3840, height: 2160, hardwareDecode: true, transparent: false, codec: "avc" };
		rememberHardware(machine("standard"));
		expect(needsEditingProxy(uhd264)).toBe(false);
		rememberHardware(machine("base"));
		expect(needsEditingProxy(uhd264)).toBe(true);
		expect(needsEditingProxy({ ...uhd264, width: 1920, height: 1080 })).toBe(false);
	});

	test("plays at High until the user picks a quality; a bigger Mac at Full", async () => {
		const { effectiveQuality } = await import("@/preview/playback-quality");
		rememberHardware(machine("base"));
		expect(effectiveQuality({ quality: "full", chosen: false })).toBe("high");
		expect(effectiveQuality({ quality: "full", chosen: true })).toBe("full");
		rememberHardware(machine("standard"));
		expect(effectiveQuality({ quality: "full", chosen: false })).toBe("full");
	});
});
