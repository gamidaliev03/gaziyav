import { expect, test } from "bun:test";
import { proEffects } from "@/effects/definitions/studio/pro-effects";

type Build = (ctx: unknown) => Array<{ shader: string; uniforms: { u_params: number[] } }>;

test("the effects pack: ~90 effects (its 11 twins retired), unique types and names, each packs up to 32 finite floats from its defaults", () => {
	expect(proEffects.length).toBeGreaterThanOrEqual(60);
	expect(new Set(proEffects.map((e) => e.type)).size).toBe(proEffects.length);
	expect(new Set(proEffects.map((e) => e.name)).size).toBe(proEffects.length);
	for (const effect of proEffects) {
		const params = Object.fromEntries(effect.params.map((p) => [p.key, (p as { default: unknown }).default]));
		const build = (effect.renderer as unknown as { buildPasses: Build }).buildPasses;
		const passes = build({ effectParams: params, width: 64, height: 64, time: { time: 0.5, duration: 2, progress: 0.25, frame: 12 } });
		expect(passes.length).toBe(1);
		expect(passes[0].shader.startsWith("pro.fx.family.")).toBe(true);
		expect(passes[0].uniforms.u_params.length).toBeLessThanOrEqual(32);
		for (const v of passes[0].uniforms.u_params) expect(Number.isFinite(v)).toBe(true);
	}
});

test("a project with a retired twin still draws it, as the effect that stays", async () => {
	const { effectsRegistry, RETIRED_EFFECTS } = await import("@/effects/registry");
	const { registerDefaultEffects } = await import("@/effects/definitions");
	registerDefaultEffects();
	for (const [old, now] of Object.entries(RETIRED_EFFECTS)) {
		expect([old, effectsRegistry.has(old)]).toEqual([old, true]);
		expect(effectsRegistry.get(old).type).toBe(now);
	}
	expect(effectsRegistry.getAll().some((e) => e.type in RETIRED_EFFECTS)).toBe(false);
});

test("Tiles and Motion Blur carry the number their twins varied by: tiles per side (slot 1), the blur's angle (slot 2)", () => {
	const build = (type: string, values: Record<string, number>) => {
		const effect = proEffects.find((e) => e.type === type);
		if (!effect) throw new Error(type);
		const params = { ...Object.fromEntries(effect.params.map((p) => [p.key, (p as { default: unknown }).default])), ...values };
		return (effect.renderer as unknown as { buildPasses: Build }).buildPasses({ effectParams: params, width: 64, height: 64, time: { time: 0, duration: 2, progress: 0, frame: 0 } })[0].uniforms.u_params;
	};
	expect(build("pro.fx.tiles", {}).slice(0, 2)).toEqual([4, 2]);
	expect(build("pro.fx.tiles", { tiles: 3 }).slice(0, 2)).toEqual([4, 3]);
	expect(build("pro.fx.motionBlur", {})[2]).toBe(0);
	expect(build("pro.fx.motionBlur", { angle: 90 })[2]).toBe(90);
	for (const gone of ["pro.fx.tiles2", "pro.fx.tiles3", "pro.fx.motionBlurV", "pro.fx.leakPink", "pro.fx.kaleido8", "pro.fx.strobe"]) expect(proEffects.some((e) => e.type === gone)).toBe(false);
});
