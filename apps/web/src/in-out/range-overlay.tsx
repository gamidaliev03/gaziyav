"use client";

import { useEffect, useRef } from "react";
import { useEditor } from "@/editor/use-editor";
import { TICKS_PER_SECOND } from "@/wasm";
import { resolveInOutRange, useInOutStore } from "./store";
import { useT } from "@/i18n";

function formatTime(ticks: number): string {
	const seconds = ticks / TICKS_PER_SECOND;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, "0")}`;
}

/**
 * In→Out band on the timeline ruler (I / O / X marks, ⌥X clears). Drag an edge to move
 * In or Out; the chip shows the range and its × clears it.
 */
export function InOutRangeOverlay({
	pixelsPerSecond,
}: {
	pixelsPerSecond: number;
}) {
	const t = useT();
	const rootRef = useRef<HTMLDivElement>(null);
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
				className="bg-primary text-primary-foreground pointer-events-auto absolute top-0 left-1.5 flex h-3.5 items-center gap-1 rounded-b px-1 text-[9px] leading-none font-medium whitespace-nowrap"
				data-testid="in-out-chip"
				onMouseDown={stop}
				onClick={stop}
			>
				<span>
					{t("In {a} · Out {b} · {len} s", { a: inPoint !== null ? formatTime(range.start) : "—", b: outPoint !== null ? formatTime(range.end) : "—", len: ((range.end - range.start) / TICKS_PER_SECOND).toFixed(1) })}
				</span>
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
