"use client";

// The layout of CapCut's Captions forms (Auto captions, Auto lyrics): the fields at the top, no title, and a footer
// pinned to the panel's bottom with «☐ Delete current …» on the left and «Generate» on the right.
import type { HTMLAttributes, ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export function CaptionsForm({ children, footer, ...rest }: { children: ReactNode; footer: ReactNode } & HTMLAttributes<HTMLDivElement>) {
	return (
		<div className="flex h-full min-h-0 flex-col" {...rest}>
			<div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3 pt-3 pb-3">{children}</div>
			<div className="border-foreground/[0.07] flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2" data-captions-footer>
				{footer}
			</div>
		</div>
	);
}

/** A field: its name above the control, as in CapCut («Spoken language», «Lyrics language»…). */
export function CaptionsField({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-[12px] font-medium">{label}</span>
			{children}
		</div>
	);
}

/** The footer's checkbox («Delete current captions» / «Delete current lyrics»). */
export function FooterCheck({ id, checked, onChange, children, ...data }: { id: string; checked: boolean; onChange: (checked: boolean) => void; children: ReactNode } & Record<`data-${string}`, string | boolean>) {
	return (
		<div className="flex min-w-0 items-center gap-2">
			<Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} {...data} />
			<Label htmlFor={id} className="truncate text-xs font-normal">
				{children}
			</Label>
		</div>
	);
}
