import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// The presets import the wasm bindings (ticks): loaded after the shim.
let P: typeof import("@/animation/presets");
let T = 0;
beforeAll(async () => {
	await installOpenCutWasm();
	P = await import("@/animation/presets");
	T = (await import("@/wasm")).TICKS_PER_SECOND;
});

const frameAt = (params: Record<string, unknown>, seconds: number) =>
	P.resolveTextAnimFrame({
		params: { "anim.inDuration": 0.5, "anim.outDuration": 0.4, ...params },
		duration: 2 * T,
		localTime: Math.round(seconds * T),
		canvasWidth: 1080,
		canvasHeight: 1920,
	});

describe("trend text animations", () => {
	const IN = ["slam", "punch", "smoothRise", "spin", "swing", "neon"];
	const OUT = ["smoothRise", "spin", "neon"];

	test("are listed in the inspector", () => {
		for (const kind of IN) expect(P.TEXT_ANIM_IN.some((k) => k.value === kind)).toBe(true);
		for (const kind of OUT) expect(P.TEXT_ANIM_OUT.some((k) => k.value === kind)).toBe(true);
	});

	test("entrances move on the first frame, land on the element's own state, and repeat exactly", () => {
		for (const kind of IN) {
			const first = frameAt({ "anim.in": kind }, 0);
			expect(first).not.toEqual(P.IDENTITY_ANIM_FRAME);
			expect(frameAt({ "anim.in": kind }, 0.6)).toEqual(P.IDENTITY_ANIM_FRAME);
			for (const s of [0.1, 0.23, 0.37]) expect(frameAt({ "anim.in": kind }, s)).toEqual(frameAt({ "anim.in": kind }, s));
		}
	});

	test("slam overshoots small on landing, spin overshoots big", () => {
		expect(frameAt({ "anim.in": "slam" }, 0.05).scale).toBeGreaterThan(2);
		expect(frameAt({ "anim.in": "slam" }, 0.3).scale).toBeLessThan(1);
		const spinScales = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45].map((s) => frameAt({ "anim.in": "spin" }, s).scale);
		expect(Math.max(...spinScales)).toBeGreaterThan(1.02);
	});

	test("exits are gone at the clip end and untouched before they start", () => {
		for (const kind of OUT) {
			expect(frameAt({ "anim.out": kind }, 1.0)).toEqual(P.IDENTITY_ANIM_FRAME);
			expect(frameAt({ "anim.out": kind }, 1.999).opacity).toBeLessThan(0.1);
		}
	});
});
