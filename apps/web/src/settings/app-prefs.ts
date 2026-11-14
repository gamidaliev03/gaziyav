// How the app works, from the Settings window (CapCut's Projects · Edit · Performance · General tabs). Each value is
// read where it applies: export, new projects, the media import. Kept in this Mac's app storage.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { setStillSeconds } from "@/timeline/creation";

export interface AppPrefs {
	/** Performance → Encode: VideoToolbox for H.264 / HEVC / ProRes when exporting. */
	hardwareEncoding: boolean;
	/** Edit → Sound for export: a chime when an export is saved. */
	exportSound: boolean;
	/** General → Notification: a Mac notification when an export or a long job finishes while Gaziyav is in the back. */
	notifications: boolean;
	/** Edit → Target loudness (LUFS) used by Export → Even loudness. */
	targetLufs: number;
	/** An H.264 editing copy of heavy videos (4K HEVC / AV1 / 10-bit this Mac decodes in software). No switch in Settings
	 * since perf round B (always on, decided per file on import); kept for tests that edit the original. */
	editingProxies: boolean;
	/** Edit → Frame rate of new projects. */
	projectFps: number;
	/** Projects → Cache: delete cached files older than this many days (null: never). */
	cacheDays: number | null;
	/** Projects → Cache: the cache keeps itself under this many GB, the oldest entries making room (null: no limit). */
	cacheLimitGb: number | null;
	/** Edit → Step forward or back many N frames (⇧← / ⇧→). */
	stepFrames: number;
	/** Edit → Image duration: seconds a picture lasts when it is added. */
	imageSeconds: number;
	/** General → Trackpad feedback: a tap of the Force Touch trackpad when something snaps, aligns or reaches its limit. */
	trackpadFeedback: boolean;
}

export const DEFAULT_APP_PREFS: AppPrefs = {
	hardwareEncoding: true,
	exportSound: false,
	notifications: true,
	targetLufs: -14,
	editingProxies: true,
	projectFps: 30,
	cacheDays: null,
	cacheLimitGb: 10,
	stepFrames: 10,
	imageSeconds: 5,
	trackpadFeedback: true,
};

/** CapCut's loudness targets plus the one platforms use. */
export const LOUDNESS_TARGETS = [
	{ value: -14, label: "Social media (−14 LUFS)" },
	{ value: -16, label: "Podcast (−16 LUFS)" },
	{ value: -23, label: "Broadcast EBU R128 (−23 LUFS)" },
	{ value: -24, label: "Broadcast ATSC (−24 LUFS)" },
] as const;

export const PROJECT_FRAME_RATES = [24, 25, 30, 50, 60] as const;

export const CACHE_LIMITS_GB = [5, 10, 20, 50] as const;

interface AppPrefsState extends AppPrefs {
	setPrefs: (patch: Partial<AppPrefs>) => void;
	reset: () => void;
}

export const useAppPrefs = create<AppPrefsState>()(
	persist(
		(set) => ({
			...DEFAULT_APP_PREFS,
			setPrefs: (patch) => set(patch),
			reset: () => set(DEFAULT_APP_PREFS),
		}),
		{
			name: "gaziyav.app-prefs",
			version: 1,
			partialize: ({ setPrefs: _set, reset: _reset, ...prefs }) => prefs,
		},
	),
);

// Image duration is read by the timeline code, which doesn't know Settings: it gets the value here.
setStillSeconds(useAppPrefs.getState().imageSeconds);
useAppPrefs.subscribe((state) => setStillSeconds(state.imageSeconds));

/** The current values outside React. */
export function appPrefs(): AppPrefs {
	const { setPrefs: _set, reset: _reset, ...prefs } = useAppPrefs.getState();
	return prefs;
}
