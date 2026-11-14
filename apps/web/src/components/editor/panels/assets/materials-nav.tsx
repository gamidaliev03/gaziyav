"use client";

// The column on the left of each CapCut materials tab (docs/capcut/materials.md): sections, some of them groups that
// open on their items (▾ / ▴), the current one in the accent colour; badges «AI» and «New» as in CapCut.
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { fold, HugeiconsIcon } from "@/components/ui/icon";
import { type ReactNode, useContext, useState } from "react";
import { useT } from "@/i18n";
import { cn } from "@/utils/ui";
import { type Tab, useAssetsPanelStore } from "./assets-panel-store";
import { PanelSectionTabsContext } from "./views/base-panel";

export type NavItem = {
	key: string;
	label: string;
	badge?: "AI" | "New";
	children?: NavItem[];
	/** A group: the item its name opens when it is folded (CapCut: Captions → Templates opens Trending). */
	select?: string;
	/** A group that starts folded unless its item is the open one (CapCut: Captions → Templates ▾). */
	collapsed?: boolean;
	/** An entry that lives in another tab: CapCut lists it here too, it opens it there (one feature, one place). */
	goTo?: { tab: Tab; section: string };
};

const leaves = (items: NavItem[]): NavItem[] => items.flatMap((item) => (item.children ? leaves(item.children) : [item]));

export function MaterialsLayout({ tab, items, render }: { tab: Tab; items: NavItem[]; render: (section: string) => ReactNode }) {
	const t = useT();
	// the group's segment (Text | Captions…) is one row over both columns, on every sub-tab; a section that draws its
	// own header (PanelView) doesn't draw it again
	const sectionTabs = useContext(PanelSectionTabsContext);
	const stored = useAssetsPanelStore((s) => s.sections[tab]);
	const setSection = useAssetsPanelStore((s) => s.setSection);
	const setActiveTab = useAssetsPanelStore((s) => s.setActiveTab);
	// an entry that opens another tab is never this tab's own section
	const all = leaves(items).filter((item) => !item.goTo);
	const current = all.some((item) => item.key === stored) ? (stored as string) : all[0].key;
	const single = items.length === 1 && !items[0].children && !items[0].goTo;
	const [closed, setClosed] = useState<Record<string, boolean>>(() =>
		Object.fromEntries(items.filter((item) => item.collapsed && !item.children?.some((child) => child.key === current)).map((item) => [item.key, true])),
	);
	const openGroup = (item: NavItem) => {
		if (item.select && closed[item.key]) {
			setClosed((s) => ({ ...s, [item.key]: false }));
			setSection(tab, item.select);
		} else setClosed((s) => ({ ...s, [item.key]: !s[item.key] }));
	};
	const button = (item: NavItem, extra: { sub?: boolean; group?: boolean; active: boolean; onClick: () => void }) => (
		<button
			key={item.key}
			type="button"
			onClick={extra.onClick}
			data-nav-item={extra.group ? undefined : item.key}
			data-nav-group={extra.group ? item.key : undefined}
			aria-current={extra.active && !extra.group ? "true" : undefined}
			className={cn(
				"relative flex min-h-[26px] w-full shrink-0 items-center gap-1 rounded-[4px] px-2 py-[3px] text-left text-[12px] leading-[15px] transition-colors",
				extra.sub ? "font-normal" : "bg-foreground/[0.06] font-medium",
				extra.active ? "text-primary bg-foreground/[0.08]" : "text-foreground/90 hover:bg-foreground/[0.09]",
			)}
		>
			{/* hyphens: «Анимирован-ные», not «Анимированн|ые» in a narrow column (polish3, 11.11) */}
			<span className="min-w-0 flex-1 break-words hyphens-auto">{t(item.label)}</span>
			{item.badge && <span className="bg-primary text-primary-foreground absolute -top-1 right-1 rounded-[3px] px-[3px] text-[8px] leading-[11px] font-bold">{item.badge}</span>}
			{extra.group && <HugeiconsIcon icon={ArrowDown01Icon} className={cn("text-muted-foreground size-3 shrink-0", fold(!closed[item.key]))} />}
		</button>
	);
	// h-full: its box is not a flex column, so flex-1 alone left the row as tall as the section column — a tab with few
	// sections (Adjustment) got a 70 px list and its tiles were cut off.
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col" data-materials={tab}>
			{sectionTabs && <div className="shrink-0 border-b px-2 py-1.5">{sectionTabs}</div>}
			<div className="flex min-h-0 flex-1">
			{/* No scrollbar of its own (it took a column from the names); the bottom fades out while more follows below.
			    One place alone has no column: it would only say the tab's name again (polish3 D, 13.11). */}
			<div className={cn("flex w-[118px] shrink-0 border-r", single && "hidden")}>
			<nav aria-label={t("Sections")} className="scrollbar-hidden flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto px-1.5 pt-2 pb-6 [mask-image:linear-gradient(to_bottom,black_calc(100%-20px),transparent)]">
				{items.map((item) =>
					item.children ? (
						<div key={item.key} className="flex flex-col gap-0.5">
							{button(item, { group: true, active: item.children.some((c) => c.key === current), onClick: () => openGroup(item) })}
							{!closed[item.key] && item.children.map((child) => button(child, { sub: true, active: child.key === current, onClick: () => setSection(tab, child.key) }))}
						</div>
					) : (
						button(item, {
							active: item.key === current,
							onClick: () => {
								if (!item.goTo) return setSection(tab, item.key);
								setSection(item.goTo.tab, item.goTo.section);
								setActiveTab(item.goTo.tab);
							},
						})
					),
				)}
			</nav>
			</div>
			{/* The section fills the space exactly (absolute): its lists scroll with the wheel. As a plain flex item it had no
			    height of its own, so a list taller than the panel was cut off instead of scrolling. */}
			<div className="relative min-h-0 min-w-0 flex-1">
				<div className="absolute inset-0 flex flex-col" data-materials-section={current}>
					<PanelSectionTabsContext.Provider value={null}>{render(current)}</PanelSectionTabsContext.Provider>
				</div>
			</div>
			</div>
		</div>
	);
}
