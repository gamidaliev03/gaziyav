"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useCommittedRef } from "@/hooks/use-committed-ref";
import { useResizeObserver } from "@/hooks/use-resize-observer";
import { TIMELINE_AUDIO_WAVEFORM_COLOR } from "./theme";
import {
	buildWaveformSampleBuckets,
	sampleSourceWaveformSummary,
	type SourceWaveformSummary,
} from "@/media/waveform-summary";
import type { RetimeConfig } from "@/timeline";
import { getBarFractionFromOutputAmplitude } from "@/timeline/audio-display";
import { waveformCache } from "@/services/waveform-cache/service";
import {
	getLivePixelsPerSecond,
	subscribeClipMoved,
	subscribeLivePixelsPerSecond,
} from "@/timeline/live-pps";
import { scheduleTimelineDraw } from "@/timeline/draw-batch";
import { findScrollParent } from "@/utils/browser";
import { cn } from "@/utils/ui";

const BAR_WIDTH = 1;
const BAR_GAP = 1;
const BAR_STEP = BAR_WIDTH + BAR_GAP;
const WAVEFORM_BURN_COLOR = "rgba(255, 110, 20, 0.9)";
export const WAVEFORM_GAIN_SAMPLE_COUNT = 200;

function sampleGainAtClipTime({
	samples,
	clipTimeSec,
	clipDurationSec,
}: {
	samples: number[];
	clipTimeSec: number;
	clipDurationSec: number;
}): number {
	if (samples.length === 0 || clipDurationSec <= 0) {
		return 1;
	}

	const progress = Math.max(0, Math.min(1, clipTimeSec / clipDurationSec));
	const rawIndex = progress * (samples.length - 1);
	const lo = Math.floor(rawIndex);
	const hi = Math.min(samples.length - 1, lo + 1);
	return samples[lo] + (samples[hi] - samples[lo]) * (rawIndex - lo);
}

interface AudioWaveformProps {
	sourceKey: string;
	sourceFile?: File;
	audioUrl?: string;
	audioBuffer?: AudioBuffer;
	gainSamples?: number[];
	pixelsPerSecond: number;
	clipDurationSec: number;
	retime?: RetimeConfig;
	sourceStartSec: number;
	color?: string;
	burnColor?: string;
	className?: string;
	/** The timeline clip it belongs to: redrawn when a ripple moves that clip across the view's edge. */
	clipId?: string;
}

/**
 * The bars are an SVG path, not a canvas. Every canvas is its own compositor layer
 * (CPU-backed ones too): with 300 clips that was ~300 canvas layers plus ~225 more
 * pushed up by overlap, and every zoom step re-allocated each canvas's bitmap —
 * ~50 ms a step. A path paints into the track like the rest of the clip.
 */
const SVG_NS = "http://www.w3.org/2000/svg";
const EMPTY_SIGNATURE = "empty";

export function AudioWaveform({
	sourceKey,
	sourceFile,
	audioUrl,
	audioBuffer,
	gainSamples,
	pixelsPerSecond,
	clipDurationSec,
	retime,
	sourceStartSec,
	color = TIMELINE_AUDIO_WAVEFORM_COLOR,
	burnColor = WAVEFORM_BURN_COLOR,
	className = "",
	clipId,
}: AudioWaveformProps) {
	const svgRef = useRef<SVGSVGElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const summaryRef = useRef<SourceWaveformSummary | null>(null);
	const waveformConfigRef = useCommittedRef({
		gainSamples,
		pixelsPerSecond,
		clipDurationSec,
		retime,
		sourceStartSec,
		color,
		burnColor,
	});
	const scrollParentRef = useRef<HTMLElement | null>(null);
	const heightRef = useRef<number>(0);
	const lastRenderSignatureRef = useRef<string | null>(null);
	const lastGainSamplesRef = useRef<number[] | undefined>(undefined);

	// Off screen or not loaded: cleared once. Clearing again on every zoom/scroll step touched ~300 SVGs a frame.
	const clearWave = useCallback(() => {
		if (lastRenderSignatureRef.current === EMPTY_SIGNATURE) return;
		const svg = svgRef.current;
		if (svg) {
			for (const path of svg.children) path.setAttribute("d", "");
		}
		lastRenderSignatureRef.current = EMPTY_SIGNATURE;
	}, []);
	const clearIfDrawn = useCallback(
		() => (lastRenderSignatureRef.current === EMPTY_SIGNATURE ? null : clearWave),
		[clearWave],
	);

	// Read phase (layout reads only). Returns the write phase, or null if nothing changed.
	const measureVisible = useCallback((): (() => void) | null => {
		const container = containerRef.current;
		const svg = svgRef.current;
		const summary = summaryRef.current;
		const height = heightRef.current;

		if (!container || !svg || !summary || height <= 0) {
			return clearIfDrawn();
		}

		const containerRect = container.getBoundingClientRect();
		const elementWidth = containerRect.width;
		if (elementWidth <= 0) {
			return clearIfDrawn();
		}

		const scrollParent = scrollParentRef.current;

		let clipLeft: number;
		let clipRight: number;

		if (scrollParent) {
			const parentRect = scrollParent.getBoundingClientRect();
			clipLeft = Math.max(0, parentRect.left - containerRect.left);
			clipRight = Math.min(elementWidth, parentRect.right - containerRect.left);
		} else {
			clipLeft = Math.max(0, -containerRect.left);
			clipRight = Math.min(
				elementWidth,
				window.innerWidth - containerRect.left,
			);
		}

		const visibleWidth = clipRight - clipLeft;
		if (visibleWidth <= 0) {
			return clearIfDrawn();
		}

		const {
			gainSamples: gainSamplesValue,
			pixelsPerSecond: pixelsPerSecondProp,
			clipDurationSec: clipDurationSecValue,
			retime: retimeValue,
			sourceStartSec: sourceStartSecValue,
			color: colorValue,
			burnColor: burnColorValue,
		} = waveformConfigRef.current;
		// The live zoom (set on every wheel step), not the prop of the last render.
		const pixelsPerSecondValue = getLivePixelsPerSecond() || pixelsPerSecondProp;
		const barCount = Math.max(1, Math.floor(visibleWidth / BAR_STEP));
		// Cheap to build for ~300 clips per frame: the gain curve is compared by identity, not serialised.
		const renderSignature = [
			elementWidth,
			clipLeft,
			clipRight,
			height,
			clipDurationSecValue,
			sourceStartSecValue,
			pixelsPerSecondValue,
			retimeValue ? JSON.stringify(retimeValue) : "",
			summary.sourceKey,
			summary.sampleRate,
			summary.totalSamples,
			summary.bucketSize,
			colorValue,
			burnColorValue,
		].join("|");
		if (lastRenderSignatureRef.current === renderSignature && lastGainSamplesRef.current === gainSamplesValue) {
			return null;
		}
		lastRenderSignatureRef.current = renderSignature;
		lastGainSamplesRef.current = gainSamplesValue;

		// Write phase: runs after every waveform on screen has measured, so a
		// zoom/scroll costs one layout instead of one per clip.
		return () => {
			svg.setAttribute("width", `${visibleWidth}`);
			svg.setAttribute("height", `${height}`);
			svg.setAttribute("viewBox", `0 0 ${visibleWidth} ${height}`);
			svg.style.left = `${clipLeft}px`;

			const sampleBuckets = buildWaveformSampleBuckets({
				clipLeftPx: clipLeft,
				clipRightPx: clipRight,
				barCount,
				pixelsPerSecond: pixelsPerSecondValue,
				clipDurationSec: clipDurationSecValue,
				sourceStartSec: sourceStartSecValue,
				retime: retimeValue,
				sampleRate: summary.sampleRate,
				maxSampleExclusive: summary.totalSamples,
				barStepPx: BAR_STEP,
			});
			const amplitudes = sampleSourceWaveformSummary({
				summary,
				buckets: sampleBuckets,
			});

			let bars = "";
			let burns = "";
			for (let i = 0; i < barCount; i++) {
				const barCenterPx = clipLeft + i * BAR_STEP + BAR_WIDTH * 0.5;
				const clipCenterSec = Math.max(
					0,
					Math.min(clipDurationSecValue, barCenterPx / pixelsPerSecondValue),
				);
				const gain =
					gainSamplesValue != null
						? sampleGainAtClipTime({
								samples: gainSamplesValue,
								clipTimeSec: clipCenterSec,
								clipDurationSec: clipDurationSecValue,
							})
						: 1;
				const amplitude = Math.max(0, amplitudes[i] ?? 0);
				const outputAmplitude = amplitude * Math.max(0, gain);
				const fraction = getBarFractionFromOutputAmplitude({ outputAmplitude });
				const barH = fraction > 0 ? Math.max(1, fraction * height) : 0;
				if (barH <= 0) {
					continue;
				}
				const x = i * BAR_STEP;
				const top = Math.round((height - barH) * 2) / 2;
				bars += `M${x} ${top}h${BAR_WIDTH}V${height}h-${BAR_WIDTH}z`;
				if (outputAmplitude > 1) {
					burns += `M${x} ${top}h${BAR_WIDTH}v1h-${BAR_WIDTH}z`;
				}
			}
			const [barPath, burnPath] = svg.children;
			barPath?.setAttribute("d", bars);
			barPath?.setAttribute("fill", colorValue);
			burnPath?.setAttribute("d", burns);
			burnPath?.setAttribute("fill", burnColorValue);
		};
	}, [clearIfDrawn, waveformConfigRef]);

	const drawVisible = useCallback(
		() => scheduleTimelineDraw(measureVisible),
		[measureVisible],
	);

	useEffect(() => {
		let isCancelled = false;
		summaryRef.current = null;
		clearWave();

		void waveformCache
			.getSourceSummary({
				sourceKey,
				audioBuffer,
				sourceFile,
				audioUrl,
			})
			.then((summary) => {
				if (isCancelled) {
					return;
				}
				summaryRef.current = summary;
				drawVisible();
			})
			.catch(() => {
				// Waveform loading failed (e.g. corrupt file, unsupported format).
				// Fail silently — a missing waveform is preferable to an error state.
				if (!isCancelled) {
					clearWave();
				}
			});

		return () => {
			isCancelled = true;
		};
	}, [audioBuffer, audioUrl, clearWave, drawVisible, sourceFile, sourceKey]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: redraws when the zoom, the trim or the colours change; drawVisible reads them from refs
	useLayoutEffect(() => {
		drawVisible();
	}, [
		drawVisible,
		gainSamples,
		pixelsPerSecond,
		clipDurationSec,
		retime,
		sourceStartSec,
		color,
		burnColor,
	]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}

		// The tracks scroller is tagged; walking up with getComputedStyle forced a
		// style recalc for every clip that mounted (undo/redo, scrolling in).
		scrollParentRef.current =
			container.closest<HTMLElement>("[data-timeline-tracks-scroll]") ??
			findScrollParent({ element: container });
		const scrollParent = scrollParentRef.current;
		if (!scrollParent) {
			return;
		}

		const handleScroll = () => {
			drawVisible();
		};
		scrollParent.addEventListener("scroll", handleScroll, { passive: true });
		return () => scrollParent.removeEventListener("scroll", handleScroll);
	}, [drawVisible]);

	// Zoom: the live pixels per second changed (no re-render of this clip needed).
	useEffect(() => subscribeLivePixelsPerSecond(drawVisible), [drawVisible]);
	// The clip moved without a re-render (a ripple) and its visible part changed.
	useEffect(
		() => (clipId ? subscribeClipMoved(clipId, drawVisible) : undefined),
		[clipId, drawVisible],
	);

	const onResize = useCallback(
		(entry: ResizeObserverEntry) => {
			heightRef.current = entry.contentRect.height;
			drawVisible();
		},
		[drawVisible],
	);

	useResizeObserver({ ref: containerRef, onResize });

	return (
		// Not positioned: the bars are placed in the parent strip (positioned, same box). One paint layer
		// less per clip.
		<div ref={containerRef} className={cn("size-full", className)}>
			<svg ref={svgRef} xmlns={SVG_NS} className="absolute bottom-0" aria-hidden="true" shapeRendering="crispEdges">
				<path />
				<path />
			</svg>
		</div>
	);
}
