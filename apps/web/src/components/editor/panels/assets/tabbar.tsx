"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@/components/ui/icon";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { useT } from "@/i18n";
import { Segmented } from "@/components/ui/segmented";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/utils/ui";
import {
	groupOf,
	type Tab,
	TAB_GROUPS,
	tabs,
	useAssetsPanelStore,
} from "@/components/editor/panels/assets/assets-panel-store";
import { type Job, type JobSignal, jobCenter, signalFor, useJobsStore } from "@/jobs/store";


/** A group's dot: running beats error beats done, over all its sub-tabs. */
function groupSignal(jobs: Job[], members: readonly Tab[]): JobSignal {
	const signals = members.map((tab) => signalFor(jobs, tab));
	return (["running", "error", "done"] as const).find((s) => signals.includes(s)) ?? null;
}

/** Narrower than this, the tabs are icons with tooltips: at a 1280 px window the labelled row overflowed and the AI tab
 * hid behind «›» (design review 05.11). The icons are 36 px wide so that all seven, AI last, fit the 305 px panel of a
 * 1024 px window with no arrow (at 40 px the row was 300 px and the arrow took the AI tab, 06.11). */
const COMPACT_BELOW_PX = 420;
/** The tabs are icons at every width (their names in the tooltip). */
const ICONS_ONLY = true;

/**
 * The tab strip of the materials panel as in CapCut: one row across the top, each tab an icon over its label (only the
 * icon in a narrow panel); the wheel scrolls it sideways and «›» shows the tabs past the edge.
 */
export function TabBar() {
	const t = useT();
	const activeTab = useAssetsPanelStore((s) => s.activeTab);
	const openGroup = useAssetsPanelStore((s) => s.openGroup);
	const activeGroup = groupOf(activeTab).key;
	const jobs = useJobsStore((s) => s.jobs);
	// Looking at a tab acknowledges its finished tasks.
	// biome-ignore lint/correctness/useExhaustiveDependencies: tasks that finish while their tab is open are acknowledged too
	useEffect(() => {
		jobCenter.markSeen((job) => job.tab === activeTab);
	}, [activeTab, jobs]);
	const stripRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const [more, setMore] = useState(false);
	const [less, setLess] = useState(false);
	// Icons only, the name on hover (the owner, 12.11: Apple-minimal — no word under every tab icon).
	const [compact, setCompact] = useState(true);
	const check = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		// The strip's own width is the panel's (its tabs never widen it), so switching to icons cannot flip it back.
		const strip = stripRef.current;
		if (strip) setCompact(strip.clientWidth < COMPACT_BELOW_PX || ICONS_ONLY);
		// An arrow only for a real overflow: the row's own padding made it 2–6 px wider than the panel at some widths and
		// the «more» arrow showed with every tab in view (exam 03.11, panel ≈ 580 px).
		setMore(el.scrollWidth - (el.scrollLeft + el.clientWidth) > 8);
		setLess(el.scrollLeft > 8);
	}, []);
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		check();
		el.addEventListener("scroll", check);
		const ro = new ResizeObserver(check);
		ro.observe(el);
		if (stripRef.current) ro.observe(stripRef.current);
		return () => {
			el.removeEventListener("scroll", check);
			ro.disconnect();
		};
	}, [check]);
	// The open tab is always whole (it may sit past the edge after a restart) — and again when an arrow appears or goes
	// right after it was chosen: the arrow takes room from the row and left the tab half cut at that edge (Filters in a
	// narrow panel). Only then: the arrows' own scrolling is not pulled back to the open tab.
	const revealing = useRef(false);
	const reveal = useCallback(() => {
		scrollRef.current?.querySelector(`[data-tab-group="${activeGroup}"]`)?.scrollIntoView({ inline: "nearest", block: "nearest" });
	}, [activeGroup]);
	useEffect(() => {
		revealing.current = true;
		reveal();
		const done = setTimeout(() => {
			revealing.current = false;
		}, 400);
		return () => clearTimeout(done);
	}, [reveal]);
	// Icons or labels change the row's width: the arrows are measured again.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when the row switches between icons and labels
	useEffect(() => {
		check();
	}, [compact, check]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-reveal when an arrow appears or goes, only while revealing
	useEffect(() => {
		if (revealing.current) reveal();
	}, [more, less, reveal]);

	return (
		// The ‹ › arrows have their own place (CapCut): the row ends where an arrow begins, so no tab is ever under one
		// and a click on a tab's visible part always opens it.
		<div ref={stripRef} className="relative flex shrink-0 items-stretch border-b" data-tab-strip data-tab-strip-compact={compact ? "" : undefined}>
			{less && (
				<button
					type="button"
					aria-label={t("Previous tabs")}
					onClick={() => scrollRef.current?.scrollBy({ left: -180, behavior: "smooth" })}
					className="text-muted-foreground hover:text-foreground flex w-6 shrink-0 items-center justify-center"
				>
					<HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
				</button>
			)}
			<div
				ref={scrollRef}
				className="scrollbar-hidden flex min-w-0 flex-1 gap-0.5 overflow-x-auto px-1 py-1"
				onWheel={(event) => {
					if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY;
				}}
			>
				{TAB_GROUPS.map((group) => {
					const tabKey = group.key;
					const tab = tabs[tabKey];
					const isActive = activeGroup === tabKey;
					const signal = groupSignal(jobs, group.tabs);
					return (
						<Hint key={tabKey} label={compact ? t(tab.label) : undefined} side="bottom">
							<button
								type="button"
								aria-label={t(tab.label)}
								aria-pressed={isActive}
								data-tab-group={tabKey}
								onClick={() => openGroup(tabKey)}
								className={cn(
									"flex shrink-0 items-center justify-center rounded-md transition-colors",
									compact ? "h-10 min-w-9 px-1.5" : "h-12 min-w-[3.25rem] flex-col gap-1 px-1.5",
									isActive ? "text-primary" : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]",
								)}
							>
								<span className="relative">
									<tab.icon className="size-[18px]" />
									<TabSignal tab={tabKey} signal={isActive ? running(signal) : signal} />
								</span>
								{!compact && <span className="text-[11px] leading-none whitespace-nowrap">{t(tab.label)}</span>}
							</button>
						</Hint>
					);
				})}
			</div>
			{more && (
				<button
					type="button"
					aria-label={t("More tabs")}
					onClick={() => scrollRef.current?.scrollBy({ left: 180, behavior: "smooth" })}
					className="text-muted-foreground hover:text-foreground flex w-6 shrink-0 items-center justify-center"
				>
					<HugeiconsIcon icon={ArrowRight01Icon} className="size-4" />
				</button>
			)}
		</div>
	);
}

function running(signal: JobSignal): JobSignal {
	return signal === "running" ? signal : null;
}

/** Status dot on a tab icon: blue pulse while its task runs, green when done, red on error. */
function TabSignal({ tab, signal }: { tab: Tab; signal: JobSignal }) {
	if (!signal) return null;
	return (
		<span
			data-tab-signal={signal}
			data-tab={tab}
			className={cn(
				"ring-background absolute -top-0.5 -right-1 size-2 rounded-full ring-2",
				signal === "running" && "animate-pulse bg-sky-500",
				signal === "done" && "bg-emerald-500",
				signal === "error" && "bg-red-500",
			)}
		/>
	);
}

/** Whether the open tab belongs to a group with sections (Text | Captions, Effects | Transitions | Color). */
export function hasSubTabs(tab: Tab): boolean {
	return groupOf(tab).tabs.length > 1;
}

/** The sections of the open group as the panel header's segmented switch (it replaces the title there). */
export function SubTabs() {
	const activeTab = useAssetsPanelStore((s) => s.activeTab);
	const setActiveTab = useAssetsPanelStore((s) => s.setActiveTab);
	const group = groupOf(activeTab);
	if (group.tabs.length < 2) return null;
	return (
		<Segmented
			aria-label={`${tabs[group.key].label} sections`}
			value={activeTab}
			onValueChange={setActiveTab}
			items={group.tabs.map((tab) => ({ value: tab, label: tabs[tab].label }))}
			itemProps={(tab) => ({ "data-sub-tab": tab })}
		/>
	);
}
