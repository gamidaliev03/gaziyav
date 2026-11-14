// Which sound surfaces are open (the meter's numbers, the mixer). ⌘K and the timeline's bar open them through here.
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SoundUi {
	/** The loudness numbers by the level meter. */
	loudnessOpen: boolean;
	/** The mixer, docked at the right of the timeline. */
	mixerOpen: boolean;
	/** «Balance the mix»: how far the music goes down under words, dB. */
	duckDb: number;
	setDuckDb: (duckDb: number) => void;
	setLoudnessOpen: (open: boolean) => void;
	setMixerOpen: (open: boolean) => void;
	toggleMixer: () => void;
}

export const useSoundUi = create<SoundUi>()(
	persist(
		(set) => ({
			loudnessOpen: false,
			mixerOpen: false,
			duckDb: 12,
			setDuckDb: (duckDb) => set({ duckDb }),
			setLoudnessOpen: (loudnessOpen) => set({ loudnessOpen }),
			setMixerOpen: (mixerOpen) => set({ mixerOpen }),
			toggleMixer: () => set((s) => ({ mixerOpen: !s.mixerOpen })),
		}),
		// the mixer stays as it was left; the numbers always start closed
		{ name: "gaziyav.sound-ui", version: 1, partialize: (s) => ({ mixerOpen: s.mixerOpen, duckDb: s.duckDb }) },
	),
);
