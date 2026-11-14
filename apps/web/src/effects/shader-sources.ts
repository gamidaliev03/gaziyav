/**
 * WGSL sources for runtime shaders (effects and transitions), keyed by shader
 * id. Pure data — no wasm import — so definitions can register at module load
 * and tests never touch the GPU. The renderer registers a shader with the
 * engine the first time a frame references it (see
 * services/renderer/compositor/shader-registration.ts).
 */
const sources = new Map<string, string>();

export function defineShaderSource({ id, wgsl }: { id: string; wgsl: string }) {
	if (sources.get(id) === wgsl) return;
	sources.set(id, wgsl);
}

export function getShaderSource(id: string): string | undefined {
	return sources.get(id);
}
