"use client";

// A text preset's tile drawn by the player's own text renderer — the same fonts, plates, layers and per-letter
// motion — so the tile is what lands in the video: a still once everything has come in, and the whole animation
// looping while the pointer is over it (CapCut plays its tiles the same way).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { resolveTextAnimFrame } from "@/animation/presets";
import { fontFailed, fontStatus, loadBundledFont, subscribeFontStatus } from "@/fonts/bundled";
import { t, useLang } from "@/i18n";
import { buildTextBackgroundFromElement, buildTextPaintFromElement, measureTextElement } from "@/text/measure-element";
import { settleSeconds } from "@/text/insert-preset";
import { buildPresetParams, presetScene, TEXT_PRESETS, type TextPreset } from "@/text/presets";
import stillManifest from "@/text/tile-stills.json";
import { CAPTION_STYLES } from "@/subtitles/styles";
import { captionStill, captionTileElement } from "@/subtitles/caption-tile";
import { drawStyledTextLayout } from "@/text/primitives";
import { paintScene, type Scene, scenePhoto } from "@/text/theme-scenes";
import type { TextElement } from "@/timeline";
import { buildTextElement } from "@/timeline/element-utils";
import { DEFAULTS } from "@/timeline/defaults";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";

const FRAME = { width: 1080, height: 1920 };

/** The preset as a text clip on a 9:16 frame (the sample words in the interface language). */
export function presetTextElement(preset: TextPreset): TextElement {
	const params = buildPresetParams({ preset, canvasHeight: FRAME.height });
	const sub = params["design.sub"];
	const built = buildTextElement({
		raw: {
			...DEFAULTS.text.element,
			name: preset.name,
			duration: mediaTime({ ticks: Math.round(preset.duration * TICKS_PER_SECOND) }),
			params: { ...DEFAULTS.text.element.params, ...params, content: t(preset.content), ...(typeof sub === "string" && sub ? { "design.sub": t(sub) } : {}) },
		},
		startTime: mediaTime({ ticks: 0 }),
	});
	return { ...built, id: `preset:${preset.id}` } as TextElement;
}

let measureCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
function measureContext() {
	if (!measureCanvas) measureCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(8, 8) : document.createElement("canvas");
	return measureCanvas.getContext("2d") as CanvasRenderingContext2D;
}

/** The composition's box on the still (local px), so the hover animation keeps the same framing. */
function framingOf(element: TextElement, seconds: number) {
	const localTime = Math.round(seconds * TICKS_PER_SECOND);
	const measured = measureTextElement({ element, canvasHeight: FRAME.height, canvasWidth: FRAME.width, localTime, ctx: measureContext() });
	return measured.visualRect;
}

function drawFrame(
	ctx: CanvasRenderingContext2D,
	element: TextElement,
	seconds: number,
	size: { width: number; height: number },
	framing: { left: number; top: number; width: number; height: number },
	backdrop: { scene: Scene; photo: HTMLImageElement | null } | null,
) {
	const localTime = Math.round(Math.max(0, seconds) * TICKS_PER_SECOND);
	const params = element.params as Record<string, unknown>;
	const animFrame = resolveTextAnimFrame({ params, animations: element.animations, duration: element.duration, localTime, canvasWidth: FRAME.width, canvasHeight: FRAME.height });
	const measured = measureTextElement({ element, canvasHeight: FRAME.height, canvasWidth: FRAME.width, localTime, ctx: measureContext(), animFrame });
	const textColor = typeof params.color === "string" ? params.color : "#ffffff";
	const paint = buildTextPaintFromElement({ element, textColor, localTime, animFrame });
	const background = buildTextBackgroundFromElement({ element });
	// Fit the composition into the tile with a margin, never larger than a quarter of the frame width per tile.
	const scale = Math.min((size.width * 0.84) / Math.max(1, framing.width), (size.height * 0.74) / Math.max(1, framing.height), size.width / (FRAME.width * 0.42));
	ctx.save();
	ctx.clearRect(0, 0, size.width, size.height);
	if (backdrop) paintScene(ctx, backdrop.scene, size.width, size.height, backdrop.photo);
	ctx.translate(size.width / 2, size.height / 2);
	ctx.scale(scale, scale);
	const rotate = Number(params["transform.rotate"] ?? 0);
	if (rotate) ctx.rotate((rotate * Math.PI) / 180);
	ctx.translate(-(framing.left + framing.width / 2), -(framing.top + framing.height / 2));
	ctx.translate(animFrame.offsetX, animFrame.offsetY);
	if (animFrame.rotate) ctx.rotate((animFrame.rotate * Math.PI) / 180);
	ctx.scale(animFrame.scale, animFrame.scale);
	ctx.globalAlpha = Math.max(0, Math.min(1, animFrame.opacity * Number(element.params.opacity ?? 1)));
	drawStyledTextLayout({ ctx, layout: measured, style: paint, pixelScale: scale * animFrame.scale, background: measured.resolvedBackground, backgroundColor: background.color });
	ctx.restore();
}

export function PresetThumb({ preset, playing }: { preset: TextPreset; playing: boolean }) {
	const lang = useLang((s) => s.lang);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the sample words follow the interface language
	const element = useMemo(() => presetTextElement(preset), [preset, lang]);
	return (
		<TextTile
			id={preset.id}
			stillUrl={tileStillUrl(`text:${preset.id}`, lang)}
			element={element}
			still={settleSeconds(preset)}
			duration={preset.duration}
			scene={presetScene(preset)}
			fontFamily={String(preset.params.fontFamily ?? "")}
			playing={playing}
		/>
	);
}

/** The canvas size for a tile of `width` × `height` CSS px (null while it has no size yet: nothing to draw into). */
export function tileCanvasSize(width: number, height: number, devicePixelRatio: number): { width: number; height: number } | null {
	if (width < 2 || height < 2) return null;
	const ratio = Math.min(2, devicePixelRatio || 1);
	return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

/**
 * A text clip drawn on a scene in a tile: the still at `still` seconds, the whole clip looping while `playing`.
 * Drawn (and its photo and font fetched) only once the tile scrolls into view.
 */
export function TextTile({
	id,
	element,
	still,
	duration,
	scene,
	fontFamily,
	playing,
	stillUrl,
}: {
	id: string;
	/** The still picture (text only, transparent) made ahead: shown over the scene without loading the font. */
	stillUrl?: string;
	element: TextElement;
	still: number;
	duration: number;
	scene: Scene;
	fontFamily: string;
	playing: boolean;
}) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const [seen, setSeen] = useState(false);
	// the tile's size, followed (a tile first seen while its panel opens has no size yet and stayed blank)
	const [size, setSize] = useState<{ width: number; height: number } | null>(null);
	useEffect(() => {
		const el = canvas.current;
		if (!el) return;
		const read = () => {
			const r = el.getBoundingClientRect();
			const next = tileCanvasSize(r.width, r.height, window.devicePixelRatio);
			setSize((prev) => (prev && next && prev.width === next.width && prev.height === next.height ? prev : next));
		};
		read();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(read);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		const el = canvas.current;
		if (!el || seen) return;
		if (typeof IntersectionObserver === "undefined") {
			setSeen(true);
			return;
		}
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				setSeen(true);
				observer.disconnect();
			}
		}, { rootMargin: "200px" });
		observer.observe(el);
		return () => observer.disconnect();
	}, [seen]);

	useEffect(() => {
		const el = canvas.current;
		if (!el || !seen || !size) return;
		// a canvas is cleared by any size set, even the same one: keep the still up while a hovered tile waits
		if (el.width !== size.width) el.width = size.width;
		if (el.height !== size.height) el.height = size.height;
		const ctx = el.getContext("2d");
		if (!ctx) return;
		let raf = 0;
		let cancelled = false;
		// not hovered: the still picture over the scene — no font is loaded for a tile only looked at
		if (!playing && stillUrl) {
			void Promise.all([stillImage(stillUrl), scenePhoto(scene)]).then(([still, photo]) => {
				if (cancelled || !still) return;
				ctx.clearRect(0, 0, size.width, size.height);
				paintScene(ctx, scene, size.width, size.height, photo);
				ctx.drawImage(still, 0, 0, size.width, size.height);
			});
			return () => {
				cancelled = true;
			};
		}
		// hovered: the font comes quietly after ~150 ms of hover (a pass over the tile downloads nothing), then it plays
		let hoverDelay = 0;
		const live = () => void Promise.all([loadBundledFont(fontFamily).catch(() => {}), scenePhoto(scene)]).then(([, photo]) => {
			// no internet: the still stays (with the cloud mark) instead of playing in the stand-in font
			if (cancelled || (stillUrl && fontFailed(fontFamily))) return;
			const backdrop = { scene, photo };
			const framing = framingOf(element, still);
			if (!playing) {
				drawFrame(ctx, element, still, size, framing, backdrop);
				return;
			}
			const started = performance.now();
			const loop = duration + 0.5;
			const tick = (now: number) => {
				if (cancelled) return;
				const seconds = ((now - started) / 1000) % loop;
				drawFrame(ctx, element, Math.min(seconds, duration - 1 / 30), size, framing, backdrop);
				raf = requestAnimationFrame(tick);
			};
			raf = requestAnimationFrame(tick);
		});
		if (playing && stillUrl) hoverDelay = window.setTimeout(live, 150);
		else live();
		return () => {
			cancelled = true;
			window.clearTimeout(hoverDelay);
			cancelAnimationFrame(raf);
		};
	}, [element, still, duration, scene, fontFamily, playing, seen, size, stillUrl]);

	// iCloud Photos: every tile looks here; a short ring while its font comes, a cloud only when there's no internet
	const status = useSyncExternalStore(subscribeFontStatus, () => fontStatus(fontFamily), () => "here" as const);
	return (
		<div className="relative size-full">
			<canvas ref={canvas} data-text-tile={id} aria-hidden className="size-full" />
			{status === "loading" && (
				<span data-font-loading aria-hidden className="absolute bottom-1 left-1 size-3 animate-spin rounded-full border-[1.5px] border-white/30 border-t-white" />
			)}
			{status === "offline" && (
				<span data-font-offline title={t("The font will download when the internet is back")} className="absolute bottom-1 left-1 text-white/85">
					<svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden="true">
						<path d="M7.5 19a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18.4 9.5 4.75 4.75 0 0 1 17.75 19z" />
					</svg>
				</span>
			)}
		</div>
	);
}

const stills = new Map<string, Promise<HTMLImageElement | null>>();
function stillImage(url: string): Promise<HTMLImageElement | null> {
	let hit = stills.get(url);
	if (!hit) {
		hit = new Promise((resolve) => {
			const image = new Image();
			image.decoding = "async";
			image.onload = () => resolve(image);
			image.onerror = () => resolve(null);
			image.src = url;
		});
		stills.set(url, hit);
	}
	return hit;
}

const STILL_KEYS = new Map(Object.entries((stillManifest as { keys: Record<string, string[]> }).keys).map(([lang, keys]) => [lang, new Set(keys)]));

/** The still picture of a tile (`text:<preset>` or `caption:<style>`) in a language, when one was made. */
export function tileStillUrl(key: string, lang: string): string | undefined {
	return STILL_KEYS.get(lang)?.has(key) ? `/text-tiles/${lang}/${encodeURIComponent(key.replace(":", "-"))}.webp` : undefined;
}

/**
 * The still pictures of every built-in text preset and caption style tile, text only (transparent): run by
 */
async function makeTileStills(lang: "ru" | "en"): Promise<Array<{ key: string; data: string }>> {
	const before = useLang.getState().lang;
	useLang.setState({ lang });
	const side = (stillManifest as { size: number }).size;
	const size = { width: side, height: side };
	const canvas = document.createElement("canvas");
	canvas.width = side;
	canvas.height = side;
	const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
	const out: Array<{ key: string; data: string }> = [];
	const shoot = async (key: string, element: TextElement, seconds: number, family: string) => {
		await loadBundledFont(family);
		drawFrame(ctx, element, seconds, size, framingOf(element, seconds), null);
		out.push({ key, data: canvas.toDataURL("image/webp", 0.92) });
	};
	try {
		for (const preset of TEXT_PRESETS) await shoot(`text:${preset.id}`, presetTextElement(preset), settleSeconds(preset), String(preset.params.fontFamily ?? ""));
		for (const style of CAPTION_STYLES) {
			if (style.id.startsWith("user-")) continue;
			await shoot(`caption:${style.id}`, captionTileElement(style, lang), captionStill(style), String(style.params.fontFamily ?? ""));
		}
	} finally {
		useLang.setState({ lang: before });
	}
	return out;
}

if (typeof window !== "undefined") (window as unknown as { __gaziyavTileStills?: typeof makeTileStills }).__gaziyavTileStills = makeTileStills;

