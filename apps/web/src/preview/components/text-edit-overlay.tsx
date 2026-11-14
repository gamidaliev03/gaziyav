"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePreviewViewport } from "@/preview/components/preview-viewport";
import { useEditor } from "@/editor/use-editor";
import type { TextElement } from "@/timeline";
import { DEFAULTS } from "@/timeline/defaults";
import { cn } from "@/utils/ui";
import {
	getElementLocalTime,
} from "@/animation";
import { resolveTransformAtTime } from "@/rendering/animation-values";
import { buildTransformFromParams } from "@/rendering";
import {
	buildTextBackgroundFromElement,
	buildTextLayoutParamsFromElement,
	getTextMeasurementContext,
	measureTextElement,
} from "@/text/measure-element";

export function TextEditOverlay({
	trackId,
	elementId,
	element,
	onCommit,
}: {
	trackId: string;
	elementId: string;
	element: TextElement;
	onCommit: () => void;
}) {
	const editor = useEditor();
	const viewport = usePreviewViewport();
	const divRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const div = divRef.current;
		if (!div) return;
		// No scroll: focusing a box that reaches past the visible frame scrolled the player and every clip on it moved.
		div.focus({ preventScroll: true });
		const range = document.createRange();
		range.selectNodeContents(div);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}, []);

	const handleInput = useCallback(() => {
		const div = divRef.current;
		if (!div) return;
		// textContent: innerText would return the text as shown, i.e. UPPERCASE under a Case style, and
		// that would become the stored text. (Plain-text editing keeps line breaks as "\n" in it.)
		const text = div.textContent ?? "";
		// `params` replaces the whole object: keep the style, change only the text. The style as it is now, not as it
		// was when editing began: a change made meanwhile (a style applied to all captions) was put back.
		const current = editor.timeline.getTrackById({ trackId })?.elements.find((e) => e.id === elementId);
		const params = current?.type === "text" ? current.params : element.params;
		editor.timeline.previewElements({
			updates: [{ trackId, elementId, updates: { params: { ...params, content: text } } }],
		});
	}, [editor.timeline, trackId, elementId, element.params]);

	// The text in the box goes in first: an edit committed elsewhere while typing (a job that landed) clears the
	// preview, and the commit had nothing left — the typed text was gone.
	// Once: Esc finishes, then the box unmounts and its blur must not open a new preview.
	const finishedRef = useRef(false);
	const finish = useCallback(() => {
		if (finishedRef.current) return;
		finishedRef.current = true;
		handleInput();
		onCommit();
	}, [handleInput, onCommit]);

	const handleKeyDown = useCallback(
		({ event }: { event: React.KeyboardEvent }) => {
			const { key } = event;
			if (key === "Escape") {
				event.preventDefault();
				finish();
				return;
			}
		},
		[finish],
	);

	const canvasSize = editor.project.getActive().settings.canvasSize;

	if (!canvasSize) return null;

	const currentTime = editor.playback.getCurrentTime();
	const localTime = getElementLocalTime({
		timelineTime: currentTime,
		elementStartTime: element.startTime,
		elementDuration: element.duration,
	});
	const transform = resolveTransformAtTime({
		baseTransform: buildTransformFromParams({ params: element.params }),
		animations: element.animations,
		localTime,
	});

	const { x: posX, y: posY } = viewport.positionToOverlay({
		positionX: transform.position.x,
		positionY: transform.position.y,
	});

	const { x: displayScaleX } = viewport.getDisplayScale();
	// Laid out like the renderer draws it (weight, Case, box width, fitted size, tracking), so the caret and the
	// selection sit on the visible letters. It used to be normal weight, as typed, on one unwrapped line: on a
	// "BOLD / POP" title the selection was one wide bar between the two lines.
	const textParams = buildTextLayoutParamsFromElement({
		element,
		canvasWidth: canvasSize.width,
		canvasHeight: canvasSize.height,
	});
	const resolvedTextLayout = measureTextElement({
		element,
		canvasWidth: canvasSize.width,
		canvasHeight: canvasSize.height,
		localTime,
		ctx: getTextMeasurementContext(),
	});
	const boxWidth = textParams.boxWidth ?? 0;
	const lineHeightPx = resolvedTextLayout.lineHeightPx;

	const bg = buildTextBackgroundFromElement({ element });
	const shouldShowBackground =
		bg.enabled && bg.color && bg.color !== "transparent";
	const fontSizeRatio = resolvedTextLayout.fontSizeRatio;
	const canvasPaddingX = shouldShowBackground
		? (bg.paddingX ?? DEFAULTS.text.background.paddingX) * fontSizeRatio
		: 0;
	const canvasPaddingY = shouldShowBackground
		? (bg.paddingY ?? DEFAULTS.text.background.paddingY) * fontSizeRatio
		: 0;

	return (
		<div
			className="absolute"
			style={{
				left: posX,
				top: posY,
				transform: `translate(-50%, -50%) scale(${transform.scaleX * displayScaleX}, ${transform.scaleY * displayScaleX}) rotate(${transform.rotate}deg)`,
				transformOrigin: "center center",
			}}
		>
			<div
				ref={divRef}
				contentEditable="plaintext-only"
				suppressContentEditableWarning
				tabIndex={0}
				role="textbox"
				aria-label="Edit text"
				className={cn(
					"cursor-text select-text outline-none",
					boxWidth > 0 ? "whitespace-pre-wrap break-words" : "whitespace-pre",
				)}
				style={{
					font: resolvedTextLayout.fontString,
					textAlign: textParams.textAlign,
					textTransform: textParams.textTransform ?? "none",
					letterSpacing: `${resolvedTextLayout.letterSpacing}px`,
					lineHeight: `${lineHeightPx}px`,
					// border-box: the box width is for the text, the background padding comes on top
					width: boxWidth > 0 ? boxWidth + 2 * canvasPaddingX : undefined,
					color: "transparent",
					caretColor:
						typeof element.params.color === "string"
							? element.params.color
							: "#ffffff",
					backgroundColor: shouldShowBackground ? bg.color : "transparent",
					minHeight: lineHeightPx,
					textDecoration: textParams.textDecoration ?? "none",
					padding: shouldShowBackground
						? `${canvasPaddingY}px ${canvasPaddingX}px`
						: 0,
					minWidth: 1,
				}}
				onInput={handleInput}
				onBlur={finish}
				onKeyDown={(event) => handleKeyDown({ event })}
			>
				{textParams.content}
			</div>
		</div>
	);
}
