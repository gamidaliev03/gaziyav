// CapCut's timeline toolbar actions: the Select / Split tools (A / B), Linkage (`), Preview axis (S), and the tools for
// the selected clip — Freeze, Reverse, Mirror, Rotate — plus 🎙 Record voiceover, groups (⌘G ⇧⌘G) and compound clips
// (⌥G ⌥⇧G). Each edit is one ⌘Z.
import { toast } from "sonner";
import { useEditor } from "@/editor/use-editor";
import { freezeFrame } from "@/motion/freeze";
import { toggleReverse } from "@/motion/client";
import { useTimelineStore } from "@/timeline/timeline-store";
import { createCompoundClip, dismissCompoundClips } from "@/timeline/compound";
import { groupSelection, ungroupSelection } from "@/timeline/groups";
import type { TimelineElement } from "@/timeline";
import { toggleVoiceover } from "@/voiceover/recorder";
import { useActionHandler } from "./use-action-handler";

const VISUAL_TYPES = new Set(["video", "image", "text", "sticker", "graphic"]);

export function useCapcutTools() {
	const editor = useEditor();

	useActionHandler("tool-select", () => useTimelineStore.getState().setTool("select"), undefined);
	useActionHandler("tool-split", () => useTimelineStore.getState().setTool("split"), undefined);

	useActionHandler(
		"toggle-linkage",
		(_args, trigger) => {
			useTimelineStore.getState().toggleLinkage();
			if (trigger === "keypress") toast(useTimelineStore.getState().linkageEnabled ? "Linkage on" : "Linkage off", { duration: 1200 });
		},
		undefined,
	);

	useActionHandler(
		"toggle-preview-axis",
		(_args, trigger) => {
			const { previewAxis, previewAxisOnMode, setPreviewAxis } = useTimelineStore.getState();
			setPreviewAxis(previewAxis === "off" ? previewAxisOnMode : "off");
			if (trigger === "keypress") toast(useTimelineStore.getState().previewAxis === "off" ? "Preview axis off" : "Preview axis on", { duration: 1200 });
		},
		undefined,
	);

	useActionHandler("freeze-frame", () => void freezeFrame(), undefined);

	useActionHandler(
		"reverse-selected",
		() => {
			const [first] = editor.timeline.getElementsWithTracks({ elements: editor.selection.getSelectedElements() });
			if (!first || first.element.type !== "video") {
				toast.info("Select a video clip to reverse");
				return;
			}
			void toggleReverse(first.element.id);
		},
		undefined,
	);

	/** A transform param changed on every selected picture (a clip whose param has keys is left as it is). */
	const updateVisual = (key: string, next: (value: number) => number, emptyMessage: string) => {
		const updates = editor.timeline
			.getElementsWithTracks({ elements: editor.selection.getSelectedElements() })
			.flatMap(({ track, element }) => {
				if (!VISUAL_TYPES.has(element.type) || element.animations?.[key]) return [];
				const current = Number(element.params[key] ?? (key.startsWith("transform.scale") ? 1 : 0));
				const patch = { params: { ...element.params, [key]: next(current) } } as Partial<TimelineElement>;
				return [{ trackId: track.id, elementId: element.id, patch }];
			});
		if (updates.length === 0) toast.info(emptyMessage);
		else editor.timeline.updateElements({ updates });
	};

	useActionHandler("mirror-selected", () => updateVisual("transform.scaleX", (x) => -x, "Select a clip to mirror"), undefined);
	// CapCut turns the picture a quarter turn clockwise per click.
	useActionHandler(
		"rotate-selected",
		() =>
			updateVisual(
				"transform.rotate",
				(r) => {
					// In (−180°, 180°]: two clicks read 180°, not −180°.
					const turned = (((r + 90) % 360) + 360) % 360;
					return turned > 180 ? turned - 360 : turned;
				},
				"Select a clip to rotate",
			),
		undefined,
	);

	useActionHandler("record-voiceover", () => void toggleVoiceover(), undefined);

	useActionHandler(
		"group-selected",
		() => {
			if (!groupSelection(editor)) toast.info("Select two or more clips to group them");
		},
		undefined,
	);
	useActionHandler(
		"ungroup-selected",
		() => {
			if (!ungroupSelection(editor)) toast.info("Select a group to ungroup it");
		},
		undefined,
	);
	useActionHandler(
		"create-compound",
		() => {
			if (!createCompoundClip(editor)) toast.info("Select clips to make a compound clip");
		},
		undefined,
	);
	useActionHandler(
		"dismiss-compound",
		() => {
			const result = dismissCompoundClips(editor);
			if (result === "none") toast.info("Select a compound clip to dismiss it");
		},
		undefined,
	);
}
