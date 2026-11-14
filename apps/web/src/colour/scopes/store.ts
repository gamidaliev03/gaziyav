// The scopes strip under the player: open or not, which scopes show, how tall. Kept across launches.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ScopeReadout } from "./math";

export type ScopeKind = "waveform" | "parade" | "vectorscope" | "histogram";
export const SCOPE_KINDS: ScopeKind[] = ["waveform", "parade", "vectorscope", "histogram"];
export const SCOPE_TITLES: Record<ScopeKind, string> = {
	waveform: "Waveform",
	parade: "RGB parade",
	vectorscope: "Vectorscope",
	histogram: "Histogram",
};

/** The scopes' own height in CSS pixels (the bar is on top of it). */
export const SCOPES_MIN_HEIGHT = 72;
export const SCOPES_MAX_HEIGHT = 360;

interface ScopesState {
	open: boolean;
	shown: Record<ScopeKind, boolean>;
	/** 0: chosen from the player's height. */
	height: number;
	/** The vectorscope's trace takes the colour it stands for. */
	tinted: boolean;
	/** How the strip is drawn right now (not kept). */
	mode: "starting" | "gpu" | "cpu";
	readout: ScopeReadout | null;
	setOpen: (open: boolean) => void;
	toggle: () => void;
	toggleKind: (kind: ScopeKind) => void;
	setHeight: (height: number) => void;
	setTinted: (tinted: boolean) => void;
}

export const useScopes = create<ScopesState>()(
	persist(
		(set, get) => ({
			open: false,
			shown: { waveform: true, parade: true, vectorscope: true, histogram: true },
			height: 0,
			tinted: true,
			mode: "starting",
			readout: null,
			setOpen: (open) => set({ open }),
			toggle: () => set({ open: !get().open }),
			toggleKind: (kind) => {
				const shown = { ...get().shown, [kind]: !get().shown[kind] };
				// never an empty strip: the last scope stays on
				if (SCOPE_KINDS.some((k) => shown[k])) set({ shown });
			},
			setHeight: (height) => set({ height: Math.round(Math.min(SCOPES_MAX_HEIGHT, Math.max(SCOPES_MIN_HEIGHT, height))) }),
			setTinted: (tinted) => set({ tinted }),
		}),
		{
			name: "gaziyav.colour.scopes",
			partialize: (state) => ({ open: state.open, shown: state.shown, height: state.height, tinted: state.tinted }),
		},
	),
);

/** Opens or closes the strip (the Color section's button, ⌘K «Scopes»). */
export function toggleScopes(): boolean {
	useScopes.getState().toggle();
	return true;
}
