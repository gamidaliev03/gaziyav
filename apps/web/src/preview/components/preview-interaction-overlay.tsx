import { useCallback, useState } from "react";
import { hapticGuides } from "@/haptics";
import { usePreviewViewport } from "@/preview/components/preview-viewport";
import { usePreviewInteraction } from "@/preview/hooks/use-preview-interaction";
import type { SnapLine } from "@/preview/preview-snap";
import { TransformHandles } from "./transform-handles";
import { MaskHandles } from "./mask-handles";
import { SnapGuides } from "./snap-guides";
import { TextEditOverlay } from "./text-edit-overlay";
import { useEditor } from "@/editor/use-editor";
import { useInspectorGroupOpen } from "@/components/editor/panels/properties/components/inspector-ui";

export function PreviewInteractionOverlay() {
	const [snapLines, setSnapLinesState] = useState<SnapLine[]>([]);
	// A tap of the trackpad as a guide appears (haptics).
	const setSnapLines = useCallback((lines: SnapLine[]) => {
		hapticGuides(lines);
		setSnapLinesState(lines);
	}, []);
	const editor = useEditor();
	const viewport = usePreviewViewport();
	const selectedElements = useEditor((e) => e.selection.getSelectedElements());

	const selectedRef =
		selectedElements.length === 1 ? selectedElements[0] : null;
	const activeTrack = selectedRef
		? editor.timeline.getTrackById({ trackId: selectedRef.trackId })
		: null;
	const activeElement =
		activeTrack?.elements.find(
			(element) => element.id === selectedRef?.elementId,
		) ?? null;
	// With the Mask section open and a mask on the clip, the player edits the mask (a shape's and an AI layer's too).
	// (the clip's masks are watched: the first one added must switch the player over without another click)
	const hasMasks = useEditor(
		(e) => {
			const [ref] = e.selection.getSelectedElements();
			const element = ref ? e.timeline.getTrackById({ trackId: ref.trackId })?.elements.find((x) => x.id === ref.elementId) : undefined;
			return !!element && "masks" in element && (element.masks?.length ?? 0) > 0;
		},
		["timeline", "selection"],
	);
	// The inspector is one list (properties/layout.ts): the player edits the mask while the Mask section is open in it
	// (among the tools, unfolded) — what the Cutout tab being open meant before.
	const toolsOpen = useInspectorGroupOpen("insp.tools");
	const masksOpen = useInspectorGroupOpen("masks");
	const isMaskMode = !!activeElement && toolsOpen && masksOpen && hasMasks;

	const {
		onPointerDown,
		onPointerMove,
		onPointerUp,
		onDoubleClick,
		editingText,
		commitTextEdit,
	} = usePreviewInteraction({
		onSnapLinesChange: setSnapLines,
		isMaskMode,
	});

	const handlePointerDown = (event: React.PointerEvent) => {
		if (viewport.handlePanPointerDown({ event })) {
			return;
		}

		onPointerDown(event);
	};

	const handlePointerMove = (event: React.PointerEvent) => {
		if (viewport.handlePanPointerMove({ event })) {
			return;
		}

		onPointerMove(event);
	};

	const handlePointerUp = (event: React.PointerEvent) => {
		if (viewport.handlePanPointerUp({ event })) {
			return;
		}

		onPointerUp(event);
	};

	// A double-click on a corner or edge handle is one on the box's middle (between two opposite corners, so a turned
	// box too): on a short text those handles cover or flank the words, and a point beside them found no text.
	const handleHandlesDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
		if ((event.target as HTMLElement).closest('[data-transform-handle="rotate"]')) return;
		const corner = (name: string) => event.currentTarget.querySelector(`[data-transform-handle="${name}"]`)?.getBoundingClientRect();
		const a = corner("top-left");
		const b = corner("bottom-right");
		if (!a || !b) {
			onDoubleClick(event);
			return;
		}
		onDoubleClick({ ...event, clientX: (a.x + a.width / 2 + b.x + b.width / 2) / 2, clientY: (a.y + a.height / 2 + b.y + b.height / 2) / 2 });
	};

	return (
		<div className="absolute inset-0" data-mask-mode={isMaskMode ? "on" : undefined}>
			<div
				className="absolute inset-0 pointer-events-auto"
				role="application"
				aria-label="Preview canvas"
				style={{
					cursor: viewport.isPanning
						? "grabbing"
						: viewport.canPan
							? "default"
							: undefined,
				}}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={handlePointerUp}
				onDoubleClick={onDoubleClick}
				onDragStart={(e) => e.preventDefault()}
			/>
			{editingText ? (
				<TextEditOverlay
					trackId={editingText.trackId}
					elementId={editingText.elementId}
					element={editingText.element}
					onCommit={commitTextEdit}
				/>
			) : isMaskMode ? (
				<MaskHandles onSnapLinesChange={setSnapLines} />
			) : (
				// A double-click on a handle starts typing like one on the words (timeline-motion M20 under load: the
				// bottom handle of a short text covered them and took the double-click).
				// biome-ignore lint/a11y/noStaticElementInteractions: no box of its own, it only passes the handles' double-click on
				<div className="contents" onDoubleClick={handleHandlesDoubleClick}>
					<TransformHandles onSnapLinesChange={setSnapLines} />
				</div>
			)}
			<SnapGuides lines={snapLines} />
		</div>
	);
}
