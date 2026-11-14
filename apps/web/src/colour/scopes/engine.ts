// The scopes on the GPU. They run on the compositor's own WebGPU device: a WebGPU canvas can only be read by the
// device that drew it, and only until the browser presents the frame — so the frame is copied in the task that drew it
// (frame()), one GPU-to-GPU copy, and measured and drawn from that copy on the next animation frame (flush()). The
// player's task pays for one copy call; nothing is read back to the CPU.
//
// Every call sits inside an error scope of its own: a mistake here is caught here and never reaches the compositor
// that shares the device. After a failure the engine is dead and the strip falls back to the CPU path (cpu.ts).
import { BUFFER_USAGE, type GpuBuffer, type GpuCanvasContext, type GpuDevice, type GpuPipeline, type GpuTexture, MAP_MODE_READ, preferredCanvasFormat, TEXTURE_USAGE } from "./gpu";
import { BINS_LENGTH, HIST_OFFSET, LEVELS, playbackStep, type ScopeBins, WAVE_COLS } from "./math";
import { DRAW_WGSL, KIND, MEASURE_WGSL } from "./wgsl";

export type ScopeKind = keyof typeof KIND;

/** Where one scope is drawn on the strip's canvas, in device pixels. */
export interface ScopeCell {
	kind: ScopeKind;
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A still frame is measured pixel for pixel up to this many pixels (1080p); larger frames every 2nd, 3rd… pixel. */
const STILL_SAMPLES = 2_100_000;

export class ScopeEngine {
	private source: GpuTexture | null = null;
	private sourceSize = { width: 0, height: 0 };
	private measureGroup: object | null = null;
	private readonly bins: GpuBuffer;
	private readonly params: GpuBuffer;
	private readonly views = new Map<ScopeKind, { buffer: GpuBuffer; group: object }>();
	private context: GpuCanvasContext | null = null;
	private pendingMeasure = false;
	private still = false;
	/** What the tables hold now. */
	private measured = { columns: WAVE_COLS, samples: 0, perColumn: 0, step: 1 };
	private reading = false;
	dead = false;
	/** Frames copied, measured and drawn so far, and the time this engine's calls took on the main thread (tests). */
	readonly stats = { copied: 0, measured: 0, drawn: 0, copyMs: 0, flushMs: 0, errors: [] as string[] };
	tinted = true;

	private constructor(
		private readonly device: GpuDevice,
		private readonly measure: GpuPipeline,
		private readonly draw: GpuPipeline,
	) {
		this.bins = device.createBuffer({ size: BINS_LENGTH * 4, usage: BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_SRC | BUFFER_USAGE.COPY_DST });
		this.params = device.createBuffer({ size: 32, usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST });
		for (const kind of Object.keys(KIND) as ScopeKind[]) {
			const buffer = device.createBuffer({ size: 32, usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST });
			const group = device.createBindGroup({
				layout: draw.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: { buffer: this.bins } },
					{ binding: 1, resource: { buffer } },
				],
			});
			this.views.set(kind, { buffer, group });
		}
		void device.lost.then(() => {
			this.dead = true;
		});
	}

	/** Compiles the two programs in the background (never on the player's frame). Null when the device refuses them. */
	static async create(device: GpuDevice): Promise<ScopeEngine | null> {
		try {
			device.pushErrorScope("validation");
			const measure = device.createComputePipelineAsync({
				layout: "auto",
				compute: { module: device.createShaderModule({ code: MEASURE_WGSL }), entryPoint: "main" },
			});
			const drawModule = device.createShaderModule({ code: DRAW_WGSL });
			const draw = device.createRenderPipelineAsync({
				layout: "auto",
				vertex: { module: drawModule, entryPoint: "vertex_main" },
				fragment: { module: drawModule, entryPoint: "fragment_main", targets: [{ format: preferredCanvasFormat() }] },
				primitive: { topology: "triangle-list" },
			});
			const scope = device.popErrorScope();
			const [measurePipeline, drawPipeline, error] = await Promise.all([measure, draw, scope]);
			if (error) throw new Error(error.message);
			device.pushErrorScope("validation");
			const engine = new ScopeEngine(device, measurePipeline, drawPipeline);
			const made = await device.popErrorScope();
			if (made) throw new Error(made.message);
			return engine;
		} catch (error) {
			console.warn("Scopes: the graphics chip refused the scope programs, using the slower path.", error);
			return null;
		}
	}

	/** The strip's canvas (or null when it went away). */
	attach(canvas: HTMLCanvasElement | null): void {
		if (this.dead) return;
		this.guard(() => {
			this.context?.unconfigure();
			this.context = null;
			if (!canvas) return;
			const context = canvas.getContext("webgpu") as unknown as GpuCanvasContext | null;
			if (!context) throw new Error("no WebGPU context for the scopes canvas");
			context.configure({ device: this.device, format: preferredCanvasFormat(), alphaMode: "opaque" });
			this.context = context;
		});
	}

	/**
	 * The player has just drawn `canvas` (this very task): keep a copy of the frame. `still` = the film is not playing,
	 * so the frame is measured in full.
	 */
	frame(canvas: HTMLCanvasElement, width: number, height: number, still: boolean): void {
		if (this.dead || width < 2 || height < 2) return;
		const started = performance.now();
		this.guard(() => {
			if (!this.source || this.sourceSize.width !== width || this.sourceSize.height !== height) {
				this.source?.destroy();
				this.source = this.device.createTexture({
					size: [width, height],
					format: "rgba8unorm",
					usage: TEXTURE_USAGE.COPY_DST | TEXTURE_USAGE.RENDER_ATTACHMENT | TEXTURE_USAGE.TEXTURE_BINDING,
				});
				this.sourceSize = { width, height };
				this.measureGroup = this.device.createBindGroup({
					layout: this.measure.getBindGroupLayout(0),
					entries: [
						{ binding: 0, resource: this.source.createView() },
						{ binding: 1, resource: { buffer: this.bins } },
						{ binding: 2, resource: { buffer: this.params } },
					],
				});
			}
			this.device.queue.copyExternalImageToTexture({ source: canvas }, { texture: this.source }, [width, height]);
			this.pendingMeasure = true;
			this.still = still;
			this.stats.copied++;
		}, true);
		this.stats.copyMs += performance.now() - started;
	}

	/** Measures the kept frame (when there is a new one) and draws the cells. Called once per animation frame at most. */
	flush(cells: ScopeCell[], { columns, redraw = false }: { columns: number; redraw?: boolean }): void {
		if (this.dead || (!this.pendingMeasure && !redraw)) return;
		const started = performance.now();
		this.guard(() => {
			const encoder = this.device.createCommandEncoder();
			if (this.pendingMeasure && this.source && this.measureGroup) {
				const { width, height } = this.sourceSize;
				const step = this.still ? Math.max(1, Math.ceil(Math.sqrt((width * height) / STILL_SAMPLES))) : playbackStep(width, height);
				const gridX = Math.max(1, Math.floor(width / step));
				const gridY = Math.max(1, Math.floor(height / step));
				const cols = Math.max(1, Math.min(WAVE_COLS, Math.round(columns)));
				this.device.queue.writeBuffer(this.params, 0, new Uint32Array([width, height, gridX, gridY, step, step, cols, 0]));
				encoder.clearBuffer(this.bins);
				const pass = encoder.beginComputePass();
				pass.setPipeline(this.measure);
				pass.setBindGroup(0, this.measureGroup);
				pass.dispatchWorkgroups(Math.ceil(gridX / 8), Math.ceil(gridY / 8));
				pass.end();
				this.measured = { columns: cols, samples: gridX * gridY, perColumn: (gridX * gridY) / cols, step };
				this.pendingMeasure = false;
				this.stats.measured++;
			}
			if (this.context && cells.length > 0) {
				const target = this.context.getCurrentTexture();
				const pass = encoder.beginRenderPass({
					colorAttachments: [{ view: target.createView(), clearValue: { r: 0.035, g: 0.035, b: 0.04, a: 1 }, loadOp: "clear", storeOp: "store" }],
				});
				pass.setPipeline(this.draw);
				for (const cell of cells) {
					const view = this.views.get(cell.kind);
					if (!view || cell.width < 2 || cell.height < 2) continue;
					const data = new ArrayBuffer(32);
					new Float32Array(data, 0, 4).set([cell.width, cell.height, this.measured.perColumn, this.measured.samples]);
					new Uint32Array(data, 16, 4).set([KIND[cell.kind], this.measured.columns, this.tinted ? 1 : 0, 0]);
					this.device.queue.writeBuffer(view.buffer, 0, data);
					pass.setViewport(cell.x, cell.y, cell.width, cell.height, 0, 1);
					pass.setScissorRect(cell.x, cell.y, cell.width, cell.height);
					pass.setBindGroup(0, view.group);
					pass.draw(3);
				}
				pass.end();
				this.stats.drawn++;
			}
			this.device.queue.submit([encoder.finish()]);
		});
		this.stats.flushMs += performance.now() - started;
	}

	/** True when a copied frame waits to be measured. */
	get pending(): boolean {
		return this.pendingMeasure;
	}

	/** The tables as they are on the GPU now (the tests' proof; never called while the film plays). */
	async readBins(): Promise<(ScopeBins & { step: number }) | null> {
		const counts = await this.read(0, BINS_LENGTH);
		return counts ? { counts, ...this.measured } : null;
	}

	/** The histogram alone (4 KB), for the numbers shown under it. Null while another read is on its way. */
	async readHistogram(): Promise<ScopeBins | null> {
		const part = await this.read(HIST_OFFSET, 4 * LEVELS);
		if (!part) return null;
		const counts = new Uint32Array(BINS_LENGTH);
		counts.set(part, HIST_OFFSET);
		return { counts, ...this.measured };
	}

	private async read(offset: number, length: number): Promise<Uint32Array | null> {
		if (this.dead || this.reading) return null;
		this.reading = true;
		let staging: GpuBuffer | null = null;
		try {
			this.device.pushErrorScope("validation");
			staging = this.device.createBuffer({ size: length * 4, usage: BUFFER_USAGE.COPY_DST | BUFFER_USAGE.MAP_READ });
			const encoder = this.device.createCommandEncoder();
			encoder.copyBufferToBuffer(this.bins, offset * 4, staging, 0, length * 4);
			this.device.queue.submit([encoder.finish()]);
			const error = await this.device.popErrorScope();
			if (error) throw new Error(error.message);
			await staging.mapAsync(MAP_MODE_READ);
			const counts = new Uint32Array(staging.getMappedRange().slice(0));
			staging.unmap();
			return counts;
		} catch (error) {
			this.fail(error);
			return null;
		} finally {
			staging?.destroy();
			this.reading = false;
		}
	}

	destroy(): void {
		this.dead = true;
		try {
			this.context?.unconfigure();
		} catch {}
		this.context = null;
		this.source?.destroy();
		this.bins.destroy();
		this.params.destroy();
		for (const view of this.views.values()) view.buffer.destroy();
	}

	/**
	 * Runs GPU calls with their validation errors caught here (the device is the compositor's). `tolerant`: one failed
	 * call is only a missed frame (the copy of a frame the browser had already presented); thirty in a row end the engine.
	 */
	private guard(run: () => void, tolerant = false): void {
		const failed = (error: unknown) => {
			if (!tolerant) return this.fail(error);
			this.missed++;
			if (this.stats.errors.length < 5) this.stats.errors.push(`missed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300));
			if (this.missed >= 30) this.fail(error);
		};
		try {
			this.device.pushErrorScope("validation");
			try {
				run();
			} finally {
				void this.device.popErrorScope().then((error) => {
					if (error) failed(new Error(error.message));
					else if (tolerant) this.missed = 0;
				});
			}
		} catch (error) {
			failed(error);
		}
	}
	private missed = 0;

	private fail(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		if (this.stats.errors.length < 5) this.stats.errors.push(message.slice(0, 300));
		if (!this.dead) console.warn("Scopes: the GPU path stopped, using the slower path.", message);
		this.dead = true;
	}
}
