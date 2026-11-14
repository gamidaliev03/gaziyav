import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// The cold-shader speed test changes each shader's constant (no cache knows it), not its picture: the colour is
// clamped at a tiny negative number. Both forms: an effect body, a full shader returning FragmentOutput.
let cold: typeof import("@/effects/shader-cold");
let sources: typeof import("@/effects/shader-sources");
beforeAll(async () => {
	await installOpenCutWasm();
	cold = await import("@/effects/shader-cold");
	sources = await import("@/effects/shader-sources");
});

test("an effect body is wrapped; a full shader's FragmentOutput is clamped; an unknown form is left", () => {
	const body = "fn effect(uv: vec2f) -> vec4f { return src(uv); }";
	expect(cold.perturbShaderSource(body, "0.000001")).toBe(
		"fn effect_cold(uv: vec2f) -> vec4f { return src(uv); }\nfn effect(uv: vec2f) -> vec4f { return max(effect_cold(uv), vec4<f32>(-0.000001)); }\n",
	);
	const full = "fn main_1() { }\n@fragment\nfn fragment_main(@location(0) v_uv: vec2<f32>) -> FragmentOutput {\n    let _e36 = out_color;\n    return FragmentOutput(_e36);\n}\n";
	expect(cold.perturbShaderSource(full, "0.000002")).toBe(full.replace("return FragmentOutput(_e36);", "return FragmentOutput(max(_e36, vec4<f32>(-0.000002)));"));
	expect(cold.perturbShaderSource("fn other() {}", "0.1")).toBeNull();
});

test("each call starts from the shader's own source with a new constant", async () => {
	sources.defineShaderSource({ id: "t.cold", wgsl: "fn effect(uv: vec2f) -> vec4f { return src(uv); }" });
	expect(cold.coldShaders({ ids: ["t.cold", "t.none"], tag: 1 })).toBe(1);
	const first = sources.getShaderSource("t.cold");
	cold.coldShaders({ ids: ["t.cold"], tag: 2 });
	const second = sources.getShaderSource("t.cold") ?? "";
	expect(second).not.toBe(first);
	expect(second.match(/fn effect_cold\(/g)?.length).toBe(1);
});
