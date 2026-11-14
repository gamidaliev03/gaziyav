"use client";

import { useEffect, useRef } from "react";
import { useEditor } from "@/editor/use-editor";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";
import { resolveInOutRange, useInOutStore } from "./store";

/**
 * In→Out band on the timeline ruler (I / O / X marks, ⌥X clears). Drag an edge to move
 * In or Out, its middle to slide both; the small × clears it.
 */
export function InOutRangeOverlay({
	pixelsPerSecond,
}: {
	pixelsPerSecond: number;
}) {
	const rootRef = useRef<HTMLDivElement>(null);
	const editor = useEditor();
	const inPoint = useInOutStore((s) => s.inPoint);
	const outPoint = useInOutStore((s) => s.outPoint);
	const duration = useEditor((e) => e.timeline.getTotalDuration());
	const projectId = useEditor((e) => e.project.getActiveOrNull()?.metadata.id ?? null);
	// Marks belong to the project they were set in: opening another one starts without them (export and lipsync
	// read the same store, so they don't carry over either).
	useEffect(() => {
		if (projectId && useInOutStore.getState().projectId !== projectId) {
			useInOutStore.setState({ projectId, inPoint: null, outPoint: null });
		}
	}, [projectId]);
	const range = resolveInOutRange({ inPoint, outPoint, duration });
	if (!range) return null;

	const left = (range.start / TICKS_PER_SECOND) * pixelsPerSecond;
	const width = Math.max(
		2,
		((range.end - range.start) / TICKS_PER_SECOND) * pixelsPerSecond,
	);

	const startEdgeDrag = (edge: "in" | "out") => (event: React.MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		const ruler = rootRef.current?.parentElement;
		if (!ruler) return;
		const toTicks = (clientX: number) => {
			const x = clientX - ruler.getBoundingClientRect().left;
			const ticks = Math.round((x / pixelsPerSecond) * TICKS_PER_SECOND);
			return Math.max(0, Math.min(duration, ticks));
		};
		const onMove = (move: MouseEvent) => {
			const time = toTicks(move.clientX);
			const store = useInOutStore.getState();
			const current = resolveInOutRange({
				inPoint: store.inPoint,
				outPoint: store.outPoint,
				duration,
			});
			if (!current) return;
			if (edge === "in" && time < current.end) {
				store.setRange({ start: time, end: current.end, projectId });
			} else if (edge === "out" && time > current.start) {
				store.setRange({ start: current.start, end: time, projectId });
			}
		};
		const onUp = () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	};

	// The whole range by its middle: In and Out slide together, the length kept (the owner, 14.11: «чтоб марк ин и аут
	// мог курсором целиком перемещать по таймлайну, ткнув в середину, а не за края только»). A press that does not
	// move stays what it was — a click on the ruler: the playhead goes there.
	const startRangeDrag = (event: React.MouseEvent) => {
		if (event.button !== 0) return;
		const ruler = rootRef.current?.parentElement;
		const marks = useInOutStore.getState();
		const from = resolveInOutRange({ inPoint: marks.inPoint, outPoint: marks.outPoint, duration });
		if (!ruler || !from) return;
		event.preventDefault();
		event.stopPropagation();
		const x0 = event.clientX;
		const length = from.end - from.start;
		let moved = false;
		const onMove = (move: MouseEvent) => {
			const dx = move.clientX - x0;
			if (!moved && Math.abs(dx) < 3) return;
			moved = true;
			const shift = Math.round((dx / pixelsPerSecond) * TICKS_PER_SECOND);
			const start = Math.max(0, Math.min(Math.max(0, duration - length), from.start + shift));
			useInOutStore.getState().setRange({ start, end: start + length, projectId });
		};
		const onUp = (up: MouseEvent) => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
			if (moved) return;
			const x = up.clientX - ruler.getBoundingClientRect().left;
			const ticks = Math.max(0, Math.min(duration, Math.round((x / pixelsPerSecond) * TICKS_PER_SECOND)));
			editor.playback.seek({ time: mediaTime({ ticks }) });
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	};

	const stop = (event: React.MouseEvent) => event.stopPropagation();

	return (
		<div
			ref={rootRef}
			data-testid="in-out-range"
			aria-label="In / Out range"
			className="bg-primary/25 pointer-events-none absolute inset-y-0 z-10"
			style={{ left, width }}
		>
			<div
				className="pointer-events-auto absolute inset-y-0 right-1 left-1 cursor-grab active:cursor-grabbing"
				title="Drag to move the range"
				data-testid="in-out-body"
				onMouseDown={startRangeDrag}
			/>
			<div
				className="bg-primary pointer-events-auto absolute inset-y-0 -left-0.5 w-1 cursor-ew-resize"
				title="Drag to move In"
				data-testid="in-out-in-handle"
				onMouseDown={startEdgeDrag("in")}
			/>
			<div
				className="bg-primary pointer-events-auto absolute inset-y-0 -right-0.5 w-1 cursor-ew-resize"
				title="Drag to move Out"
				data-testid="in-out-out-handle"
				onMouseDown={startEdgeDrag("out")}
			/>
			<div
				className="bg-primary text-primary-foreground pointer-events-auto absolute top-0 left-1.5 flex h-3.5 items-center rounded-b px-0.5 text-[10px] leading-none font-medium"
				data-testid="in-out-chip"
				onMouseDown={stop}
				onClick={stop}
			>
				{/* no «In … · Out … · … s» words (the owner, 14.11: «эта сноска на марках не нужна нигде… только возможность
				    удалить, крестик маленький») — the range itself shows where it is */}
				<button
					type="button"
					aria-label="Clear In / Out (⌥X)"
					title="Clear In / Out (⌥X)"
					className="hover:bg-primary-foreground/20 rounded px-0.5"
					data-testid="in-out-clear"
					onClick={() => useInOutStore.getState().clear()}
				>
					×
				</button>
			</div>
		</div>
	);
}
