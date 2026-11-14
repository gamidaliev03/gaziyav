"use client";

// «Sync by waveform» in a clip's right-click menu: shown when two or more clips with sound are selected and this is
// one of them. One step, one ⌘Z (sync/run.ts).
import { AudioWave01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import type { TimelineElement } from "@/timeline";
import { runSync } from "../actions";
import { SOUND_SYNC } from "../features";

/** Nothing while sync by waveform is switched off (sound/features.ts). */
export const SyncMenuItems = (props: { trackId: string; element: TimelineElement | null }) => (SOUND_SYNC ? <SyncItem element={props.element} /> : null);

function SyncItem({ element }: { element: TimelineElement | null }) {
	const t = useT();
	const selected = useEditor((e) => e.selection.getSelectedElements(), ["selection"]);
	const withSound = useEditor(
		(e) => e.timeline.getElementsWithTracks({ elements: selected }).filter(({ element: el }) => el.type === "audio" || el.type === "video").length,
		["selection", "timeline", "scenes"],
	);
	if (!element || (element.type !== "audio" && element.type !== "video")) return null;
	if (withSound < 2 || !selected.some((ref) => ref.elementId === element.id)) return null;
	return (
		<ContextMenuItem
			icon={<HugeiconsIcon icon={AudioWave01Icon} />}
			data-clip-menu="sync-waveform"
			onClick={(event: React.MouseEvent) => {
				event.stopPropagation();
				void runSync();
			}}
		>
			{t("Sync by waveform")}
		</ContextMenuItem>
	);
}
