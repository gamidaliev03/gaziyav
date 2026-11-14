// A generator's texture for the compositor (player and export alike): sized from the PROJECT canvas and the layer's
// base scale — never from the preview's size — so the player and the export sample the very same pixels. A still
// generator is drawn once per change of its values; an animated one once per clip frame, into two canvases that
// alternate (the compositor sees a new object and re-uploads), never a canvas per frame.
import { DEFAULT_GRAPHIC_SOURCE_SIZE } from "@/graphics/types";
import type { ParamValues } from "@/params";
import type { GeneratorSpec, PixelBuffer } from "./types";

export interface GeneratorSourceCache {
	key: string | null;
	canvases: OffscreenCanvas[];
	index: number;
	image: ImageData | null;
}

/** The generator's own values (the «gen.» params): transform or opacity keyframes never redraw the picture. */
export function generatorValuesKey(params: ParamValues): string {
	const keys = Object.keys(params).filter((k) => k.startsWith("gen.")).sort();
	return keys.map((k) => `${k}=${String(params[k])}`).join("&");
}

/**
 * Texture size: the layer box's SHAPE on the canvas, its long side at the generator's `maxSide`. Only the aspect of
 * the canvas counts — the preview's canvas is smaller than the project's but has its shape — so the player and the
 */
export function generatorTextureSize({
	spec,
	canvasSize,
	scaleX,
	scaleY,
}: {
	spec: GeneratorSpec;
	canvasSize?: { width: number; height: number };
	scaleX: number;
	scaleY: number;
}): { width: number; height: number } {
	if (spec.resolution <= 0) return { width: spec.maxSide, height: spec.maxSide };
	const canvas = canvasSize ?? { width: 1920, height: 1080 };
	const contain = Math.min(canvas.width / DEFAULT_GRAPHIC_SOURCE_SIZE, canvas.height / DEFAULT_GRAPHIC_SOURCE_SIZE);
	const w = Math.abs(DEFAULT_GRAPHIC_SOURCE_SIZE * contain * (scaleX || 1));
	const h = Math.abs(DEFAULT_GRAPHIC_SOURCE_SIZE * contain * (scaleY || 1));
	const long = Math.max(w, h, 1);
	// 8-px steps: a slightly different scale does not reallocate
	const step = (v: number) => Math.max(8, Math.round(v / 8) * 8);
	return { width: step((w * spec.maxSide) / long), height: step((h * spec.maxSide) / long) };
}

export function drawGeneratorSource({
	spec,
	params,
	canvasSize,
	scaleX,
	scaleY,
	frame,
	fps,
	cache,
}: {
	spec: GeneratorSpec;
	params: ParamValues;
	canvasSize?: { width: number; height: number };
	scaleX: number;
	scaleY: number;
	frame: number;
	fps: number;
	cache: GeneratorSourceCache;
}): OffscreenCanvas {
	const { width, height } = generatorTextureSize({ spec, canvasSize, scaleX, scaleY });
	const animated = spec.animated(params);
	const f = animated ? frame : 0;
	const key = `${spec.id}|${width}x${height}|${f}|${fps}|${generatorValuesKey(params)}`;
	const current = cache.canvases[cache.index];
	if (cache.key === key && current) return current;
	cache.index = (cache.index + 1) % 2;
	let canvas = cache.canvases[cache.index];
	if (!canvas || canvas.width !== width || canvas.height !== height) {
		canvas = new OffscreenCanvas(width, height);
		cache.canvases[cache.index] = canvas;
	}
	const context = canvas.getContext("2d");
	if (context) {
		if (!cache.image || cache.image.width !== width || cache.image.height !== height) cache.image = context.createImageData(width, height);
		const out: PixelBuffer = { data: cache.image.data, width, height };
		spec.pixels(out, params, { frame: f, fps });
		context.putImageData(cache.image, 0, 0);
	}
	cache.key = key;
	return canvas;
}
