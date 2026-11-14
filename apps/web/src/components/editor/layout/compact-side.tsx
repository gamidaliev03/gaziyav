"use client";

// and the inspector share one side column beside the player — two tabs over it, one click each. A click on the open
// tab folds the column to a rail of the same two tabs (so does dragging its divider to the floor); a click on the rail
// opens it again. The panel elements themselves are the ones of the wide layout (page.tsx's hosts): nothing remounts.
import { useEffect } from "react";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { type CompactSide, usePanelStore } from "@/editor/panel-store";
import { useT } from "@/i18n";
import { cn } from "@/utils/ui";

const TABS: { id: CompactSide; label: string }[] = [
	{ id: "media", label: "Media" },
	{ id: "details", label: "Inspector" },
];

/** A tool of another panel asks for its place: Media's tab chosen (⌘K, a menu) or an inspector section revealed. */
export function useCompactSideFollows(active: boolean) {
	const setSide = usePanelStore((state) => state.setCompactSide);
	useEffect(() => {
		if (!active) return;
		const unsub = useAssetsPanelStore.subscribe((state, before) => {
			if (state.activeTab !== before.activeTab) setSide("media", true);
		});
		const reveal = () => setSide("details", true);
		window.addEventListener("gz-reveal-inspector", reveal);
		return () => {
			unsub();
			window.removeEventListener("gz-reveal-inspector", reveal);
		};
	}, [active, setSide]);
}

export function CompactTabs({ rail = false }: { rail?: boolean }) {
	const t = useT();
	const side = usePanelStore((state) => state.compactSide);
	const folded = usePanelStore((state) => state.compactFolded);
	const setSide = usePanelStore((state) => state.setCompactSide);
	const setFolded = usePanelStore((state) => state.setCompactFolded);
	return (
		<div
			role="tablist"
			data-compact-rail={rail ? "" : undefined}
			data-compact-tabs
			className={cn(
				"panel bg-background flex shrink-0 gap-1 rounded-sm border p-1",
				rail ? "h-full w-9 flex-col items-center" : "h-9 items-center",
			)}
		>
			{TABS.map((tab) => {
				const open = !folded && side === tab.id;
				return (
					<button
						key={tab.id}
						type="button"
						role="tab"
						aria-selected={open}
						data-compact-tab={tab.id}
						title={open ? t("Fold the side panel") : undefined}
						onClick={() => (open ? setFolded(true) : setSide(tab.id, true))}
						className={cn(
							"text-muted-foreground hover:text-foreground flex items-center justify-center rounded-[5px] text-xs font-medium whitespace-nowrap transition-colors",
							rail ? "w-7 px-0 py-3 [writing-mode:vertical-rl] rotate-180" : "h-7 px-3",
							open && "bg-accent text-foreground",
						)}
					>
						{t(tab.label)}
					</button>
				);
			})}
		</div>
	);
}
