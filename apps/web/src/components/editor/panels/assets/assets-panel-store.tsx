import type { ElementType } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	UserAiIcon,
	ArrowRightDoubleIcon,
	ClosedCaptionIcon,
	Folder01Icon,
	HeadphonesIcon,
	MagicWand05Icon,
	TextIcon,
	FilterIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@/components/ui/icon";

// The materials panel = what you ADD (docs/EDITOR-MAP.md): Media (your files, Downloads) · Audio · Text (Text | Captions;
// its categories: Add text, Styles, Motion graphics, Shapes, Yours with My templates) · Effects (Effects | Transitions |
// Filters) · AI (AI image, AI video, Lipsync, Translator). Stickers and Templates are gone (the owner, 12.11).
// Every view keeps its own key; a group with several shows them as the segment at the top of the panel.
export const TAB_KEYS = [
	"media",
	"sounds",
	"text",
	"captions",
	"effects",
	"transitions",
	"filters",
	"avatar",
] as const;

export type Tab = (typeof TAB_KEYS)[number];

/**
 * Keys of tabs that were merged into others: other windows still open them (Adjustment → Filters, its first tile).
 * «Текст» now, My templates are in its «Yours»; an old key opens that place.
 */
const TAB_ALIASES = {
	color: "filters",
	adjustment: "filters",
	lut: "filters",
	stickers: "text",
	templates: "text",
	motion: "text",
	mytemplates: "text",
} as const satisfies Record<string, Tab>;
/** The section an old tab key lands on in its new home. */
const ALIAS_SECTIONS: Record<string, string> = { stickers: "shapes", templates: "layouts", motion: "motion", mytemplates: "yours" };
export type TabKey = Tab | keyof typeof TAB_ALIASES;

/** Sections that moved to another tab: Media → Generate's AI image / AI video are in AI now. */
const MOVED_SECTIONS: Record<string, { tab: Tab; section: string }> = {
	"media:ai-image": { tab: "avatar", section: "ai-image" },
	"media:ai-video": { tab: "avatar", section: "ai-video" },
	"templates:shapes": { tab: "text", section: "shapes" },
	"motion:shapes": { tab: "text", section: "shapes" },
	"stickers:shapes": { tab: "text", section: "shapes" },
};

/** Where a (tab, section) of any version opens today. */
export function placeOf(tab: Tab, section: string): { tab: Tab; section: string } {
	return MOVED_SECTIONS[`${tab}:${section}`] ?? { tab, section };
}

/** The tab a key (old or current) opens. */
export function tabOf(key: TabKey | string): Tab {
	if ((TAB_KEYS as readonly string[]).includes(key)) return key as Tab;
	return (TAB_ALIASES as Record<string, Tab>)[key] ?? "media";
}

export const TAB_GROUPS = [
	{ key: "media", tabs: ["media"] },
	{ key: "sounds", tabs: ["sounds"] },
	{ key: "text", tabs: ["text", "captions"] },
	{ key: "effects", tabs: ["effects", "transitions", "filters"] },
	{ key: "avatar", tabs: ["avatar"] },
] as const satisfies ReadonlyArray<{ key: Tab; tabs: readonly Tab[] }>;

export type TabGroup = (typeof TAB_GROUPS)[number]["key"];

export function groupOf(tab: Tab): (typeof TAB_GROUPS)[number] {
	return TAB_GROUPS.find((group) => (group.tabs as readonly Tab[]).includes(tab)) ?? TAB_GROUPS[0];
}

const createHugeiconsIcon =
	({ icon }: { icon: IconSvgElement }) =>
	({ className }: { className?: string }) => (
		<HugeiconsIcon icon={icon} className={className} />
	);

export const tabs = {
	media: {
		icon: createHugeiconsIcon({ icon: Folder01Icon }),
		label: "Media",
	},
	avatar: {
		icon: createHugeiconsIcon({ icon: UserAiIcon }),
		label: "AI",
	},
	sounds: {
		icon: createHugeiconsIcon({ icon: HeadphonesIcon }),
		label: "Audio",
	},
	text: {
		icon: createHugeiconsIcon({ icon: TextIcon }),
		label: "Text",
	},
	effects: {
		icon: createHugeiconsIcon({ icon: MagicWand05Icon }),
		label: "Effects",
	},
	transitions: {
		icon: createHugeiconsIcon({ icon: ArrowRightDoubleIcon }),
		label: "Transitions",
	},
	filters: {
		icon: createHugeiconsIcon({ icon: FilterIcon }),
		label: "Filters",
	},
	captions: {
		icon: createHugeiconsIcon({ icon: ClosedCaptionIcon }),
		label: "Captions",
	},
} satisfies Record<
	Tab,
	{ icon: ElementType<{ className?: string }>; label: string }
>;

export type MediaViewMode = "grid" | "list";
export type MediaSortKey = "name" | "type" | "duration" | "size";
export type MediaSortOrder = "asc" | "desc";

interface AssetsPanelStore {
	activeTab: Tab;
	setActiveTab: (tab: TabKey) => void;
	/** The section chosen in each tab's left column (CapCut: Media → Generate → AI video…). */
	sections: Partial<Record<Tab, string>>;
	setSection: (tab: Tab, section: string) => void;
	/** Opens a tab on one of its sections. */
	openSection: (tab: TabKey, section: string) => void;
	/** Last sub-tab opened in each group (Text → Captions, Effects → Transitions…). */
	lastSubTab: Partial<Record<TabGroup, Tab>>;
	openGroup: (group: TabGroup) => void;
	highlightMediaId: string | null;
	requestRevealMedia: (mediaId: string) => void;
	clearHighlight: () => void;

	/* Media */
	mediaViewMode: MediaViewMode;
	setMediaViewMode: (mode: MediaViewMode) => void;
	mediaSortBy: MediaSortKey;
	mediaSortOrder: MediaSortOrder;
	setMediaSort: (args: { key: MediaSortKey; order: MediaSortOrder }) => void;
}

export const useAssetsPanelStore = create<AssetsPanelStore>()(
	persist(
		(set) => ({
			activeTab: "media",
			setActiveTab: (key) =>
				set((state) => {
					const tab = tabOf(key);
					const moved = ALIAS_SECTIONS[key];
					return {
						activeTab: tab,
						lastSubTab: { ...state.lastSubTab, [groupOf(tab).key]: tab },
						...(moved ? { sections: { ...state.sections, [tab]: moved } } : {}),
					};
				}),
			lastSubTab: {},
			sections: {},
			setSection: (tab, section) => set((state) => ({ sections: { ...state.sections, [tab]: section } })),
			openSection: (key, section) =>
				set((state) => {
					const place = MOVED_SECTIONS[`${key}:${section}`] ?? placeOf(tabOf(key), ALIAS_SECTIONS[key] && !["shapes", "motion", "layouts", "yours"].includes(section) ? ALIAS_SECTIONS[key] : section);
					return {
						activeTab: place.tab,
						lastSubTab: { ...state.lastSubTab, [groupOf(place.tab).key]: place.tab },
						sections: { ...state.sections, [place.tab]: place.section },
					};
				}),
			openGroup: (group) =>
				set((state) => {
					const members = (TAB_GROUPS.find((g) => g.key === group)?.tabs ?? [group]) as readonly Tab[];
					const last = state.lastSubTab[group];
					return { activeTab: last && members.includes(last) ? last : members[0] };
				}),
			highlightMediaId: null,
			requestRevealMedia: (mediaId) =>
				set({ activeTab: "media", highlightMediaId: mediaId }),
			clearHighlight: () => set({ highlightMediaId: null }),
			mediaViewMode: "grid",
			setMediaViewMode: (mode) => set({ mediaViewMode: mode }),
			mediaSortBy: "name",
			mediaSortOrder: "asc",
			setMediaSort: ({ key, order }) =>
				set({ mediaSortBy: key, mediaSortOrder: order }),
		}),
		{
			name: "assets-panel",
			// The last open tab comes back after a restart; unknown (removed) tabs fall back to the default.
			// Every remembered value is checked on the way in (polish3 D3, 13.11: rc34 left «templates» / «stickers» here):
			// an unknown one — a removed tab, sub-tab, view or sort — falls back to the default, never a blank panel.
			merge: (persisted, current) => {
				const saved = (persisted ?? {}) as Partial<AssetsPanelStore>;
				const activeTab = saved.activeTab ? tabOf(saved.activeTab) : current.activeTab;
				const lastSubTab = Object.fromEntries(
					Object.entries(saved.lastSubTab ?? {}).filter(([group, tab]) =>
						((TAB_GROUPS.find((g) => g.key === group)?.tabs ?? []) as readonly string[]).includes(tab as string),
					),
				) as AssetsPanelStore["lastSubTab"];
				const pick = <T,>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
				return {
					...current,
					...saved,
					activeTab,
					lastSubTab,
					sections: saved.sections && typeof saved.sections === "object" ? saved.sections : current.sections,
					mediaViewMode: pick(saved.mediaViewMode, ["grid", "list"] as const, current.mediaViewMode),
					mediaSortBy: pick(saved.mediaSortBy, ["name", "type", "duration", "size"] as const, current.mediaSortBy),
					mediaSortOrder: pick(saved.mediaSortOrder, ["asc", "desc"] as const, current.mediaSortOrder),
				};
			},
			partialize: (state) => ({
				activeTab: state.activeTab,
				lastSubTab: state.lastSubTab,
				sections: state.sections,
				mediaViewMode: state.mediaViewMode,
				mediaSortBy: state.mediaSortBy,
				mediaSortOrder: state.mediaSortOrder,
			}),
		},
	),
);
