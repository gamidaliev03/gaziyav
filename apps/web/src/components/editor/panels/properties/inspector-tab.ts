// The inspector's open tab (./layout-places.ts: main · audio · speed · color · effects · tools). One choice for the
// whole editor, kept while it runs: clicking from clip to clip stays on «Color» when the next clip has it, and falls
// back to the clip's own first tab when it has not. A section revealed from elsewhere (⌘K, a clip's menu, a filter
// dropped on a clip — ./reveal.ts) opens its tab.
import { create } from "zustand";
import type { BlockId } from "./layout-places";

interface InspectorTabState {
	tab: BlockId;
	setTab: (tab: BlockId) => void;
}

export const useInspectorTab = create<InspectorTabState>()((set) => ({
	tab: "main",
	setTab: (tab) => set({ tab }),
}));

/** Opens a tab from outside React (reveal.ts). */
export function openInspectorTab(tab: BlockId): void {
	if (useInspectorTab.getState().tab !== tab) useInspectorTab.getState().setTab(tab);
}
