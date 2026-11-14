// The one Settings window (⌘, and Gaziyav → Settings…), CapCut's tabs: Draft (id "projects") · Edit · Performance ·
// General, then AI (AI on this Mac · API keys · Connect Claude), then Share (accounts for Share → Post). The older section ids (ondevice, pointagent, claude)
// still open the AI section: every «set it up in Settings» link in the app lands there.
import { create } from "zustand";

export type SettingsSection = "projects" | "edit" | "performance" | "ondevice" | "pointagent" | "claude" | "ai" | "general" | "appearance" | "share" | "calls";

interface SettingsState {
	open: boolean;
	section: SettingsSection;
	setOpen: (open: boolean) => void;
	setSection: (section: SettingsSection) => void;
}

export const useSettingsStore = create<SettingsState>()((set) => ({
	open: false,
	section: "general",
	setOpen: (open) => set({ open }),
	setSection: (section) => set({ section }),
}));

/** Opens Settings at a section (General by default). */
export function openSettings(section: SettingsSection = "general") {
	useSettingsStore.setState({ open: true, section });
}
