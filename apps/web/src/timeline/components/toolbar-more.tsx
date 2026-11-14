"use client";

// timeline stay only what Final Cut keeps there: the tool, undo / redo, split, delete, the magnet, snapping, linkage and
// the zoom. Everything else the bar used to show is here, in the clip's right-click menu and in the shortcuts: delete
// left / right, the marker, the selected clip's tools (freeze, reverse, mirror, rotate, crop, its sound), the assist
// tools (scenes, colour, beats), the voice-over, the preview axis and what follows the main track.
import { HugeiconsIcon } from "@/components/ui/icon";
import { Fragment } from "react";
import {
	AlignLeftIcon,
	AlignRightIcon,
	BackwardIcon,
	Bookmark02Icon,
	BookmarkRemove02Icon,
	CropIcon,
	CursorInWindowIcon,
	FilmRoll01Icon,
	FlipHorizontalIcon,
	Link02Icon,
	AiMagicIcon,
	Mic01Icon,
	MoreHorizontalIcon,
	MusicNote01Icon,
	RotateClockwiseIcon,
	SnowIcon,
	StopIcon,
	Unlink02Icon,
} from "@hugeicons/core-free-icons";
import { toast } from "sonner";
import { type TActionWithOptionalArgs, invokeAction } from "@/actions";
import { ACTIONS } from "@/actions/definitions";
import { getActionShortcutLabel, useKeybindingsStore } from "@/actions/keybindings-store";
import { autoColor } from "@/assist/auto-color";
import { isBeatMarker, markBeats, removeBeatMarkers } from "@/assist/beat-markers";
import { splitScenes } from "@/assist/scenes";
import { isPictureClip, isSoundClip, isVideoClip, selectedClips } from "@/assist/target";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEditor } from "@/editor/use-editor";
import { t, useT } from "@/i18n";
import { actionName } from "@/actions/names";
import { getElementsAtTime, hasMediaId } from "@/timeline";
import { canToggleSourceAudio, getSourceAudioActionLabel, isSourceAudioSeparated } from "@/timeline/audio-separation";
import { useElementSelection } from "@/timeline/hooks/element/use-element-selection";
import { LINKAGE_KINDS, type PreviewAxisMode, useTimelineStore } from "@/timeline/timeline-store";
import { useVoiceoverRecorder } from "@/voiceover/recorder";
import { CropDialog, openCropForSelection } from "./crop-dialog";

const icon = (i: typeof SnowIcon) => <HugeiconsIcon icon={i} />;

function Shortcut({ action }: { action: TActionWithOptionalArgs }) {
	const label = getActionShortcutLabel({ action });
	return label ? <DropdownMenuShortcut>{label}</DropdownMenuShortcut> : null;
}

const run = (action: TActionWithOptionalArgs) => () => invokeAction(action);

/** Navigate ▸ — in pairs: the cuts, the frames, the clips, the nudge. */
const STEP_ITEMS = [
	"previous-edit",
	"next-edit",
	"frame-step-backward",
	"frame-step-forward",
	"select-previous-clip",
	"select-next-clip",
	"nudge-left",
	"nudge-right",
] as const satisfies readonly TActionWithOptionalArgs[];
/** A greyed row's reason, as its tooltip (the same words the action says when it can't run). */
const why = (disabled: boolean, reason: string) => (disabled ? t(reason) : undefined);

export function TimelineMoreMenu() {
	const t = useT();
	const editor = useEditor();
	useKeybindingsStore((state) => state.keybindings);
	const { selectedElements } = useElementSelection();
	// re-render on edits too: separating the sound changes the selected clip
	useEditor((e) => e.scenes.getActiveSceneOrNull()?.tracks, ["scenes", "timeline"]);
	const mediaAssets = useEditor((e) => e.media.getAssets(), ["media"]);
	const hasClipUnderPlayhead = useEditor(
		(e) => {
			const scene = e.scenes.getActiveSceneOrNull();
			return !!scene && getElementsAtTime({ tracks: scene.tracks, time: e.playback.getCurrentTime() }).length > 0;
		},
		["playback", "scenes", "timeline"],
	);
	const isBookmarked = useEditor((e) => e.scenes.isBookmarked({ time: e.playback.getCurrentTime() }));
	const beatCount = useEditor((e) => (e.scenes.getActiveSceneOrNull()?.bookmarks ?? []).filter(isBeatMarker).length, ["scenes"]);
	const recording = useVoiceoverRecorder((s) => s.recording);
	const previewAxis = useTimelineStore((s) => s.previewAxis);
	const linkageKinds = useTimelineStore((s) => s.linkageKinds);

	const selected = editor.timeline.getElementsWithTracks({ elements: selectedElements });
	const hasSelection = selected.length > 0;
	const hasVideo = selected.some(({ element }) => element.type === "video");
	const hasMedia = selected.some(({ element }) => element.type === "video" || element.type === "image");
	const hasVisual = selected.some(({ element }) => ["video", "image", "text", "sticker", "graphic"].includes(element.type));
	const one = selected.length === 1 ? selected[0] : null;
	const oneElement = one?.element;
	const asset = oneElement && hasMediaId(oneElement) ? (mediaAssets.find((a) => a.id === oneElement.mediaId) ?? null) : null;
	const canSound = !!one && canToggleSourceAudio(one.element, asset);
	const soundLabel = one?.element.type === "video" ? getSourceAudioActionLabel({ element: one.element }) : "Extract audio";
	const soundApart = one?.element.type === "video" && isSourceAudioSeparated({ element: one.element });

	const clips = selectedClips(editor);
	const video = clips.find(isVideoClip);
	const picture = clips.some(isPictureClip);
	const sound = clips.find((c) => c.element.type === "audio" && isSoundClip(c)) ?? clips.find(isSoundClip);

	return (
		<>
			<DropdownMenu>
				<Tooltip delayDuration={200}>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button variant="text" size="icon" className="h-7 w-8 rounded-sm" aria-label="More" data-toolbar-more="" data-assist-menu="">
								<HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent>More</TooltipContent>
				</Tooltip>
				{/* never past the window's edge (a 1024×640 window put «Extract audio» above the screen — pro-core K): at most
				    the room there is, the rest scrolls */}
				<DropdownMenuContent
					align="start"
					collisionPadding={8}
					className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-64 overflow-y-auto"
					data-toolbar-more-menu=""
				>
					<DropdownMenuItem icon={icon(AlignLeftIcon)} disabled={!hasClipUnderPlayhead} title={why(!hasClipUnderPlayhead, "No clip under the playhead")} onSelect={run("split-left")} data-toolbar-id="split-left">
						{actionName("split-left")}
						<Shortcut action="split-left" />
					</DropdownMenuItem>
					<DropdownMenuItem icon={icon(AlignRightIcon)} disabled={!hasClipUnderPlayhead} title={why(!hasClipUnderPlayhead, "No clip under the playhead")} onSelect={run("split-right")} data-toolbar-id="split-right">
						{actionName("split-right")}
						<Shortcut action="split-right" />
					</DropdownMenuItem>
					<DropdownMenuItem icon={icon(Bookmark02Icon)} onSelect={run("toggle-bookmark")} data-toolbar-id="toggle-bookmark">
						{isBookmarked ? "Remove marker" : "Add marker"}
						<Shortcut action="toggle-bookmark" />
					</DropdownMenuItem>
					{/* The pointer's path to the keyboard's steps (tlc2): the menu stays open, so each click is one more step. */}
					<DropdownMenuSub>
						<DropdownMenuSubTrigger data-toolbar-id="navigate">Navigate</DropdownMenuSubTrigger>
						<DropdownMenuSubContent data-toolbar-navigate="">
							{STEP_ITEMS.map((action, index) => (
								<Fragment key={action}>
									{index > 0 && index % 2 === 0 && <DropdownMenuSeparator />}
									<DropdownMenuItem
										data-toolbar-id={action}
										onSelect={(event) => {
											event.preventDefault();
											invokeAction(action);
										}}
									>
										{ACTIONS[action].description}
										<Shortcut action={action} />
									</DropdownMenuItem>
								</Fragment>
							))}
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					{hasSelection && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem icon={icon(SnowIcon)} onSelect={run("freeze-frame")} data-toolbar-id="freeze-frame">
								{actionName("freeze-frame")}
								<Shortcut action="freeze-frame" />
							</DropdownMenuItem>
							<DropdownMenuItem icon={icon(BackwardIcon)} disabled={!hasVideo} title={why(!hasVideo, "Select a video clip to reverse")} onSelect={run("reverse-selected")} data-toolbar-id="reverse-selected">
								{actionName("reverse-selected")}
								<Shortcut action="reverse-selected" />
							</DropdownMenuItem>
							<DropdownMenuItem icon={icon(FlipHorizontalIcon)} disabled={!hasVisual} title={why(!hasVisual, "Select a clip to mirror")} onSelect={run("mirror-selected")} data-toolbar-id="mirror-selected">
								{actionName("mirror-selected")}
								<Shortcut action="mirror-selected" />
							</DropdownMenuItem>
							<DropdownMenuItem icon={icon(RotateClockwiseIcon)} disabled={!hasVisual} title={why(!hasVisual, "Select a clip to rotate")} onSelect={run("rotate-selected")} data-toolbar-id="rotate-selected">
								{actionName("rotate-selected")}
								<Shortcut action="rotate-selected" />
							</DropdownMenuItem>
							<DropdownMenuItem
								icon={icon(CropIcon)}
								disabled={!hasMedia}
								title={why(!hasMedia, "Select a video or photo to crop it")}
								onSelect={() => {
									if (!openCropForSelection(editor)) toast.info("Select a video or photo to crop it");
								}}
								data-toolbar-id="crop"
							>
								Crop
							</DropdownMenuItem>
							<DropdownMenuItem icon={icon(soundApart ? Unlink02Icon : Link02Icon)} disabled={!canSound} title={why(!canSound, "Select a clip with sound")} onSelect={run("toggle-source-audio")} data-toolbar-id="toggle-source-audio">
								{soundLabel}
								<Shortcut action="toggle-source-audio" />
							</DropdownMenuItem>
						</>
					)}
					<DropdownMenuSeparator />
					<DropdownMenuItem icon={icon(FilmRoll01Icon)} disabled={!video} onSelect={() => video && void splitScenes({ trackId: video.trackId, elementId: video.element.id })} data-assist="split-scenes">
						Split scenes
					</DropdownMenuItem>
					<DropdownMenuItem icon={icon(AiMagicIcon)} disabled={!picture} onSelect={() => void autoColor()} data-assist="auto-color">
						Auto color
					</DropdownMenuItem>
					<DropdownMenuItem icon={icon(MusicNote01Icon)} disabled={!sound} onSelect={() => sound && void markBeats({ trackId: sound.trackId, elementId: sound.element.id })} data-assist="beat-markers">
						Beat markers
					</DropdownMenuItem>
					{beatCount > 0 && (
						<DropdownMenuItem
							icon={icon(BookmarkRemove02Icon)}
							onSelect={() => {
								const n = removeBeatMarkers();
								if (n) toast.success(t("Removed {n} beat markers", { n }), { action: { label: t("Undo"), onClick: () => editor.command.undo() } });
							}}
						>
							{t("Remove beat markers ({n})", { n: beatCount })}
						</DropdownMenuItem>
					)}
					<DropdownMenuSeparator />
					<DropdownMenuItem icon={icon(recording ? StopIcon : Mic01Icon)} onSelect={run("record-voiceover")} data-toolbar-id="record-voiceover">
						{recording ? "Stop recording" : "Record voiceover"}
						<Shortcut action="record-voiceover" />
					</DropdownMenuItem>
					<DropdownMenuCheckboxItem
						checked={previewAxis !== "off"}
						onCheckedChange={() => invokeAction("toggle-preview-axis")}
						data-toolbar-id="preview-axis"
					>
						<HugeiconsIcon icon={CursorInWindowIcon} className="size-4" />
						Preview axis
						<Shortcut action="toggle-preview-axis" />
					</DropdownMenuCheckboxItem>
					{previewAxis !== "off" && (
						<DropdownMenuCheckboxItem
							checked={previewAxis === "video"}
							onSelect={(event) => event.preventDefault()}
							onCheckedChange={(on) => useTimelineStore.getState().setPreviewAxis((on ? "video" : "av") as PreviewAxisMode)}
							data-preview-axis-option="video"
						>
							Preview video only
						</DropdownMenuCheckboxItem>
					)}
					<DropdownMenuSub>
						<DropdownMenuSubTrigger data-linkage-settings="">Follow main-track clips</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							{/* stickers left the editor (12.11): their kind is not offered any more (register E1) */}
							{LINKAGE_KINDS.filter((kind) => kind.id !== "sticker").map((kind) => (
								<DropdownMenuCheckboxItem
									key={kind.id}
									data-linkage-kind={kind.id}
									checked={linkageKinds.includes(kind.id)}
									onSelect={(event) => event.preventDefault()}
									onCheckedChange={(checked) => {
										const current = useTimelineStore.getState().linkageKinds.filter((id) => id !== kind.id);
										useTimelineStore.getState().setLinkageKinds(checked ? [...current, kind.id] : current);
									}}
								>
									{kind.label}
								</DropdownMenuCheckboxItem>
							))}
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				</DropdownMenuContent>
			</DropdownMenu>
			<CropDialog />
		</>
	);
}
