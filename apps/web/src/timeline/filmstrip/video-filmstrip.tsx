"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useCommittedRef } from "@/hooks/use-committed-ref";
import { getThumbnails, peekThumbnail } from "@/services/video-cache/thumbnails";
import type { RetimeConfig } from "@/timeline";
import { scheduleTimelineDraw } from "@/timeline/draw-batch";
import {
	getLivePixelsPerSecond,
	subscribeClipMoved,
	subscribeLivePixelsPerSecond,
} from "@/timeline/live-pps";
import { type FilmstripLayout, type FilmstripTile, layoutFilmstrip, tileFallbacks } from "./tiles";

/** The canvas covers the visible part plus this share of the view on each side: scrolling redraws rarely. */
const OVERSCAN_OF_VIEW = 0.25;
/** Canvas widths are rounded up to this (device px): a zoom step reallocates the bitmap only now and then. */
const CANVAS_WIDTH_STEP = 256;
/** A scroll or zoom burst asks for frames once it pauses this long (the cache answers the rest). */
const REQUEST_DELAY_MS = 40;
/**
 * Narrower than this a clip shows its poster frame only (its background): a strip a few pixels wide shows nothing,
 * and each drawn canvas is a compositor layer — 300 clips zoomed to fit were 300 layers on every edit.
 */
const MIN_STRIP_WIDTH_PX = 24;

type DrawState = {
	clipWidth: number;
	pps: number;
	trim: number;
	duration: number;
	speed: RetimeConfig | undefined;
	height: number;
	dpr: number;
	aspect: number;
	frames: number;
};
type Drawn = { state: DrawState; from: number; to: number };

const sameState = (a: DrawState, b: DrawState) =>
	a.clipWidth === b.clipWidth &&
	a.pps === b.pps &&
	a.trim === b.trim &&
	a.duration === b.duration &&
	a.speed === b.speed &&
	a.height === b.height &&
	a.dpr === b.dpr &&
	a.aspect === b.aspect &&
	a.frames === b.frames;

/**
 * Real frames along a video clip (CapCut). One canvas per clip, covering only the part on screen; the
 * clip's repeated poster behind it shows until the frames arrive. Frames come from the shared thumbnail
 * cache (services/video-cache/thumbnails): key frames fill the view first, exact ones replace them.
 * Redraws join the waveforms' batch, so a zoom step draws clips, bars and frames in the same frame.
 */
export function VideoFilmstrip({
	clipId,
	mediaId,
	file,
	aspect,
	trackHeight,
	clipDurationSec,
	trimStartSec,
	retime,
	mediaDurationSec,
}: {
	clipId: string;
	mediaId: string;
	file: File;
	/** Source width ÷ height (corrected by the first decoded frame). */
	aspect: number;
	trackHeight: number;
	clipDurationSec: number;
	trimStartSec: number;
	retime?: RetimeConfig;
	mediaDurationSec?: number;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const config = useCommittedRef({
		mediaId,
		file,
		trackHeight,
		clipDurationSec,
		trimStartSec,
		retime,
		mediaDurationSec,
	});
	const aspectRef = useRef(aspect);
	const scrollParentRef = useRef<HTMLElement | null>(null);
	const drawnRef = useRef<Drawn | null>(null);
	const stylesRef = useRef({ width: "", height: "", left: "", display: "none" });
	const framesRef = useRef(0);
	const requestRef = useRef<{ key: string; controller: AbortController | null; timer: number }>({
		key: "",
		controller: null,
		timer: 0,
	});
	const drawVisibleRef = useRef<() => void>(() => {});

	const request = useCallback(
		(layout: FilmstripLayout, height: number) => {
			const current = requestRef.current;
			if (current.key === layout.requestKey) return;
			current.key = layout.requestKey;
			window.clearTimeout(current.timer);
			const start = () => {
				current.controller?.abort();
				const controller = new AbortController();
				current.controller = controller;
				const { mediaId: id, file: source } = config.current;
				const onFrame = (_time: number, bitmap: ImageBitmap) => {
					framesRef.current++;
					const decoded = bitmap.width / bitmap.height;
					if (decoded > 0 && Math.abs(decoded - aspectRef.current) > 0.01) aspectRef.current = decoded;
					drawVisibleRef.current();
				};
				void (async () => {
					await getThumbnails({ mediaId: id, file: source, times: layout.keyTimes, height, signal: controller.signal, onFrame });
					if (controller.signal.aborted) return;
					await getThumbnails({ mediaId: id, file: source, times: layout.exactTimes, height, signal: controller.signal, onFrame });
				})();
			};
			// The first request goes out at once; later ones wait for the scroll or zoom to pause.
			if (current.controller) current.timer = window.setTimeout(start, REQUEST_DELAY_MS);
			else start();
		},
		[config],
	);

	const cancelRequest = useCallback(() => {
		const current = requestRef.current;
		window.clearTimeout(current.timer);
		current.controller?.abort();
		current.controller = null;
		current.key = "";
	}, []);

	// Read phase (layout reads only). Returns the write phase, or null if nothing changed.
	const measure = useCallback((): (() => void) | null => {
		const canvas = canvasRef.current;
		const box = canvas?.parentElement;
		if (!canvas || !box) return null;
		const boxRect = box.getBoundingClientRect();
		const clipWidth = boxRect.width;
		const scrollParent = scrollParentRef.current;
		const viewRect = scrollParent?.getBoundingClientRect();
		const viewLeft = viewRect ? viewRect.left : 0;
		const viewRight = viewRect ? viewRect.right : window.innerWidth;
		const visibleFrom = Math.max(0, viewLeft - boxRect.left);
		const visibleTo = Math.min(clipWidth, viewRight - boxRect.left);
		// The whole clip's width (the frames' box is hidden while the clip is narrow): a clip a few pixels wide is drawn
		// as its colour only (data-narrow hides its name, frames and sound in CSS — no React render while zooming).
		const clipBox = canvas.closest<HTMLElement>("[data-timeline-element-id]");
		const fullWidth = clipBox ? clipBox.getBoundingClientRect().width : clipWidth;
		const narrow = fullWidth < MIN_STRIP_WIDTH_PX;
		const flip =
			clipBox && narrow !== clipBox.hasAttribute("data-narrow")
				? () => {
						if (narrow) clipBox.setAttribute("data-narrow", "");
						else {
							clipBox.removeAttribute("data-narrow");
							// Its frames' box shows from the next layout on: draw then.
							drawVisibleRef.current?.();
						}
					}
				: null;
		if (narrow || !(clipWidth >= MIN_STRIP_WIDTH_PX) || visibleTo <= visibleFrom) {
			if (!drawnRef.current) return flip;
			return () => {
				flip?.();
				drawnRef.current = null;
				canvas.style.display = stylesRef.current.display = "none";
				// A clip scrolled away frees its bitmap (30 mounted clips × a screen-wide canvas).
				canvas.width = 0;
				cancelRequest();
			};
		}

		const { trackHeight: height, clipDurationSec: duration, trimStartSec: trim, retime: speed } = config.current;
		// The live zoom, not a prop: the zoom must not re-render every clip (it draws from here in the zoom's frame).
		const pps = getLivePixelsPerSecond() || clipWidth / duration;
		const dpr = window.devicePixelRatio || 1;
		const drawn = drawnRef.current;
		const state = { clipWidth, pps, trim, duration, speed, height, dpr, aspect: aspectRef.current, frames: framesRef.current };
		if (drawn && sameState(drawn.state, state) && drawn.from <= visibleFrom && drawn.to >= visibleTo) return null;

		const overscan = (viewRight - viewLeft) * OVERSCAN_OF_VIEW;
		const from = Math.max(0, visibleFrom - overscan);
		const to = Math.min(clipWidth, visibleTo + overscan);
		return () => {
			flip?.();
			const { mediaId: id, mediaDurationSec } = config.current;
			const tileWidth = height * aspectRef.current;
			const layout = layoutFilmstrip({
				fromPx: from,
				toPx: to,
				centrePx: (visibleFrom + visibleTo) / 2,
				clipWidthPx: clipWidth,
				pixelsPerSecond: pps,
				tileWidthPx: tileWidth,
				trimStartSec: trim,
				clipDurationSec: duration,
				retime: speed,
				mediaDurationSec,
			});
			const bitmapHeight = Math.round(height * dpr);
			// Reallocated only when too small or 3× too big: a zoom step changes every clip's width.
			const needed = Math.ceil((to - from) * dpr);
			if (canvas.width < needed || canvas.width > needed * 3 + CANVAS_WIDTH_STEP) {
				canvas.width = Math.ceil((needed * 1.5) / CANVAS_WIDTH_STEP) * CANVAS_WIDTH_STEP;
			}
			if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;
			// Only changed styles are written: each write is a style recalc of the clip's layer.
			const styles = stylesRef.current;
			const cssWidth = `${canvas.width / dpr}px`;
			const cssHeight = `${bitmapHeight / dpr}px`;
			const cssLeft = `${from}px`;
			if (styles.width !== cssWidth) canvas.style.width = styles.width = cssWidth;
			if (styles.height !== cssHeight) canvas.style.height = styles.height = cssHeight;
			if (styles.left !== cssLeft) canvas.style.left = styles.left = cssLeft;
			if (styles.display !== "") canvas.style.display = styles.display = "";
			const context = canvas.getContext("2d");
			if (context) {
				context.clearRect(0, 0, canvas.width, canvas.height);
				for (const tile of layout.tiles) {
					const bitmap = findBitmap(id, tile, bitmapHeight);
					if (bitmap) drawTile({ context, bitmap, tile, originPx: from, dpr, tileWidth });
				}
			}
			drawnRef.current = { state, from, to };
			request(layout, bitmapHeight);
		};
	}, [cancelRequest, config, request]);

	const drawVisible = useCallback(() => scheduleTimelineDraw(measure), [measure]);
	drawVisibleRef.current = drawVisible;

	// biome-ignore lint/correctness/useExhaustiveDependencies: redraws when the zoom or the trim changes; measure reads them from refs
	useLayoutEffect(() => {
		drawVisible();
	}, [drawVisible, clipDurationSec, trimStartSec, retime, trackHeight, mediaId]);

	useLayoutEffect(() => {
		if (Math.abs(aspect - aspectRef.current) > 0.01) {
			aspectRef.current = aspect;
			drawVisible();
		}
	}, [aspect, drawVisible]);

	useEffect(() => {
		const box = canvasRef.current?.parentElement;
		if (!box) return;
		scrollParentRef.current = box.closest<HTMLElement>("[data-timeline-tracks-scroll]");
		const scrollParent = scrollParentRef.current;
		scrollParent?.addEventListener("scroll", drawVisible, { passive: true });
		// Trims, zoom and track height arrive as props or the live zoom; only the window changes the view's width.
		// (A ResizeObserver per clip fired after every zoom step's layout and measured all clips again a frame later.)
		window.addEventListener("resize", drawVisible);
		return () => {
			scrollParent?.removeEventListener("scroll", drawVisible);
			window.removeEventListener("resize", drawVisible);
		};
	}, [drawVisible]);

	useEffect(() => subscribeLivePixelsPerSecond(drawVisible), [drawVisible]);
	useEffect(() => subscribeClipMoved(clipId, drawVisible), [clipId, drawVisible]);
	useEffect(() => cancelRequest, [cancelRequest]);

	return (
		<canvas
			ref={canvasRef}
			data-filmstrip=""
			className="pointer-events-none absolute top-0"
			style={{ display: "none" }}
		/>
	);
}

/** The frame itself, else the nearest one a coarser zoom level or the key-frame pass left in the cache. */
function findBitmap(mediaId: string, tile: FilmstripTile, height: number): ImageBitmap | null {
	const exact = peekThumbnail(mediaId, tile.time, height);
	if (exact) return exact;
	for (const time of tileFallbacks(tile)) {
		const stand = peekThumbnail(mediaId, time, height);
		if (stand) return stand;
	}
	return null;
}

/** Fills the tile's slot: the middle of the frame when the slot is narrower, copies side by side when wider. */
function drawTile({
	context,
	bitmap,
	tile,
	originPx,
	dpr,
	tileWidth,
}: {
	context: CanvasRenderingContext2D;
	bitmap: ImageBitmap;
	tile: FilmstripTile;
	originPx: number;
	dpr: number;
	tileWidth: number;
}) {
	const x0 = Math.round((tile.left - originPx) * dpr);
	const x1 = Math.round((tile.right - originPx) * dpr);
	const slot = x1 - x0;
	const frame = Math.round(tileWidth * dpr);
	if (slot <= 0 || frame <= 0) return;
	const height = context.canvas.height;
	if (slot <= frame) {
		const sourceWidth = (bitmap.width * slot) / frame;
		context.drawImage(bitmap, (bitmap.width - sourceWidth) / 2, 0, sourceWidth, bitmap.height, x0, 0, slot, height);
		return;
	}
	for (let x = x0; x < x1; x += frame) {
		const width = Math.min(frame, x1 - x);
		context.drawImage(bitmap, 0, 0, (bitmap.width * width) / frame, bitmap.height, x, 0, width, height);
	}
}
