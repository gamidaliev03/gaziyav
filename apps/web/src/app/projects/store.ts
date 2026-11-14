import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TProjectSortKey } from "@/project/types";

export type ProjectsViewMode = "grid" | "list";
/** The home page shows the projects, or Trash in their place (CapCut's «Trash» button in the projects header). */
export type ProjectsPage = "home" | "trash";

interface ProjectsState {
	searchQuery: string;
	sortKey: TProjectSortKey;
	sortOrder: "asc" | "desc";
	viewMode: ProjectsViewMode;
	page: ProjectsPage;
	setPage: (page: ProjectsPage) => void;
	selectedProjectIds: string[];
	lastSelectedProjectId: string | null;
	isHydrated: boolean;
	setIsHydrated: ({ isHydrated }: { isHydrated: boolean }) => void;
	setSearchQuery: ({ query }: { query: string }) => void;
	setSortKey: ({ sortKey }: { sortKey: TProjectSortKey }) => void;
	setSortOrder: ({ sortOrder }: { sortOrder: "asc" | "desc" }) => void;
	setViewMode: ({ viewMode }: { viewMode: ProjectsViewMode }) => void;
	setSelectedProjects: ({ projectIds }: { projectIds: string[] }) => void;
	clearSelectedProjects: () => void;
	setProjectSelected: ({
		projectId,
		isSelected,
	}: {
		projectId: string;
		isSelected: boolean;
	}) => void;
	selectProjectRange: ({
		projectId,
		allProjectIds,
	}: {
		projectId: string;
		allProjectIds: string[];
	}) => void;
}

const getNextSelectedProjectIds = ({
	selectedProjectIds,
	projectId,
	isSelected,
}: {
	selectedProjectIds: string[];
	projectId: string;
	isSelected: boolean;
}): string[] => {
	const selectedProjectIdSet = new Set(selectedProjectIds);

	if (isSelected) {
		selectedProjectIdSet.add(projectId);
		return Array.from(selectedProjectIdSet);
	}

	selectedProjectIdSet.delete(projectId);
	return Array.from(selectedProjectIdSet);
};

export const useProjectsStore = create<ProjectsState>()(
	persist(
		(set) => ({
			searchQuery: "",
			sortKey: "updatedAt",
			sortOrder: "desc",
			viewMode: "grid",
			page: "home",
			setPage: (page) => set({ page, selectedProjectIds: [], lastSelectedProjectId: null }),
			selectedProjectIds: [],
			lastSelectedProjectId: null,
			isHydrated: false,
			setIsHydrated: ({ isHydrated }) => set({ isHydrated }),
			setSearchQuery: ({ query }) => set({ searchQuery: query }),
			setSortKey: ({ sortKey }) => set({ sortKey }),
			setSortOrder: ({ sortOrder }) => set({ sortOrder }),
			setViewMode: ({ viewMode }) => set({ viewMode }),
			setSelectedProjects: ({ projectIds }) =>
				set({ selectedProjectIds: projectIds }),
			clearSelectedProjects: () =>
				set({ selectedProjectIds: [], lastSelectedProjectId: null }),
			setProjectSelected: ({ projectId, isSelected }) =>
				set((state) => ({
					selectedProjectIds: getNextSelectedProjectIds({
						selectedProjectIds: state.selectedProjectIds,
						projectId,
						isSelected,
					}),
					lastSelectedProjectId: isSelected
						? projectId
						: state.lastSelectedProjectId,
				})),
			selectProjectRange: ({ projectId, allProjectIds }) =>
				set((state) => {
					const anchorId = state.lastSelectedProjectId;
					if (!anchorId) {
						return {
							selectedProjectIds: [projectId],
							lastSelectedProjectId: projectId,
						};
					}

					const anchorIndex = allProjectIds.indexOf(anchorId);
					const targetIndex = allProjectIds.indexOf(projectId);

					if (anchorIndex === -1 || targetIndex === -1) {
						return {
							selectedProjectIds: [projectId],
							lastSelectedProjectId: projectId,
						};
					}

					const startIndex = Math.min(anchorIndex, targetIndex);
					const endIndex = Math.max(anchorIndex, targetIndex);
					const rangeIds = allProjectIds.slice(startIndex, endIndex + 1);

					const merged = new Set([...state.selectedProjectIds, ...rangeIds]);
					return {
						selectedProjectIds: Array.from(merged),
					};
				}),
		}),
		{
			name: "projects-view-mode",
			// an unknown remembered view or sort (an older build's) falls back silently (polish3 D3, 13.11)
			merge: (persisted, current) => {
				const saved = (persisted ?? {}) as Partial<typeof current>;
				const ok = <T,>(value: unknown, allowed: readonly T[]) => allowed.includes(value as T);
				return {
					...current,
					viewMode: ok(saved.viewMode, ["grid", "list"] as const) ? (saved.viewMode as typeof current.viewMode) : current.viewMode,
					sortKey: ok(saved.sortKey, ["createdAt", "updatedAt", "name", "duration"] as const) ? (saved.sortKey as typeof current.sortKey) : current.sortKey,
					sortOrder: ok(saved.sortOrder, ["asc", "desc"] as const) ? (saved.sortOrder as typeof current.sortOrder) : current.sortOrder,
				};
			},
			partialize: (state) => ({
				viewMode: state.viewMode,
				sortKey: state.sortKey,
				sortOrder: state.sortOrder,
			}),
			onRehydrateStorage: () => (state) => {
				state?.setIsHydrated({ isHydrated: true });
			},
		},
	),
);
