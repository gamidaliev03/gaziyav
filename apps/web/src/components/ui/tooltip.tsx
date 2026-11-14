import { cva, type VariantProps } from "class-variance-authority";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/utils/ui";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

/**
 * Hover only, like macOS: a tooltip that Tab focus opened took the first Esc, so a window needed two to close.
 * (Radix skips its own focus handler when ours prevents the event.)
 */
const TooltipTrigger = React.forwardRef<
	React.ElementRef<typeof TooltipPrimitive.Trigger>,
	React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>
>(({ onFocus, ...props }, ref) => (
	<TooltipPrimitive.Trigger
		ref={ref}
		onFocus={(event) => {
			onFocus?.(event);
			event.preventDefault();
		}}
		{...props}
	/>
));
TooltipTrigger.displayName = TooltipPrimitive.Trigger.displayName;

const tooltipVariants = cva(
	"z-[300] overflow-visible rounded-sm text-sm shadow-md",
	{
		variants: {
			variant: {
				default: "bg-popover text-popover-foreground border px-3 py-1.5",
				destructive:
					"bg-destructive/10 text-destructive dark:bg-destructive/20 border-destructive [border-width:0.5px]",
				outline: "border-border",
				important:
					"bg-amber-100/90 text-amber-900 dark:bg-amber-900/20 dark:text-amber-300 border-amber-900 [border-width:0.5px]",
				promotions:
					"bg-red-100/90 text-redb-900 dark:bg-red-900/20 dark:text-red-300 border-red-900 [border-width:0.5px]",
				personal:
					"bg-green-100/90 text-green-900 dark:bg-green-900/20 dark:text-green-300 border-green-900 [border-width:0.5px]",
				updates:
					"bg-amber-100/90 text-amber-900 dark:bg-amber-900/20 dark:text-amber-300 border-amber-900 [border-width:0.5px]",
				forums:
					"bg-blue-100/90 text-blue-900 dark:bg-blue-900/20 dark:text-blue-300 border-blue-900 [border-width:0.5px]",
				sidebar: "bg-white dark:bg-[#413F3E] p-2.5 flex flex-col gap-2",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

interface TooltipContentProps
	extends React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>,
		VariantProps<typeof tooltipVariants> {}

const TooltipContent = React.forwardRef<
	React.ElementRef<typeof TooltipPrimitive.Content>,
	TooltipContentProps
>(({ className, sideOffset = 4, variant, ...props }, ref) => (
	<TooltipPrimitive.Content
		ref={ref}
		sideOffset={sideOffset}
		className={cn(tooltipVariants({ variant }), className)}
		{...props}
	>
		{variant === "sidebar" && (
			<svg
				width="6"
				height="10"
				viewBox="0 0 6 10"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				className="absolute top-1/2 left-[-6px] -translate-y-1/2"
				aria-hidden="true"
			>
				<path
					d="M6 0L0 5L6 10V0Z"
					className="fill-white/80 dark:fill-[#413F3E]"
				/>
			</svg>
		)}
		{props.children}
	</TooltipPrimitive.Content>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

/**
 * One control's tooltip, the native way (design review 05.11: the browser's yellow `title` boxes read as a web page):
 * the label, then its shortcut when it has one, after 400 ms. The child keeps its aria-label; nothing to show = no
 * tooltip. A disabled button gets no pointer events, so it shows none (keep a `title` where a disabled one must explain).
 */
function Hint({
	label,
	shortcut,
	side,
	children,
}: {
	label?: React.ReactNode;
	shortcut?: string;
	side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
	children: React.ReactElement;
}) {
	if (!label) return children;
	return (
		<Tooltip delayDuration={400}>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent side={side} className="flex max-w-72 items-baseline gap-2 px-2 py-1 text-xs leading-snug">
				<span className="whitespace-pre-line">{label}</span>
				{shortcut && <kbd className="text-muted-foreground shrink-0 font-sans text-[11px]">{shortcut}</kbd>}
			</TooltipContent>
		</Tooltip>
	);
}

export { Hint, Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
