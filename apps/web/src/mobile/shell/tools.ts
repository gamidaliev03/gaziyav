// The phone's bottom bar (mobile, 14.11): the creator's path, left to right — import → edit (trim / split / reorder)
// → text → audio → filters → format (9:16) → export. Each tool is an existing action of the editor or a sheet that
// shows an existing panel; nothing here edits the project itself. Data only (tested in __tests__/device-class.test.ts).
import type { TActionWithOptionalArgs } from "@/actions";

export type SheetId = "media" | "edit" | "text" | "audio" | "filters" | "format" | "export";

export interface PhoneTool {
	id: "import" | "edit" | "text" | "audio" | "filters" | "format" | "export";
	/** The English label (Russian in i18n/ru-mobile.ts). */
	label: string;
	/** hugeicons name the bar draws (the editor's icon set). */
	icon: string;
	/** A tap runs this action… */
	action?: TActionWithOptionalArgs;
	/** …or opens this sheet. */
	sheet?: SheetId;
}

export const PHONE_TOOLS: readonly PhoneTool[] = [
	{ id: "import", label: "Add", icon: "Add01Icon", sheet: "media" },
	{ id: "edit", label: "Edit", icon: "ScissorIcon", sheet: "edit" },
	{ id: "text", label: "Text", icon: "TextFontIcon", sheet: "text" },
	{ id: "audio", label: "Audio", icon: "MusicNote01Icon", sheet: "audio" },
	{ id: "filters", label: "Filters", icon: "ColorsIcon", sheet: "filters" },
	{ id: "format", label: "Format", icon: "CropIcon", sheet: "format" },
	// (Export is the top bar's own button: a seventh tool was cut off on a 375-px phone)
];

/** The «Edit» sheet's row when a clip is selected — the actions the desktop's keys run (one undo step each). */
export const EDIT_ACTIONS: ReadonlyArray<{ action: TActionWithOptionalArgs; label: string; icon: string }> = [
	{ action: "split", label: "Split", icon: "ScissorIcon" },
	{ action: "delete-selected", label: "Delete", icon: "Delete02Icon" },
	{ action: "duplicate-selected", label: "Duplicate", icon: "Copy01Icon" },
	{ action: "speed-duration", label: "Speed", icon: "DashboardSpeed01Icon" },
	{ action: "reverse-selected", label: "Reverse", icon: "ArrowReloadHorizontalIcon" },
	{ action: "freeze-frame", label: "Freeze", icon: "PauseIcon" },
	{ action: "toggle-elements-muted-selected", label: "Mute", icon: "VolumeOffIcon" },
];

/** Always at hand above the timeline (not in a sheet): play, undo, redo — the three a hand needs most. */
export const TOP_ACTIONS: ReadonlyArray<{ action: TActionWithOptionalArgs; label: string; icon: string }> = [
	{ action: "undo", label: "Undo", icon: "ArrowTurnBackwardIcon" },
	{ action: "toggle-play", label: "Play", icon: "PlayIcon" },
	{ action: "redo", label: "Redo", icon: "ArrowTurnForwardIcon" },
];
