// Which header surface is open (export popover, project dialogs). Lets the Mac menu and hotkeys
// open them without prop drilling.
import { create } from "zustand";

export type ShellDialog = "settings" | "shortcuts" | "delete" | null;

interface ShellState {
	exportOpen: boolean;
	dialog: ShellDialog;
	renaming: boolean;
	setExportOpen: (open: boolean) => void;
	setDialog: (dialog: ShellDialog) => void;
	setRenaming: (renaming: boolean) => void;
}

export const useShellStore = create<ShellState>()((set) => ({
	exportOpen: false,
	dialog: null,
	renaming: false,
	setExportOpen: (exportOpen) => set({ exportOpen }),
	setDialog: (dialog) => set({ dialog }),
	setRenaming: (renaming) => set({ renaming }),
}));
