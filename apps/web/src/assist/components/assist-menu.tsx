"use client";

// Where the Assist tools live: the clip's right-click menu (what applies to that clip) and the timeline toolbar's
// "⋯" menu (the selection). Translating and dubbing a clip has one place: AI → Video translator.
import { HugeiconsIcon } from "@/components/ui/icon";
import { BookmarkRemove02Icon, FilmRoll01Icon, AiMagicIcon, MoreHorizontalIcon, MusicNote01Icon } from "@hugeicons/core-free-icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEditor } from "@/editor/use-editor";
import type { TimelineElement } from "@/timeline";
import { autoColor } from "../auto-color";
import { isBeatMarker, markBeats, removeBeatMarkers } from "../beat-markers";
import { splitScenes } from "../scenes";

import { isPictureClip, isSoundClip, isVideoClip, resolveClip, selectedClips } from "../target";
import { THIS_COMPUTER } from "@/utils/platform";
import { useT } from "@/i18n";


const icon = (i: typeof FilmRoll01Icon) => <HugeiconsIcon icon={i} />;

/** Right-click menu entries for one clip (one line in timeline-element.tsx). */
export function AssistClipMenuItems({ trackId, element }: { trackId: string; element: TimelineElement | null }) {
	const editor = useEditor();
	if (!element) return null;
	const ref = { trackId, elementId: element.id };
	const clip = resolveClip(editor, ref);
	if (!clip) return null;
	const video = isVideoClip(clip);
	const picture = isPictureClip(clip);
	const music = element.type === "audio" && isSoundClip(clip);
	if (!video && !picture && !music) return null;
	const stop = (e: React.MouseEvent) => e.stopPropagation();
	return (
		<>
			<ContextMenuSeparator />
			{video && (
				<ContextMenuItem icon={icon(FilmRoll01Icon)} onClick={(e: React.MouseEvent) => (stop(e), void splitScenes(ref))} data-assist="split-scenes">
					Split scenes
				</ContextMenuItem>
			)}
			{picture && (
				<ContextMenuItem icon={icon(AiMagicIcon)} onClick={(e: React.MouseEvent) => (stop(e), void autoColor(ref))} data-assist="auto-color">
					Auto color
				</ContextMenuItem>
			)}
			{music && (
				<ContextMenuItem icon={icon(MusicNote01Icon)} onClick={(e: React.MouseEvent) => (stop(e), void markBeats(ref))} data-assist="beat-markers">
					Beat markers
				</ContextMenuItem>
			)}
		</>
	);
}

/** The timeline toolbar's "⋯" menu: Assist tools for the selection (one line in timeline-toolbar.tsx). */
export function AssistToolbarMenu() {
	const t = useT();
	const editor = useEditor();
	const selection = useEditor((e) => e.selection.getSelectedElements(), ["selection", "timeline"]);
	const beatCount = useEditor((e) => (e.scenes.getActiveSceneOrNull()?.bookmarks ?? []).filter(isBeatMarker).length, ["scenes"]);
	void selection;
	const clips = selectedClips(editor);
	const video = clips.find(isVideoClip);
	const picture = clips.some(isPictureClip);
	const sound = clips.find((c) => c.element.type === "audio" && isSoundClip(c)) ?? clips.find(isSoundClip);
	const hint = (ok: boolean, what: string) => (ok ? undefined : `Select ${what} on the timeline`);
	return (
		<DropdownMenu>
			{/* The same hover tooltip as the toolbar buttons next to it. */}
			<Tooltip delayDuration={200}>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button variant="text" size="icon" className="rounded-sm" aria-label="More tools" data-assist-menu>
							<HugeiconsIcon icon={MoreHorizontalIcon} className="size-4" />
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent>More tools: scenes, color, beats</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="start" className="w-60">
				<DropdownMenuLabel className="text-muted-foreground text-xs font-normal">{t("Assist · on {computer}", { computer: t(THIS_COMPUTER) })}</DropdownMenuLabel>
				<DropdownMenuItem icon={icon(FilmRoll01Icon)} disabled={!video} title={hint(!!video, "a video clip")} onSelect={() => video && void splitScenes({ trackId: video.trackId, elementId: video.element.id })}>
					Split scenes
				</DropdownMenuItem>
				<DropdownMenuItem icon={icon(AiMagicIcon)} disabled={!picture} title={hint(picture, "video or image clips")} onSelect={() => void autoColor()}>
					Auto color
				</DropdownMenuItem>
				<DropdownMenuItem icon={icon(MusicNote01Icon)} disabled={!sound} title={hint(!!sound, "a music clip")} onSelect={() => sound && void markBeats({ trackId: sound.trackId, elementId: sound.element.id })}>
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
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
