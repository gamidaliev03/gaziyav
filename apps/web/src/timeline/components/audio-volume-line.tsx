"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor } from "@/editor/use-editor";
import {
	getDbFromLinePos,
	getLinePosFromDb,
} from "@/timeline/audio-display";
import { VOLUME_DB_MAX, VOLUME_DB_MIN } from "@/timeline/audio-constants";
import {
	type AudioCapableElement,
	getElementVolume,
	hasAnimatedVolume,
} from "@/timeline/audio-state";
import {
	clamp,
	formatNumberForDisplay,
	getFractionDigitsForStep,
	isNearlyEqual,
	snapToStep,
} from "@/utils/math";
import { cn } from "@/utils/ui";

const HIT_AREA_HEIGHT_PX = 14;
const TOOLTIP_OFFSET_PX = 10;
const VOLUME_STEP = 0.1;
const VOLUME_FRACTION_DIGITS = getFractionDigitsForStep({ step: VOLUME_STEP });

function clampVolume({ value }: { value: number }): number {
	return clamp({
		value: snapToStep({ value, step: VOLUME_STEP }),
		min: VOLUME_DB_MIN,
		max: VOLUME_DB_MAX,
	});
}

function getVolumeFromPointer({
	clientY,
	rect,
}: {
	clientY: number;
	rect: DOMRect;
}): number {
	const clampedOffset = clamp({
		value: clientY - rect.top,
		min: 0,
		max: rect.height,
	});
	const progressPercent =
		rect.height <= 0 ? 0 : (clampedOffset / rect.height) * 100;
	return clampVolume({ value: getDbFromLinePos({ percent: progressPercent }) });
}

export function AudioVolumeLine({
	element,
	trackId,
	hitAreaPx = HIT_AREA_HEIGHT_PX,
	samples,
	baseGain,
}: {
	/** Audio clips, and video clips along their sound strip. */
	element: AudioCapableElement;
	trackId: string;
	hitAreaPx?: number;
	/** The gain over the clip (volume × fades × ducking) and the clip's own volume as a gain: the line bends with the
	 * fades and dips (one line for the volume and its changes, CapCut — not a second, unmovable one). */
	samples?: readonly number[];
	baseGain?: number;
}) {
	const editor = useEditor();
	const surfaceRef = useRef<HTMLDivElement>(null);
	const activePointerIdRef = useRef<number | null>(null);
	const startVolumeRef = useRef(getElementVolume({ element }));
	const lastPreviewVolumeRef = useRef(getElementVolume({ element }));
	const hasChangedRef = useRef(false);
	const [isDragging, setIsDragging] = useState(false);
	const [tooltipClientPos, setTooltipClientPos] = useState<{
		x: number;
		y: number;
	} | null>(null);

	const hasAnimatedEnvelope = hasAnimatedVolume({ element });
	const currentVolume = getElementVolume({ element });
	const lineTopPct = getLinePosFromDb({ db: currentVolume });
	const lineTop = `${lineTopPct}%`;
	// Where the volume changes over the clip (a fade in / out, a dip under a voice): the line follows it down to nothing.
	const rel = samples && baseGain && baseGain > 0 ? samples.map((g) => Math.max(0, Math.min(1, g / baseGain))) : null;
	const bends = !!rel && rel.length > 1 && rel.some((g) => g < 0.995);
	const curve = bends && rel
		? rel
				.map((g, i) => {
					const x = rel.length === 1 ? 0 : (i / (rel.length - 1)) * 100;
					return `${x.toFixed(3)},${(lineTopPct + (100 - lineTopPct) * (1 - g)).toFixed(2)}`;
				})
				.join(" ")
		: "";

	const volumeLabel = `${formatNumberForDisplay({
		value: currentVolume,
		fractionDigits: VOLUME_FRACTION_DIGITS,
	})} dB`;

	const previewVolume = useCallback(
		(nextVolume: number) => {
			if (
				isNearlyEqual({
					leftValue: nextVolume,
					rightValue: lastPreviewVolumeRef.current,
				})
			) {
				return;
			}

			editor.timeline.previewElements({
				updates: [
					{
						trackId,
						elementId: element.id,
						updates: { params: { volume: nextVolume } },
					},
				],
			});
			lastPreviewVolumeRef.current = nextVolume;
			hasChangedRef.current = !isNearlyEqual({
				leftValue: startVolumeRef.current,
				rightValue: nextVolume,
			});
		},
		[editor, element.id, trackId],
	);

	const finishDrag = useCallback(
		({ shouldCommit }: { shouldCommit: boolean }) => {
			activePointerIdRef.current = null;
			setIsDragging(false);

			if (shouldCommit && hasChangedRef.current) {
				editor.timeline.commitPreview();
			} else {
				editor.timeline.discardPreview();
			}

			hasChangedRef.current = false;
			lastPreviewVolumeRef.current = startVolumeRef.current;
			setTooltipClientPos(null);
		},
		[editor],
	);

	// The line follows the pointer from where it was grabbed (a grab no longer jumps it to the pointer), and ⇧ moves it a
	// fifth as fast: on a short audio row 8 px were +9 dB (targeted test 05.11).
	const grabRef = useRef<{ y: number; pct: number } | null>(null);
	const fineRef = useRef(false);
	const updateFromPointer = useCallback(
		({ clientX, clientY, fine = false }: { clientX: number; clientY: number; fine?: boolean }) => {
			const rect = surfaceRef.current?.getBoundingClientRect();
			if (!rect) {
				return;
			}

			setTooltipClientPos({
				x: clientX + TOOLTIP_OFFSET_PX,
				y: clientY - TOOLTIP_OFFSET_PX,
			});
			const grab = grabRef.current;
			if (!grab || rect.height <= 0) {
				previewVolume(getVolumeFromPointer({ clientY, rect }));
				return;
			}
			// Half the row's height per full travel: a 14 px drag was +15 dB on a 50 px row (check-edit), ⇧ a fifth of that.
			const pct = grab.pct + ((clientY - grab.y) / rect.height) * 100 * (fine ? 0.2 : 0.5);
			previewVolume(clampVolume({ value: getDbFromLinePos({ percent: pct }) }));
		},
		[previewVolume],
	);

	const handleClick = useCallback((event: React.MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
	}, []);

	const handleMouseDown = useCallback((event: React.MouseEvent) => {
		event.stopPropagation();
	}, []);

	const handlePointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			editor.selection.setSelectedElements({
				elements: [{ trackId, elementId: element.id }],
			});
			activePointerIdRef.current = event.pointerId;
			startVolumeRef.current = currentVolume;
			lastPreviewVolumeRef.current = currentVolume;
			hasChangedRef.current = false;
			setIsDragging(true);
			event.currentTarget.setPointerCapture(event.pointerId);
			grabRef.current = { y: event.clientY, pct: getLinePosFromDb({ db: currentVolume }) };
			setTooltipClientPos({ x: event.clientX + TOOLTIP_OFFSET_PX, y: event.clientY - TOOLTIP_OFFSET_PX });
		},
		[currentVolume, editor.selection, element.id, trackId, updateFromPointer],
	);

	const handlePointerMove = useCallback(
		(event: React.PointerEvent) => {
			if (activePointerIdRef.current !== event.pointerId) {
				return;
			}

			event.preventDefault();
			if (event.shiftKey !== fineRef.current) {
				// ⇧ pressed or let go mid-drag: go on from here at the new speed.
				fineRef.current = event.shiftKey;
				const rect = surfaceRef.current?.getBoundingClientRect();
				if (rect) grabRef.current = { y: event.clientY, pct: getLinePosFromDb({ db: lastPreviewVolumeRef.current }) };
			}
			updateFromPointer({
				clientX: event.clientX,
				clientY: event.clientY,
				fine: event.shiftKey,
			});
		},
		[updateFromPointer],
	);

	const handlePointerUp = useCallback(
		(event: React.PointerEvent) => {
			if (activePointerIdRef.current !== event.pointerId) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			finishDrag({ shouldCommit: true });
		},
		[finishDrag],
	);

	const handlePointerCancel = useCallback(
		(event: React.PointerEvent) => {
			if (activePointerIdRef.current !== event.pointerId) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			finishDrag({ shouldCommit: false });
		},
		[finishDrag],
	);

	const handleLostPointerCapture = useCallback(() => {
		if (activePointerIdRef.current === null) {
			return;
		}

		finishDrag({ shouldCommit: hasChangedRef.current });
	}, [finishDrag]);

	if (hasAnimatedEnvelope) {
		return null;
	}

	return (
		// One box (it was two nested identical ones): each positioned box is a paint layer per clip.
		<div ref={surfaceRef} className="pointer-events-none absolute inset-0">
				{bends ? (
					<svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden data-volume-curve="">
						{/* The part the fades and dips take away, under the level. */}
						<polygon points={`0,${lineTopPct} 100,${lineTopPct} ${curve.split(" ").reverse().join(" ")}`} fill="rgba(0,0,0,0.35)" />
						<polyline
							points={curve}
							fill="none"
							className={cn("transition-colors", isDragging ? "stroke-white" : "stroke-white/60 group-hover/audio:stroke-white/85")}
							strokeWidth="1.5"
							vectorEffect="non-scaling-stroke"
						/>
					</svg>
				) : (
					<div
						className={cn(
							// Centred with a margin, not a transform: a transform per clip is a paint chunk per clip (zoom cost).
							"pointer-events-none absolute inset-x-0 -mt-px border-t transition-colors",
							isDragging
								? "border-white"
								: "border-white/50 group-hover/audio:border-white/80",
						)}
						style={{ top: lineTop }}
					/>
				)}
				{/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- custom drag widget for clip volume; pointer events drive the interaction, the click/mousedown handlers are propagation-stoppers. The a11y-correct long-term shape is <input type="range"> with a custom thumb. */}
				<div
					className="absolute inset-x-0 touch-none cursor-ns-resize pointer-events-auto"
					data-volume-line
					style={{ top: lineTop, height: `${hitAreaPx}px`, marginTop: `${-hitAreaPx / 2}px` }}
					onClick={handleClick}
					onMouseDown={handleMouseDown}
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={handlePointerUp}
					onPointerCancel={handlePointerCancel}
					onLostPointerCapture={handleLostPointerCapture}
					title="Drag to adjust clip volume"
				/>
				{isDragging &&
					tooltipClientPos &&
					createPortal(
						<div
							className="pointer-events-none fixed left-0 top-0 z-50 -translate-y-full rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white whitespace-nowrap"
							style={{
								transform: `translate(${tooltipClientPos.x}px, ${tooltipClientPos.y}px)`,
							}}
						>
							{volumeLabel}
							<span className="ml-1.5 font-normal text-white/60">{"⇧ fine"}</span>
						</div>,
						document.body,
					)}
		</div>
	);
}
