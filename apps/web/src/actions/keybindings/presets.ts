import type { ShortcutKey } from "@/actions/keybinding";
import type { TActionWithOptionalArgs } from "@/actions/types";

/**
 * Keymap presets. Each preset is a complete keymap: switching replaces all bindings.
 *
 * - «CapCut» (default): CapCut 9.5 for Mac 1:1 (docs/capcut/keymap-default.json, docs/capcut-study.md §b).
 * - «Final Cut Pro»: FCP 12.3 defaults (docs/competitive.md §1.3), e.g. «, .» nudge,
 *   ⌫ ripple delete, ⇧⌫ leave a gap, ⌥[ / ⌥] trim to playhead.
 */
export type KeymapPresetId = "capcut" | "finalcut";

export const DEFAULT_KEYMAP_PRESET: KeymapPresetId = "capcut";

type PresetTable = ReadonlyArray<
	readonly [TActionWithOptionalArgs, readonly ShortcutKey[]]
>;

export interface KeymapPreset {
	id: KeymapPresetId;
	label: string;
	hint: string;
	table: PresetTable;
}

/**
 * Keyframes, in every preset unless the preset binds the key itself: FCP's ⌥K add keyframe and ⌥; / ⌥' previous / next keyframe; After
 * Effects' F9 Easy Ease, ⇧F9 Ease In, ⇧⌘F9 Ease Out, ⌃⌥H Hold; ⌥F9 Linear; ⌥⌫ / ⌥⇧⌫ delete every key of the
 * parameter / the clip, ⌥⇧R reset Transform.
 */
export const KEYFRAME_KEYS: PresetTable = [
	["toggle-keyframe", ["alt+k"]],
	["previous-keyframe", ["alt+;"]],
	["next-keyframe", ["alt+'"]],
	["keyframe-ease", ["f9"]],
	["keyframe-ease-in", ["shift+f9"]],
	["keyframe-ease-out", ["shift+cmd+f9"]],
	["keyframe-linear", ["alt+f9"]],
	["keyframe-hold", ["ctrl+alt+h"]],
	["delete-keyframes-parameter", ["alt+backspace"]],
	["delete-keyframes-clip", ["alt+shift+backspace"]],
	["reset-transform", ["alt+shift+r"]],
	// «Разметка» in the player (markup dept): beside CapCut's ⌘; reference lines; free in every preset
	["toggle-markup", ["shift+cmd+;"]],
];

/**
 * Edits to the frame from the keyboard, which CapCut doesn't have (its keys leave these free): ⌥← / ⌥→ move the
 * selected clips a frame (⌥⇧: the «many frames» step), ⌥⌘← / ⌥⌘→ their end a frame earlier / later, ⌥⇧⌘← / ⌥⇧⌘→
 * their start.
 */
/** Lipsync of the selected clip, in every preset (lipa, 14.11): ⌥L — L for lipsync, free in CapCut and Final Cut (L alone plays). */
export const LIPSYNC_KEYS: PresetTable = [["lipsync-open", ["alt+l"]], ["lipsync-take-flip", ["alt+shift+l"]]];

export const FRAME_EDIT_KEYS: PresetTable = [
	["nudge-left", ["alt+left"]],
	["nudge-right", ["alt+right"]],
	["nudge-left-large", ["alt+shift+left"]],
	["nudge-right-large", ["alt+shift+right"]],
	["trim-end-earlier", ["alt+cmd+left"]],
	["trim-end-later", ["alt+cmd+right"]],
	["trim-start-earlier", ["alt+shift+cmd+left"]],
	["trim-start-later", ["alt+shift+cmd+right"]],
];

/**
 * The trim model's keys (src/timeline/trim), the same in every preset: T the Trim tool (Final Cut, Resolve), ⌥, / ⌥.
 * slip the selected clip a frame (⌥⇧: many), + / − type a number for the picked edge or the selected clip (⌥: slip
 * it), ⇧/ loops the picked cut to trim it while it plays. CapCut has none of these commands and leaves every one of
 * these keys free.
 */
export const TRIM_KEYS: PresetTable = [
	["tool-trim", ["t"]],
	["slip-left", ["alt+,"]],
	["slip-right", ["alt+."]],
	["slip-left-large", ["alt+shift+,"]],
	["slip-right-large", ["alt+shift+."]],
	["trim-type-plus", ["=", "shift+="]],
	["trim-type-minus", ["-"]],
	["slip-type-plus", ["alt+="]],
	["slip-type-minus", ["alt+-"]],
	// ⇧/ is Final Cut's «play around»: the picked cut loops and the trim keys move it while it plays
	["trim-play-around", ["shift+/"]],
];

/**
 * tlc2: the next / previous clip on the track selected, the playhead on its start — ⌘← / ⌘→ beside ← → (a frame), ⇧← ⇧→
 * (ten), ⌥← ⌥→ (nudge) and ↑ ↓ (the cuts): the arrows walk, ⌘ walks by clips. Free in both presets; nothing that plays,
 * cuts or undoes.
 */
export const SELECT_STEP_KEYS: PresetTable = [
	["select-previous-clip", ["cmd+left"]],
	["select-next-clip", ["cmd+right"]],
];

/**
 * tlc2 (register C2): daily commands the CapCut keymap left without a key, on keys it leaves free — Final Cut's own
 * where it has one: ⌃T a title, ⌥F freeze frame, ⌥W insert the clip open in Media at the playhead (Final Cut's W;
 * CapCut's W is «Delete right»), ⌥D duplicate (⌘D stays free: CapCut's EditPilot voice), ⇧V mute the clip (V hides it).
 */
export const DAILY_KEYS_CAPCUT: PresetTable = [
	["add-title", ["ctrl+t"]],
	["freeze-frame", ["alt+f"]],
	["insert-at-playhead", ["alt+w"]],
	["duplicate-selected", ["alt+d"]],
	["toggle-elements-muted-selected", ["shift+v"]],
];
/** The same in the Final Cut keymap (⌃T and ⌘D it has): ⌥F freeze, W insert, ⇧V mute. */
export const DAILY_KEYS_FINALCUT: PresetTable = [
	["freeze-frame", ["alt+f"]],
	["insert-at-playhead", ["w"]],
	["toggle-elements-muted-selected", ["shift+v"]],
];

const COMMON_EDIT: PresetTable = [
	// ⌘S: save now and keep this moment as a version (home → project menu → Restore previous version)
	["save-project", ["cmd+s"]],
	["undo", ["cmd+z"]],
	["redo", ["shift+cmd+z"]],
	["cut-selected", ["cmd+x"]],
	["copy-selected", ["cmd+c"]],
	["paste-copied", ["cmd+v"]],
	["paste-over", ["alt+v"]],
	["select-all", ["cmd+a"]],
	["cancel-interaction", ["escape"]],
	["export-project", ["cmd+e"]],
];

/**
 * CapCut 9.5 for Mac, default preset — 1:1 with docs/capcut/keymap-default.json (Qt `Ctrl` = ⌘, `Alt` = ⌥, `Meta` = ⌃),
 * the CapCut id of each row in the comment. CapCut keys whose feature Gaziyav does not have yet stay free: ⇧B (speed segment), ⇧Return (render range), ⌘D (EditPilot voice). ⌘D is not «duplicate» in CapCut.
 */
const CAPCUT_BASE: PresetTable = [
	// Playback
	["toggle-play", ["space"]], // togglePlay
	["toggle-loop", ["cmd+l"]], // loop playback: Final Cut's key (CapCut has none)
	["shuttle-backward", ["j"]], // speedPlayBackward
	["shuttle-stop", ["k"]], // speedPlayPause
	["shuttle-forward", ["l"]], // speedPlayForward
	["frame-step-backward", ["left"]], // prevFrame
	["frame-step-forward", ["right"]], // nextFrame
	["frame-step-backward-large", ["shift+left"]], // largePreFrame
	["frame-step-forward-large", ["shift+right"]], // largeNextFrame
	["previous-edit", ["up"]], // prevCutPoint
	["next-edit", ["down"]], // nextCutPoint
	// a compound clip, in the Finder's sense: ⌘↓ into the selected one, ⌘↑ back out (CapCut has no key; one hand)
	["enter-composition", ["cmd+down"]],
	["exit-composition", ["cmd+up"]],
	["goto-start", ["home"]], // locateFirstFrame
	["goto-end", ["end"]], // locateLastFrame
	// Player
	["player-fullscreen", ["shift+cmd+f"]], // toggleFullscreen
	["player-zoom-in", ["alt+shift+="]], // playerZoomIn (⌥⇧+ and ⌥⇧= are one key)
	["player-zoom-out", ["alt+shift+-"]], // playerZoomOut
	["player-zoom-fit", ["alt+shift+z"]], // playerZoomFit
	["toggle-guides", ["cmd+;"]], // hideReferenceLine
	["toggle-rulers", ["alt+cmd+r"]], // hidePlayerRuler
	// Edit
	["split", ["cmd+b"]], // cutoff
	["split-all", ["shift+cmd+b"]], // batchCut
	["split-left", ["q"]], // cutLeft
	["split-right", ["w"]], // cutRight
	["delete-selected", ["backspace", "delete"]], // del
	["copy-selected", ["cmd+c"]], // copy
	["cut-selected", ["cmd+x"]], // cut
	["paste-copied", ["cmd+v"]], // paste
	["copy-attributes", ["shift+cmd+c"]], // copySegAttribute
	["paste-attributes", ["shift+cmd+v"]], // pasteSegAttribute
	["undo", ["cmd+z"]], // undo
	["redo", ["shift+cmd+z"]], // redo
	["select-all", ["cmd+a"]], // selectAll
	["select-backward", ["["]], // forwardSelect: every clip left of the playhead
	["select-forward", ["]"]], // backwardSelect: every clip right of it
	// Timeline
	["tool-select", ["a"]], // switchToSelect
	["tool-split", ["b"]], // switchToCut
	["toggle-linkage", ["`"]], // linkage
	["toggle-preview-axis", ["s"]], // preview
	["toggle-snapping", ["n"]], // adsorb
	["toggle-ripple-editing", ["p"]], // mainTrackAdsorb
	["timeline-zoom-in", ["cmd+="]], // zoomIn (⌘+ and ⌘= are one key)
	["timeline-zoom-out", ["cmd+-"]], // zoomOut
	["timeline-zoom-fit", ["shift+z"]], // quicklyAdjustZoomFit
	["toggle-elements-visibility-selected", ["v"]], // toggleSegmentVisibe
	["mark-in", ["i"]], // selectRangeStart
	["mark-out", ["o"]], // selectRangeEnd
	["mark-clip", ["shift+x"]], // selectRangeBySegment
	["clear-in-out", ["alt+x"]], // cancelRangeSelect
	["toggle-source-audio", ["ctrl+shift+s"]], // toggleVideoAudio
	["group-selected", ["cmd+g"]], // segmentMakeGroup
	["ungroup-selected", ["shift+cmd+g"]], // segmentRemoveGroup
	["create-compound", ["alt+g"]], // segmentCombination
	["dismiss-compound", ["alt+shift+g"]], // segmentRemoveCombination
	// Markers
	["toggle-bookmark", ["m"]], // mark
	["add-marker-alt-color", ["alt+m"]], // markWithAnotherColor
	["previous-marker", ["alt+shift+m"]], // prevTimeMark
	["next-marker", ["shift+m"]], // nextTimeMark
	["mark-beat", ["cmd+j"]], // markBeat
	// Speed & keyframes
	["speed-duration", ["cmd+r"]], // activeSpeedControl
	["toggle-keyframe-panel", ["alt+k"]], // expandKeyframePanel
	["toggle-keyframe", ["alt+shift+k"]], // addBasicKeyframe
	// Audio
	// CapCut's ⌘. / ⌘, moved to the pair ⌥⌘. / ⌥⌘, : ⌘, is the Mac's Settings key (register C3), ⌘. stops Claude
	["volume-up", ["alt+cmd+."]], // voiceUp
	["volume-down", ["alt+cmd+,"]], // voiceDown
	// App
	["new-project", ["cmd+n"]], // newProject
	["import-media", ["cmd+i"]], // importMedia
	["export-project", ["cmd+e"]], // exportVideo
	["close-project", ["cmd+w"]], // closeWindow
	["cancel-interaction", ["escape"]], // closeDialog
	["show-projects", ["alt+cmd+q"]], // returnDraftPage
	["focus-next-panel", ["tab"]], // switchTab
];

/** Gaziyav's own commands on keys CapCut leaves free (in both CapCut presets). */
const CAPCUT_EXTRAS: PresetTable = [
	// not a CapCut key (it saves by itself): ⌘S saves now and keeps the moment as a version
	["save-project", ["cmd+s"]],
	["paste-over", ["alt+v"]],
	["ripple-delete", ["shift+backspace"]],
	["clear-in", ["alt+i"]],
	["clear-out", ["alt+o"]],
	["goto-in", ["shift+i"]],
	["goto-out", ["shift+o"]],
	["goto-timecode", ["g"]], // focuses the player's timecode field (type 5 → 5 s, 130 → 1:30, +5, -12f)
	["play-in-to-out", ["/"]],
	// Premiere's Lift (;) and Extract (') of the In–Out range (the keys were free here).
	["lift-in-out", [";"]],
	["extract-in-out", ["'"]],
	["show-shortcuts", ["cmd+/"]],
	["focus-search", ["cmd+f"]],
	["focus-previous-panel", ["shift+tab"]],
	["timeline-page-back", ["pageup"]],
	["timeline-page-forward", ["pagedown"]],
	...FRAME_EDIT_KEYS,
	// Premiere's «Extend Edit»: the edge nearer the playhead to it (a roll when a clip touches that edge).
	["extend-edit", ["e"]],
	// The trim model. «,» «.» are Final Cut's nudge keys (free in CapCut): the picked edge or the selected clip a frame
	// earlier / later. [ and ] are CapCut's «select every clip left / right», so the edge keys take ⇧.
	...TRIM_KEYS,
	["nudge-left", [","]],
	["nudge-right", ["."]],
	["nudge-left-large", ["shift+,"]],
	["nudge-right-large", ["shift+."]],
	["trim-select-out", ["shift+["]],
	["trim-select-in", ["shift+]"]],
	["trim-select-roll", ["\\"]],
	...SELECT_STEP_KEYS,
	...DAILY_KEYS_CAPCUT,
	// the File menu's «Import from Link (YouTube)…» key, in the keymap too (register B3: the menu and the keys agree)
	["import-link", ["shift+cmd+y"]],
];

const CAPCUT: PresetTable = [...CAPCUT_BASE, ...CAPCUT_EXTRAS];

const FINAL_CUT: PresetTable = [
	["toggle-play", ["space"]],
	["toggle-loop", ["cmd+l"]],
	["shuttle-backward", ["j"]],
	["shuttle-stop", ["k"]],
	["shuttle-forward", ["l"]],
	["frame-step-backward", ["left"]],
	["frame-step-forward", ["right"]],
	["frame-step-backward-large", ["shift+left"]],
	["frame-step-forward-large", ["shift+right"]],
	["previous-edit", ["up", ";"]],
	["next-edit", ["down", "'"]],
	["enter-composition", ["cmd+down"]],
	["exit-composition", ["cmd+up"]],
	["goto-start", ["home"]],
	["goto-end", ["end"]],
	["mark-in", ["i"]],
	["mark-out", ["o"]],
	["clear-in", ["alt+i"]],
	["clear-out", ["alt+o"]],
	["goto-in", ["shift+i"]],
	["goto-out", ["shift+o"]],
	["goto-timecode", ["g"]],
	["clear-in-out", ["alt+x"]],
	["mark-clip", ["x"]],
	["play-in-to-out", ["/"]],
	["toggle-bookmark", ["m"]],
	...COMMON_EDIT,
	["duplicate-selected", ["cmd+d"]],
	["deselect-all", ["shift+cmd+a"]],
	["ripple-delete", ["backspace", "delete"]],
	["delete-selected", ["shift+backspace"]],
	["split", ["cmd+b"]],
	["split-all", ["shift+cmd+b"]],
	["split-left", ["alt+["]],
	["split-right", ["alt+]"]],
	["nudge-left", [","]],
	["nudge-right", ["."]],
	["nudge-left-large", ["shift+,"]],
	["nudge-right-large", ["shift+."]],
	["trim-end-earlier", ["alt+cmd+left"]],
	["trim-end-later", ["alt+cmd+right"]],
	["trim-start-earlier", ["alt+shift+cmd+left"]],
	["trim-start-later", ["alt+shift+cmd+right"]],
	["extend-edit", ["shift+x"]],
	["copy-attributes", ["alt+cmd+c"]],
	["paste-attributes", ["alt+cmd+v", "shift+cmd+v"]],
	["toggle-elements-visibility-selected", ["v"]],
	["select-at-playhead", ["c"]],
	["toggle-source-audio", ["ctrl+shift+s"]],
	["toggle-snapping", ["n"]],
	["toggle-ripple-editing", ["p"]],
	["timeline-zoom-in", ["cmd+="]],
	["timeline-zoom-out", ["cmd+-"]],
	["timeline-zoom-fit", ["shift+z"]],
	["show-shortcuts", ["alt+cmd+k"]],
	["timeline-page-back", ["pageup"]],
	["timeline-page-forward", ["pagedown"]],
	["focus-search", ["cmd+f"]],
	["focus-next-panel", ["tab"]],
	["focus-previous-panel", ["shift+tab"]],
	["speed-duration", ["cmd+r"]],
	["new-project", ["cmd+n"]],
	["import-media", ["cmd+i"]],
	["add-title", ["ctrl+t"]],
	["show-inspector", ["cmd+4"]],
	["show-effects", ["cmd+5"]],
	["match-frame", ["shift+f"]],
	// The trim model: Final Cut's own [ ] \ pick the left edge, the right edge or both sides of the cut nearest the
	// playhead; «,» «.» above then move it. T takes the Trim tool, A gives the Select tool back, B the Blade (Final Cut's
	// own tool keys).
	...TRIM_KEYS,
	["tool-select", ["a"]],
	["tool-split", ["b"]],
	["trim-select-out", ["["]],
	["trim-select-in", ["]"]],
	["trim-select-roll", ["\\"]],
	...SELECT_STEP_KEYS,
	...DAILY_KEYS_FINALCUT,
];

export const KEYMAP_PRESETS: Record<KeymapPresetId, KeymapPreset> = {
	capcut: {
		id: "capcut",
		label: "CapCut",
		hint: "Default · CapCut for Mac keys",
		table: CAPCUT,
	},
	finalcut: {
		id: "finalcut",
		label: "Final Cut Pro",
		hint: "Final Cut Pro defaults · , . nudge, ⌫ ripple delete",
		table: FINAL_CUT,
	},
};

export const KEYMAP_PRESET_IDS = Object.keys(KEYMAP_PRESETS) as KeymapPresetId[];

export function isKeymapPresetId(value: unknown): value is KeymapPresetId {
	return typeof value === "string" && Object.hasOwn(KEYMAP_PRESETS, value);
}

export function getPresetBindings({
	preset,
}: {
	preset: KeymapPresetId;
}): Map<ShortcutKey, TActionWithOptionalArgs> {
	const map = new Map<ShortcutKey, TActionWithOptionalArgs>();
	// The preset's own keys win over the shared keyframe keys (CapCut: ⌥K is the keyframe panel, ⌥⇧K adds a key).
	for (const [action, keys] of [...KEYFRAME_KEYS, ...LIPSYNC_KEYS, ...KEYMAP_PRESETS[preset].table]) {
		for (const key of keys) map.set(key, action);
	}
	return map;
}

/** Commands that came with CapCut parity: a customized keymap gets them on their CapCut keys when those are free. */
export const CAPCUT_PARITY_COMMANDS: ReadonlySet<TActionWithOptionalArgs> = new Set<TActionWithOptionalArgs>([
	// into / out of a compound clip (tlfix A2): a saved keymap gets ⌘↓ / ⌘↑ when they are free
	"enter-composition",
	"exit-composition",
	"player-fullscreen",
	"player-zoom-in",
	"player-zoom-out",
	"player-zoom-fit",
	"toggle-guides",
	"toggle-rulers",
	"add-marker-alt-color",
	"previous-marker",
	"next-marker",
	"toggle-keyframe-panel",
	"volume-up",
	"volume-down",
	// Timeline tools and modes (lane M): A / B, ` and S on their CapCut keys when a saved keymap left them free.
	"tool-select",
	"tool-split",
	"toggle-linkage",
	"toggle-loop",
	"toggle-preview-axis",
	// Groups and compound clips (stage 5): ⌘G ⇧⌘G ⌥G ⌥⇧G.
	"group-selected",
	"ungroup-selected",
	"create-compound",
	"dismiss-compound",
	"mark-beat",
]);

export function getCapCutParityKeys(): PresetTable {
	return CAPCUT_BASE.filter(([action]) => CAPCUT_PARITY_COMMANDS.has(action));
}
