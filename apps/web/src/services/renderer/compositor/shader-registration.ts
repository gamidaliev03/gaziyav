import { registerEffectShader } from "opencut-wasm";
import { getShaderSource } from "@/effects/shader-sources";
import type { EffectPass } from "@/effects/types";

/**
 * Registers runtime WGSL shaders with the wasm engine the first time a frame
 * (or an effect thumbnail) references them. The engine validates each shader
 * with naga; a broken shader is reported once and then skipped by the engine
 * (the frame still renders, without that pass).
 */
const registered = new Map<string, string>();
const failed = new Set<string>();

export function ensureShaderRegistered(id: string): boolean {
	const source = getShaderSource(id);
	if (!source) return false; // built-in (e.g. gaussian-blur) or unknown
	if (registered.get(id) === source) return true;
	if (failed.has(`${id}\u0000${source.length}`)) return false;
	try {
		registerEffectShader(id, source);
		registered.set(id, source);
		return true;
	} catch (error) {
		failed.add(`${id}\u0000${source.length}`);
		console.error(`Шейдер «${id}» не собрался:`, error);
		return false;
	}
}

export function ensurePassShadersRegistered(groups: EffectPass[][]): void {
	for (const group of groups) {
		for (const pass of group) {
			ensureShaderRegistered(pass.shader);
		}
	}
}
