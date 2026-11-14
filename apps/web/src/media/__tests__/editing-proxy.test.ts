import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// The settings it reads load the engine: installed first, so this file also runs alone.
let needsEditingProxy: typeof import("../editing-proxy").needsEditingProxy;
beforeAll(async () => {
	await installOpenCutWasm();
	({ needsEditingProxy } = await import("../editing-proxy"));
});

const hd = { width: 1920, height: 1080, hardwareDecode: true, transparent: false };

describe("needsEditingProxy", () => {
	test("decoded by the graphics chip (phone H.264/HEVC) → original", () => {
		expect(needsEditingProxy(hd)).toBe(false);
	});
	test("decoded in software (AV1 on M1, H.264 10-bit) → copy", () => {
		expect(needsEditingProxy({ ...hd, hardwareDecode: false })).toBe(true);
	});
	test("unknown decoder → original", () => {
		expect(needsEditingProxy({ ...hd, hardwareDecode: null })).toBe(false);
	});
	test("4K HEVC (a phone's 4K, 8 or 10 bit) → copy; 4K H.264 and 1080p HEVC → original", () => {
		const uhd = { ...hd, width: 3840, height: 2160 };
		expect(needsEditingProxy({ ...uhd, codec: "hevc" })).toBe(true);
		expect(needsEditingProxy({ ...uhd, width: 2160, height: 3840, codec: "hevc" })).toBe(true);
		expect(needsEditingProxy({ ...uhd, codec: "avc" })).toBe(false);
		expect(needsEditingProxy({ ...hd, codec: "hevc" })).toBe(false);
		expect(needsEditingProxy({ ...uhd, codec: "hevc", transparent: true })).toBe(false);
	});
	test("small or transparent clips keep the original", () => {
		expect(needsEditingProxy({ ...hd, width: 640, height: 360, hardwareDecode: false })).toBe(false);
		expect(needsEditingProxy({ ...hd, hardwareDecode: false, transparent: true })).toBe(false);
	});
});
