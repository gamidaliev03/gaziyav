"use client";

import type * as React from "react";
import { cn } from "@/utils/ui";

export interface SegmentedItem<T extends string> {
	value: T;
	label: React.ReactNode;
	/** Shown as the button's tooltip and accessible name when the label is an icon or shortened. */
	title?: string;
	disabled?: boolean;
}

interface SegmentedProps<T extends string> {
	value: T;
	onValueChange: (value: T) => void;
	items: readonly SegmentedItem<T>[];
	"aria-label": string;
	/** sm: 24 px, in panel headers and dense rows; md: 28 px, in forms and dialogs. */
	size?: "sm" | "md";
	className?: string;
	/** Extra attributes per item (test ids, data-* hooks the views already rely on). */
	itemProps?: (value: T) => React.ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string>;
}

/** The segment an arrow key moves to: the next enabled one, wrapping around; null when nothing else can be chosen. */
export function stepSegment<T extends string>(
	items: readonly SegmentedItem<T>[],
	value: T,
	direction: 1 | -1,
): T | null {
	const enabled = items.filter((item) => !item.disabled);
	if (enabled.length === 0) return null;
	const at = enabled.findIndex((item) => item.value === value);
	// From a value that isn't enabled (or none): → lands on the first segment, ← on the last.
	const from = at < 0 ? (direction === 1 ? -1 : 0) : at;
	const next = enabled[(from + direction + enabled.length) % enabled.length];
	return next && next.value !== value ? next.value : null;
}

/**
 * The one tab style of the editor: a segmented control. Section switches at the top of a panel (Text |
 * Captions, Sounds | Music…), choices in forms (MP4 | WebM). Categories that filter a list are chips, not this.
 * ←/→ move between segments, as in macOS.
 */
export function Segmented<T extends string>({
	value,
	onValueChange,
	items,
	size = "sm",
	className,
	itemProps,
	"aria-label": ariaLabel,
}: SegmentedProps<T>) {
	const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		event.preventDefault();
		event.stopPropagation();
		const next = stepSegment(items, value, event.key === "ArrowRight" ? 1 : -1);
		if (next === null) return;
		onValueChange(next);
		const button = event.currentTarget.querySelector<HTMLButtonElement>(`[data-segment="${next}"]`);
		button?.focus();
	};
	return (
		<div
			role="tablist"
			aria-label={ariaLabel}
			onKeyDown={onKeyDown}
			className={cn("bg-muted flex min-w-0 rounded-md p-0.5", className)}
		>
			{items.map((item) => {
				const active = item.value === value;
				return (
					<button
						key={item.value}
						type="button"
						role="tab"
						aria-selected={active}
						tabIndex={active ? 0 : -1}
						title={item.title}
						disabled={item.disabled}
						data-segment={item.value}
						onClick={() => onValueChange(item.value)}
						{...itemProps?.(item.value)}
						className={cn(
							// flex-auto: a long label («Transitions») takes the room a short one («Color») doesn't need
							"focus-visible:ring-ring min-w-0 flex-auto cursor-pointer truncate rounded-[5px] px-2 font-medium transition-colors focus-visible:ring-1 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-40",
							size === "sm" ? "h-6 text-xs" : "h-7 text-[13px]",
							// in a narrow inspector («Saturation» · «Luminance» at 245 px) a little smaller, never cut
							"@max-[17.5rem]/insp:px-1 @max-[17.5rem]/insp:text-[11px]",
							active
								? "bg-background text-foreground shadow-sm"
								: // muted-foreground on bg-muted was 3.8:1; this is about 5:1
									"text-foreground/65 hover:text-foreground",
						)}
					>
						{item.label}
					</button>
				);
			})}
		</div>
	);
}
