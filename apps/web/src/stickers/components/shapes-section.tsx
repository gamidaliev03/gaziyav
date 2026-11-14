"use client";

// Stickers → Shapes: hand-made shapes as ordinary timeline layers (no AI, no composition). A double-click, «+» or a
// drag puts one at the playhead / where it is dropped; its fill, stroke and corners are in the clip's Shape tab, its
// move in Motion (In / Out / Loop) and its keyframes on Basic → Transform (◆), like any clip.
import type { ReactNode } from "react";
import { materialGrid, MATERIAL_TILE } from "@/components/editor/panels/assets/material-grid";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import type { ParamValues } from "@/params";
import { buildGraphicElement } from "@/timeline/element-utils";

const GOLD = "#FFD23F";

export interface ShapePreset {
	id: string;
	name: string;
	definitionId: string;
	params: Partial<ParamValues>;
	icon: ReactNode;
}

const svg = (child: ReactNode) => (
	<svg viewBox="0 0 40 40" className="size-10" aria-hidden>
		{child}
	</svg>
);

/** A shape at scale 1 is a square of the frame's short side (montage/layers.ts → shapeBase). */
export const SHAPE_PRESETS: ShapePreset[] = [
	{ id: "rect", name: "Rectangle", definitionId: "rectangle", params: { fill: GOLD, "transform.scaleX": 0.6, "transform.scaleY": 0.22 }, icon: svg(<rect x="4" y="12" width="32" height="16" fill={GOLD} />) },
	{ id: "rounded", name: "Rounded rectangle", definitionId: "rectangle", params: { fill: GOLD, cornerRadius: 24, "transform.scaleX": 0.6, "transform.scaleY": 0.22 }, icon: svg(<rect x="4" y="12" width="32" height="16" rx="6" fill={GOLD} />) },
	{ id: "ellipse", name: "Ellipse", definitionId: "ellipse", params: { fill: GOLD, "transform.scaleX": 0.35, "transform.scaleY": 0.35 }, icon: svg(<circle cx="20" cy="20" r="13" fill={GOLD} />) },
	{ id: "line", name: "Straight line", definitionId: "rectangle", params: { fill: "#ffffff", cornerRadius: 50, "transform.scaleX": 0.6, "transform.scaleY": 0.01 }, icon: svg(<rect x="4" y="19" width="32" height="2.5" rx="1.25" fill="#ffffff" />) },
	{ id: "triangle", name: "Triangle", definitionId: "polygon", params: { fill: GOLD, sides: 3, "transform.scaleX": 0.35, "transform.scaleY": 0.35 }, icon: svg(<polygon points="20,6 35,33 5,33" fill={GOLD} />) },
	{ id: "star", name: "Star", definitionId: "star", params: { fill: GOLD, "transform.scaleX": 0.35, "transform.scaleY": 0.35 }, icon: svg(<polygon points="20,4 24.7,14.5 36,15.6 27.5,23.1 30,34.3 20,28.4 10,34.3 12.5,23.1 4,15.6 15.3,14.5" fill={GOLD} />) },
	{ id: "hexagon", name: "Hexagon", definitionId: "polygon", params: { fill: GOLD, sides: 6, "transform.scaleX": 0.35, "transform.scaleY": 0.35 }, icon: svg(<polygon points="20,5 33,12.5 33,27.5 20,35 7,27.5 7,12.5" fill={GOLD} />) },
];

export function ShapesSection() {
	const t = useT();
	return (
		<PanelView title={t("Shapes")}>
			<div style={materialGrid(MATERIAL_TILE)} data-shapes-grid>
				{SHAPE_PRESETS.map((preset) => (
					<ShapeTile key={preset.id} preset={preset} />
				))}
			</div>
		</PanelView>
	);
}

function ShapeTile({ preset }: { preset: ShapePreset }) {
	const t = useT();
	const editor = useEditor();
	const name = t(preset.name);
	return (
		<div data-shape-preset={preset.id}>
			<DraggableItem
				name={name}
				preview={<div className="flex size-full items-center justify-center bg-neutral-800">{preset.icon}</div>}
				dragData={{ id: `shape:${preset.id}`, type: "graphic", name, definitionId: preset.definitionId, params: preset.params }}
				onAddToTimeline={({ currentTime }) => {
					if (!editor.project.getActiveOrNull()) return;
					const element = buildGraphicElement({ definitionId: preset.definitionId, name, startTime: currentTime, params: preset.params });
					editor.timeline.insertElement({ placement: { mode: "auto" }, element });
				}}
				aspectRatio={1}
				containerClassName="w-full"
				shouldShowPlusOnDrag={false}
				// the shape is its own picture: its name is the tooltip (the owner, 12.11)
				shouldShowLabel={false}
			/>
		</div>
	);
}
