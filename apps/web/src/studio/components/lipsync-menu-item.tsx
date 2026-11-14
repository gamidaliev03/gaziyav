"use client";

import { openLipsync } from "@/studio/components/lipsync-inspector";
import { HugeiconsIcon } from "@/components/ui/icon";
import { VoiceIcon } from "@hugeicons/core-free-icons";
import { ContextMenuItem, ContextMenuShortcut } from "@/components/ui/context-menu";
import type { TimelineElement } from "@/timeline/types";
import { EditorCore } from "@/core";
import { takesOf } from "@/studio/client/takes";
import { flipSelectedTake } from "./clip-lipsync";

/** Right-click a video clip → «Lipsync…»: the same as ⌥L — the clip's Lipsync section first, the caret in the words. */
export function LipsyncMenuItem({ trackId, element }: { trackId: string; element: TimelineElement | null }) {
	if (!element || element.type !== "video") return null;
	const item = (
		<ContextMenuItem
			icon={<HugeiconsIcon icon={VoiceIcon} />}
			data-lipsync-menu
			onClick={(event: React.MouseEvent) => {
				event.stopPropagation();
				openLipsync({ trackId, elementId: element.id });
			}}
		>
			Lipsync…
			<ContextMenuShortcut>⌥L</ContextMenuShortcut>
		</ContextMenuItem>
	);
	// lip3: a clip with takes flips original ↔ the newest lipsynced take here too (the same as ⇧⌥L)
	const editor = EditorCore.getInstance();
	const takes = takesOf(editor, editor.project.getActiveOrNull()?.metadata.id ?? "", element.id);
	if (!takes) return item;
	return (
		<>
			{item}
			<ContextMenuItem
				data-lipsync-take-flip
				onClick={(event: React.MouseEvent) => {
					event.stopPropagation();
					editor.selection.setSelectedElements({ elements: [{ trackId, elementId: element.id }] });
					flipSelectedTake();
				}}
			>
				{takes.shown === 0 ? "Show the lipsynced take" : "Show the original"}
				<ContextMenuShortcut>⇧⌥L</ContextMenuShortcut>
			</ContextMenuItem>
		</>
	);
}
