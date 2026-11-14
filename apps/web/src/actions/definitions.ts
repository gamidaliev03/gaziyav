import type { ShortcutKey } from "@/actions/keybinding";
import type { TActionWithOptionalArgs } from "./types";

export type TActionCategory =
	| "playback"
	| "editing"
	| "marks"
	| "timeline"
	| "keyframes"
	| "player"
	| "view"
	| "assets";

export interface TActionBaseDefinition {
	description: string;
	category: TActionCategory;
	args?: Record<string, unknown>;
	/** Kept for compatibility (buttons, old keymaps) but not listed in the shortcuts dialog. */
	hidden?: boolean;
}

export interface TActionDefinition extends TActionBaseDefinition {
	defaultShortcuts?: readonly ShortcutKey[];
}

export const ACTIONS = {
	"toggle-play": {
		description: "Play / Pause",
		category: "playback",
	},
	"shuttle-backward": {
		description: "Play Reverse (press again: faster)",
		category: "playback",
	},
	"shuttle-stop": {
		description: "Stop",
		category: "playback",
	},
	"shuttle-forward": {
		description: "Play Forward (press again: faster)",
		category: "playback",
	},
	"stop-playback": {
		description: "Stop and Go to Start",
		category: "playback",
		hidden: true,
	},
	"seek-forward": {
		description: "Forward 1 Second",
		category: "playback",
		args: { seconds: "number" },
	},
	"seek-backward": {
		description: "Back 1 Second",
		category: "playback",
		args: { seconds: "number" },
	},
	"frame-step-forward": {
		description: "Next Frame",
		category: "playback",
	},
	"frame-step-backward": {
		description: "Previous Frame",
		category: "playback",
	},
	"frame-step-forward-large": {
		description: "Forward 10 Frames",
		category: "playback",
	},
	"frame-step-backward-large": {
		description: "Back 10 Frames",
		category: "playback",
	},
	"jump-forward": {
		description: "Forward 5 Seconds",
		category: "playback",
		args: { seconds: "number" },
		hidden: true,
	},
	"jump-backward": {
		description: "Back 5 Seconds",
		category: "playback",
		args: { seconds: "number" },
		hidden: true,
	},
	"previous-edit": {
		description: "Previous Edit Point",
		category: "playback",
	},
	"next-edit": {
		description: "Next Edit Point",
		category: "playback",
	},
	"goto-start": {
		description: "Go to Start",
		category: "playback",
	},
	"goto-end": {
		description: "Go to End",
		category: "playback",
	},
	"goto-timecode": {
		description: "Go to Timecode",
		category: "playback",
	},
	"mark-in": {
		description: "Mark In",
		category: "marks",
	},
	"mark-out": {
		description: "Mark Out",
		category: "marks",
	},
	"clear-in-out": {
		description: "Clear In / Out",
		category: "marks",
	},
	"clear-in": {
		description: "Clear In",
		category: "marks",
	},
	"clear-out": {
		description: "Clear Out",
		category: "marks",
	},
	"goto-in": {
		description: "Go to In",
		category: "marks",
	},
	"goto-out": {
		description: "Go to Out",
		category: "marks",
	},
	"mark-clip": {
		description: "Mark Clip Range",
		category: "marks",
	},
	"play-in-to-out": {
		description: "Play In to Out",
		category: "marks",
	},
	"toggle-bookmark": {
		description: "Add Marker",
		category: "marks",
	},
	split: {
		description: "Split at Playhead",
		category: "editing",
	},
	"split-all": {
		description: "Split All Tracks at Playhead",
		category: "editing",
	},
	"split-left": {
		description: "Delete left",
		category: "editing",
	},
	"split-right": {
		description: "Delete right",
		category: "editing",
	},
	"delete-selected": {
		description: "Delete",
		category: "editing",
	},
	"ripple-delete": {
		description: "Ripple delete",
		category: "editing",
	},
	"cut-selected": {
		description: "Cut",
		category: "editing",
	},
	"copy-selected": {
		description: "Copy",
		category: "editing",
	},
	"paste-copied": {
		description: "Paste (insert at the playhead: later clips move along)",
		category: "editing",
	},
	"paste-over": {
		description: "Paste over (replaces what it covers)",
		category: "editing",
	},
	"duplicate-selected": {
		description: "Duplicate",
		category: "editing",
	},
	"copy-attributes": {
		description: "Copy attributes",
		category: "editing",
	},
	"paste-attributes": {
		description: "Paste attributes",
		category: "editing",
	},
	"nudge-left": {
		description: "Nudge Left",
		category: "editing",
	},
	"nudge-right": {
		description: "Nudge Right",
		category: "editing",
	},
	"nudge-left-large": {
		description: "Nudge Left 10 Frames",
		category: "editing",
	},
	"nudge-right-large": {
		description: "Nudge Right 10 Frames",
		category: "editing",
	},
	"trim-end-earlier": {
		description: "Trim End 1 Frame Earlier",
		category: "editing",
	},
	"trim-end-later": {
		description: "Trim End 1 Frame Later",
		category: "editing",
	},
	"trim-start-earlier": {
		description: "Trim Start 1 Frame Earlier",
		category: "editing",
	},
	"trim-start-later": {
		description: "Trim Start 1 Frame Later",
		category: "editing",
	},
	"extend-edit": {
		description: "Extend Edit to Playhead",
		category: "editing",
	},
	"toggle-elements-visibility-selected": {
		description: "Enable / Disable Clip",
		category: "editing",
	},
	"toggle-elements-muted-selected": {
		description: "Mute / Unmute Clip",
		category: "editing",
	},
	"toggle-source-audio": {
		description: "Detach / Restore Audio",
		category: "editing",
	},
	"select-all": {
		description: "Select All",
		category: "editing",
	},
	"deselect-all": {
		description: "Deselect All",
		category: "editing",
	},
	"select-at-playhead": {
		description: "Select Clip at Playhead",
		category: "editing",
	},
	"cancel-interaction": {
		description: "Cancel / Deselect",
		category: "editing",
	},
	"toggle-snapping": {
		description: "Snapping",
		category: "timeline",
	},
	"toggle-ripple-editing": {
		description: "Main Track Magnet (Ripple)",
		category: "timeline",
	},
	"tool-select": {
		description: "Select tool",
		category: "timeline",
	},
	"tool-split": {
		description: "Split tool (click a clip to cut it)",
		category: "timeline",
	},
	"toggle-linkage": {
		description: "Linkage",
		category: "timeline",
	},
	"mark-beat": {
		description: "Mark beat",
		category: "marks",
	},
	"group-selected": {
		description: "Group",
		category: "timeline",
	},
	"ungroup-selected": {
		description: "Ungroup",
		category: "timeline",
	},
	"create-compound": {
		description: "Create compound clip",
		category: "timeline",
	},
	"dismiss-compound": {
		description: "Dismiss compound clip",
		category: "timeline",
	},
	"toggle-preview-axis": {
		description: "Preview axis",
		category: "timeline",
	},
	"freeze-frame": {
		description: "Freeze frame",
		category: "editing",
	},
	"reverse-selected": {
		description: "Reverse",
		category: "editing",
	},
	"mirror-selected": {
		description: "Mirror",
		category: "editing",
	},
	"rotate-selected": {
		description: "Rotate 90°",
		category: "editing",
	},
	"record-voiceover": {
		description: "Record voiceover",
		category: "editing",
	},
	"timeline-zoom-in": {
		description: "Zoom In",
		category: "timeline",
	},
	"timeline-zoom-out": {
		description: "Zoom Out",
		category: "timeline",
	},
	"timeline-zoom-fit": {
		description: "Zoom to fit",
		category: "timeline",
	},
	undo: {
		description: "Undo",
		category: "editing",
	},
	redo: {
		description: "Redo",
		category: "editing",
	},
	"export-project": {
		description: "Export…",
		category: "view",
	},
	"timeline-page-back": {
		description: "Scroll Timeline One Screen Back",
		category: "timeline",
	},
	"timeline-page-forward": {
		description: "Scroll Timeline One Screen Forward",
		category: "timeline",
	},
	"focus-search": {
		description: "Search in the Current Panel",
		category: "view",
	},
	"focus-next-panel": {
		description: "Next Panel",
		category: "view",
	},
	"focus-previous-panel": {
		description: "Previous Panel",
		category: "view",
	},
	"lift-in-out": {
		description: "Lift In–Out (leave a gap)",
		category: "marks",
	},
	"extract-in-out": {
		description: "Extract In–Out (close the gap)",
		category: "marks",
	},
	"select-forward": {
		description: "Select All Clips from Playhead Forward",
		category: "editing",
	},
	"select-backward": {
		description: "Select All Clips up to Playhead",
		category: "editing",
	},
	"move-to-track-above": {
		description: "Move Clip to Track Above",
		category: "editing",
	},
	"move-to-track-below": {
		description: "Move Clip to Track Below",
		category: "editing",
	},
	"add-title": {
		description: "Add Title at Playhead",
		category: "editing",
	},
	"match-frame": {
		description: "Reveal media",
		category: "editing",
	},
	"speed-duration": {
		description: "Speed / Duration…",
		category: "editing",
	},
	"toggle-loop": {
		description: "Loop Playback",
		category: "playback",
	},
	"open-assemble": {
		description: "Assemble a First Cut",
		category: "editing",
	},
	"toggle-follow-select": {
		description: "Selection Follows Playhead",
		category: "timeline",
	},
	"add-video-track": {
		description: "Add Video Track",
		category: "timeline",
	},
	"add-audio-track": {
		description: "Add Audio Track",
		category: "timeline",
	},
	"exit-composition": {
		description: "Back to Main Timeline",
		category: "timeline",
	},
	"enter-composition": {
		description: "Open the Selected Compound Clip",
		category: "timeline",
	},
	"toggle-keyframe": {
		description: "Add / Remove Keyframes at Playhead (every animated parameter)",
		category: "keyframes",
	},
	"previous-keyframe": {
		description: "Previous Keyframe",
		category: "keyframes",
	},
	"next-keyframe": {
		description: "Next Keyframe",
		category: "keyframes",
	},
	"keyframe-ease": {
		description: "Easy Ease (selected keyframes)",
		category: "keyframes",
	},
	"keyframe-ease-in": {
		description: "Ease In",
		category: "keyframes",
	},
	"keyframe-ease-out": {
		description: "Ease Out",
		category: "keyframes",
	},
	"keyframe-linear": {
		description: "Linear",
		category: "keyframes",
	},
	"keyframe-hold": {
		description: "Hold (jump at the next keyframe)",
		category: "keyframes",
	},
	"delete-keyframes-parameter": {
		description: "Delete All Keyframes on the Parameter (of the selected keyframes)",
		category: "keyframes",
	},
	"delete-keyframes-clip": {
		description: "Delete All Keyframes on the Clip",
		category: "keyframes",
	},
	"reset-transform": {
		description: "Reset Transform (position, scale, rotation and their keyframes)",
		category: "keyframes",
	},
	"previous-marker": {
		description: "Previous Marker",
		category: "marks",
	},
	"next-marker": {
		description: "Next Marker",
		category: "marks",
	},
	"add-marker-alt-color": {
		description: "Add Marker (Another Color)",
		category: "marks",
	},
	"volume-up": {
		description: "Volume Up (selected clips)",
		category: "editing",
	},
	"volume-down": {
		description: "Volume Down (selected clips)",
		category: "editing",
	},
	"toggle-keyframe-panel": {
		description: "Show / Hide Keyframe Panel",
		category: "keyframes",
	},
	"player-zoom-in": {
		description: "Zoom In Player",
		category: "player",
	},
	"player-zoom-out": {
		description: "Zoom Out Player",
		category: "player",
	},
	"player-zoom-fit": {
		description: "Zoom Player to Fit",
		category: "player",
	},
	"player-fullscreen": {
		description: "Player Full Screen",
		category: "player",
	},
	"toggle-guides": {
		description: "Show / Hide Guides",
		category: "player",
	},
	"toggle-rulers": {
		description: "Show / Hide Rulers",
		category: "player",
	},
	"show-media": {
		description: "Media",
		category: "view",
	},
	"show-effects": {
		description: "Effects",
		category: "view",
	},
	"show-inspector": {
		description: "Inspector",
		category: "view",
	},
	"show-captions": {
		description: "Auto Captions (Captions panel)",
		category: "view",
	},
	"project-settings": {
		description: "Project Settings…",
		category: "view",
	},
	"new-project": {
		description: "New Project",
		category: "view",
	},
	"save-project": {
		description: "Save Now (autosaves anyway)",
		category: "view",
	},
	"import-media": {
		description: "Import Media…",
		category: "view",
	},
	"import-link": {
		description: "Import from Link (YouTube)…",
		category: "view",
	},
	"show-projects": {
		description: "All Projects",
		category: "view",
	},
	"close-project": {
		description: "Close Project",
		category: "view",
	},
	"show-shortcuts": {
		description: "Keyboard Shortcuts",
		category: "view",
	},
	"remove-media-asset": {
		description: "Remove Media",
		category: "assets",
		args: { projectId: "string", assetId: "string" },
		hidden: true,
	},
	"remove-media-assets": {
		description: "Remove Media Files",
		category: "assets",
		args: { projectId: "string", assetIds: "string[]" },
		hidden: true,
	},
	// «Claude at work» (src/agentview): reached from ⌘K and the card's own buttons; ⌘. stops while Claude works.
	"agent-card": { description: "Claude: What Was Done", category: "view", hidden: true },
	"agent-stop": { description: "Claude: Stop", category: "editing", hidden: true },
	"agent-pause": { description: "Claude: Pause", category: "editing", hidden: true },
	"agent-resume": { description: "Claude: Continue", category: "editing", hidden: true },
	karaoke: { description: "Karaoke", category: "editing", hidden: true },
	// The trim model (src/timeline/trim): the Trim tool, the edge or the cut nearest the playhead picked for «,» «.»
	// and typed numbers, the selected clip slipped.
	"tool-trim": { description: "Trim tool (roll a cut, ripple an edge, slip a clip)", category: "timeline" },
	"trim-select-out": { description: "Pick the clip's end at the cut (ripple)", category: "timeline" },
	"trim-select-in": { description: "Pick the clip's start at the cut (ripple)", category: "timeline" },
	"trim-select-roll": { description: "Pick both sides of the cut (roll)", category: "timeline" },
	"slip-left": { description: "Slip the clip a frame left", category: "timeline" },
	"slip-right": { description: "Slip the clip a frame right", category: "timeline" },
	"slip-left-large": { description: "Slip the clip 10 frames left", category: "timeline" },
	"slip-right-large": { description: "Slip the clip 10 frames right", category: "timeline" },
	"trim-type-plus": { description: "Trim or move by a typed number, later (nothing selected: the playhead)", category: "timeline" },
	"trim-type-minus": { description: "Trim or move by a typed number, earlier (nothing selected: the playhead)", category: "timeline" },
	"slip-type-plus": { description: "Slip by a typed number, right", category: "timeline" },
	"slip-type-minus": { description: "Slip by a typed number, left", category: "timeline" },
	"trim-play-around": { description: "Loop the picked cut and trim it while it plays (J L , .)", category: "timeline" },
	// Lipsync of the selected clip (lipa): its section first in the inspector, the caret in the words field
	"lipsync-open": { description: "Lipsync the selected clip", category: "editing" },
	"toggle-markup": { description: "Show / Hide Markup (social frame, TV safe, text zones, thirds)", category: "player" },
	// tlc2: the hand that stays on the keyboard — the next / previous clip on the track, the playhead to its start
	"select-next-clip": { description: "Select Next Clip", category: "timeline" },
	"select-previous-clip": { description: "Select Previous Clip", category: "timeline" },
	// tlc2 (register C2): the clip open in Media (its In–Out) inserted at the playhead, as Media's «Insert at the playhead»
	"insert-at-playhead": { description: "Insert at the playhead", category: "editing" },
	// The selected clip's takes (lip3): the original ↔ the newest lipsynced take, in place, one ⌘Z
	"lipsync-take-flip": { description: "Flip the clip: original ↔ lipsynced take", category: "editing" },
} as const satisfies Record<string, TActionBaseDefinition>;

export type TAction = keyof typeof ACTIONS;

// Actions whose arguments are required can't be bound to a bare shortcut.
const ACTIONS_WITH_REQUIRED_ARGS: ReadonlySet<string> = new Set([
	"remove-media-asset",
	"remove-media-assets",
]);

export function isActionWithOptionalArgs(
	value: string,
): value is TActionWithOptionalArgs {
	return Object.hasOwn(ACTIONS, value) && !ACTIONS_WITH_REQUIRED_ARGS.has(value);
}

/** Actions listed in the shortcuts dialog (bindable and not hidden). */
export function getListedActions(): TActionWithOptionalArgs[] {
	return (Object.keys(ACTIONS) as TAction[]).filter(
		(action): action is TActionWithOptionalArgs => {
			const definition: TActionBaseDefinition = ACTIONS[action];
			return isActionWithOptionalArgs(action) && !definition.hidden;
		},
	);
}
