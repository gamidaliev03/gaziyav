import { create } from "zustand";

/**
 * Loop playback (⌘L, the ⟳ next to Play, ⌘K «Loop playback»): when the playhead reaches the end of the In–Out range
 * (or of the whole edit), it plays again from the start. Per window, not saved with the project.
 */
interface LoopState {
	loop: boolean;
	setLoop: (loop: boolean) => void;
	/** Returns the new state. */
	toggleLoop: () => boolean;
}

export const useLoopStore = create<LoopState>()((set, get) => ({
	loop: false,
	setLoop: (loop) => set({ loop }),
	toggleLoop: () => {
		const loop = !get().loop;
		set({ loop });
		return loop;
	},
}));
