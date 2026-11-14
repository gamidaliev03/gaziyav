"use client";

import { createContext, useContext } from "react";

interface SelectionContextValue {
	selectedIds: string[];
	/** Every item of the list, in display order (a drag of several selected items keeps this order). */
	orderedIds: readonly string[];
	anchorId: string | null;
	highlightedId: string | null;
	isBoxSelecting: boolean;
	isSelected: (id: string) => boolean;
	clearSelection: () => void;
	handleItemClick: ({
		event,
		id,
	}: {
		event: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>;
		id: string;
	}) => void;
	handleItemMouseDown: ({
		event,
		id,
	}: {
		event: React.MouseEvent<HTMLDivElement>;
		id: string;
	}) => void;
	registerItem: (id: string, element: HTMLElement | null) => void;
}

export const SelectionContext = createContext<SelectionContextValue | null>(null);

export function useSelectionContext() {
	const context = useContext(SelectionContext);

	if (!context) {
		throw new Error("useSelectionContext must be used within SelectableSurface");
	}

	return context;
}

export function useSelection() {
	const { selectedIds, orderedIds, anchorId, highlightedId, isSelected, clearSelection } =
		useSelectionContext();

	return {
		selectedIds,
		orderedIds,
		anchorId,
		highlightedId,
		isSelected,
		clearSelection,
	};
}
