"use client";

import * as React from "react";

import { cn } from "@/utils/ui";
import { crossesDetent, haptic, sliderDetents } from "@/haptics";

// One-thumb horizontal slider without Radix. Radix's thumb measured itself (useSize: a new ResizeObserver and an
// offsetWidth read in a layout effect) every time its effects ran, and the inspector is kept mounted in <Activity>,
// whose effects run again each time it shows: a forced layout per slider on every ⌫/⌘Z that hides and shows the clip
// panel (~1.4 ms per timeline edit at 264 clips). The thumb's size is known from its class, so nothing is measured.
type SliderProps = Omit<React.HTMLAttributes<HTMLSpanElement>, "defaultValue" | "dir"> & {
	value?: number[];
	defaultValue?: number[];
	onValueChange?: (value: number[]) => void;
	/** After a drag or a key step that changed the value. */
	onValueCommit?: (value: number[]) => void;
	min?: number;
	max?: number;
	step?: number;
	disabled?: boolean;
	trackClassName?: string;
	rangeClassName?: string;
	thumbClassName?: string;
	/** Thumb width in px (its class sets it): keeps the thumb inside the track at both ends. */
	thumbSize?: number;
	thumbTabIndex?: number;
	/** A centred slider: the fill runs from this value (e.g. 0 on −100…100) to the thumb, not from the left end. */
	origin?: number;
	/** Values a drag taps the trackpad at (besides the ends, the origin and 0), e.g. 1 for a speed of 1×. */
	detents?: number[];
};

const decimals = (step: number) => (String(step).split(".")[1] ?? "").length;

const Slider = React.forwardRef<HTMLSpanElement, SliderProps>(
	(
		{
			className,
			value: valueProp,
			defaultValue,
			onValueChange,
			onValueCommit,
			min = 0,
			max = 100,
			step = 1,
			disabled = false,
			trackClassName,
			rangeClassName,
			thumbClassName,
			thumbSize = 16,
			thumbTabIndex = 0,
			origin,
			detents,
			"aria-label": ariaLabel,
			onPointerDown,
			onPointerMove,
			onPointerUp,
			...props
		},
		ref,
	) => {
		const [uncontrolled, setUncontrolled] = React.useState(defaultValue?.[0] ?? min);
		const value = valueProp?.[0] ?? uncontrolled;
		const thumb = React.useRef<HTMLSpanElement>(null);
		const atSlideStart = React.useRef<number | null>(null);
		// A press on the handle grabs it where it was pressed (the value doesn't jump to the pointer); a press on the track
		// moves the handle there.
		const grab = React.useRef(0);
		const latest = React.useRef(value);
		latest.current = value;

		const snap = (raw: number) => {
			const stepped = Math.round((raw - min) / step) * step + min;
			return Math.min(max, Math.max(min, Number(stepped.toFixed(decimals(step)))));
		};
		const set = (next: number, commit: boolean) => {
			const v = snap(next);
			if (v === latest.current) return false;
			latest.current = v;
			if (valueProp === undefined) setUncontrolled(v);
			onValueChange?.([v]);
			if (commit) onValueCommit?.([v]);
			return true;
		};
		// A drag that reaches an end or crosses a natural value (0, the origin, a detent) taps the trackpad once (haptics).
		const slide = (next: number) => {
			const prev = latest.current;
			if (!set(next, false)) return;
			const at = sliderDetents(min, max, origin);
			if (crossesDetent(prev, latest.current, detents ? at.concat(detents) : at)) haptic("limit");
		};
		const fromPointer = (event: React.PointerEvent<HTMLSpanElement>) => {
			const rect = event.currentTarget.getBoundingClientRect();
			return min + ((event.clientX - rect.left) / Math.max(1, rect.width)) * (max - min);
		};

		const toPercent = (v: number) => (max > min ? ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100 : 0);
		const percent = toPercent(value);
		const from = origin === undefined ? 0 : toPercent(origin);
		// Radix's in-bounds offset: half a thumb in at 0 %, none at 50 %, half a thumb back at 100 %.
		const inBounds = (thumbSize / 2) * (1 - percent / 50);
		const state = disabled ? "" : undefined;

		return (
			<span
				ref={ref}
				data-orientation="horizontal"
				data-disabled={state}
				aria-disabled={disabled || undefined}
				className={cn("relative flex w-full touch-none items-center select-none", className)}
				{...props}
				onPointerDown={(event) => {
					onPointerDown?.(event);
					if (disabled || event.button !== 0 || event.defaultPrevented) return;
					event.currentTarget.setPointerCapture(event.pointerId);
					// keep the focus where it is until the thumb takes it (no focus ring on a mouse press)
					event.preventDefault();
					atSlideStart.current = latest.current;
					thumb.current?.focus({ preventScroll: true });
					const onHandle = Boolean(thumb.current?.contains(event.target as Node));
					grab.current = onHandle ? fromPointer(event) - latest.current : 0;
					if (!onHandle) slide(fromPointer(event));
				}}
				onPointerMove={(event) => {
					onPointerMove?.(event);
					if (atSlideStart.current === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
					slide(fromPointer(event) - grab.current);
				}}
				onPointerUp={(event) => {
					onPointerUp?.(event);
					if (atSlideStart.current === null) return;
					if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
					const started = atSlideStart.current;
					atSlideStart.current = null;
					if (latest.current !== started) onValueCommit?.([latest.current]);
				}}
				onLostPointerCapture={() => {
					if (atSlideStart.current === null) return;
					const started = atSlideStart.current;
					atSlideStart.current = null;
					if (latest.current !== started) onValueCommit?.([latest.current]);
				}}
			>
				<span
					data-orientation="horizontal"
					data-disabled={state}
					className={cn("bg-accent relative h-1.5 w-full grow overflow-hidden rounded-full", trackClassName)}
				>
					<span
						data-orientation="horizontal"
						data-disabled={state}
						className={cn("bg-primary absolute h-full", rangeClassName)}
						style={{ left: `${Math.min(from, percent)}%`, right: `${100 - Math.max(from, percent)}%` }}
					/>
				</span>
				<span
					style={{ position: "absolute", left: `calc(${percent}% + ${inBounds}px)`, transform: "translateX(-50%)" }}
				>
					<span
						ref={thumb}
						role="slider"
						aria-label={ariaLabel}
						aria-valuemin={min}
						aria-valuemax={max}
						aria-valuenow={value}
						aria-orientation="horizontal"
						aria-disabled={disabled || undefined}
						data-orientation="horizontal"
						data-disabled={state}
						tabIndex={disabled ? undefined : thumbTabIndex}
						onKeyDown={(event) => {
							if (disabled) return;
							const big = step * 10;
							const delta: Record<string, number> = {
								ArrowRight: event.shiftKey ? big : step,
								ArrowUp: event.shiftKey ? big : step,
								ArrowLeft: event.shiftKey ? -big : -step,
								ArrowDown: event.shiftKey ? -big : -step,
								PageUp: big,
								PageDown: -big,
							};
							if (event.key === "Home") set(min, true);
							else if (event.key === "End") set(max, true);
							else if (event.key in delta) set(latest.current + delta[event.key], true);
							else return;
							event.preventDefault();
						}}
						className={cn(
							"border-primary/50 bg-background focus-visible:ring-ring block size-4 cursor-grab rounded-full border shadow-sm focus-visible:ring-1 focus-visible:outline-hidden active:cursor-grabbing data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
							thumbClassName,
						)}
					/>
				</span>
			</span>
		);
	},
);
Slider.displayName = "Slider";

export { Slider };
