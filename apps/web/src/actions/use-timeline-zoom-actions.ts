"use client";

import { type RefObject, useEffect, useRef } from "react";
import { useActionHandler } from "@/actions/use-action-handler";
import { useEditor } from "@/editor/use-editor";
import { timelineTimeToPixels } from "@/timeline/pixel-utils";
import { BASE_TIMELINE_PIXELS_PER_SECOND, TIMELINE_ZOOM_MAX } from "@/timeline/scale";
import { TICKS_PER_SECOND } from "@/wasm";
import { isPointerSeek } from "@/timeline/pointer-seek";

const ZOOM_STEP = 1.5;
/** Share of the visible width the whole edit takes after ⇧Z. */
const FIT_FILL = 0.95;

/** The zoom at which `seconds` fill the viewport the way ⇧Z fits the edit. */
export function fitZoomFor({ viewport, seconds, minZoom }: { viewport: number; seconds: number; minZoom: number }): number {
	if (viewport <= 0 || seconds <= 0) return minZoom;
	const fit = (viewport * FIT_FILL) / (seconds * BASE_TIMELINE_PIXELS_PER_SECOND);
	return Math.max(minZoom, Math.min(TIMELINE_ZOOM_MAX, fit));
}

/**
 * = / − / ⇧Z timeline zoom, and keyboard seeks (End, ↑/↓, J/L, frame steps) keep the
 * playhead in view. Bound by the timeline, which owns the zoom state and scroll elements.
 */
export function useTimelineZoomActions({
	setZoomLevel,
	minZoom,
	zoomLevel,
	tracksScrollRef,
	rulerScrollRef,
}: {
	setZoomLevel: (zoom: number | ((previous: number) => number)) => void;
	minZoom: number;
	zoomLevel: number;
	tracksScrollRef: RefObject<HTMLDivElement | null>;
	rulerScrollRef: RefObject<HTMLDivElement | null>;
}) {
	const editor = useEditor();
	const zoomRef = useRef(zoomLevel);
	zoomRef.current = zoomLevel;

	const scrollTo = (left: number) => {
		const tracks = tracksScrollRef.current;
		if (!tracks) return;
		tracks.scrollLeft = Math.max(0, left);
		if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = tracks.scrollLeft;
	};

	useActionHandler(
		"timeline-zoom-in",
		() => setZoomLevel((previous) => Math.min(TIMELINE_ZOOM_MAX, previous * ZOOM_STEP)),
		undefined,
	);
	useActionHandler(
		"timeline-zoom-out",
		() => setZoomLevel((previous) => Math.max(minZoom, previous / ZOOM_STEP)),
		undefined,
	);
	const zoomToFit = () => {
		const viewport = tracksScrollRef.current?.clientWidth ?? 0;
		const seconds = editor.timeline.getTotalDuration() / TICKS_PER_SECOND;
		if (viewport <= 0 || seconds <= 0) {
			setZoomLevel(minZoom);
			return;
		}
		setZoomLevel(fitZoomFor({ viewport, seconds, minZoom }));
		// After the zoom layout settles, show the edit from its start.
		requestAnimationFrame(() => requestAnimationFrame(() => scrollTo(0)));
	};
	const zoomToFitRef = useRef(zoomToFit);
	zoomToFitRef.current = zoomToFit;

	useActionHandler("timeline-zoom-fit", () => zoomToFit(), undefined);

	// First media on an empty timeline: fit it, like ⇧Z.
	useEffect(() => {
		let wasEmpty = editor.timeline.getTotalDuration() <= 0;
		return editor.timeline.subscribe(() => {
			const isEmpty = editor.timeline.getTotalDuration() <= 0;
			if (wasEmpty && !isEmpty) {
				requestAnimationFrame(() => zoomToFitRef.current());
			}
			wasEmpty = isEmpty;
		});
	}, [editor]);

	const scrollPage = (direction: 1 | -1) => {
		const tracks = tracksScrollRef.current;
		if (!tracks) return;
		scrollTo(tracks.scrollLeft + direction * tracks.clientWidth * 0.9);
	};
	useActionHandler("timeline-page-back", () => scrollPage(-1), undefined);
	useActionHandler("timeline-page-forward", () => scrollPage(1), undefined);

	// Keyboard seeks don't auto-scroll like playback does: keep the playhead visible.
	// biome-ignore lint/correctness/useExhaustiveDependencies: one seek listener per editor; the scroll helpers read refs
	useEffect(
		() =>
			editor.playback.onSeek((time) => {
				if (editor.playback.getIsScrubbing() || editor.playback.getIsPlaying() || isPointerSeek()) return;
				const tracks = tracksScrollRef.current;
				if (!tracks) return;
				const x = timelineTimeToPixels({ time, zoomLevel: zoomRef.current });
				const width = tracks.clientWidth;
				// An edit that pulled the playhead back inside a shorter film (a trim, a delete) moves the view only when the
				// playhead left it: a trim at the fitted view jumped it 324 px, the end lying in the 80 px margin (tlc C1b).
				const margin = editor.playback.isClampSeek() ? 0 : Math.min(80, width * 0.1);
				if (x < tracks.scrollLeft + margin || x > tracks.scrollLeft + width - margin) {
					scrollTo(x - width / 2);
				}
			}),
		[editor],
	);
}
