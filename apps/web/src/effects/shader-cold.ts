/**
 * For the cold-shader speed test only (test/transition-cold.mjs through the studio bridge): the same shader with a
 * different constant, so neither the GPU's pipeline cache nor macOS's Metal cache knows it — its first frame pays the
 * whole compile, as on a Mac that never ran it. The output is clamped at a tiny negative number: no pixel changes
 * (colours are ≥ 0), yet the generated Metal code differs, so a run compiles anew.
 */
import { defineShaderSource, getShaderSource } from "./shader-sources";

/** `source` with its colour clamped at −eps; null when its form isn't known (left as it is). */
export function perturbShaderSource(source: string, eps: string): string | null {
	const floor = `vec4<f32>(-${eps})`;
	const main = source.indexOf("fn fragment_main(");
	if (main >= 0) {
		// a full shader (the GL transitions): its entry returns FragmentOutput(color)
		const head = source.slice(0, main);
		const body = source.slice(main);
		const at = body.lastIndexOf("return FragmentOutput(");
		if (at < 0) return null;
		const end = body.indexOf(");", at);
		if (end < 0) return null;
		const value = body.slice(at + "return FragmentOutput(".length, end);
		return `${head}${body.slice(0, at)}return FragmentOutput(max(${value}, ${floor}));${body.slice(end + 2)}`;
	}
	if (!/fn effect\s*\(/.test(source)) return null;
	// an effect body: the prelude's entry calls effect(uv)
	return `${source.replace(/fn effect\s*\(/, "fn effect_cold(")}\nfn effect(uv: vec2f) -> vec4f { return max(effect_cold(uv), ${floor}); }\n`;
}

/** Each shader's own source, kept the first time it is made cold: every later call starts from it again. */
const pristine = new Map<string, string>();

/** Makes these shaders (ids) cold for the GPU; returns how many changed. `tag` makes each call's constants new. */
export function coldShaders({ ids, tag }: { ids: string[]; tag: number }): number {
	const eps = ((1 + (Math.abs(Math.round(tag)) % 999_983)) * 1e-12).toFixed(18).replace(/0+$/, "");
	let changed = 0;
	for (const id of ids) {
		const current = getShaderSource(id);
		if (current && !pristine.has(id)) pristine.set(id, current);
		const source = pristine.get(id);
		const cold = source ? perturbShaderSource(source, eps) : null;
		if (!cold) continue;
		defineShaderSource({ id, wgsl: cold });
		changed++;
	}
	return changed;
}
