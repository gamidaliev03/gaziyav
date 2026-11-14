"use client";

import { type RefObject, useEffect, useRef } from "react";
import { useEditor } from "@/editor/use-editor";
import { BASE_TIMELINE_PIXELS_PER_SECOND } from "@/timeline/scale";
import { useTimelineStore } from "@/timeline/timeline-store";
import { mediaTime, roundFrameTime, TICKS_PER_SECOND } from "@/wasm";
import { TIMELINE_LAYERS } from "./layers";

/**
 * The line that follows the pointer over the tracks: the Split tool's blade (B), and the Preview axis (S), which also
 * shows the frame under the pointer in the player without moving the playhead. Moved by a transform (no re-render
 * per mouse move); hidden while a button is held (a drag, a trim) and when the pointer leaves the tracks.
 */
export function HoverAxis({ scrollRef, zoomLevel }: { scrollRef: RefObject<HTMLDivElement | null>; zoomLevel: number }) {
	const editor = useEditor();
	const tool = useTimelineStore((s) => s.tool);
	const previewAxis = useTimelineStore((s) => s.previewAxis);
	const lineRef = useRef<HTMLDivElement>(null);
	const zoomRef = useRef(zoomLevel);
	zoomRef.current = zoomLevel;
	const active = tool === "split" || previewAxis !== "off";

	useEffect(() => {
		const scroller = scrollRef.current;
		const line = lineRef.current;
		if (!active || !scroller || !line) return;
		const showsFrame = previewAxis !== "off";
		const hide = () => {
			line.style.display = "none";
			if (showsFrame) editor.playback.setPreviewTime(null);
		};
		const move = (event: MouseEvent) => {
			if (event.buttons !== 0 || editor.playback.getIsPlaying()) {
				hide();
				return;
			}
			const x = event.clientX - scroller.getBoundingClientRect().left + scroller.scrollLeft;
			const raw = mediaTime({ ticks: Math.max(0, Math.round((x / (BASE_TIMELINE_PIXELS_PER_SECOND * zoomRef.current)) * TICKS_PER_SECOND)) });
			const fps = editor.project.getActiveOrNull()?.settings.fps;
			const time = fps ? roundFrameTime({ time: raw, fps }) : raw;
			const px = (time / TICKS_PER_SECOND) * BASE_TIMELINE_PIXELS_PER_SECOND * zoomRef.current;
			line.style.display = "";
			line.style.transform = `translateX(${px}px)`;
			if (showsFrame) editor.playback.setPreviewTime(time);
		};
		scroller.addEventListener("mousemove", move, { passive: true });
		scroller.addEventListener("mouseleave", hide);
		scroller.addEventListener("mousedown", hide);
		return () => {
			scroller.removeEventListener("mousemove", move);
			scroller.removeEventListener("mouseleave", hide);
			scroller.removeEventListener("mousedown", hide);
			hide();
		};
	}, [active, previewAxis, scrollRef, editor]);

	if (!active) return null;
	return (
		<div
			ref={lineRef}
			data-hover-axis={tool === "split" ? "split" : "preview"}
			className={tool === "split" ? "pointer-events-none absolute top-0 bottom-0 left-0 w-px bg-red-400" : "pointer-events-none absolute top-0 bottom-0 left-0 w-px bg-white/70"}
			style={{ display: "none", zIndex: TIMELINE_LAYERS.dragLine }}
		/>
	);
}
