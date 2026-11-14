"use client";

// CapCut's inspector tabs (Video · Audio · Speed · Animation · Adjust · AI): full names in one row, the active one
// in the accent colour with a line under it. When they don't fit the panel, the row scrolls and an arrow shows on
// the side that has more — names are never cut to «V…». As in CapCut the arrows have their own place: the row ends
// where an arrow begins, so no tab ever lies under one (an arrow over «AI» took the clicks meant for the tab). That
// place is kept on both sides as long as the row overflows at all, whether or not each arrow is drawn: an arrow
// appearing used to shift the whole row by its width under the pointer, and a click aimed at «Adjust» landed on
// «Animation». A row that fits has no arrows and loses nothing.
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/utils/ui";

export function TabStrip<T extends string>({
	label,
	value,
	items,
	onValueChange,
	dataAttribute,
}: {
	label: string;
	value: T;
	items: { value: T; label: string }[];
	onValueChange: (value: T) => void;
	dataAttribute: string;
}) {
	const scroller = useRef<HTMLDivElement>(null);
	const [more, setMore] = useState({ left: false, right: false });
	const measure = useCallback(() => {
		const el = scroller.current;
		if (!el) return;
		const left = el.scrollLeft > 1;
		const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
		setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
	}, []);
	// Sizes are read where the browser has laid the row out already — the ResizeObserver's callback, a scroll. Read
	// while mounting, they forced a style and layout pass of the whole page inside the frame: 60 ms of a ⌘Z whenever the
	// clip's panel came back with its effects (perf-tracks10).
	useEffect(() => {
		const el = scroller.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [measure]);
	// The chosen tab is always in view (after a click on a half-hidden one, or a tab chosen elsewhere) — and again if an
	// arrow appears right after (it takes room from the row and could cover the tab just scrolled to). Only for a new
	// choice: the panel coming back with the same tab reveals nothing, and the arrows' own scrolling isn't pulled back.
	const revealing = useRef(false);
	const shownValue = useRef<T | null>(null);
	const reveal = useCallback(() => {
		scroller.current?.querySelector<HTMLElement>(`[${dataAttribute}="${value}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [dataAttribute, value]);
	useEffect(() => {
		if (shownValue.current === value) return;
		const first = shownValue.current === null;
		shownValue.current = value;
		revealing.current = true;
		// first show: after the frame is laid out (no forced layout while mounting)
		const frame = first ? requestAnimationFrame(reveal) : 0;
		if (!first) {
			reveal();
			measure();
		}
		const done = setTimeout(() => {
			revealing.current = false;
		}, 400);
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(done);
		};
	}, [value, reveal, measure]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-reveal when an arrow appears or goes, only while revealing
	useEffect(() => {
		if (revealing.current) reveal();
	}, [more.left, more.right, reveal]);
	const nudge = (direction: 1 | -1) => scroller.current?.scrollBy({ left: direction * 120, behavior: "smooth" });
	const overflows = more.left || more.right;
	const step = (direction: 1 | -1) => {
		const index = items.findIndex((item) => item.value === value);
		const next = items[(index + direction + items.length) % items.length];
		if (next) onValueChange(next.value);
	};

	return (
		<div className="flex items-center gap-1">
			{overflows && (
				<button
					type="button"
					aria-label="Previous tabs"
					aria-hidden={!more.left}
					tabIndex={-1}
					disabled={!more.left}
					onClick={() => nudge(-1)}
					className={cn("text-muted-foreground hover:text-foreground flex h-7 w-5 shrink-0 items-center justify-center", !more.left && "invisible")}
				>
					<HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
				</button>
			)}
			<div
				ref={scroller}
				role="tablist"
				aria-label={label}
				onScroll={measure}
				onKeyDown={(event) => {
					if (event.key === "ArrowRight") step(1);
					else if (event.key === "ArrowLeft") step(-1);
					else return;
					event.preventDefault();
				}}
				// 12 px between tabs (design review 05.11: 16 crowded the strip), 8 in a narrow panel (a laptop's window): with 20 a video with sound (Video · Audio · Speed ·
				// Animation · Adjust · AI) overflowed the default Details width and the AI tab was cut off at the edge. The seven
				// tabs of a video (… Tracking · Adjust · AI) need the narrow gap up to 26rem (lead83 shots: «Adjus» cut at 22.4rem).
				// Whatever still overflows fades out at the edge that has more instead of ending mid-letter.
				className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto @max-[26rem]/tabs:gap-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
				style={
					more.left || more.right
						? { maskImage: `linear-gradient(to right, ${more.left ? "transparent, black 18px" : "black"}, ${more.right ? "black calc(100% - 18px), transparent" : "black"})` }
						: undefined
				}
			>
				{items.map((item) => {
					const on = item.value === value;
					return (
						<button
							key={item.value}
							type="button"
							role="tab"
							aria-selected={on}
							tabIndex={on ? 0 : -1}
							{...{ [dataAttribute]: item.value }}
							onClick={() => onValueChange(item.value)}
							className={cn(
								// 12 px in a narrow panel: the seven tabs of a video (… Tracking · Adjust · AI) fit a 20-rem panel without a scroll
								"relative shrink-0 py-1 text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:underline @max-[26rem]/tabs:text-[12px]",
								on ? "text-primary" : "text-muted-foreground hover:text-foreground",
							)}
						>
							{item.label}
							{on && <span aria-hidden="true" className="bg-primary absolute inset-x-0 -bottom-[9px] h-0.5 rounded-full" />}
						</button>
					);
				})}
			</div>
			{overflows && (
				<button
					type="button"
					aria-label="More tabs"
					aria-hidden={!more.right}
					tabIndex={-1}
					disabled={!more.right}
					onClick={() => nudge(1)}
					className={cn("text-muted-foreground hover:text-foreground flex h-7 w-5 shrink-0 items-center justify-center", !more.right && "invisible")}
				>
					<HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
				</button>
			)}
		</div>
	);
}
