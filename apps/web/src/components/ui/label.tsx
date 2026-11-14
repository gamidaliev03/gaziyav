"use client";

import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/utils/ui";

const labelVariants = cva(
	// No `peer-disabled:*` here: it compiles to `:where(.peer):disabled ~ *`, an indirect sibling
	// selector that makes the browser re-style the whole subtree on every child insert/remove
	// (~16 ms per edit on a 260-clip timeline).
	"text-xs text-muted-foreground font-medium leading-none",
);

const Label = React.forwardRef<
	React.ElementRef<typeof LabelPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
		VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
	<LabelPrimitive.Root
		ref={ref}
		className={cn(labelVariants(), className)}
		{...props}
	/>
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
