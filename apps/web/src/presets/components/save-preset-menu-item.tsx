"use client";

// Clip right-click: keep AI layers (the selected ones, or all of an AI Composition Gaziyav AI made) or a title's look
// as a Text-tab preset.
import { BookmarkAdd02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { toast } from "sonner";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { useEditor } from "@/editor/use-editor";
import type { TimelineElement } from "@/timeline/types";
import { canSaveAsPreset, clipsForPreset, presetFromClips } from "../actions";
import { useUserPresets } from "../user-presets";

export function SavePresetMenuItem({ trackId, element }: { trackId: string; element: TimelineElement }) {
	const editor = useEditor();
	if (!canSaveAsPreset(element)) return null;

	const save = () => {
		const selected = editor.selection.getSelectedElements();
		const refs = selected.some((ref) => ref.elementId === element.id) ? selected : [{ trackId, elementId: element.id }];
		const scenes = editor.scenes.getScenes();
		const elements = editor.timeline
			.getElementsWithTracks({ elements: refs })
			.flatMap(({ element: clip }) => clipsForPreset({ element: clip, scenes }));
		const preset = presetFromClips({ elements, canvas: editor.project.getActive().settings.canvasSize });
		if (!preset) return;
		useUserPresets.getState().addText(preset);
		toast.success(`“${preset.name}” saved to Text › My presets`);
	};

	return (
		<ContextMenuItem
			icon={<HugeiconsIcon icon={BookmarkAdd02Icon} />}
			onClick={(event: React.MouseEvent) => {
				event.stopPropagation();
				save();
			}}
		>
			Save as preset
		</ContextMenuItem>
	);
}
