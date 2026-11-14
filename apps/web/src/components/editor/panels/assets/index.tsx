"use client";

import { AudioTab, AvatarTab, CaptionsTab, MediaTab } from "./capcut-tabs";
import { CloudPauseWatcher } from "@/content/client/pause";
import { SpendDialog } from "@/cloud/components/spend-dialog";
import { LibraryMediaSync } from "@/media/library-sync";
import { type Tab, useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { hasSubTabs, SubTabs, TabBar } from "./tabbar";
import { PanelSectionTabsContext } from "./views/base-panel";
import { TextView } from "@/text/components/assets-view";
import { EffectsView } from "@/effects/components/assets-view";
import { TransitionsView } from "@/transitions/components/assets-view";
import { FiltersView } from "@/effects/components/filters-view";
import { YouTubeDialog } from "@/studio/components/youtube-dialog";
import { PanelErrorBoundary } from "@/reliability/panel-error-boundary";

// carries none of the family's sections.

const TAB_NAMES: Record<Tab, string> = {
	media: "Media",
	sounds: "Audio",
	text: "Text",
	effects: "Effects",
	transitions: "Transitions",
	captions: "Captions",
	filters: "Filters",
	avatar: "AI",
};

export function AssetsPanel() {
	const { activeTab } = useAssetsPanelStore();

	const viewMap: Record<Tab, React.ReactNode> = {
		media: <MediaTab />,
		sounds: <AudioTab />,
		text: <TextView />,
		effects: <EffectsView />,
		transitions: <TransitionsView />,
		captions: <CaptionsTab />,
		filters: <FiltersView />,
		avatar: <AvatarTab />,
	};

	return (
		<div data-assets-panel className="panel bg-background relative flex h-full flex-col rounded-sm border overflow-hidden">
			<LibraryMediaSync />
			<CloudPauseWatcher />
			<SpendDialog />
			<TabBar />
			{/* One tab failing never takes the tab bar with it: switching tabs (or Reload) recovers. */}
			<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
				{/* A group's sections (Text | Captions…) sit in the panel header in place of the title. */}
				<PanelSectionTabsContext.Provider value={hasSubTabs(activeTab) ? <SubTabs /> : null}>
					<div className="relative min-h-0 flex-1 overflow-hidden">
						<PanelErrorBoundary key={activeTab} name={TAB_NAMES[activeTab]}>
							{viewMap[activeTab]}
						</PanelErrorBoundary>
					</div>
				</PanelSectionTabsContext.Provider>
			</div>
			<PanelErrorBoundary
				name="Add from a link"
				className="bg-background absolute inset-x-2 bottom-2 z-10 flex flex-col items-center gap-2 rounded-md border p-3 text-center"
			>
				<YouTubeDialog />
			</PanelErrorBoundary>
		</div>
	);
}
