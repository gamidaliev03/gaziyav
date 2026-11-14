export type ScopeEntry = {
	hasSelection: () => boolean;
	clear: () => void;
	clearActive?: () => void;
};

let activeScope: ScopeEntry | null = null;

export function activateScope({ entry }: { entry: ScopeEntry }): () => void {
	// Media and the timeline keep their own selections (CapCut): picking a file doesn't drop the selected clip, so the
	// inspector keeps it. The newest scope is only the one Esc empties first.
	activeScope = entry;

	return () => {
		if (activeScope === entry) {
			activeScope = null;
		}
	};
}

export function clearActiveScope(): boolean {
	if (!activeScope?.hasSelection()) {
		return false;
	}

	(activeScope.clearActive ?? activeScope.clear)();
	return true;
}
