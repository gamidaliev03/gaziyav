"use client";

import * as React from "react";
import { Progress as ProgressPrimitive } from "radix-ui";

import { cn } from "@/utils/ui";

/** Clamped to 0…100: a job reporting 1.02 or NaN no longer draws past the end or not at all. */
export function progressPercent(value: number | null | undefined): number {
	if (value == null || !Number.isFinite(value)) return 0;
	return Math.min(100, Math.max(0, value));
}

/**
 * The one progress bar of the editor (export, background jobs, AI tasks, imports): a thin rounded bar that glides
 * between updates instead of jumping. 6 px by default; `className="h-1"` for the compact rows of the job list.
 */
const Progress = React.forwardRef<
	React.ElementRef<typeof ProgressPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
	<ProgressPrimitive.Root
		ref={ref}
		value={value == null ? value : progressPercent(value)}
		className={cn(
			"bg-foreground/10 relative h-1.5 w-full overflow-hidden rounded-full",
			className,
		)}
		{...props}
	>
		<ProgressPrimitive.Indicator
			className="bg-primary size-full flex-1 rounded-full transition-transform duration-300 ease-out"
			style={{ transform: `translateX(-${100 - progressPercent(value)}%)` }}
		/>
	</ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
