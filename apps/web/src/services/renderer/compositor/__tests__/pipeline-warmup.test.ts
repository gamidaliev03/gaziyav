import { beforeAll, expect, test } from "bun:test";
import { defineShaderSource } from "@/effects/shader-sources";
import type { EffectPass } from "@/effects/types";
import type { FrameDescriptor, LayerDescriptor } from "@/services/renderer/compositor/types";

let warmup: typeof import("@/services/renderer/compositor/pipeline-warmup");
const pending: Array<() => void> = [];

// A stand-in for the browser's WebGPU: the engine's device is captured when it is created; its async compiles
// finish when the test says so.
beforeAll(async () => {
	class FakeAdapter {
		async requestDevice() {
			return {
				createShaderModule: () => ({}),
				createBindGroupLayout: () => ({}),
				createPipelineLayout: () => ({}),
				createRenderPipelineAsync: () => new Promise<void>((resolve) => pending.push(resolve)),
				lost: new Promise(() => {}),
			};
		}
	}
	(globalThis as { GPUAdapter?: unknown }).GPUAdapter = FakeAdapter;
	warmup = await import("@/services/renderer/compositor/pipeline-warmup");
	warmup.captureGpuDevices();
	await new FakeAdapter().requestDevice();
});

const flush = async () => {
	for (const resolve of pending.splice(0)) resolve();
	await new Promise((r) => setTimeout(r, 0));
};

const pass = (shader: string, progress = 0): EffectPass => ({ shader, uniforms: { u_progress: progress } });
const layer = (textureId: string, groups: EffectPass[][] = []): LayerDescriptor => ({
	textureId,
	transform: { centerX: 0, centerY: 0, width: 1, height: 1, rotationDegrees: 0, flipX: false, flipY: false },
	opacity: 1,
	blendMode: "screen",
	effectPassGroups: groups,
	mask: null,
});

test("a shader is ready only after its background compile; an edited source (same length and tail) compiles again", async () => {
	defineShaderSource({ id: "t.a", wgsl: "fn effect(uv: vec2f) -> vec4f { return src(uv) * 1.0; } // tail" });
	expect(warmup.isShaderReady("t.a")).toBe(false);
	let told = 0;
	const off = warmup.onShaderReady(() => told++);
	warmup.warmShader("t.a");
	expect(warmup.isWarming()).toBe(true);
	expect(warmup.isShaderReady("t.a")).toBe(false);
	await flush();
	expect(warmup.isShaderReady("t.a")).toBe(true);
	expect(told).toBe(1);
	defineShaderSource({ id: "t.a", wgsl: "fn effect(uv: vec2f) -> vec4f { return src(uv) * 2.0; } // tail" });
	expect(warmup.isShaderReady("t.a")).toBe(false);
	off();
});

test("a cold transition is drawn as the plain cut (the clip as it is outside the transition); a cold effect is left out", async () => {
	defineShaderSource({ id: "t.tr", wgsl: "fn effect(uv: vec2f) -> vec4f { return orig(uv); }" });
	defineShaderSource({ id: "t.fx", wgsl: "fn effect(uv: vec2f) -> vec4f { return src(uv) * 0.5; }" });
	const from = layer("from", [[pass("t.fx")]]);
	const to = layer("to");
	const frame = (progress: number): FrameDescriptor => ({
		width: 10,
		height: 10,
		clear: { color: [0, 0, 0, 1] },
		items: [{ type: "transition", from, to, effectPassGroups: [[pass("t.tr", progress)]], blendMode: "normal" }],
	});
	const early = warmup.frameWithoutColdShaders(frame(0.3));
	expect(early.incomplete).toBe(true);
	// before the middle the outgoing clip, with its own blend and without its still-cold effect
	expect(early.frame.items).toEqual([{ type: "layer", ...from, effectPassGroups: [] }]);
	const late = warmup.frameWithoutColdShaders(frame(0.7));
	expect(late.frame.items).toEqual([{ type: "layer", ...to }]);
	await flush();
	const ready = warmup.frameWithoutColdShaders(frame(0.7));
	expect(ready.incomplete).toBe(false);
	expect(ready.frame).toEqual(frame(0.7));
});

test("whenShadersReady resolves once every shader is compiled", async () => {
	defineShaderSource({ id: "t.b", wgsl: "fn effect(uv: vec2f) -> vec4f { return src(uv).bgra; }" });
	let done = false;
	const waiting = warmup.whenShadersReady(["t.b", "t.a"]).then(() => {
		done = true;
	});
	await new Promise((r) => setTimeout(r, 0));
	expect(done).toBe(false);
	await flush();
	await waiting;
	expect(done).toBe(true);
});
