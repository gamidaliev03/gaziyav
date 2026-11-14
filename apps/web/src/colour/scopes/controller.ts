// Feeds the strip: takes each frame the player draws (services/renderer/canvas-renderer.ts onCompositorFrame), and
// once per animation frame measures the newest one and draws the scopes. With the strip closed nothing here runs and
// nothing is listening.
import { EditorCore } from "@/core";
import { onCompositorFrame, requestCompositorRedraw, type CompositorFrame } from "@/services/renderer/canvas-renderer";
import { engineGpuDevice } from "@/services/renderer/compositor/pipeline-warmup";
import { CPU_SAMPLE, drawScope } from "./cpu";
import { type ScopeCell, ScopeEngine } from "./engine";
import type { GpuDevice } from "./gpu";
import { measureFrame, readout, type ScopeBins, WAVE_COLS } from "./math";
import { useScopes } from "./store";

/** The numbers under the histogram are read back this often at most (4 KB; never per frame). */
const READOUT_EVERY_MS = 250;
/** The CPU path measures this often at most. */
const CPU_EVERY_MS = 125;

class ScopesController {
	private gpuCanvas: HTMLCanvasElement | null = null;
	private cpuCanvas: HTMLCanvasElement | null = null;
	private cells: ScopeCell[] = [];
	private engine: ScopeEngine | null = null;
	private engineDevice: GpuDevice | null = null;
	private starting = false;
	private untap: (() => void) | null = null;
	private raf = 0;
	private redraw = false;
	private lastReadout = 0;
	// the CPU path's copy of the frame, and when it was last measured
	private sample: HTMLCanvasElement | null = null;
	private samplePending = false;
	private lastCpu = 0;
	private cpuBins: ScopeBins | null = null;
	/** Time spent in the player's own task per frame (the tap), for the speed test. */
	readonly tapStats = { frames: 0, ms: 0, worstMs: 0 };

	/** The strip mounted its canvases (GPU and CPU, stacked) or took them away (null). */
	mount(gpuCanvas: HTMLCanvasElement | null, cpuCanvas: HTMLCanvasElement | null): void {
		this.gpuCanvas = gpuCanvas;
		this.cpuCanvas = cpuCanvas;
		if (!gpuCanvas) {
			this.stop();
			return;
		}
		this.untap ??= onCompositorFrame(this.tap);
		this.ensureEngine();
		// the frame on screen has not been seen: ask the player for it
		requestCompositorRedraw();
	}

	/** Where each scope is on the canvas, in device pixels (the strip measures its layout). */
	layout(cells: ScopeCell[]): void {
		this.cells = cells;
		this.redraw = true;
		this.schedule();
	}

	/** A setting that changes the drawing only. */
	restyle(): void {
		if (this.engine) this.engine.tinted = useScopes.getState().tinted;
		this.redraw = true;
		this.schedule();
	}

	private stop(): void {
		this.untap?.();
		this.untap = null;
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = 0;
		this.engine?.destroy();
		this.engine = null;
		this.engineDevice = null;
		this.sample = null;
		this.cpuBins = null;
		this.cells = [];
		useScopes.setState({ mode: "starting", readout: null });
	}

	private ensureEngine(): void {
		if (this.engine?.dead) {
			// it failed (that device is not tried again) or its device was lost (the compositor starts a new one)
			this.failedDevice = this.engineDevice;
			this.engine.destroy();
			this.engine = null;
			this.engineDevice = null;
		}
		const device = engineGpuDevice() as GpuDevice | null;
		if (this.engine && this.engineDevice === device) return;
		if (this.starting) return;
		if (this.engine) {
			this.engine.destroy();
			this.engine = null;
			this.engineDevice = null;
		}
		if (!device || this.failedDevice === device) {
			if (useScopes.getState().mode !== "cpu") useScopes.setState({ mode: "cpu" });
			return;
		}
		this.starting = true;
		void ScopeEngine.create(device).then((engine) => {
			this.starting = false;
			if (!this.gpuCanvas) {
				engine?.destroy();
				return;
			}
			if (!engine) {
				this.failedDevice = device;
				useScopes.setState({ mode: "cpu" });
				requestCompositorRedraw();
				return;
			}
			this.engine = engine;
			this.engineDevice = device;
			engine.tinted = useScopes.getState().tinted;
			engine.attach(this.gpuCanvas);
			useScopes.setState({ mode: "gpu" });
			requestCompositorRedraw();
		});
	}
	/** A device whose scope programs did not build: not tried again. */
	private failedDevice: GpuDevice | null = null;

	private tap = (frame: CompositorFrame): void => {
		// an export draws its frames into the same canvas: they are not the player's, and the export is not slowed
		if (frame.exporting || !this.gpuCanvas) return;
		const started = performance.now();
		const still = !EditorCore.getInstance().playback.getIsPlaying();
		this.ensureEngine();
		if (this.engine && !this.engine.dead) {
			this.engine.frame(frame.canvas, frame.width, frame.height, still);
		} else if (!this.starting) {
			// the CPU path: a small copy now (the frame is gone after this task), measured later
			const now = performance.now();
			if (still || now - this.lastCpu >= CPU_EVERY_MS) {
				this.sample ??= document.createElement("canvas");
				this.sample.width = CPU_SAMPLE.width;
				this.sample.height = CPU_SAMPLE.height;
				const ctx = this.sample.getContext("2d", { willReadFrequently: true });
				if (ctx) {
					ctx.imageSmoothingEnabled = false;
					ctx.drawImage(frame.canvas, 0, 0, CPU_SAMPLE.width, CPU_SAMPLE.height);
					this.samplePending = true;
					this.lastCpu = now;
				}
			}
		}
		if (this.capture) {
			// a test asked for the very pixels of this frame (compare below)
			const resolve = this.capture;
			this.capture = null;
			const copy = document.createElement("canvas");
			copy.width = frame.width;
			copy.height = frame.height;
			const ctx = copy.getContext("2d", { willReadFrequently: true });
			ctx?.drawImage(frame.canvas, 0, 0);
			resolve(ctx ? ctx.getImageData(0, 0, frame.width, frame.height) : null);
			return;
		}
		const spent = performance.now() - started;
		this.tapStats.frames++;
		this.tapStats.ms += spent;
		if (spent > this.tapStats.worstMs) this.tapStats.worstMs = spent;
		this.schedule();
	};

	private schedule(): void {
		if (!this.raf && this.gpuCanvas) this.raf = requestAnimationFrame(this.flush);
	}

	private columns(): number {
		const wave = this.cells.find((c) => c.kind === "waveform");
		const parade = this.cells.find((c) => c.kind === "parade");
		// one column per device pixel of the widest waveform (a parade's third counts as one)
		const width = Math.max(wave?.width ?? 0, parade ? parade.width / 3 : 0);
		return Math.max(64, Math.min(WAVE_COLS, Math.round(width) || WAVE_COLS));
	}

	private flush = (): void => {
		this.raf = 0;
		if (!this.gpuCanvas) return;
		const redraw = this.redraw;
		this.redraw = false;
		const engine = this.engine && !this.engine.dead ? this.engine : null;
		if (engine) {
			const measured = engine.pending;
			if (this.gpuCanvas.width > 0 && this.gpuCanvas.height > 0) engine.flush(this.cells, { columns: this.columns(), redraw });
			if (measured && useScopes.getState().shown.histogram && performance.now() - this.lastReadout >= READOUT_EVERY_MS) {
				this.lastReadout = performance.now();
				void engine.readHistogram().then((bins) => {
					if (bins && this.gpuCanvas) useScopes.setState({ readout: readout(bins) });
				});
			}
			return;
		}
		if (this.samplePending && this.sample) {
			this.samplePending = false;
			const ctx = this.sample.getContext("2d", { willReadFrequently: true });
			if (ctx) {
				const pixels = ctx.getImageData(0, 0, CPU_SAMPLE.width, CPU_SAMPLE.height).data;
				this.cpuBins = measureFrame({ pixels, width: CPU_SAMPLE.width, height: CPU_SAMPLE.height, columns: Math.min(this.columns(), CPU_SAMPLE.width) });
				useScopes.setState({ readout: readout(this.cpuBins) });
				this.drawCpu();
				return;
			}
		}
		if (redraw) this.drawCpu();
	};

	private drawCpu(): void {
		const canvas = this.cpuCanvas;
		const bins = this.cpuBins;
		if (!canvas || !bins || canvas.width < 2 || canvas.height < 2) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.fillStyle = "#09090a";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		// half the device pixels each way: the CPU path's samples are coarse anyway
		for (const cell of this.cells) {
			const w = Math.max(2, Math.round(cell.width / 2));
			const h = Math.max(2, Math.round(cell.height / 2));
			const pixels = drawScope({ kind: cell.kind, bins, width: w, height: h, tinted: useScopes.getState().tinted });
			const image = new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, w, h);
			const scratch = new OffscreenCanvas(w, h);
			scratch.getContext("2d")?.putImageData(image, 0, 0);
			ctx.drawImage(scratch, cell.x, cell.y, cell.width, cell.height);
		}
	}

	private capture: ((pixels: ImageData | null) => void) | null = null;

	/**
	 * The proof of the GPU path (tests only, paused): the tables the GPU filled from the frame on screen against
	 * math.ts measureFrame run on the same pixels with the same sampling.
	 */
	private async compare() {
		const engine = this.engine;
		if (!engine || engine.dead) return { error: "the GPU path is not running" };
		const pixels = await new Promise<ImageData | null>((resolve) => {
			this.capture = resolve;
			requestCompositorRedraw();
		});
		if (!pixels) return { error: "the frame could not be read" };
		await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
		const gpu = await engine.readBins();
		if (!gpu) return { error: "the tables could not be read" };
		const reference = measureFrame({ pixels: pixels.data, width: pixels.width, height: pixels.height, columns: gpu.columns, stepX: gpu.step, stepY: gpu.step });
		let different = 0;
		let moved = 0;
		let total = 0;
		for (let i = 0; i < reference.counts.length; i++) {
			const d = Math.abs(reference.counts[i] - gpu.counts[i]);
			if (d) different++;
			moved += d;
			total += reference.counts[i];
		}
		return { width: pixels.width, height: pixels.height, step: gpu.step, columns: gpu.columns, samples: gpu.samples, referenceSamples: reference.samples, bins: reference.counts.length, different, movedShare: moved / Math.max(1, total) };
	}

	/**
	 * For the tests (the strip open, the film paused): the mean R, G, B (0…255) of parts of the very frame the player
	 * shows, each part given as fractions of the frame [left, top, right, bottom], and the largest step from that mean.
	 */
	private async patches(rects: Array<[number, number, number, number]>) {
		const pixels = await new Promise<ImageData | null>((resolve) => {
			this.capture = resolve;
			requestCompositorRedraw();
		});
		if (!pixels) return null;
		const { data, width, height } = pixels;
		return rects.map(([left, top, right, bottom]) => {
			const x0 = Math.max(0, Math.round(left * width));
			const x1 = Math.min(width, Math.round(right * width));
			const y0 = Math.max(0, Math.round(top * height));
			const y1 = Math.min(height, Math.round(bottom * height));
			const sum = [0, 0, 0];
			let n = 0;
			for (let y = y0; y < y1; y++) {
				for (let x = x0; x < x1; x++) {
					const i = (y * width + x) * 4;
					sum[0] += data[i];
					sum[1] += data[i + 1];
					sum[2] += data[i + 2];
					n++;
				}
			}
			const mean = sum.map((v) => v / Math.max(1, n));
			let spread = 0;
			for (let y = y0; y < y1; y += 3) {
				for (let x = x0; x < x1; x += 3) {
					const i = (y * width + x) * 4;
					spread = Math.max(spread, Math.abs(data[i] - mean[0]), Math.abs(data[i + 1] - mean[1]), Math.abs(data[i + 2] - mean[2]));
				}
			}
			return { rgb: mean, spread, pixels: n };
		});
	}

	/** For the tests: what is running and what it measured. */
	debug() {
		return {
			mode: useScopes.getState().mode,
			engine: this.engine ? { ...this.engine.stats, dead: this.engine.dead } : null,
			tap: { ...this.tapStats },
			cells: this.cells,
			readBins: async () => {
				const bins = this.engine && !this.engine.dead ? await this.engine.readBins() : this.cpuBins;
				return bins ? { counts: bins.counts, columns: bins.columns, samples: bins.samples, perColumn: bins.perColumn } : null;
			},
			compare: () => this.compare(),
			patches: (rects: Array<[number, number, number, number]>) => this.patches(rects),
			forceCpu: () => {
				this.failedDevice = this.engineDevice ?? (engineGpuDevice() as GpuDevice | null);
				this.engine?.destroy();
				this.engine = null;
				useScopes.setState({ mode: "cpu" });
				requestCompositorRedraw();
			},
		};
	}
}

export const scopesController = new ScopesController();
if (typeof window !== "undefined") {
	(window as unknown as { __colourScopes: () => ReturnType<ScopesController["debug"]> }).__colourScopes = () => scopesController.debug();
}
