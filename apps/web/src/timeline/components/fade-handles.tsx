"use client";

// CapCut's fade handles on a clip: a dot in each top corner. Dragged inward, the clip fades in / out over that length —
// its sound (params fadeIn / fadeOut: audio, and video with sound; the mix envelope plays and exports them) and its
// picture (the In / Out animation «fade»: video and pictures). The faded part is shaded as a wedge. Previewed while
// dragging, one ⌘Z for the step.
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor } from "@/editor/use-editor";
import type { TimelineElement } from "@/timeline/types";
import { TICKS_PER_SECOND } from "@/wasm";
import { useT } from "@/i18n";
import { cn } from "@/utils/ui";

import { fadeLimit, fadeOf, fadeParams, type FadeSide as Side } from "@/timeline/fades";

const MAX_FADE_S = 10;
const STEP_S = 0.05;

export function FadeHandles({ element, trackId }: { element: TimelineElement; trackId: string }) {
	const editor = useEditor();
	const t = useT();
	const surface = useRef<HTMLDivElement>(null);
	const drag = useRef<{ side: Side; pointerId: number; startX: number; start: number; other: number; pps: number; changed: boolean } | null>(null);
	const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
	const duration = element.duration / TICKS_PER_SECOND;
	const fadeIn = fadeOf(element, "in");
	const fadeOut = fadeOf(element, "out");
	// a side may take all the clip the other side leaves (they never cross)
	const limitOf = (side: Side) => fadeLimit(duration, side === "in" ? fadeOut : fadeIn, MAX_FADE_S);
	// A clip with sound shows its fades on its own volume line (it bends at the fade): no second line over it. Only a
	// picture, which has no volume line, gets the shaded wedge.
	const wedge = element.type === "image";

	const begin = useCallback(
		(side: Side) => (event: React.PointerEvent<HTMLButtonElement>) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			const rect = surface.current?.getBoundingClientRect();
			if (!rect || duration <= 0) return;
			editor.selection.setSelectedElements({ elements: [{ trackId, elementId: element.id }] });
			drag.current = { side, pointerId: event.pointerId, startX: event.clientX, start: side === "in" ? fadeIn : fadeOut, other: side === "in" ? fadeOut : fadeIn, pps: rect.width / duration, changed: false };
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		[duration, editor, element.id, fadeIn, fadeOut, trackId],
	);

	const move = useCallback(
		(event: React.PointerEvent<HTMLButtonElement>) => {
			const d = drag.current;
			if (!d || d.pointerId !== event.pointerId) return;
			event.preventDefault();
			// Inward is longer: right for the fade in, left for the fade out.
			const dx = (event.clientX - d.startX) * (d.side === "in" ? 1 : -1);
			// In steps, then held to the limit: rounded after the limit, a fade-in took 3.55 s of the 3.53 s a 1.5 s
			// fade-out leaves on a 151-frame clip, and the two crossed (pro-core, 09.11).
			const seconds = Math.max(0, Math.min(fadeLimit(duration, d.other, MAX_FADE_S), Math.round((d.start + dx / d.pps) / STEP_S) * STEP_S));
			d.changed = d.changed || Math.abs(seconds - d.start) > 1e-6;
			editor.timeline.previewElements({
				updates: [{ trackId, elementId: element.id, updates: { params: fadeParams(element, d.side, seconds) } as Partial<TimelineElement> }],
			});
			setTip({ x: event.clientX + 10, y: event.clientY - 26, text: t(d.side === "in" ? "Fade in {s} s" : "Fade out {s} s", { s: seconds.toFixed(2) }) });
		},
		[duration, editor, element, t, trackId],
	);

	const end = useCallback(
		(event: React.PointerEvent<HTMLButtonElement>) => {
			const d = drag.current;
			if (!d || d.pointerId !== event.pointerId) return;
			drag.current = null;
			setTip(null);
			if (d.changed) editor.timeline.commitPreview();
			else editor.timeline.discardPreview();
		},
		[editor],
	);

	const stop = (event: React.SyntheticEvent) => event.stopPropagation();
	const pct = (seconds: number) => `${duration > 0 ? Math.min(100, (seconds / duration) * 100) : 0}%`;
	const handle = (side: Side, seconds: number) => (
		<button
			type="button"
			tabIndex={-1}
			aria-label={t(side === "in" ? "Fade in" : "Fade out")}
			title={t(side === "in" ? "Fade in — drag right" : "Fade out — drag left")}
			data-fade-handle={side}
			onPointerDown={begin(side)}
			onPointerMove={move}
			onPointerUp={end}
			onPointerCancel={end}
			onMouseDown={stop}
			onClick={stop}
			className={cn(
				"pointer-events-auto absolute top-4 z-10 size-2.5 -translate-x-1/2 cursor-ew-resize rounded-full border border-black/40 bg-white shadow-sm transition-opacity",
				seconds > 0 ? "opacity-90" : "opacity-0 group-hover/clip:opacity-90",
			)}
			// 16 px in from the corner at least: clear of the 12 px trim handle on the clip's edge (a trim started at the top
			// corner set a fade instead — blind test 05.11). Below the 14 px name bar: on it the dot hid the clip's name.
			style={{ left: side === "in" ? `max(16px, ${pct(seconds)})` : `min(calc(100% - 16px), calc(100% - ${pct(seconds)}))` }}
		/>
	);

	return (
		<div ref={surface} className="pointer-events-none absolute inset-y-0 group-data-[narrow]/clip:hidden" style={{ left: 2.5, right: 2.5 }} data-fade-handles="">
			{/* The faded parts: a wedge from the corner, as the sound or the picture rises from nothing. */}
			{wedge && fadeIn > 0 && (
				<svg aria-hidden className="absolute inset-y-0 left-0 h-full" style={{ width: pct(fadeIn) }} preserveAspectRatio="none" viewBox="0 0 100 100" data-fade-wedge="in">
					<polygon points="0,0 100,0 0,100" className="fill-black/35" />
					<line x1="0" y1="100" x2="100" y2="0" className="stroke-white/70" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
				</svg>
			)}
			{wedge && fadeOut > 0 && (
				<svg aria-hidden className="absolute inset-y-0 right-0 h-full" style={{ width: pct(fadeOut) }} preserveAspectRatio="none" viewBox="0 0 100 100" data-fade-wedge="out">
					<polygon points="0,0 100,0 100,100" className="fill-black/35" />
					<line x1="0" y1="0" x2="100" y2="100" className="stroke-white/70" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
				</svg>
			)}
			{limitOf("in") > 0 && handle("in", fadeIn)}
			{limitOf("out") > 0 && handle("out", fadeOut)}
			{tip &&
				createPortal(
					<div className="bg-popover text-popover-foreground pointer-events-none fixed z-[400] rounded-md border px-2 py-1 text-[11px] tabular-nums shadow-md" style={{ left: tip.x, top: tip.y }}>
						{tip.text}
					</div>,
					document.body,
				)}
		</div>
	);
}
