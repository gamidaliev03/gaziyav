/**
 * UI state for the timeline
 * For core logic, use EditorCore instead.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** CapCut's Linkage settings: the kinds of items that follow a main-track clip when it moves or is deleted. */
export type LinkageKind = "text" | "sticker" | "effect" | "audio" | "overlay";
export const LINKAGE_KINDS: ReadonlyArray<{ id: LinkageKind; label: string }> = [
	{ id: "text", label: "Text" },
	{ id: "sticker", label: "Stickers" },
	{ id: "effect", label: "Effects" },
	{ id: "audio", label: "Audio" },
	{ id: "overlay", label: "Overlay" },
];

/** Preview axis (S): the frame under the pointer shows in the player while hovering the timeline. */
export type PreviewAxisMode = "av" | "video" | "off";

interface TimelineStore {
	snappingEnabled: boolean;
	toggleSnapping: () => void;
	rippleEditingEnabled: boolean;
	toggleRippleEditing: () => void;
	/** Select (A), Split (B): a click on a clip cuts it there, or Trim (T): the trim model's zones (src/timeline/trim). */
	tool: "select" | "split" | "trim";
	setTool: (tool: "select" | "split" | "trim") => void;
	linkageEnabled: boolean;
	toggleLinkage: () => void;
	linkageKinds: LinkageKind[];
	setLinkageKinds: (kinds: LinkageKind[]) => void;
	previewAxis: PreviewAxisMode;
	/** The mode S turns back on (the ▾ choice). */
	previewAxisOnMode: Exclude<PreviewAxisMode, "off">;
	setPreviewAxis: (mode: PreviewAxisMode) => void;
	expandedElementIds: Set<string>;
	toggleElementExpanded: (elementId: string) => void;
	/** CapCut ⋯ on the main track → Track height: Short / Default / Tall (video tracks). */
	trackHeight: TrackHeightChoice;
	setTrackHeight: (trackHeight: TrackHeightChoice) => void;
	/** CapCut ⋯ on the main track → Audio waveform size: the sound bar under a video clip's frames. */
	waveformSize: WaveformSizeChoice;
	setWaveformSize: (waveformSize: WaveformSizeChoice) => void;
}

export type TrackHeightChoice = "short" | "default" | "tall";
export type WaveformSizeChoice = 30 | 60 | 100;

export const useTimelineStore = create<TimelineStore>()(
	persist(
		(set) => ({
			snappingEnabled: true,

			toggleSnapping: () => {
				set((state) => ({ snappingEnabled: !state.snappingEnabled }));
			},

			// Main-track magnet on by default (CapCut): deleting or trimming on the main track closes the gap.
			rippleEditingEnabled: true,

			toggleRippleEditing: () => {
				set((state) => ({
					rippleEditingEnabled: !state.rippleEditingEnabled,
				}));
			},

			tool: "select",
			setTool: (tool) => set({ tool }),

			// Linkage on by default (CapCut): titles, stickers, effects and sounds over a main clip go with it.
			linkageEnabled: true,
			toggleLinkage: () => set((state) => ({ linkageEnabled: !state.linkageEnabled })),
			linkageKinds: LINKAGE_KINDS.map((kind) => kind.id),
			setLinkageKinds: (linkageKinds) => set({ linkageKinds }),

			previewAxis: "off",
			previewAxisOnMode: "av",
			setPreviewAxis: (previewAxis) =>
				set((state) => ({ previewAxis, previewAxisOnMode: previewAxis === "off" ? state.previewAxisOnMode : previewAxis })),

			expandedElementIds: new Set<string>(),

			trackHeight: "default",
			setTrackHeight: (trackHeight) => set({ trackHeight }),
			waveformSize: 30,
			setWaveformSize: (waveformSize) => set({ waveformSize }),

			toggleElementExpanded: (elementId) => {
				set((state) => {
					const next = new Set(state.expandedElementIds);
					if (next.has(elementId)) {
						next.delete(elementId);
					} else {
						next.add(elementId);
					}
					return { expandedElementIds: next };
				});
			},
		}),
		{
			name: "timeline-store",
			// v1: main-track magnet turned on once for everyone.
			version: 1,
			migrate: (persisted, version) => {
				const state = (persisted ?? {}) as Record<string, unknown>;
				return version < 1 ? { ...state, rippleEditingEnabled: true } : state;
			},
			partialize: (state) => ({
				snappingEnabled: state.snappingEnabled,
				rippleEditingEnabled: state.rippleEditingEnabled,
				linkageEnabled: state.linkageEnabled,
				linkageKinds: state.linkageKinds,
				previewAxis: state.previewAxis,
				previewAxisOnMode: state.previewAxisOnMode,
				trackHeight: state.trackHeight,
				waveformSize: state.waveformSize,
			}),
		},
	),
);
