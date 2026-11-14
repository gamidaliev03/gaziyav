"use client";

import { usePreviewViewport } from "@/preview/components/preview-viewport";
import { useTransformHandles } from "@/preview/hooks/use-transform-handles";
import { isVisualElement } from "@/timeline/element-utils";
import {
	getCornerPosition,
	getEdgeHandlePosition,
	type Corner,
	type Edge,
} from "@/preview/element-bounds";
import { placeRotationHandle } from "@/preview/rotation-handle";
import type { OnSnapLinesChange } from "@/preview/hooks/use-preview-interaction";
import {
	BoundingBoxOutline,
	CornerHandle,
	EdgeHandle,
	IconHandle,
	getResizeCursor,
} from "./handle-primitives";
import { RotateClockwiseIcon } from "@hugeicons/core-free-icons";
import { useEditor } from "@/editor/use-editor";

const CORNERS: Corner[] = [
	"top-left",
	"top-right",
	"bottom-left",
	"bottom-right",
];
const EDGES: Edge[] = ["right", "left", "bottom"];

export function TransformHandles({
	onSnapLinesChange,
}: {
	onSnapLinesChange?: OnSnapLinesChange;
}) {
	const viewport = usePreviewViewport();
	const {
		selectedWithBounds,
		hasVisualSelection,
		handleCornerPointerDown,
		handleEdgePointerDown,
		handleRotationPointerDown,
		handlePointerMove,
		handlePointerUp,
	} = useTransformHandles({ onSnapLinesChange });
	const playing = useEditor((e) => e.playback.getIsPlaying(), ["playback"]);

	if (!hasVisualSelection || !selectedWithBounds) return null;

	const { bounds, element } = selectedWithBounds;
	if (!isVisualElement(element)) return null;
	// A clip moving by its keyframes: the box can't keep up with the playing picture (it stood still while the picture
	// grew — targeted test 05.11), so it steps aside until the playback stops, as the handles can't be used then anyway.
	const animations = (element as { animations?: unknown }).animations;
	const animated = Array.isArray(animations) ? animations.length > 0 : !!animations && typeof animations === "object" && Object.keys(animations).length > 0;
	if (playing && animated) return null;

	const displayScale = viewport.getDisplayScale();

	const toOverlay = ({
		canvasX,
		canvasY,
	}: {
		canvasX: number;
		canvasY: number;
	}) =>
		viewport.canvasToOverlay({
			canvasX,
			canvasY,
		});

	const center = toOverlay({ canvasX: bounds.cx, canvasY: bounds.cy });
	const outlineWidth = Math.abs(bounds.width) * displayScale.x;
	const outlineHeight = Math.abs(bounds.height) * displayScale.y;

	const rotationAngleRad = (bounds.rotation * Math.PI) / 180;
	const topCenterLocalY = -bounds.height / 2;
	const topCenterScreen = toOverlay({
		canvasX: bounds.cx - topCenterLocalY * Math.sin(rotationAngleRad),
		canvasY: bounds.cy + topCenterLocalY * Math.cos(rotationAngleRad),
	});
	const bottomCenterScreen = toOverlay({
		canvasX: bounds.cx + topCenterLocalY * Math.sin(rotationAngleRad),
		canvasY: bounds.cy - topCenterLocalY * Math.cos(rotationAngleRad),
	});
	const rotationHandleScreen = placeRotationHandle({
		up: topCenterScreen,
		down: bottomCenterScreen,
		angleRad: rotationAngleRad,
		viewportHeight: viewport.viewportHeight,
	});

	const onPointerMove = (event: React.PointerEvent) =>
		handlePointerMove({ event });
	const onPointerUp = () => handlePointerUp();

	return (
		<div
			className="pointer-events-none absolute inset-0 overflow-hidden"
			aria-hidden
		>
			<BoundingBoxOutline
				center={center}
				outlineWidth={outlineWidth}
				outlineHeight={outlineHeight}
				rotation={bounds.rotation}
			/>
			{CORNERS.map((corner) => {
				const cornerPosition = getCornerPosition({ bounds, corner });
				const screen = toOverlay({
					canvasX: cornerPosition.x,
					canvasY: cornerPosition.y,
				});
				const angleDeg =
					Math.atan2(screen.y - center.y, screen.x - center.x) *
					(180 / Math.PI);
				return (
					<CornerHandle
						key={corner}
						name={corner}
						cursor={getResizeCursor({ angleDeg })}
						screen={screen}
						onPointerDown={(event) =>
							handleCornerPointerDown({ event, corner })
						}
						onPointerMove={onPointerMove}
						onPointerUp={onPointerUp}
					/>
				);
			})}
			{EDGES.map((edge) => {
				const edgePosition = getEdgeHandlePosition({ bounds, edge });
				const screen = toOverlay({
					canvasX: edgePosition.x,
					canvasY: edgePosition.y,
				});
				return (
					<EdgeHandle
						key={edge}
						edge={edge}
						screen={screen}
						rotation={bounds.rotation}
						onPointerDown={(event) => handleEdgePointerDown({ event, edge })}
						onPointerMove={onPointerMove}
						onPointerUp={onPointerUp}
					/>
				);
			})}
			<IconHandle
				icon={RotateClockwiseIcon}
				name="rotate"
				screen={rotationHandleScreen}
				onPointerDown={(event) => handleRotationPointerDown({ event })}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
			/>
		</div>
	);
}
