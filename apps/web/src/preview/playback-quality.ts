import { create } from "zustand";
import { persist } from "zustand/middleware";
import { hardwareTier } from "@/platform/hardware-client";

// Player → playback resolution (CapCut: Full / High / Low): how sharp the player decodes video. Playback only — the
// export always renders at full size.
export type PlaybackQuality = "full" | "high" | "low";
export const QUALITY_FACTOR: Record<PlaybackQuality, number> = { full: 1, high: 0.75, low: 0.5 };

export const usePlaybackQuality = create<{ quality: PlaybackQuality; chosen: boolean; setQuality: (q: PlaybackQuality) => void }>()(
	persist(
		(set) => ({
			quality: "full",
			chosen: false,
			setQuality: (quality) => set({ quality, chosen: true }),
		}),
		{ name: "playback-quality" },
	),
);

/** The quality the player uses: the user's choice, else this Mac's — High on an 8 GB Mac ("base"), Full on others. */
export const effectiveQuality = (state: { quality: PlaybackQuality; chosen: boolean }): PlaybackQuality =>
	state.chosen ? state.quality : hardwareTier() === "base" ? "high" : state.quality;
