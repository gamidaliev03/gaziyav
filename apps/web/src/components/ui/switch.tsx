"use client";

import * as React from "react";

import { cn } from "@/utils/ui";

// A plain button with role="switch" (Space/Enter toggle it, as any button). Radix's Switch mounted a hidden form
// input with every switch until its button ref was set, and that input measured itself (useSize: ResizeObserver +
// offsetWidth in a layout effect): one forced layout per switch each time the inspector remounted, ~1.9 ms per
// timeline edit at 264 clips. No form in the app posts a switch, so there is no input to keep.
type SwitchProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value" | "defaultChecked" | "onChange"> & {
	checked?: boolean;
	defaultChecked?: boolean;
	onCheckedChange?: (checked: boolean) => void;
};

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
	({ className, checked: checkedProp, defaultChecked = false, onCheckedChange, onClick, disabled, ...props }, ref) => {
		const [uncontrolled, setUncontrolled] = React.useState(defaultChecked);
		const checked = checkedProp ?? uncontrolled;
		const state = checked ? "checked" : "unchecked";
		return (
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				data-state={state}
				data-disabled={disabled ? "" : undefined}
				disabled={disabled}
				className={cn(
					"peer focus-visible:ring-ring focus-visible:ring-offset-background data-[state=checked]:bg-primary data-[state=unchecked]:bg-foreground/25 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
					className,
				)}
				{...props}
				ref={ref}
				onClick={(event) => {
					onClick?.(event);
					if (event.defaultPrevented) return;
					if (checkedProp === undefined) setUncontrolled(!checked);
					onCheckedChange?.(!checked);
				}}
			>
				<span
					data-state={state}
					className="pointer-events-none block size-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] ring-0 transition-transform duration-150 ease-out data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
				/>
			</button>
		);
	},
);
Switch.displayName = "Switch";

export { Switch };
