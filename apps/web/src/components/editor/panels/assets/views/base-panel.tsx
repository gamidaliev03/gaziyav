import { createContext, useContext } from "react";
import { PanelHeader } from "@/components/ui/panel-header";
import { cn } from "@/utils/ui";

/** The section switch of a tab group (Text | Captions…): set by the assets panel, shown in place of the title. */
export const PanelSectionTabsContext = createContext<React.ReactNode>(null);

interface PanelViewProps extends React.HTMLAttributes<HTMLDivElement> {
	/** Kept for the callers; not shown — the tab and its section column already name the panel (the owner, 12.11:
	 */
	title?: string;
	actions?: React.ReactNode;
	/** The header's own content left of the actions (Media: its search field). */
	headerContent?: React.ReactNode;
	children: React.ReactNode;
	contentClassName?: string;
	scrollClassName?: string;
	hideHeader?: boolean;
	ref?: React.Ref<HTMLDivElement>;
	onScroll?: React.UIEventHandler<HTMLDivElement>;
	scrollRef?: React.Ref<HTMLDivElement>;
}

export function PanelView({
	title,
	actions,
	headerContent,
	children,
	className,
	contentClassName,
	scrollClassName,
	hideHeader = false,
	ref,
	onScroll,
	scrollRef,
	...rest
}: PanelViewProps) {
	const sectionTabs = useContext(PanelSectionTabsContext);
	void title;
	const showHeader = !hideHeader && !!(sectionTabs || actions || headerContent);
	return (
		<div
			className={cn("relative flex h-full flex-col", className)}
			ref={ref}
			{...rest}
		>
			{/* A header only for something to use (a section switch, a search, buttons): never a title alone. */}
			{showHeader && (
				<PanelHeader className="pr-2" tabs={sectionTabs ?? undefined} actions={actions}>
					{headerContent && <div className="flex min-w-0 flex-1 items-center">{headerContent}</div>}
				</PanelHeader>
			)}
			{/* The rest of the panel under the header, not the panel's whole height (size-full ran the list's last row
			    out of the panel by the header's height: design review 05.11). */}
			<div
				className={cn(
					"scrollbar-hidden min-h-0 w-full flex-1 overflow-y-auto",
					"pt-2",
					scrollClassName,
				)}
				ref={scrollRef}
				onScroll={onScroll}
			>
				<div className={cn("w-full flex-1 px-2 pt-0", contentClassName)}>
					{children}
				</div>
			</div>
		</div>
	);
}
