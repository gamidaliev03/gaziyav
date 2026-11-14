"use client";

import { useEffect, useRef } from "react";
import type { EffectPass, EffectTimeContext } from "@/effects/types";
import { gpuRenderer, isGpuAvailable } from "@/services/renderer/gpu-renderer";
import { defineShaderSource } from "@/effects/shader-sources";
import { useJobsStore } from "@/jobs/store";
import { whenShadersReady } from "@/services/renderer/compositor/pipeline-warmup";
import { onMemoryPressure } from "@/platform/memory-pressure";
import { byTier } from "@/platform/hardware-client";

// Tiles composite the result over a checkerboard: the thumbnail canvas is
// opaque, so masks / keys would otherwise look like the untouched photo.
const THUMB_MATTE = "studio.thumbMatte";
defineShaderSource({
	id: THUMB_MATTE,
	wgsl: /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let c = src(uv);
    let cell = floor(uv * fx.resolution / 10.0);
    let checker = select(0.22, 0.32, (cell.x + cell.y) % 2.0 > 0.5);
    return vec4f(mix(vec3f(checker), c.rgb, c.a), 1.0);
}`,
});

/** Tile render size (px). Tiles are ~90–110 css px wide, so this stays sharp on Retina. */
const SIZE = 192;
const PREVIEW_IMAGE_PATH = "/effects/preview.jpg";

type Sources = { a: OffscreenCanvas; b: OffscreenCanvas };
/** Per preview photo (the default portrait, or a theme's photo): its two test frames, once loaded. */
const sourcesByPhoto = new Map<string, Sources>();
const loadingByPhoto = new Map<string, Promise<Sources | null>>();

/** Two test frames of a photo: the photo and a recoloured, mirrored copy (transition "B"). */
function loadSources(photo: string = PREVIEW_IMAGE_PATH): Promise<Sources | null> {
	const loaded = sourcesByPhoto.get(photo);
	if (loaded) return Promise.resolve(loaded);
	let loading = loadingByPhoto.get(photo);
	if (!loading) {
		loading = new Promise<Sources | null>((resolve) => {
			const image = new Image();
			image.onload = () => {
				const a = new OffscreenCanvas(SIZE, SIZE);
				// A photo that isn't square is cropped to its middle (object-fit: cover).
				const side = Math.min(image.naturalWidth, image.naturalHeight) || SIZE;
				const sx = (image.naturalWidth - side) / 2;
				const sy = (image.naturalHeight - side) / 2;
				a.getContext("2d")?.drawImage(image, sx, sy, side, side, 0, 0, SIZE, SIZE);
				const b = new OffscreenCanvas(SIZE, SIZE);
				const ctx = b.getContext("2d");
				if (ctx) {
					ctx.filter = "hue-rotate(160deg) saturate(1.3)";
					ctx.translate(SIZE, 0);
					ctx.scale(-1, 1);
					ctx.drawImage(image, sx, sy, side, side, 0, 0, SIZE, SIZE);
				}
				const sources = { a, b };
				sourcesByPhoto.set(photo, sources);
				resolve(sources);
			};
			image.onerror = () => resolve(null);
			image.src = photo;
		});
		loadingByPhoto.set(photo, loading);
	}
	return loading;
}

export function timeAt(seconds: number, duration: number, fps = 30): EffectTimeContext {
	return {
		time: seconds,
		duration,
		progress: duration > 0 ? Math.min(1, seconds / duration) : 0,
		frame: Math.round(seconds * fps),
	};
}

/**
 * Renders on the GPU and resolves with a bitmap WITHOUT blocking the main
 * thread: the result is read back with createImageBitmap (async). drawImage on
 * the WebGPU canvas would wait for the shader pipeline to compile (≈1 s the
 * first time a shader is used) and freeze the UI.
 */
async function renderBitmap({
	passes,
	twoInputs,
	size = SIZE,
	photo = PREVIEW_IMAGE_PATH,
}: {
	passes: EffectPass[];
	twoInputs: boolean;
	size?: number;
	photo?: string;
}): Promise<ImageBitmap | null> {
	const sources = sourcesByPhoto.get(photo);
	if (!sources || !isGpuAvailable()) return null;
	try {
		// The GPU compiles a shader's pipeline in the background first: compiled in the draw, it held up every frame
		// of the page for 100–250 ms (a hovered tile, the stills of a newly opened list).
		const all = [...passes, { shader: THUMB_MATTE, uniforms: {} }];
		await whenShadersReady(all.map((pass) => pass.shader));
		const canvas = gpuRenderer.applyEffect({
			source: sources.a,
			orig: twoInputs ? sources.b : undefined,
			width: size,
			height: size,
			passes: all,
		});
		return await createImageBitmap(canvas);
	} catch {
		return null;
	}
}

/**
 * Idle stills, cached per tile key and photo (re-opening a tab costs nothing). The least recently shown go past 400
 * (~60 MB at 192²): each theme chip previews every tile on another photo.
 */
const STILLS_KEPT = 400;
const stillsKept = () => byTier({ base: STILLS_KEPT / 2, standard: STILLS_KEPT, pro: STILLS_KEPT });
const stills = new Map<string, ImageBitmap>();
const stillCache = {
	get(key: string): ImageBitmap | undefined {
		const bitmap = stills.get(key);
		if (bitmap) {
			stills.delete(key);
			stills.set(key, bitmap);
		}
		return bitmap;
	},
	has: (key: string) => stills.has(key),
	set(key: string, bitmap: ImageBitmap): void {
		stills.delete(key);
		stills.set(key, bitmap);
		for (const [oldest, old] of stills) {
			if (stills.size <= stillsKept()) break;
			stills.delete(oldest);
			old.close();
		}
	},
};
// Memory short: the tile stills go (a tile on screen keeps what it drew; one shown again is rendered again).
onMemoryPressure(() => {
	for (const bitmap of stills.values()) bitmap.close();
	stills.clear();
});
/** One still at a time (async), so a big grid never blocks the UI. */
const stillQueue: Array<() => Promise<void>> = [];
let queueRunning = false;
// No still is rendered while a list scrolls: a shader's first compile takes 100–300 ms and stalled the scroll of
// Effects and Transitions (release probe, 31.10: frames of 175–326 ms). The queue goes on 250 ms after it stops.
let lastScrollAt = 0;
if (typeof window !== "undefined") {
	const mark = () => {
		lastScrollAt = performance.now();
	};
	window.addEventListener("wheel", mark, { capture: true, passive: true });
	document.addEventListener("scroll", mark, { capture: true, passive: true });
}
function enqueueStill(job: () => Promise<void>) {
	stillQueue.push(job);
	if (queueRunning) return;
	queueRunning = true;
	const run = async () => {
		if (performance.now() - lastScrollAt < 250) {
			setTimeout(() => void run(), 120);
			return;
		}
		const next = stillQueue.shift();
		if (!next) {
			queueRunning = false;
			return;
		}
		try {
			await next();
		} catch {
			// a failed tile keeps its photo; never break the queue
		}
		requestAnimationFrame(() => void run());
	};
	requestAnimationFrame(() => void run());
}

/**
 * Warms shader pipelines in idle time (most-used first), so the first hover or
 * the first apply never waits for a compile. One shader per idle slot; each
 * render is 16×16 and read back asynchronously.
 */
const warmQueue: Array<{ passes: () => EffectPass[]; twoInputs: boolean }> = [];
let warming = false;
export function warmThumbnailShaders(jobs: Array<{ passes: () => EffectPass[]; twoInputs: boolean }>) {
	warmQueue.push(...jobs);
	if (warming || typeof window === "undefined") return;
	warming = true;
	const idle = (cb: () => void) =>
		"requestIdleCallback" in window
			? (window as Window & { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback(cb, { timeout: 1500 })
			: setTimeout(cb, 80);
	const step = () => {
		// a compile in the middle of a scroll is what stalled it: wait until the list is still. None either while an
		// export or an AI job (Whisper, lipsync…) runs: this is speculative GPU work, theirs comes first.
		if (performance.now() - lastScrollAt < 250 || useJobsStore.getState().jobs.some((job) => job.status === "running")) {
			setTimeout(() => idle(step), 200);
			return;
		}
		const next = warmQueue.shift();
		if (!next) {
			warming = false;
			return;
		}
		void loadSources().then(async () => {
			try {
				(await renderBitmap({ passes: next.passes(), twoInputs: next.twoInputs, size: 16 }))?.close();
			} catch {
				// best effort
			}
			idle(step);
		});
	};
	idle(step);
}

export type ThumbnailMode = "loop" | "wipe";

/** Apple-like ease for the before/after wipe. */
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Live thumbnail rendered by the same wasm engine as preview/export.
 * Idle: a cached still at `restTime`, rendered lazily when the tile nears the
 * viewport. Hovered:
 *  - "loop": the effect/transition plays through `loopSeconds` at display rate
 *    (one GPU frame in flight, read back asynchronously), holds, and repeats;
 *  - "wipe": for effects that do not change over time (grades, styles), a
 *    before → after split sweeps across the tile.
 */
export function FxThumbnail({
	cacheKey,
	buildPasses,
	twoInputs = false,
	restTime,
	loopSeconds,
	hovered,
	mode = "loop",
	photo = PREVIEW_IMAGE_PATH,
}: {
	cacheKey: string;
	buildPasses: (time: EffectTimeContext) => EffectPass[];
	twoInputs?: boolean;
	restTime: number;
	loopSeconds: number;
	hovered: boolean;
	mode?: ThumbnailMode;
	/** The photo it is previewed on (a theme's), else the default portrait. */
	photo?: string;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const buildRef = useRef(buildPasses);
	buildRef.current = buildPasses;
	const stillKey = `${cacheKey}@${restTime}@${photo}`;

	const paint = (image: CanvasImageSource | null) => {
		const canvas = canvasRef.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx || !image) return;
		if (canvas.width !== SIZE) {
			canvas.width = SIZE;
			canvas.height = SIZE;
		}
		ctx.drawImage(image, 0, 0, SIZE, SIZE);
	};

	const stillPasses = () => buildRef.current(timeAt(restTime, loopSeconds));

	// idle still: lazy (near the viewport), queued, async, cached
	// biome-ignore lint/correctness/useExhaustiveDependencies: stillKey names the still: paint/stillPasses are this render's helpers
	useEffect(() => {
		if (hovered) return;
		const cached = stillCache.get(stillKey);
		if (cached) {
			paint(cached);
			return;
		}
		const canvas = canvasRef.current;
		if (!canvas) return;
		let cancelled = false;
		// the untouched photo until the effect's still is ready
		void loadSources(photo).then((sources) => {
			if (!cancelled && !stillCache.has(stillKey) && sources) paint(sources.a);
		});
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				observer.disconnect();
				void loadSources(photo).then(() => {
					enqueueStill(async () => {
						if (cancelled) return;
						const hit = stillCache.get(stillKey);
						if (hit) {
							paint(hit);
							return;
						}
						const bitmap = await renderBitmap({ passes: stillPasses(), twoInputs, photo });
						if (!bitmap) return;
						stillCache.set(stillKey, bitmap);
						if (!cancelled) paint(bitmap);
					});
				});
			},
			// start before the tile scrolls in, so fast scrolling never shows a blank one
			{ rootMargin: "400px 0px" },
		);
		observer.observe(canvas);
		return () => {
			cancelled = true;
			observer.disconnect();
		};
	}, [hovered, stillKey, twoInputs, photo]);

	// hover: animate at display rate until the pointer leaves
	// biome-ignore lint/correctness/useExhaustiveDependencies: the hover loop restarts with the hover or a new still; paint/stillPasses are this render's helpers
	useEffect(() => {
		if (!hovered) return;
		let raf = 0;
		let cancelled = false;
		void loadSources(photo).then(async (sources) => {
			if (cancelled || !sources) return;
			const started = performance.now();
			if (mode === "wipe") {
				const after = stillCache.get(stillKey) ?? (await renderBitmap({ passes: stillPasses(), twoInputs, photo }));
				if (cancelled) return;
				if (after && !stillCache.has(stillKey)) stillCache.set(stillKey, after);
				const PERIOD = 1800;
				const tick = (now: number) => {
					if (cancelled) return;
					const ctx = canvasRef.current?.getContext("2d");
					if (ctx) {
						// 0 → 1 → 0 with an eased sweep and a short hold at each end
						const phase = ((now - started) % PERIOD) / PERIOD;
						const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
						const t = easeInOutCubic(Math.min(1, Math.max(0, (tri - 0.08) / 0.84)));
						const x = SIZE * (1 - t);
						ctx.drawImage(sources.a, 0, 0, SIZE, SIZE);
						if (after) {
							ctx.save();
							ctx.beginPath();
							ctx.rect(x, 0, SIZE - x, SIZE);
							ctx.clip();
							ctx.drawImage(after, 0, 0, SIZE, SIZE);
							ctx.restore();
						}
						if (x > 0.5 && x < SIZE - 0.5) {
							ctx.fillStyle = "rgba(255,255,255,0.9)";
							ctx.fillRect(Math.round(x) - 1, 0, 2, SIZE);
						}
					}
					raf = requestAnimationFrame(tick);
				};
				raf = requestAnimationFrame(tick);
				return;
			}
			// loop: play the effect, hold the last frame briefly, repeat
			const HOLD = 0.35;
			let inFlight = false;
			const tick = (now: number) => {
				if (cancelled) return;
				if (!inFlight) {
					const elapsed = ((now - started) / 1000) % (loopSeconds + HOLD);
					const t = Math.min(elapsed, loopSeconds);
					inFlight = true;
					void renderBitmap({ passes: buildRef.current(timeAt(t, loopSeconds)), twoInputs, photo }).then((bitmap) => {
						inFlight = false;
						if (!bitmap) return;
						if (!cancelled) paint(bitmap);
						bitmap.close();
					});
				}
				raf = requestAnimationFrame(tick);
			};
			raf = requestAnimationFrame(tick);
		});
		return () => {
			cancelled = true;
			cancelAnimationFrame(raf);
			// back to the idle still at once (no flash of a mid-animation frame)
			const still = stillCache.get(stillKey);
			if (still) paint(still);
		};
	}, [hovered, loopSeconds, twoInputs, mode, stillKey, photo]);

	return <canvas ref={canvasRef} width={SIZE} height={SIZE} className="size-full rounded-md object-cover" />;
}

/** Effects whose shader reads time animate on hover; static looks get the before/after wipe. */
export function thumbnailModeFor(wgslSources: string[]): ThumbnailMode {
	return wgslSources.some((wgsl) => /fx\.(time|frame|progress)/.test(wgsl)) ? "loop" : "wipe";
}
