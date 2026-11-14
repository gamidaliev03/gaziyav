"use client";

// Track right-click: Adjustment layer (grades and filters everything below it) and Solid color (a full-frame
// colour matte), like Premiere. Both start at the playhead and are selected so the inspector shows them.
import { HugeiconsIcon } from "@/components/ui/icon";
import { PaintBoardIcon, LayerAddIcon } from "@hugeicons/core-free-icons";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { EditorCore } from "@/core";
import { COLOR_EFFECT_TYPE } from "@/effects/definitions/studio/color";
import { buildEffectElement, buildGraphicElement } from "@/timeline/element-utils";
import { mediaTimeFromSeconds } from "@/wasm";

const FIVE_SECONDS = mediaTimeFromSeconds({ seconds: 5 });

function addAdjustmentLayer() {
	const editor = EditorCore.getInstance();
	const element = buildEffectElement({ effectType: COLOR_EFFECT_TYPE, startTime: editor.playback.getCurrentTime(), duration: FIVE_SECONDS });
	editor.timeline.insertElement({ placement: { mode: "auto", trackType: "effect", newTrack: true }, element: { ...element, name: "Adjustment layer" } });
}

function addSolidColor() {
	const editor = EditorCore.getInstance();
	const canvas = editor.project.getActive()?.settings.canvasSize ?? { width: 1920, height: 1080 };
	const element = buildGraphicElement({
		definitionId: "rectangle",
		name: "Solid color",
		startTime: editor.playback.getCurrentTime(),
		params: {
			fill: "#1f1f24",
			"transform.scaleX": canvas.width / 512 + 0.01,
			"transform.scaleY": canvas.height / 512 + 0.01,
		},
	});
	editor.timeline.insertElement({ placement: { mode: "auto" }, element: { ...element, duration: FIVE_SECONDS } });
}

export function LayerMenuItems() {
	return (
		<>
			<ContextMenuItem
				icon={<HugeiconsIcon icon={LayerAddIcon} />}
				onClick={(event: React.MouseEvent) => {
					event.stopPropagation();
					addAdjustmentLayer();
				}}
			>
				Adjustment layer
			</ContextMenuItem>
			<ContextMenuItem
				icon={<HugeiconsIcon icon={PaintBoardIcon} />}
				onClick={(event: React.MouseEvent) => {
					event.stopPropagation();
					addSolidColor();
				}}
			>
				Solid color
			</ContextMenuItem>
		</>
	);
}
