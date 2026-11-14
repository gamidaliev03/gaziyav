"use client";

import { toast } from "sonner";
import { useActionHandler } from "@/actions/use-action-handler";
import { useEditor } from "@/editor/use-editor";
import {
	addMarkerInAnotherColor,
	changeSelectedVolume,
	jumpToMarker,
	toggleGuides,
	toggleKeyframePanel,
	toggleRulers,
	VOLUME_STEP_DB,
} from "./capcut-commands";
import { toggleBeatMark } from "@/timeline/beats";

/** Handlers of the CapCut keys Gaziyav lacked (the player's zoom and full screen live with the player). */
export function useCapCutActions() {
	const editor = useEditor();
	useActionHandler("next-marker", () => void jumpToMarker(editor, "next"), undefined);
	useActionHandler("previous-marker", () => void jumpToMarker(editor, "previous"), undefined);
	useActionHandler("add-marker-alt-color", () => addMarkerInAnotherColor(editor), undefined);
	useActionHandler(
		"volume-up",
		() => {
			if (changeSelectedVolume(editor, VOLUME_STEP_DB) === 0) toast.info("Select a clip with sound");
		},
		undefined,
	);
	useActionHandler(
		"volume-down",
		() => {
			if (changeSelectedVolume(editor, -VOLUME_STEP_DB) === 0) toast.info("Select a clip with sound");
		},
		undefined,
	);
	useActionHandler(
		"toggle-keyframe-panel",
		() => {
			if (toggleKeyframePanel(editor) === 0) toast.info("Select a clip to show its keyframes");
		},
		undefined,
	);
	useActionHandler(
		"mark-beat",
		() => {
			if (!toggleBeatMark(editor)) toast.info("Select a clip with sound to mark beats");
		},
		undefined,
	);
	useActionHandler("toggle-guides", () => toggleGuides(), undefined);
	useActionHandler("toggle-rulers", () => toggleRulers(), undefined);
}
