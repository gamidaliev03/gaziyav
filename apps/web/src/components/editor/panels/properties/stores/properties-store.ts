import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface PropertiesState {
	/** The tab last asked for per kind of clip (registry.tsx elementKind: video, image, shape, ai, text…). */
	activeTabPerType: Record<string, string>;
	/**
	 * «Show me that» from elsewhere (the timeline's fx badge, ⌘R, a tool's link): the inspector has no tabs any more
	 * (one list, ./layout.ts), so it opens and scrolls to that tab's first section instead. `seq` makes a second ask of
	 * the same tab count too.
	 */
	tabRequest: { tabId: string; seq: number } | null;
	setActiveTab: (args: { elementType: string; tabId: string }) => void;
	isTransformScaleLocked: boolean;
	setTransformScaleLocked: (args: { locked: boolean }) => void;
	/** Scale X and Y move together (one Scale row) — the CapCut default. */
	isScaleUniform: boolean;
	setScaleUniform: (args: { uniform: boolean }) => void;
}

// The open tab of each kind of clip and the Uniform scale switch survive a restart, like the panel sizes.
export const usePropertiesStore = create<PropertiesState>()(
	persist(
		(set) => ({
			activeTabPerType: {},
			tabRequest: null,
			setActiveTab: ({ elementType, tabId }) =>
				set((state) => ({
					activeTabPerType: { ...state.activeTabPerType, [elementType]: tabId },
					tabRequest: { tabId, seq: (state.tabRequest?.seq ?? 0) + 1 },
				})),
			isTransformScaleLocked: false,
			setTransformScaleLocked: ({ locked }) =>
				set({ isTransformScaleLocked: locked }),
			isScaleUniform: true,
			setScaleUniform: ({ uniform }) => set({ isScaleUniform: uniform }),
		}),
		{
			name: "inspector",
			version: 1,
			storage: createJSONStorage(() => localStorage),
			partialize: (state) => ({ activeTabPerType: state.activeTabPerType, isScaleUniform: state.isScaleUniform }),
		},
	),
);
