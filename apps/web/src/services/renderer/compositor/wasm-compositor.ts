import {
	getCompositorCanvas,
	getLastFrameProfile,
	initCompositor,
	releaseTexture,
	renderFrame,
	resizeCompositor,
	uploadTexture,
} from "opencut-wasm";
import {
	incrementCounter,
	isRenderPerfEnabled,
	recordWasmFrameProfile,
} from "@/diagnostics/render-perf";
import { frameWithoutColdShaders } from "./pipeline-warmup";
import { ensurePassShadersRegistered } from "./shader-registration";
import type {
	ExternalTextureDescriptor,
	FrameDescriptor,
	RenderedTextureDescriptor,
	TextureUploadDescriptor,
} from "./types";

/**
 * One slot in the derived-texture cache. The OffscreenCanvas is persistent —
 * we reuse and redraw into it across frames, which is the change that takes
 * the WebGL upload path off the per-frame critical path for static content.
 */
type RenderedCacheEntry = {
	kind: "rendered";
	canvas: OffscreenCanvas;
	contentHash: string;
	width: number;
	height: number;
};

type ExternalCacheEntry = {
	kind: "external";
	source: CanvasImageSource;
	sourceKey?: number | string;
	width: number;
	height: number;
};

class WasmCompositor {
	private canvas: HTMLCanvasElement | null = null;
	private initializedSize: { width: number; height: number } | null = null;
	private cache = new Map<string, RenderedCacheEntry | ExternalCacheEntry>();

	ensureInitialized({ width, height }: { width: number; height: number }) {
		if (!this.canvas) {
			initCompositor(width, height);
			this.canvas = getCompositorCanvas();
			this.initializedSize = { width, height };
			return;
		}

		if (
			!this.initializedSize ||
			this.initializedSize.width !== width ||
			this.initializedSize.height !== height
		) {
			resizeCompositor(width, height);
			this.initializedSize = { width, height };
		}
	}

	getCanvas(): HTMLCanvasElement {
		if (!this.canvas) {
			throw new Error("Compositor is not initialized");
		}
		return this.canvas;
	}

	syncTextures(textures: TextureUploadDescriptor[]) {
		const nextIds = new Set(textures.map((texture) => texture.id));
		for (const previousId of this.cache.keys()) {
			if (!nextIds.has(previousId)) {
				releaseTexture(previousId);
				this.cache.delete(previousId);
			}
		}

		for (const texture of textures) {
			if (texture.kind === "external") {
				this.syncExternalTexture(texture);
			} else {
				this.syncRenderedTexture(texture);
			}
		}
	}

	/** True when the last frame left out a pass whose shader was still compiling (the player draws it again). */
	lastFrameIncomplete = false;

	/** `complete`: draw every pass even if the GPU must compile it first (export); else cold ones wait (preview). */
	render(input: FrameDescriptor, { complete = true }: { complete?: boolean } = {}) {
		const gated = complete ? { frame: input, incomplete: false } : frameWithoutColdShaders(input);
		this.lastFrameIncomplete = gated.incomplete;
		const frame = gated.frame;
		registerItemShaders(frame.items);
		renderFrame(frame);
		renderStats.frames += 1;
		if (isRenderPerfEnabled()) {
			recordWasmFrameProfile(
				getLastFrameProfile() as Array<{ name: string; durationMs: number }>,
			);
		}
	}

	private syncExternalTexture(texture: ExternalTextureDescriptor) {
		const previous = this.cache.get(texture.id);
		if (
			previous?.kind === "external" &&
			previous.source === texture.source &&
			previous.sourceKey === texture.sourceKey &&
			previous.width === texture.width &&
			previous.height === texture.height
		) {
			incrementCounter({ name: "textureCacheHit" });
			return;
		}

		incrementCounter({ name: "textureUpload" });
		incrementCounter({
			name: "textureUploadPixels",
			by: texture.width * texture.height,
		});
		uploadExternalTexture(texture);
		this.cache.set(texture.id, {
			kind: "external",
			source: texture.source,
			sourceKey: texture.sourceKey,
			width: texture.width,
			height: texture.height,
		});
	}

	private syncRenderedTexture(texture: RenderedTextureDescriptor) {
		const previous = this.cache.get(texture.id);
		if (
			previous?.kind === "rendered" &&
			previous.contentHash === texture.contentHash &&
			previous.width === texture.width &&
			previous.height === texture.height
		) {
			incrementCounter({ name: "textureCacheHit" });
			return;
		}

		const canvas =
			previous?.kind === "rendered" &&
			previous.width === texture.width &&
			previous.height === texture.height
				? previous.canvas
				: createBackingCanvas({
						width: texture.width,
						height: texture.height,
					});

		const ctx = canvas.getContext("2d");
		if (!ctx) {
			throw new Error(`Failed to get 2d context for texture ${texture.id}`);
		}
		ctx.clearRect(0, 0, texture.width, texture.height);
		texture.draw(ctx);

		incrementCounter({ name: "textureUpload" });
		incrementCounter({
			name: "textureUploadPixels",
			by: texture.width * texture.height,
		});
		uploadTexture({
			id: texture.id,
			source: canvas,
			width: texture.width,
			height: texture.height,
		});
		this.cache.set(texture.id, {
			kind: "rendered",
			canvas,
			contentHash: texture.contentHash,
			width: texture.width,
			height: texture.height,
		});
	}
}

function registerItemShaders(items: FrameDescriptor["items"]) {
	for (const item of items) {
		ensurePassShadersRegistered(item.effectPassGroups);
		if (item.type === "layer" && item.afterMaskPassGroups) ensurePassShadersRegistered(item.afterMaskPassGroups);
		if (item.type === "transition") {
			if (item.from) ensurePassShadersRegistered(item.from.effectPassGroups);
			if (item.to) ensurePassShadersRegistered(item.to.effectPassGroups);
		}
		if (item.type === "sceneTransition") {
			registerItemShaders(item.from);
			registerItemShaders(item.to);
		}
	}
}

export const wasmCompositor = new WasmCompositor();

/** Frames composited so far (read by the app's self-tests to measure fps). */
const renderStats = { frames: 0 };
if (typeof window !== "undefined") {
	(window as unknown as { __studioRenderStats: typeof renderStats }).__studioRenderStats = renderStats;
}

/**
 * Canvas sources (decoded video frames) go to the GPU directly; the wasm side
 * copies them into a reused texture. Older wasm builds / the WebGL backend only
 * take an OffscreenCanvas: then we fall back to copying into one (once detected).
 */
let directCanvasUploadUnsupported = false;

function uploadExternalTexture(texture: ExternalTextureDescriptor) {
	const isCanvas =
		(typeof HTMLCanvasElement !== "undefined" &&
			texture.source instanceof HTMLCanvasElement) ||
		(typeof OffscreenCanvas !== "undefined" &&
			texture.source instanceof OffscreenCanvas);
	if (isCanvas && !directCanvasUploadUnsupported) {
		try {
			uploadTexture({
				id: texture.id,
				source: texture.source,
				width: texture.width,
				height: texture.height,
			});
			return;
		} catch (error) {
			if (texture.source instanceof OffscreenCanvas) throw error;
			directCanvasUploadUnsupported = true;
		}
	}
	uploadTexture({
		id: texture.id,
		source: ensureOffscreenCanvas({
			source: texture.source,
			width: texture.width,
			height: texture.height,
			label: `texture upload ${texture.id}`,
		}),
		width: texture.width,
		height: texture.height,
	});
}

function createBackingCanvas({
	width,
	height,
}: {
	width: number;
	height: number;
}): OffscreenCanvas {
	if (typeof OffscreenCanvas === "undefined") {
		throw new Error("OffscreenCanvas is not supported in this environment");
	}
	return new OffscreenCanvas(width, height);
}

function ensureOffscreenCanvas({
	source,
	width,
	height,
	label,
}: {
	source: CanvasImageSource;
	width: number;
	height: number;
	label: string;
}): OffscreenCanvas {
	if (source instanceof OffscreenCanvas) {
		return source;
	}

	if (typeof OffscreenCanvas === "undefined") {
		throw new Error(`OffscreenCanvas is required for ${label}`);
	}

	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error(`Failed to get 2d context for ${label}`);
	}
	context.clearRect(0, 0, width, height);
	context.drawImage(source, 0, 0, width, height);
	return canvas;
}
