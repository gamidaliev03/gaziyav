import type * as React from "react";
import { cn } from "@/utils/ui";

interface PanelHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
	/** The panel's name. Left out when `tabs` are given: the tabs name the panel's sections themselves. */
	title?: React.ReactNode;
	/** A small icon before the title (the inspector shows the selected clip's kind there). */
	icon?: React.ReactNode;
	/** A <Segmented> switch between the panel's sections, in place of the title. */
	tabs?: React.ReactNode;
	/** Buttons on the right: view options, Add, close… */
	actions?: React.ReactNode;
}

/**
 * The one header row of every editor panel: 44 px, a hairline below, the name (or the section switch) on the
 * left and the panel's own buttons on the right. Media, Audio, Text, Effects, Stickers, AI and the inspector
 * all use it, so the panels line up and read the same way.
 */
export function PanelHeader({ title, icon, tabs, actions, className, children, ...rest }: PanelHeaderProps) {
	return (
		<div
			data-panel-header
			className={cn("bg-background @container/ph flex h-11 shrink-0 items-center gap-2 border-b px-3", className)}
			{...rest}
		>
			{tabs ? (
				<div className="min-w-0 flex-1">{tabs}</div>
			) : (
				(title || icon) && (
					<div className="flex min-w-0 flex-1 items-center gap-2">
						{icon && <span className="text-muted-foreground flex shrink-0 [&_svg]:size-4">{icon}</span>}
						{title && <span className="text-foreground truncate text-[13px] font-semibold">{title}</span>}
					</div>
				)
			)}
			{children}
			{actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
		</div>
	);
}
