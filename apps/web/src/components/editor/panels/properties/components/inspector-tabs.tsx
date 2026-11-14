"use client";

// The clip's tabs, every one in view at once — nothing scrolls, nothing hides behind an arrow (docs/EDITOR-MAP.md: the
// user should never hunt for a tab). Wide enough for all the names: icon + name in one row. Not wide enough (the default
// inspector holds the 10 tabs of a video only as icons): icons in one row, the open tab's name and what it holds on a
// line under them, every icon's name and contents in its tooltip. Narrower still: the icons wrap into a second row.
// Which one is measured, not guessed: a hidden copy of the named row is compared with the room there is (the Russian
// names are longer than the English ones).
import { type IconSvgElement, HugeiconsIcon } from "@/components/ui/icon";
import { useLayoutEffect, useRef, useState } from "react";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/utils/ui";

export interface InspectorTabItem<T extends string> {
	value: T;
	label: string;
	icon: IconSvgElement;
	/** What is inside (the section names), for the tooltip and the caption. */
	contents?: string;
}

export function InspectorTabs<T extends string>({
	label,
	value,
	items,
	onValueChange,
	dataAttribute,
}: {
	label: string;
	value: T;
	items: InspectorTabItem<T>[];
	onValueChange: (value: T) => void;
	dataAttribute: string;
}) {
	const rowRef = useRef<HTMLDivElement>(null);
	const measureRef = useRef<HTMLDivElement>(null);
	const [named, setNamed] = useState(true);
	const signature = items.map((item) => `${item.value}:${item.label}`).join("|");
	// biome-ignore lint/correctness/useExhaustiveDependencies: measured again when the tabs or their names change
	useLayoutEffect(() => {
		const row = rowRef.current;
		const measure = measureRef.current;
		if (!row || !measure || typeof ResizeObserver === "undefined") return;
		const check = () => setNamed(measure.scrollWidth <= row.clientWidth + 0.5);
		check();
		const observer = new ResizeObserver(check);
		observer.observe(row);
		observer.observe(measure);
		return () => observer.disconnect();
	}, [signature]);
	const active = items.find((item) => item.value === value) ?? items[0];
	const step = (direction: 1 | -1) => {
		const index = items.findIndex((item) => item.value === value);
		const next = items[(index + direction + items.length) % items.length];
		if (next) onValueChange(next.value);
	};
	return (
		<div className="relative" data-tab-mode={named ? "named" : "icons"}>
			{/* the named row as it would be, out of sight: its width decides */}
			<div ref={measureRef} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex w-max gap-3 whitespace-nowrap">
				{items.map((item) => (
					<span key={item.value} className="flex items-center gap-1 py-1 text-[12px] font-medium">
						<HugeiconsIcon icon={item.icon} className="size-3.5" />
						{item.label}
					</span>
				))}
			</div>
			<div
				ref={rowRef}
				role="tablist"
				aria-label={label}
				onKeyDown={(event) => {
					if (event.key === "ArrowRight") step(1);
					else if (event.key === "ArrowLeft") step(-1);
					else return;
					event.preventDefault();
				}}
				className={cn("flex min-w-0 flex-wrap items-center", named ? "gap-x-3 gap-y-1" : "justify-between gap-x-0.5 gap-y-1")}
			>
				{items.map((item) => {
					const on = item.value === value;
					return (
						<Hint key={item.value} label={item.contents ? `${item.label}\n${item.contents}` : item.label} side="bottom">
							<button
								type="button"
								role="tab"
								aria-selected={on}
								aria-label={item.label}
								tabIndex={on ? 0 : -1}
								{...{ [dataAttribute]: item.value }}
								onClick={() => onValueChange(item.value)}
								className={cn(
									"relative flex shrink-0 items-center gap-1 text-[12px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:underline",
									named ? "py-1" : "h-7 w-7 justify-center rounded-sm hover:bg-accent",
									on ? "text-primary" : "text-muted-foreground hover:text-foreground",
								)}
							>
								<HugeiconsIcon icon={item.icon} className={named ? "size-3.5" : "size-4"} />
								{/* icons only: the name stays in the text for screen readers (and anything reading the tab's text) */}
								{named ? item.label : <span className="sr-only">{item.label}</span>}
								{on && <span aria-hidden="true" className={cn("bg-primary absolute h-0.5 rounded-full", named ? "inset-x-0 -bottom-[9px]" : "inset-x-1 -bottom-[3px]")} />}
							</button>
						</Hint>
					);
				})}
			</div>
			{!named && active && (
				<div className="mt-1.5 flex min-w-0 items-baseline gap-1.5 text-[11px] leading-tight" data-tab-caption>
					<span className="text-foreground shrink-0 font-medium">{active.label}</span>
					{active.contents && <span className="text-muted-foreground min-w-0 [overflow-wrap:anywhere]">{active.contents}</span>}
				</div>
			)}
		</div>
	);
}
