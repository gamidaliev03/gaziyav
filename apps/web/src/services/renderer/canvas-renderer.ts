import type { FrameRate } from "opencut-wasm";
import type { AnyBaseNode } from "./nodes/base-node";
import { buildFrameDescriptor } from "./compositor/frame-descriptor";
import { wasmCompositor } from "./compositor/wasm-compositor";
import { VideoCache, videoCache as sharedVideoCache } from "@/services/video-cache/service";
import { type FrameBudget, resolveRenderTree } from "./resolve";
import {
	measureSpanAsync,
	measureSpanSync,
	onRenderPerfFrameComplete,
} from "@/diagnostics/render-perf";

export type CanvasRendererParams = {
	width: number;
	height: number;
	fps: FrameRate;
	/** Decoder cache; the exporter passes its own so preview seeks can't disturb it. */
	videoCache?: VideoCache;
	/** Preview: decode sources no larger than this renderer's canvas. */
	capDecodeSize?: boolean;
};

/**
 * The wasm compositor (and its texture cache) is a single global. While a
 * renderer holds it exclusively (export), other renderers (the live preview)
 * skip their frames instead of overwriting textures mid-export.
 */
let exclusiveRenderer: CanvasRenderer | null = null;
/** The renderer whose frame the shared compositor canvas shows right now. */
let lastRenderer: CanvasRenderer | null = null;
const takeoverListeners = new Set<() => void>();

/**
 * Called when a renderer draws into the shared compositor canvas after another one did (an export, a
 * snapshot): the previous one shows a foreign frame and must redraw (see showsOwnFrame).
 */
export function onCompositorTakeover(listener: () => void): () => void {
	takeoverListeners.add(listener);
	return () => {
		takeoverListeners.delete(listener);
	};
}

/** A frame just drawn into the shared compositor canvas. */
export type CompositorFrame = { canvas: HTMLCanvasElement; width: number; height: number; /** Drawn by an export. */ exporting: boolean };
const frameTaps = new Set<(frame: CompositorFrame) => void>();

/**
 * Called right after every frame drawn into the compositor canvas, in the same task: a WebGPU canvas can be read only
 * until the browser presents it (the colour scopes copy it then, src/colour/scopes). A tap that throws is ignored.
 */
export function onCompositorFrame(tap: (frame: CompositorFrame) => void): () => void {
	frameTaps.add(tap);
	return () => {
		frameTaps.delete(tap);
	};
}

/** Asks whoever shows the compositor canvas to draw its frame again (a tap added while paused has seen none yet). */
export function requestCompositorRedraw(): void {
	lastRenderer = null;
	for (const listener of takeoverListeners) listener();
}

/**
 * Preview decode scale: the picture's width on screen in device pixels over the canvas width, times `headroom`
 * for zoomed-in clips, rounded up to 1/8 steps (so a resize re-decodes rarely), at most 1.
 */
export function previewDecodeScale({
	sceneWidth,
	canvasWidth,
	devicePixelRatio,
	headroom,
}: {
	sceneWidth: number;
	canvasWidth: number;
	devicePixelRatio: number;
	headroom: number;
}): number {
	if (canvasWidth <= 0 || sceneWidth <= 0) return 1;
	const onScreen = (sceneWidth * (devicePixelRatio || 1)) / canvasWidth;
	return Math.min(1, Math.ceil(onScreen * headroom * 8) / 8);
}

export class CanvasRenderer {
	width: number;
	height: number;
	fps: FrameRate;
	videoCache: VideoCache;
	private capDecodeSize: boolean;

	constructor({
		width,
		height,
		fps,
		videoCache,
		capDecodeSize = false,
	}: CanvasRendererParams) {
		this.width = width;
		this.height = height;
		this.fps = fps;
		this.videoCache = videoCache ?? sharedVideoCache;
		this.capDecodeSize = capDecodeSize;
		if (capDecodeSize) this.videoCache.setMaxDecodeSize({ width, height });
	}

	/**
	 * Preview: video frames are drawn only as sharp as the picture on screen, `scale` = its size over the
	 * canvas (≤ 1). A 4K project in a ~900 px tall panel draws and uploads a quarter of the pixels per frame;
	 * compositing, text and effects stay at canvas size. Export and snapshots use their own full-size cache.
	 * Returns true when frames on hand changed size (the caller redraws).
	 */
	setDecodeScale(scale: number): boolean {
		if (!this.capDecodeSize) return false;
		const s = Math.min(1, Math.max(0.1, scale));
		return this.videoCache.setMaxDecodeSize({
			width: Math.round(this.width * s),
			height: Math.round(this.height * s),
		});
	}

	getOutputCanvas(): HTMLCanvasElement {
		if (this.isBlocked()) {
			// Never resize the compositor under a running export.
			return wasmCompositor.getCanvas();
		}
		wasmCompositor.ensureInitialized({
			width: this.width,
			height: this.height,
		});
		return wasmCompositor.getCanvas();
	}

	/** The seeks the last frame didn't wait for (layers shown with their last frame): it is drawn again when they end. */
	lastFrameLate: Promise<void> | null = null;

	/** Take the compositor for this renderer only (until releaseExclusive). */
	acquireExclusive() {
		exclusiveRenderer = this;
	}

	releaseExclusive() {
		if (exclusiveRenderer === this) exclusiveRenderer = null;
	}

	private isBlocked() {
		return exclusiveRenderer !== null && exclusiveRenderer !== this;
	}

	/**
	 * False when another renderer (an export) drew into the shared compositor
	 * canvas after this one: the preview must redraw its own frame even though
	 * the playhead did not move.
	 */
	showsOwnFrame(): boolean {
		return lastRenderer === this;
	}

	/** Returns false when the frame was skipped (compositor held by an export). */
	async render({
		node,
		time,
		complete = false,
		scrubBudgetMs,
	}: {
		node: AnyBaseNode;
		time: number;
		/** Draw every pass even if the GPU must compile it first (a snapshot); the player's frames don't wait. */
		complete?: boolean;
		/** While the user scrubs: a video layer still seeking after this long shows its last frame (see FrameBudget). */
		scrubBudgetMs?: number;
	}): Promise<boolean> {
		if (this.isBlocked()) return false;
		const budget: FrameBudget | undefined = scrubBudgetMs && !complete ? { ms: scrubBudgetMs, late: [] } : undefined;
		this.lastFrameLate = null;
		await measureSpanAsync({
			name: "resolve",
			fn: () => resolveRenderTree({ node, renderer: this, time, budget }),
		});
		if (budget?.late.length) this.lastFrameLate = Promise.allSettled(budget.late).then(() => {});
		const { frame, textures } = await measureSpanAsync({
			name: "buildFrame",
			fn: () => buildFrameDescriptor({ node, renderer: this }),
		});
		// An export may have started while this frame was being resolved.
		if (this.isBlocked()) return false;
		wasmCompositor.ensureInitialized({
			width: this.width,
			height: this.height,
		});
		measureSpanSync({
			name: "syncTextures",
			fn: () => wasmCompositor.syncTextures(textures),
		});
		measureSpanSync({
			name: "renderFrame",
			// The export holds the compositor alone and never leaves a pass out; the player's frames don't wait for a compile.
			fn: () => wasmCompositor.render(frame, { complete: complete || exclusiveRenderer === this }),
		});
		if (frameTaps.size > 0) {
			const drawn: CompositorFrame = { canvas: wasmCompositor.getCanvas(), width: this.width, height: this.height, exporting: exclusiveRenderer === this };
			for (const tap of frameTaps) {
				try {
					tap(drawn);
				} catch {}
			}
		}
		const previousRenderer = lastRenderer;
		lastRenderer = this;
		if (previousRenderer !== this) {
			for (const listener of takeoverListeners) listener();
		}
		return true;
	}

	async renderToCanvas({
		node,
		time,
		targetCanvas,
	}: {
		node: AnyBaseNode;
		time: number;
		targetCanvas: HTMLCanvasElement;
	}) {
		// Skipped while an export holds the compositor (its canvas has export frames).
		if (!(await this.render({ node, time, complete: true }))) return;

		const ctx = targetCanvas.getContext("2d");
		if (!ctx) {
			throw new Error("Failed to get target canvas context");
		}

		measureSpanSync({
			name: "drawImage",
			fn: () =>
				ctx.drawImage(
					wasmCompositor.getCanvas(),
					0,
					0,
					targetCanvas.width,
					targetCanvas.height,
				),
		});
		onRenderPerfFrameComplete();
	}
}
