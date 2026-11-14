import { getShaderSource } from "@/effects/shader-sources";
import type { EffectPass } from "@/effects/types";
import { composeShaderSource, ENGINE_FULLSCREEN_WGSL } from "./engine-wgsl";
import type { FrameDescriptor, FrameItemDescriptor, LayerDescriptor } from "./types";

/**
 * A shader the GPU has never compiled took 100–250 ms the first time a frame used it (a transition dropped on a
 * cut, an effect applied): the engine creates its pipelines synchronously and the player's canvas waited for the
 * compile — the whole page stood still. Here the same pipeline is compiled in the background first
 * (createRenderPipelineAsync on the engine's own device); until it is ready the player leaves that pass out (a plain
 * cut instead of the transition, the clip without the effect) and draws the frame again once it is. The engine's own
 * compile then finds the finished pipeline in the GPU's cache (measured: 2 ms instead of 155–200 ms). The export
 * never leaves anything out.
 */

// The few WebGPU calls used here (the project has no WebGPU typings); constants from the spec.
type GpuDevice = {
	createShaderModule(descriptor: { code: string }): object;
	createBindGroupLayout(descriptor: { entries: object[] }): object;
	createPipelineLayout(descriptor: { bindGroupLayouts: object[] }): object;
	createRenderPipelineAsync(descriptor: object): Promise<unknown>;
	lost: Promise<unknown>;
};
type GpuAdapterClass = { prototype: { requestDevice: (...args: unknown[]) => Promise<GpuDevice> } };
const FRAGMENT_STAGE = 0x2;
const COLOR_WRITE_ALL = 0xf;

const devices: GpuDevice[] = [];
let capturing = false;

/** Before the engine asks for its GPU device: keep a handle to it for the background compiles. */
export function captureGpuDevices(): void {
	const adapterClass = (globalThis as { GPUAdapter?: GpuAdapterClass }).GPUAdapter;
	if (capturing || !adapterClass) return;
	capturing = true;
	const original = adapterClass.prototype.requestDevice;
	adapterClass.prototype.requestDevice = async function requestDevice(this: unknown, ...args: unknown[]) {
		const device = await original.apply(this, args);
		devices.push(device);
		device.lost.then(() => {
			const at = devices.indexOf(device);
			if (at >= 0) devices.splice(at, 1);
		});
		return device;
	};
}

/** The compositor's own WebGPU device, or null (WebGL, or not started): the colour scopes run on it (src/colour/scopes). */
export function engineGpuDevice(): unknown {
	return devices[0] ?? null;
}

type DeviceKit = { layout: object; vertex: object };
const kits = new WeakMap<GpuDevice, DeviceKit>();

/** The engine's effect pipeline layout (rust/crates/effects/src/pipeline.rs, gpu/src/context.rs), entry for entry. */
function kitFor(device: GpuDevice): DeviceKit {
	const cached = kits.get(device);
	if (cached) return cached;
	const texture = (binding: number) => ({
		binding,
		visibility: FRAGMENT_STAGE,
		texture: { sampleType: "float", viewDimension: "2d", multisampled: false },
	});
	const layout = device.createPipelineLayout({
		bindGroupLayouts: [
			device.createBindGroupLayout({ entries: [texture(0), { binding: 1, visibility: FRAGMENT_STAGE, sampler: { type: "filtering" } }] }),
			device.createBindGroupLayout({ entries: [{ binding: 0, visibility: FRAGMENT_STAGE, buffer: { type: "uniform", hasDynamicOffset: false } }] }),
			device.createBindGroupLayout({ entries: [texture(0), texture(1), texture(2)] }),
		],
	});
	const kit = { layout, vertex: device.createShaderModule({ code: ENGINE_FULLSCREEN_WGSL }) };
	kits.set(device, kit);
	return kit;
}

function compileAsync(device: GpuDevice, code: string): Promise<unknown> {
	const { layout, vertex } = kitFor(device);
	return device.createRenderPipelineAsync({
		layout,
		vertex: {
			module: vertex,
			entryPoint: "vertex_main",
			buffers: [{ arrayStride: 8, stepMode: "vertex", attributes: [{ format: "float32x2", offset: 0, shaderLocation: 0 }] }],
		},
		fragment: {
			module: device.createShaderModule({ code }),
			entryPoint: "fragment_main",
			targets: [{ format: "bgra8unorm", writeMask: COLOR_WRITE_ALL }],
		},
		primitive: { topology: "triangle-list" },
		multisample: { count: 1 },
	});
}

/** Per shader id: the source that was compiled (or is compiling) — an edited source is a new compile. */
const states = new Map<string, { source: string; state: "warming" | "ready" }>();
const readyListeners = new Set<() => void>();

/** Called when a background compile finished (the player draws the frame again with that pass). */
export function onShaderReady(listener: () => void): () => void {
	readyListeners.add(listener);
	return () => {
		readyListeners.delete(listener);
	};
}

/** True when a frame can use the shader without the GPU compiling it then (or when nothing can be compiled ahead). */
export function isShaderReady(id: string): boolean {
	if (devices.length === 0) return true;
	const source = getShaderSource(id);
	if (!source) return true; // a built-in, compiled with the engine
	const entry = states.get(id);
	return entry?.state === "ready" && entry.source === source;
}

/** True while a background compile is running (a frame drawn without it will be drawn again when it ends). */
export function isWarming(): boolean {
	for (const entry of states.values()) if (entry.state === "warming") return true;
	return false;
}

/** Starts the background compile of a shader (a tile hovered or dragged, a transition about to go on a cut). */
export function warmShader(id: string): void {
	if (devices.length === 0) return;
	const source = getShaderSource(id);
	if (!source) return;
	if (states.get(id)?.source === source) return;
	const entry = { source, state: "warming" as "warming" | "ready" };
	states.set(id, entry);
	const code = composeShaderSource(source);
	Promise.all(devices.map((device) => compileAsync(device, code)))
		// A shader that doesn't compile: the engine reports it once; its frames must not wait for it forever.
		.catch(() => {})
		.finally(() => {
			entry.state = "ready";
			for (const listener of readyListeners) listener();
		});
}

/** Resolves when every one of these shaders can be drawn without a compile (warming the ones that aren't). */
export function whenShadersReady(ids: string[]): Promise<void> {
	const pending = () => ids.some((id) => !isShaderReady(id));
	if (!pending()) return Promise.resolve();
	for (const id of ids) warmShader(id);
	return new Promise((resolve) => {
		const off = onShaderReady(() => {
			if (pending()) return;
			off();
			resolve();
		});
	});
}

const groupReady = (group: EffectPass[]) => {
	let ready = true;
	for (const pass of group) {
		if (!isShaderReady(pass.shader)) {
			warmShader(pass.shader);
			ready = false;
		}
	}
	return ready;
};

const readyGroups = (groups: EffectPass[][]) => groups.filter(groupReady);

/**
 * The frame the player can draw now: passes whose shader is still compiling are left out (warming them), a
 * transition whose shader is compiling is a plain cut (the outgoing clip before the middle, the incoming after).
 */
export function frameWithoutColdShaders(frame: FrameDescriptor): { frame: FrameDescriptor; incomplete: boolean } {
	if (devices.length === 0) return { frame, incomplete: false };
	let incomplete = false;
	const layer = (descriptor: LayerDescriptor): LayerDescriptor => {
		const groups = readyGroups(descriptor.effectPassGroups);
		const after = descriptor.afterMaskPassGroups ? readyGroups(descriptor.afterMaskPassGroups) : undefined;
		if (groups.length === descriptor.effectPassGroups.length && after?.length === descriptor.afterMaskPassGroups?.length) return descriptor;
		incomplete = true;
		return { ...descriptor, effectPassGroups: groups, ...(after ? { afterMaskPassGroups: after } : {}) };
	};
	const mapItems = (list: FrameItemDescriptor[]): FrameItemDescriptor[] => {
		const items: FrameItemDescriptor[] = [];
		for (const item of list) {
			if (item.type === "layer") {
				const { type: _type, ...descriptor } = item;
				items.push({ type: "layer", ...layer(descriptor) });
			} else if (item.type === "sceneEffect") {
				const groups = readyGroups(item.effectPassGroups);
				if (groups.length !== item.effectPassGroups.length) incomplete = true;
				if (groups.length > 0) items.push({ ...item, effectPassGroups: groups });
			} else if (item.type === "sceneTransition") {
				const from = mapItems(item.from);
				const to = mapItems(item.to);
				if (readyGroups(item.effectPassGroups).length === item.effectPassGroups.length) {
					items.push({ ...item, from, to });
					continue;
				}
				// A plain cut until the shader is ready: the composite before the middle, after it the one after.
				incomplete = true;
				const progress = Number(item.effectPassGroups[0]?.[0]?.uniforms.u_progress ?? 0);
				items.push(...(progress >= 0.5 ? to : from));
			} else {
				const from = item.from ? layer(item.from) : null;
				const to = item.to ? layer(item.to) : null;
				if (readyGroups(item.effectPassGroups).length === item.effectPassGroups.length) {
					items.push({ ...item, from, to });
					continue;
				}
				incomplete = true;
				const progress = Number(item.effectPassGroups[0]?.[0]?.uniforms.u_progress ?? 0);
				const shown = (progress >= 0.5 ? to : from) ?? from ?? to;
				if (shown) items.push({ type: "layer", ...shown });
			}
		}
		return items;
	};
	const items = mapItems(frame.items);
	return { frame: incomplete ? { ...frame, items } : frame, incomplete };
}
