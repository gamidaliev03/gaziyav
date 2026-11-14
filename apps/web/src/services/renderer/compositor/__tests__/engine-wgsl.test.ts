import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { composeShaderSource, ENGINE_FULLSCREEN_WGSL, ENGINE_PRELUDE } from "@/services/renderer/compositor/engine-wgsl";

const rust = join(import.meta.dir, "../../../../../../../rust/crates");

test("the engine's prelude and fullscreen vertex shader copies are the Rust files byte for byte", () => {
	expect(ENGINE_PRELUDE).toBe(readFileSync(join(rust, "effects/src/shaders/prelude.wgsl"), "utf8"));
	expect(ENGINE_FULLSCREEN_WGSL).toBe(readFileSync(join(rust, "gpu/src/shaders/fullscreen.wgsl"), "utf8"));
});

test("composeShaderSource wraps a body like registry.rs and passes a full shader through", () => {
	const registry = readFileSync(join(rust, "effects/src/registry.rs"), "utf8");
	expect(registry).toContain('format!("{PRELUDE}\\n{body}\\n{EPILOGUE}")');
	expect(composeShaderSource("fn effect(uv: vec2f) -> vec4f { return src(uv); }").startsWith(ENGINE_PRELUDE)).toBe(true);
	const full = "@fragment\nfn fragment_main() -> @location(0) vec4f { return vec4f(1.0); }";
	expect(composeShaderSource(full)).toBe(full);
});
