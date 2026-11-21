"use client";

// The AI tab and the Audio tab as places, not as a tree (the owner, 17.11: «чтоб удобно, понятно и дружелюбно, а не как
// древо»). AI is one shelf of big cards — each says what it makes in one line and opens full width, with a way back;
// nothing hides behind a second column. Audio is one row of names at the top and one tool under it, so the voice grid has
// the whole panel's width. Both keep the store's section (`sections[tab]`), so a place is remembered like before.
import { ArrowLeft01Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { openFalSettings, useKeys } from "@/fal/client";
import type { ReactNode } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@/components/ui/icon";
import { useT } from "@/i18n";
import { cn } from "@/utils/ui";
import { useAssetsPanelStore, type Tab } from "./assets-panel-store";

export interface Tool {
	key: string;
	label: string;
	/** One line: what it makes. */
	line?: string;
	icon: IconSvgElement;
	badge?: "AI" | "New";
}

/** AI: a shelf of tools. A tool takes the whole panel; «All AI tools» brings the shelf back. */
export function ToolHub({ tab, tools, render }: { tab: Tab; tools: Tool[]; render: (section: string) => ReactNode }) {
	const t = useT();
	const keys = useKeys();
	const stored = useAssetsPanelStore((s) => s.sections[tab]);
	const setSection = useAssetsPanelStore((s) => s.setSection);
	// where the key goes, said once at the foot of the shelf instead of on every card
	const anyKey = !!keys && (keys.fal || keys.kie);
	const open = tools.find((tool) => tool.key === stored);
	if (!open) {
		return (
			<div className="flex h-full min-h-0 flex-1 flex-col" data-materials={tab}>
				<div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-4">
					<div className="text-muted-foreground pb-1.5 text-[11px]">{t("What would you like to make?")}</div>
					<div className="grid grid-cols-2 gap-2">
						{tools.map((tool, i) => {
							// an odd tool takes the whole last row: one card alone in a two-column grid looks unfinished
							const wide = i === tools.length - 1 && tools.length % 2 === 1;
							return (
								<button
									key={tool.key}
									type="button"
									data-nav-item={tool.key}
									data-hub-card={tool.key}
									onClick={() => setSection(tab, tool.key)}
									className={cn(
										"group border-border/70 bg-muted/30 hover:bg-accent hover:border-primary/40 relative flex gap-2.5 rounded-lg border p-2.5 text-left transition-colors",
										wide ? "col-span-2 items-center" : "flex-col items-start",
									)}
								>
									<span className="bg-primary/15 text-primary grid size-9 shrink-0 place-items-center rounded-lg">
										<HugeiconsIcon icon={tool.icon} className="size-4" />
									</span>
									<span className={cn("flex min-w-0 flex-col gap-0.5", wide && "flex-1")}>
										<span className="text-[13px] leading-tight font-semibold">{t(tool.label)}</span>
										{tool.line && <span className="text-muted-foreground line-clamp-2 text-[11px] leading-snug">{t(tool.line)}</span>}
									</span>
									{tool.badge && <span className="bg-primary text-primary-foreground absolute top-2 right-2 rounded-[3px] px-1 py-px text-[8px] leading-[11px] font-bold">{tool.badge}</span>}
								</button>
							);
						})}
					</div>
					<button
						type="button"
						onClick={openFalSettings}
						data-hub-key
						className="text-muted-foreground hover:text-foreground mt-3 flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-left text-[11px] leading-snug transition-colors"
					>
						<HugeiconsIcon icon={Settings01Icon} className="size-3.5 shrink-0" />
						{anyKey ? t("Connected: Settings → Services holds the key and the models") : t("Add a fal.ai key in Settings → Services: pictures, video and voice run on it")}
					</button>
				</div>
			</div>
		);
	}
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col" data-materials={tab} data-materials-section={open.key}>
			<div className="flex shrink-0 items-center gap-1.5 border-b pr-2 pl-0.5 py-1.5">
				<button
					type="button"
					data-hub-back
					onClick={() => setSection(tab, "")}
					className="text-muted-foreground hover:bg-accent hover:text-foreground flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors"
				>
					<HugeiconsIcon icon={ArrowLeft01Icon} className="size-3.5" />
					{t("All AI tools")}
				</button>
				<span className="ml-auto flex items-center gap-1 truncate pr-1 text-[11px] font-medium">
					<HugeiconsIcon icon={open.icon} className="text-primary size-3.5" />
					{t(open.label)}
				</span>
			</div>
			<div className="relative min-h-0 min-w-0 flex-1">
				<div className="absolute inset-0 flex flex-col">{render(open.key)}</div>
			</div>
		</div>
	);
}

/** Audio: one row of names (Music · Sound effects · Voice · Yours) and the tool under it, full width. */
export function ToolRow({ tab, tools, render }: { tab: Tab; tools: Tool[]; render: (section: string) => ReactNode }) {
	const t = useT();
	const stored = useAssetsPanelStore((s) => s.sections[tab]);
	const setSection = useAssetsPanelStore((s) => s.setSection);
	const current = tools.some((tool) => tool.key === stored) ? (stored as string) : tools[0].key;
	return (
		<div className="flex h-full min-h-0 flex-1 flex-col" data-materials={tab} data-materials-section={current}>
			<div className="scrollbar-hidden flex shrink-0 items-center gap-1 overflow-x-auto border-b pr-2 pl-0.5 py-1.5">
				{tools.map((tool) => (
					<button
						key={tool.key}
						type="button"
						data-nav-item={tool.key}
						aria-current={tool.key === current ? "true" : undefined}
						onClick={() => setSection(tab, tool.key)}
						className={cn(
							"relative flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
							tool.key === current ? "bg-foreground/[0.08] text-primary" : "text-foreground/80 hover:bg-foreground/[0.06]",
						)}
					>
						{t(tool.label)}
						{tool.badge && <span className="bg-primary text-primary-foreground rounded-[3px] px-[3px] text-[8px] leading-[11px] font-bold">{tool.badge}</span>}
					</button>
				))}
			</div>
			<div className="relative min-h-0 min-w-0 flex-1">
				<div className="absolute inset-0 flex flex-col">{render(current)}</div>
			</div>
		</div>
	);
}
