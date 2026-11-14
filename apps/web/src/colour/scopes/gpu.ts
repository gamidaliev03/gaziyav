// The few WebGPU calls the scopes use (the project has no WebGPU typings), with the constants of the spec.
export interface GpuBuffer {
	destroy(): void;
	mapAsync(mode: number): Promise<void>;
	getMappedRange(): ArrayBuffer;
	unmap(): void;
}
export interface GpuTexture {
	createView(): object;
	destroy(): void;
}
export interface GpuBindGroupLayout {
	readonly __layout?: never;
}
export interface GpuPipeline {
	getBindGroupLayout(index: number): GpuBindGroupLayout;
}
export interface GpuComputePass {
	setPipeline(pipeline: GpuPipeline): void;
	setBindGroup(index: number, group: object): void;
	dispatchWorkgroups(x: number, y?: number): void;
	end(): void;
}
export interface GpuRenderPass {
	setPipeline(pipeline: GpuPipeline): void;
	setBindGroup(index: number, group: object): void;
	setViewport(x: number, y: number, width: number, height: number, minDepth: number, maxDepth: number): void;
	setScissorRect(x: number, y: number, width: number, height: number): void;
	draw(vertexCount: number): void;
	end(): void;
}
export interface GpuEncoder {
	clearBuffer(buffer: GpuBuffer, offset?: number, size?: number): void;
	beginComputePass(): GpuComputePass;
	beginRenderPass(descriptor: object): GpuRenderPass;
	copyBufferToBuffer(source: GpuBuffer, sourceOffset: number, destination: GpuBuffer, destinationOffset: number, size: number): void;
	finish(): object;
}
export interface GpuQueue {
	submit(buffers: object[]): void;
	writeBuffer(buffer: GpuBuffer, offset: number, data: ArrayBufferView | ArrayBuffer): void;
	copyExternalImageToTexture(source: { source: CanvasImageSource }, destination: { texture: GpuTexture }, size: [number, number]): void;
	onSubmittedWorkDone(): Promise<void>;
}
export interface GpuDevice {
	queue: GpuQueue;
	lost: Promise<unknown>;
	createShaderModule(descriptor: { code: string }): object;
	createBuffer(descriptor: { size: number; usage: number }): GpuBuffer;
	createTexture(descriptor: { size: [number, number]; format: string; usage: number }): GpuTexture;
	createBindGroup(descriptor: { layout: GpuBindGroupLayout; entries: Array<{ binding: number; resource: object }> }): object;
	createComputePipelineAsync(descriptor: object): Promise<GpuPipeline>;
	createRenderPipelineAsync(descriptor: object): Promise<GpuPipeline>;
	createCommandEncoder(): GpuEncoder;
	pushErrorScope(filter: "validation" | "out-of-memory" | "internal"): void;
	popErrorScope(): Promise<{ message: string } | null>;
}
export interface GpuCanvasContext {
	configure(configuration: { device: GpuDevice; format: string; alphaMode?: "opaque" | "premultiplied" }): void;
	unconfigure(): void;
	getCurrentTexture(): GpuTexture;
}

export const BUFFER_USAGE = { MAP_READ: 0x1, COPY_SRC: 0x4, COPY_DST: 0x8, UNIFORM: 0x40, STORAGE: 0x80 } as const;
export const TEXTURE_USAGE = { COPY_SRC: 0x1, COPY_DST: 0x2, TEXTURE_BINDING: 0x4, RENDER_ATTACHMENT: 0x10 } as const;
export const MAP_MODE_READ = 0x1;

/** The canvas format the screen wants (bgra8unorm on a Mac). */
export function preferredCanvasFormat(): string {
	const gpu = (navigator as unknown as { gpu?: { getPreferredCanvasFormat?: () => string } }).gpu;
	return gpu?.getPreferredCanvasFormat?.() ?? "bgra8unorm";
}
