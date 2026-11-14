"use client";

/**
 * Live stereo level meter at the right edge of the timeline (where CapCut keeps it).
 * Reads the mix bus through an AnalyserNode and draws on rAF into a canvas: React renders it
 * once, never per frame. Off screen or at rest, no frame loop runs and the tap is disconnected.
 */

import { useEffect, useRef } from "react";
import { useEditor } from "@/editor/use-editor";
import type { MeterTap } from "@/core/managers/audio-manager";
import {
	METER_TICKS_DB,
	createMeterState,
	formatMeterDb,
	isMeterAtRest,
	meterFraction,
	resetMeterClip,
	samplePeak,
	stepMeter,
	amplitudeToDb,
	type MeterState,
} from "@/media/level-meter";
import { LoudnessBar, LoudnessReadout } from "@/sound/meter/loudness";
import { MixerDock } from "@/sound/mixer/dock";

// 34 px of peak bars and scale, and 7 for the loudness bar with its target tick (sound/meter/loudness.tsx).
export const LEVEL_METER_WIDTH_PX = 41;

const PAD_TOP = 3;
const PAD_BOTTOM = 8;
const BAR_WIDTH = 5;
const BAR_GAP = 2;
const BAR_RIGHT = 11;
const LABEL_RIGHT_GAP = 4;
const MIN_LABEL_SPACING = 11;
const CLIP_CAP = 3;

interface Palette {
	track: string;
	label: string;
	tick: string;
	clip: string;
}

function hexToRgb(value: string): [number, number, number] | null {
	const hex = value.trim().replace("#", "");
	if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
	return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [
		number,
		number,
		number,
	];
}

function readPalette(element: Element): Palette {
	const style = getComputedStyle(element);
	const fg = hexToRgb(style.getPropertyValue("--foreground")) ?? [237, 237, 240];
	const rgba = (alpha: number) => `rgba(${fg[0]}, ${fg[1]}, ${fg[2]}, ${alpha})`;
	return {
		track: rgba(0.07),
		label: rgba(0.42),
		tick: rgba(0.16),
		clip: "#f43f5e",
	};
}

interface Geometry {
	width: number;
	height: number;
	dpr: number;
	top: number;
	bottom: number;
	barsX: [number, number];
}

function measure(canvas: HTMLCanvasElement): Geometry {
	const rect = canvas.getBoundingClientRect();
	const width = Math.max(1, Math.round(rect.width));
	const height = Math.max(1, Math.round(rect.height));
	const right = width - BAR_RIGHT - BAR_WIDTH;
	return {
		width,
		height,
		dpr: Math.max(1, window.devicePixelRatio || 1),
		top: PAD_TOP,
		bottom: height - PAD_BOTTOM,
		barsX: [right - BAR_GAP - BAR_WIDTH, right],
	};
}

function yForDb(geometry: Geometry, db: number): number {
	return geometry.bottom - meterFraction(db) * (geometry.bottom - geometry.top);
}

function sizeCanvas(canvas: HTMLCanvasElement, geometry: Geometry) {
	const w = Math.round(geometry.width * geometry.dpr);
	const h = Math.round(geometry.height * geometry.dpr);
	if (canvas.width !== w) canvas.width = w;
	if (canvas.height !== h) canvas.height = h;
	const ctx = canvas.getContext("2d");
	ctx?.setTransform(geometry.dpr, 0, 0, geometry.dpr, 0, 0);
	return ctx;
}

/** Scale, labels and the dim bar tracks: drawn on resize and theme change only. */
function drawStatic(canvas: HTMLCanvasElement, geometry: Geometry, palette: Palette) {
	const ctx = sizeCanvas(canvas, geometry);
	if (!ctx) return;
	ctx.clearRect(0, 0, geometry.width, geometry.height);
	if (geometry.bottom - geometry.top < 24) return;
	for (const x of geometry.barsX) {
		ctx.fillStyle = palette.track;
		roundRect(ctx, x, geometry.top, BAR_WIDTH, geometry.bottom - geometry.top, 1.5);
		ctx.fill();
	}
	ctx.font = "500 8px ui-sans-serif, -apple-system, system-ui, sans-serif";
	ctx.textAlign = "right";
	ctx.textBaseline = "middle";
	const labelRight = geometry.barsX[0] - LABEL_RIGHT_GAP;
	let lastY = Number.NEGATIVE_INFINITY;
	for (const db of METER_TICKS_DB) {
		const y = yForDb(geometry, db);
		if (y - lastY < MIN_LABEL_SPACING) continue;
		lastY = y;
		ctx.fillStyle = palette.tick;
		ctx.fillRect(labelRight + 1, Math.round(y) - 0.5, 2, 1);
		ctx.fillStyle = palette.label;
		// Logic-style scale: numbers without the minus sign.
		ctx.fillText(String(Math.abs(db)), labelRight - 1, Math.min(geometry.bottom - 3, Math.max(geometry.top + 4, y)));
	}
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
	ctx.beginPath();
	if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
	else ctx.rect(x, y, w, h);
}

function levelGradient(ctx: CanvasRenderingContext2D, geometry: Geometry): CanvasGradient {
	const gradient = ctx.createLinearGradient(0, geometry.bottom, 0, geometry.top);
	const stop = (db: number, color: string) => gradient.addColorStop(meterFraction(db), color);
	stop(-60, "#2bb673");
	stop(-18, "#34d399");
	stop(-10, "#a3e635");
	stop(-6, "#fbbf24");
	stop(-2, "#fb923c");
	stop(0, "#f43f5e");
	return gradient;
}

function drawLive(
	canvas: HTMLCanvasElement,
	geometry: Geometry,
	state: MeterState,
	palette: Palette,
	gradientRef: { current: CanvasGradient | null },
) {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.setTransform(geometry.dpr, 0, 0, geometry.dpr, 0, 0);
	ctx.clearRect(0, 0, geometry.width, geometry.height);
	if (geometry.bottom - geometry.top < 24) return;
	if (!gradientRef.current) gradientRef.current = levelGradient(ctx, geometry);
	ctx.fillStyle = gradientRef.current;
	for (let index = 0; index < 2; index++) {
		const channel = state.channels[index];
		const x = geometry.barsX[index];
		const levelY = yForDb(geometry, amplitudeToDb(channel.level));
		if (levelY < geometry.bottom) {
			roundRect(ctx, x, levelY, BAR_WIDTH, geometry.bottom - levelY, 1.5);
			ctx.fill();
		}
		const holdDb = amplitudeToDb(channel.hold);
		if (holdDb > -60) {
			const holdY = yForDb(geometry, holdDb);
			ctx.fillRect(x, Math.max(geometry.top, Math.round(holdY) - 1), BAR_WIDTH, 2);
		}
	}
	if (state.clipped) {
		ctx.fillStyle = palette.clip;
		for (const x of geometry.barsX) {
			roundRect(ctx, x, geometry.top, BAR_WIDTH, CLIP_CAP, 1.5);
			ctx.fill();
		}
	}
}

export function LevelMeter({ headerHeight }: { headerHeight: number }) {
	const editor = useEditor();
	const rootRef = useRef<HTMLDivElement>(null);
	const barsRef = useRef<HTMLDivElement>(null);
	const staticRef = useRef<HTMLCanvasElement>(null);
	const liveRef = useRef<HTMLCanvasElement>(null);
	const readoutRef = useRef<HTMLButtonElement>(null);
	const resetRef = useRef<() => void>(() => {});

	useEffect(() => {
		const root = rootRef.current;
		const bars = barsRef.current;
		const staticCanvas = staticRef.current;
		const liveCanvas = liveRef.current;
		const readout = readoutRef.current;
		if (!root || !bars || !staticCanvas || !liveCanvas || !readout) return;

		const state = createMeterState();
		// Read-only handle for the CDP proofs (test/meter.mjs).
		(root as HTMLDivElement & { __levelMeter?: MeterState }).__levelMeter = state;
		const buffers = [new Float32Array(2048), new Float32Array(2048)];
		const peaks: [number, number] = [0, 0];
		const gradientRef: { current: CanvasGradient | null } = { current: null };
		let geometry = measure(liveCanvas);
		let palette = readPalette(root);
		let tap: MeterTap | null = null;
		let raf: number | null = null;
		let lastFrame = 0;
		let visible = true;
		let playing = editor.playback.getIsPlaying();
		let shownText = "\u0000";
		let shownClip = false;

		const layout = () => {
			geometry = measure(liveCanvas);
			sizeCanvas(liveCanvas, geometry);
			gradientRef.current = null;
			drawStatic(staticCanvas, geometry, palette);
			drawLive(liveCanvas, geometry, state, palette, gradientRef);
		};

		const updateReadout = () => {
			const loudest = Math.max(state.channels[0].hold, state.channels[1].hold);
			const text = state.clipped
				? formatMeterDb(state.maxSinceReset)
				: formatMeterDb(loudest);
			if (text !== shownText) {
				shownText = text;
				readout.textContent = text || "dB";
				readout.dataset.idle = text ? "false" : "true";
			}
			if (state.clipped !== shownClip) {
				shownClip = state.clipped;
				readout.dataset.clipped = String(state.clipped);
				// a button only while there is a clip light to reset (otherwise a click would do nothing)
				readout.disabled = !state.clipped;
				readout.setAttribute(
					"aria-label",
					state.clipped ? "The mix clipped. Click to reset the clip light." : "Peak level",
				);
			}
		};

		const releaseTap = () => {
			tap?.release();
			tap = null;
		};

		const stop = () => {
			if (raf !== null) cancelAnimationFrame(raf);
			raf = null;
			releaseTap();
		};

		const frame = (now: number) => {
			raf = null;
			const dtMs = lastFrame ? Math.min(250, now - lastFrame) : 16;
			lastFrame = now;
			if (playing && tap) {
				for (let index = 0; index < 2; index++) {
					const buffer = buffers[index];
					tap.analysers[index].getFloatTimeDomainData(buffer);
					peaks[index] = samplePeak(buffer);
				}
			} else {
				peaks[0] = 0;
				peaks[1] = 0;
			}
			stepMeter({ state, peaks, now, dtMs });
			drawLive(liveCanvas, geometry, state, palette, gradientRef);
			updateReadout();
			if (!playing && isMeterAtRest(state)) {
				stop();
				return;
			}
			raf = requestAnimationFrame(frame);
		};

		const ensureRunning = () => {
			if (!visible) return;
			if (playing && !tap) tap = editor.audio.acquireMeterTap();
			if (!playing) releaseTap();
			if (raf === null && (playing || !isMeterAtRest(state))) {
				lastFrame = 0;
				raf = requestAnimationFrame(frame);
			}
		};

		const onPlayback = () => {
			const next = editor.playback.getIsPlaying();
			if (next === playing) return;
			playing = next;
			ensureRunning();
		};

		resetRef.current = () => {
			resetMeterClip(state);
			drawLive(liveCanvas, geometry, state, palette, gradientRef);
			updateReadout();
		};

		const resizeObserver = new ResizeObserver(layout);
		resizeObserver.observe(bars);
		const intersection = new IntersectionObserver((entries) => {
			visible = entries.some((entry) => entry.isIntersecting);
			if (visible) ensureRunning();
			else stop();
		});
		intersection.observe(root);
		const themeObserver = new MutationObserver(() => {
			palette = readPalette(root);
			layout();
		});
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class", "data-theme"],
		});
		const unsubscribe = editor.playback.subscribe(onPlayback);

		layout();
		updateReadout();
		ensureRunning();

		return () => {
			unsubscribe();
			resizeObserver.disconnect();
			intersection.disconnect();
			themeObserver.disconnect();
			stop();
			resetRef.current = () => {};
		};
	}, [editor]);

	return (
		<>
		{/* the mixer docks at the meter's left when it is open (the meter is its master's meter) */}
		<MixerDock headerHeight={headerHeight} />
		<div
			ref={rootRef}
			data-level-meter
			className="bg-background relative flex shrink-0 flex-col border-l select-none"
			style={{ width: LEVEL_METER_WIDTH_PX }}
		>
			<div
				className="relative flex shrink-0 items-end justify-center pb-1"
				style={{ height: headerHeight }}
			>
				{/* Loudness: the number over the peak readout; the whole cell opens its numbers and the target. */}
				<LoudnessReadout />
				<button
					ref={readoutRef}
					type="button"
					tabIndex={-1}
					data-idle="true"
					data-clipped="false"
					disabled
					aria-label="Peak level"
					title="Mix level (peak). Turns red when the mix clips; click to reset."
					onClick={(event) => {
						event.stopPropagation();
						resetRef.current();
					}}
					onMouseDown={(event) => event.preventDefault()}
					className="relative h-4 w-[28px] rounded-[4px] text-center text-[9px] leading-4 font-medium tabular-nums transition-colors duration-150 text-foreground/80 data-[idle=true]:text-muted-foreground/50 data-[clipped=true]:bg-[#f43f5e] data-[clipped=true]:text-white hover:bg-accent/60 data-[clipped=true]:hover:bg-[#e11d48] disabled:pointer-events-none"
				>
					dB
				</button>
			</div>
			<div ref={barsRef} className="relative min-h-0 flex-1">
				<canvas ref={staticRef} aria-hidden className="absolute inset-0 size-full" />
				<canvas ref={liveRef} aria-hidden className="absolute inset-0 size-full" />
				<LoudnessBar top={PAD_TOP} bottom={PAD_BOTTOM} />
			</div>
		</div>
		</>
	);
}
