"use client";

import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import * as React from "react";
import { cn } from "@/utils/ui";

/** The one look of a filter chip (categories of Audio, Effects, Transitions, Graphics). */
export function chipClass(active: boolean, className?: string) {
	return cn(
		"focus-visible:ring-ring inline-flex h-6 shrink-0 cursor-pointer items-center gap-0.5 rounded-full border px-2.5 text-[11px] font-medium whitespace-nowrap transition-colors focus-visible:ring-1 focus-visible:outline-hidden",
		active
			? "border-primary/70 bg-primary/15 text-foreground"
			: "bg-accent/60 text-foreground/70 hover:bg-accent hover:text-foreground border-transparent",
		className,
	);
}

export const Chip = React.forwardRef<
	HTMLButtonElement,
	React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
>(({ active = false, className, ...props }, ref) => (
	<button
		ref={ref}
		type="button"
		aria-pressed={active}
		data-active={active || undefined}
		className={chipClass(active, className)}
		{...props}
	/>
));
Chip.displayName = "Chip";

/**
 * One row of chips that scrolls sideways instead of wrapping into several rows. A clipped edge fades out and gets
 * an arrow, the mouse wheel scrolls it, and the active chip is kept in view.
 */
export function ChipRow({
	children,
	className,
	"aria-label": ariaLabel,
}: {
	children: React.ReactNode;
	className?: string;
	"aria-label"?: string;
}) {
	const ref = React.useRef<HTMLDivElement>(null);
	const [edges, setEdges] = React.useState({ left: false, right: false });

	const measure = React.useCallback(() => {
		const el = ref.current;
		if (!el) return;
		const left = el.scrollLeft > 1;
		const right = el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
		setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
	}, []);

	React.useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [measure]);

	// A newly active chip is scrolled into view, sideways only (scrollIntoView would also scroll the panel).
	const lastActive = React.useRef<HTMLElement | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the chips change (a new active one)
	React.useEffect(() => {
		const row = ref.current;
		const chip = row?.querySelector<HTMLElement>("[data-active]") ?? null;
		if (row && chip && chip !== lastActive.current) {
			const start = chip.offsetLeft;
			const end = start + chip.offsetWidth;
			if (start < row.scrollLeft) row.scrollLeft = start - 24;
			else if (end > row.scrollLeft + row.clientWidth) row.scrollLeft = end - row.clientWidth + 24;
		}
		lastActive.current = chip;
		measure();
	}, [children, measure]);

	const scrollBy = (direction: 1 | -1) => {
		const el = ref.current;
		if (el) el.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: "smooth" });
	};

	const mask = `linear-gradient(to right, ${edges.left ? "transparent, black 28px" : "black"}, ${edges.right ? "black calc(100% - 28px), transparent" : "black"})`;

	return (
		<div className={cn("relative min-w-0", className)}>
			{/* biome-ignore lint/a11y/useSemanticElements: a row of toggle chips; a <fieldset> would bring a border and a legend */}
			<div
				ref={ref}
				role="group"
				aria-label={ariaLabel}
				className="scrollbar-hidden relative flex gap-1 overflow-x-auto"
				style={{ maskImage: mask, WebkitMaskImage: mask }}
				onScroll={measure}
				onWheel={(event) => {
					// a vertical wheel over the chips scrolls them sideways
					if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY;
				}}
			>
				{children}
			</div>
			{edges.left && <EdgeButton side="left" onClick={() => scrollBy(-1)} />}
			{edges.right && <EdgeButton side="right" onClick={() => scrollBy(1)} />}
		</div>
	);
}

function EdgeButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
	return (
		<button
			type="button"
			tabIndex={-1}
			aria-hidden
			onClick={onClick}
			className={cn(
				"text-muted-foreground hover:text-foreground absolute top-0 grid h-6 w-5 cursor-pointer place-items-center",
				side === "left" ? "left-0" : "right-0",
			)}
		>
			<HugeiconsIcon icon={side === "left" ? ArrowLeft01Icon : ArrowRight01Icon} className="size-3.5" />
		</button>
	);
}
