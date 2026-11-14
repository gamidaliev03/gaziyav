import { create } from "zustand";
import { persist } from "zustand/middleware";

/** CapCut 9.5's Layout ▾ (docs/capcut/editor-frame.md): each layout is an arrangement, not only widths.
 * Default: Media · Player · Details over the timeline. Media: the media panel full height on the left.
 * Attributes: Details full height on the right. Vertical: a full-height player on the right, for 9:16 videos. */
export type LayoutId = "default" | "media" | "attributes" | "vertical";
export type PanelKey = "media" | "player" | "details" | "timeline";
/** The compact class (page.tsx): which panel the one side column shows, and whether it is folded to its tabs. */
export type CompactSide = "media" | "details";
export type LayoutNode = { panel: PanelKey } | { group: string; direction: "horizontal" | "vertical"; items: LayoutNode[] };

const top = (a: PanelKey, b: PanelKey, c?: PanelKey): LayoutNode => ({
	group: "top",
	direction: "horizontal",
	items: [{ panel: a }, { panel: b }, ...(c ? [{ panel: c }] : [])],
});
const rows = (above: LayoutNode): LayoutNode => ({ group: "rows", direction: "vertical", items: [above, { panel: "timeline" }] });

export const LAYOUTS: Record<LayoutId, LayoutNode> = {
	default: rows(top("media", "player", "details")),
	media: { group: "columns", direction: "horizontal", items: [{ panel: "media" }, rows(top("player", "details"))] },
	attributes: { group: "columns", direction: "horizontal", items: [rows(top("media", "player")), { panel: "details" }] },
	vertical: { group: "columns", direction: "horizontal", items: [rows(top("media", "details")), { panel: "player" }] },
};

/** Each group's sizes in percent, measured in CapCut 9.5 (1492 × 843 window) right after choosing the layout. */
export const LAYOUT_SIZES: Record<LayoutId, Record<string, number[]>> = {
	default: { rows: [54, 46], top: [31, 44, 25] },
	media: { columns: [33, 67], rows: [54, 46], top: [62, 38] },
	attributes: { columns: [75, 25], rows: [54, 46], top: [43, 57] },
	vertical: { columns: [73, 27], rows: [54, 46], top: [65, 35] },
};

interface PanelState {
	layout: LayoutId;
	/** Layouts the owner picked for a project (Layout ▾): that project opens in it; others follow their shape. */
	chosen: Record<string, LayoutId>;
	/** The current layout was picked for the project's shape, not by the owner: another shape may change it. */
	auto: boolean;
	/** Sizes dragged by hand in the current layout, per group. Choosing a layout starts from its own sizes. */
	sizes: Record<string, number[]>;
	/** Bumped when a layout is chosen or reset: the panel groups are rebuilt at that layout's sizes. */
	revision: number;
	setGroupSizes: (group: string, sizes: number[]) => void;
	/** A divider's double-click: its group back to the layout's own sizes (DESIGN.md R3). */
	resetGroup: (group: string) => void;
	compactSide: CompactSide;
	compactFolded: boolean;
	setCompactSide: (side: CompactSide, open?: boolean) => void;
	setCompactFolded: (folded: boolean) => void;
	applyLayout: (id: LayoutId, projectId?: string) => void;
	/** «Reset current layout»: the current layout back to its own sizes. */
	resetLayout: () => void;
	/** A project opened (or its shape changed): its own layout if the owner picked one, else Vertical for a tall
	 * canvas (final-A A3, 07.11: a 9:16 video in the default layout had a 91×164 px player at 1024×640) and the default
	 * back for a wide one, when the layout was picked that way. */
	autoLayout: (input: { projectId: string; vertical: boolean }) => void;
}

export const usePanelStore = create<PanelState>()(
	persist(
		(set) => ({
			layout: "default",
			chosen: {},
			auto: false,
			sizes: {},
			revision: 0,
			setGroupSizes: (group, sizes) => set((state) => ({ sizes: { ...state.sizes, [group]: sizes } })),
			resetGroup: (group) =>
				set((state) => {
					const { [group]: _, ...sizes } = state.sizes;
					return { sizes, revision: state.revision + 1 };
				}),
			compactSide: "media",
			compactFolded: false,
			setCompactSide: (side, open) =>
				set((state) => (state.compactSide === side && (!open || !state.compactFolded) ? state : { compactSide: side, compactFolded: open ? false : state.compactFolded })),
			setCompactFolded: (folded) => set((state) => (state.compactFolded === folded ? state : { compactFolded: folded })),
			applyLayout: (id, projectId) =>
				set((state) => ({ layout: id, sizes: {}, revision: state.revision + 1, auto: false, chosen: projectId ? { ...state.chosen, [projectId]: id } : state.chosen })),
			resetLayout: () => set((state) => ({ sizes: {}, revision: state.revision + 1 })),
			autoLayout: ({ projectId, vertical }) =>
				set((state) => {
					const picked = state.chosen[projectId];
					const want: LayoutId | null = picked ?? (vertical ? "vertical" : state.auto && state.layout === "vertical" ? "default" : null);
					if (!want || want === state.layout) return state;
					return { layout: want, sizes: {}, revision: state.revision + 1, auto: !picked };
				}),
		}),
		{
			name: "panel-sizes",
			// v4: CapCut's arrangements — sizes saved for the old single arrangement are dropped once.
			// v5: CapCut's proportions (a bigger player); sizes dragged under the old ones start over once.
			version: 5,
			migrate: () => ({ layout: "default" as LayoutId, sizes: {}, chosen: {}, auto: false }),
			partialize: (state) => ({ layout: state.layout, sizes: state.sizes, chosen: state.chosen, auto: state.auto, compactSide: state.compactSide, compactFolded: state.compactFolded }),
		},
	),
);
