// Every action goes through invokeAction (registry.ts): a key, a menu row, a toolbar button, ⌘K, the connector. Before
// its handlers run, the guard here asks the action's precondition; when it fails, nothing runs and ONE short quiet line
// says why («Ничего не выделено», «Дорожка закреплена») in the toasts' place — never a dialog, never two at once.
// Menus read the same `whyNot` to disable their row with the reason as its tooltip. Navigation keys have no
// precondition: they never complain. A reason is an English catalogue key, translated where it is shown.
import { toast } from "sonner";
import { getElementKeyframes } from "@/animation";
import { EditorCore } from "@/core";
import { t } from "@/i18n";
import { resolveInOutRange, useInOutStore } from "@/in-out/store";
import { hasMediaId } from "@/timeline";
import { canToggleSourceAudio } from "@/timeline/audio-separation";
import { getElementsAtTime } from "@/timeline/element-utils";
import { splitTargets } from "@/timeline/split-targets";
import { lockedTrackIds } from "@/timeline/track-lock";
import { useTrimUi } from "@/timeline/trim/store";
import type { ElementRef, SceneTracks } from "@/timeline/types";
import { useSelectedCut } from "@/transitions/commands";
import type { TAction } from "./definitions";
import { setActionGuard } from "./registry";

export const WHY = {
	nothing: "Nothing selected",
	locked: "The track is locked",
	oneClip: "Select one clip",
	inside: "Put the playhead inside the clip",
	noClip: "No clip under the playhead",
	marks: "Mark In (I) and Out (O) first",
	sound: "Select a clip with sound",
	noKeys: "The clip has no keyframes",
} as const;

type Why = string | null;

const tracksOf = (editor: EditorCore): SceneTracks => editor.scenes.getActiveScene().tracks;
/** The selected clips that still exist. */
const selectedClips = (editor: EditorCore): ElementRef[] => {
	const refs = editor.selection.getSelectedElements();
	return refs.length ? editor.timeline.getElementsWithTracks({ elements: [...refs] }).map(({ track, element }) => ({ trackId: track.id, elementId: element.id })) : [];
};

/** Something selected, and not all of it on a locked track. */
const needClips = (editor: EditorCore): Why => {
	const refs = selectedClips(editor);
	if (refs.length === 0) return WHY.nothing;
	const locked = lockedTrackIds(tracksOf(editor));
	if (locked.size && refs.every((ref) => locked.has(ref.trackId))) return WHY.locked;
	return null;
};
const needOneClip = (editor: EditorCore): Why => needClips(editor) ?? (selectedClips(editor).length > 1 ? WHY.oneClip : null);

/** ⌘B: the selected clips under the playhead, else the main track's clip there (split-targets.ts). */
const canSplit = (editor: EditorCore, all: boolean): Why => {
	const tracks = tracksOf(editor);
	const time = editor.playback.getCurrentTime() as number;
	const selected = all ? [] : selectedClips(editor);
	if (splitTargets({ tracks, time, selected, all }).length > 0) return null;
	const locked = lockedTrackIds(tracks);
	if (selected.length) return locked.size && selected.every((ref) => locked.has(ref.trackId)) ? WHY.locked : WHY.inside;
	// nothing selected: ⌘B cuts the main track's clip, ⇧⌘B every track's
	const under = getElementsAtTime({ tracks, time }).filter((ref) => all || ref.trackId === tracks.main.id);
	if (under.length && under.every((ref) => locked.has(ref.trackId))) return WHY.locked;
	// no clip there, or the playhead on a clip's very start or end (a cut there would make nothing)
	return under.length ? WHY.inside : WHY.noClip;
};

/** Q / W: the clips (selected, else under the playhead) the playhead is strictly inside. */
const canTrimToPlayhead = (editor: EditorCore): Why => {
	const tracks = tracksOf(editor);
	const time = editor.playback.getCurrentTime() as number;
	const locked = lockedTrackIds(tracks);
	const selected = selectedClips(editor);
	const refs = selected.length ? selected : getElementsAtTime({ tracks, time }).filter((ref) => !locked.has(ref.trackId));
	if (selected.length && locked.size && selected.every((ref) => locked.has(ref.trackId))) return WHY.locked;
	if (!refs.length) return selected.length ? WHY.inside : WHY.noClip;
	const inside = editor.timeline.getElementsWithTracks({ elements: refs }).some(({ element }) => time > element.startTime && time < element.startTime + element.duration);
	return inside ? null : WHY.inside;
};

const canToggleAudio = (editor: EditorCore): Why => {
	const why = needOneClip(editor);
	if (why) return why;
	const [found] = editor.timeline.getElementsWithTracks({ elements: selectedClips(editor) });
	if (!found) return WHY.nothing;
	const element = found.element;
	const mediaId = hasMediaId(element) ? element.mediaId : null;
	const asset = mediaId ? (editor.media.getAssets().find((a) => a.id === mediaId) ?? null) : null;
	return canToggleSourceAudio(found.element, asset) ? null : WHY.sound;
};

const hasMarks = (editor: EditorCore): Why => {
	const { inPoint, outPoint } = useInOutStore.getState();
	return resolveInOutRange({ inPoint, outPoint, duration: editor.timeline.getTotalDuration() }) ? null : WHY.marks;
};

/** ⌫ also takes a clicked transition, selected keys or mask points off. */
const canDelete = (editor: EditorCore): Why => {
	if (useSelectedCut.getState().cut) return null;
	const kind = editor.selection.getActiveSelectionKind();
	if (kind === "keyframes" || kind === "mask-points") return null;
	return needClips(editor);
};

/** «,» «.» move a picked edge too (timeline/trim): only a selection-less, edge-less press has nothing to move. */
const canNudge = (editor: EditorCore): Why => (useTrimUi.getState().selection ? null : needClips(editor));

/** ⌥K: the panel of the selected clips' keyframes — there must be some to show. */
const hasKeys = (editor: EditorCore): Why => {
	const refs = selectedClips(editor);
	if (!refs.length) return null; // the handler's own «select a clip» says it
	const any = editor.timeline.getElementsWithTracks({ elements: refs }).some(({ element }) => getElementKeyframes({ animations: element.animations }).length > 0);
	return any ? null : WHY.noKeys;
};

const CHECKS: Partial<Record<TAction, (editor: EditorCore) => Why>> = {
	split: (editor) => canSplit(editor, false),
	"split-all": (editor) => canSplit(editor, true),
	"split-left": canTrimToPlayhead,
	"split-right": canTrimToPlayhead,
	"delete-selected": canDelete,
	"ripple-delete": needClips,
	"cut-selected": (editor) => (editor.selection.getSelectedKeyframes().length ? null : needClips(editor)),
	"duplicate-selected": needClips,
	"copy-attributes": (editor) => (selectedClips(editor).length ? null : WHY.nothing),
	"toggle-elements-visibility-selected": needClips,
	"toggle-elements-muted-selected": needClips,
	"toggle-source-audio": canToggleAudio,
	"nudge-left": canNudge,
	"nudge-right": canNudge,
	"nudge-left-large": canNudge,
	"nudge-right-large": canNudge,
	"trim-end-earlier": needClips,
	"trim-end-later": needClips,
	"trim-start-earlier": needClips,
	"trim-start-later": needClips,
	"extend-edit": needClips,
	"slip-left": needOneClip,
	"slip-right": needOneClip,
	"slip-left-large": needOneClip,
	"slip-right-large": needOneClip,
	"slip-type-plus": needOneClip,
	"slip-type-minus": needOneClip,
	"toggle-keyframe-panel": hasKeys,
	"lift-in-out": hasMarks,
	"extract-in-out": hasMarks,
};

/** Why the action can't run now (an English catalogue key), or null when it can — or has no precondition. */
export function whyNot(action: TAction): Why {
	const check = CHECKS[action];
	if (!check) return null;
	try {
		const editor = EditorCore.getInstance();
		if (!editor.project.getActiveOrNull() || !editor.scenes.getActiveSceneOrNull()) return null;
		return check(editor);
	} catch {
		return null; // a precondition never blocks by its own fault
	}
}

let shown: string | number | undefined;
/** The one quiet line: a new reason replaces the one on screen. */
export function sayWhy(why: string): void {
	if (shown !== undefined) toast.dismiss(shown);
	shown = toast(t(why), { duration: 1800, className: "gz-why" });
}

setActionGuard((action) => {
	const why = whyNot(action);
	if (!why) return true;
	sayWhy(why);
	return false;
});
