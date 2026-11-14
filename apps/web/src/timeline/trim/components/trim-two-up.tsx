"use client";

// The two frames of the cut over the player while a trim is in the hand: the last frame going out on the left, the
// first coming in on the right (a slip: the clip's own first and last), each with its clip's name and its place in the
// file. The pictures are drawn by two-up-player.ts; this is the frame around them.
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/i18n";
import { type TwoUpPane, useTrimUi } from "../store";
import { twoUpPlayer } from "../two-up-player";

export function TrimTwoUp() {
	const view = useTrimUi((s) => s.twoUp);
	const shown = view !== null;
	const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
	// Over the player's picture area, measured when the panes come up (the player does not move during a drag).
	useLayoutEffect(() => {
		if (!shown) {
			setBox(null);
			return;
		}
		const host = document.querySelector<HTMLElement>("[data-preview-frame]")?.parentElement;
		const rect = host?.getBoundingClientRect();
		setBox(rect && rect.width >= 120 && rect.height >= 60 ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null);
	}, [shown]);
	if (!view || !box || typeof document === "undefined") return null;
	return createPortal(
		<div data-trim-two-up="" aria-hidden className="pointer-events-none fixed z-[350] flex gap-px bg-neutral-800" style={box}>
			<Pane index={0} pane={view.left} />
			<Pane index={1} pane={view.right} />
		</div>,
		document.body,
	);
}

function Pane({ index, pane }: { index: 0 | 1; pane: TwoUpPane | null }) {
	const t = useT();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	useLayoutEffect(() => {
		const canvas = canvasRef.current;
		if (canvas) {
			// as sharp as the pane on this screen, no sharper: the frames are decoded to this size
			const rect = canvas.getBoundingClientRect();
			const ratio = Math.min(2, window.devicePixelRatio || 1);
			canvas.width = Math.max(2, Math.round(rect.width * ratio));
			canvas.height = Math.max(2, Math.round(rect.height * ratio));
		}
		twoUpPlayer.setCanvas(index, canvas);
		return () => twoUpPlayer.setCanvas(index, null);
	}, [index]);
	return (
		<div className="relative min-w-0 flex-1 bg-black" data-two-up-pane={index === 0 ? "left" : "right"} data-two-up-kind={pane?.kind ?? "empty"}>
			<canvas ref={canvasRef} className="absolute inset-0 size-full" />
			{pane && (
				<div className="absolute inset-x-0 bottom-0 flex h-6 items-center gap-2 bg-black/65 px-2 text-[11px] text-white">
					<span className="shrink-0 font-medium">{t(pane.label)}</span>
					<span className="min-w-0 truncate text-white/75">{pane.name}</span>
					<span className="ml-auto shrink-0 tabular-nums">{pane.timecode}</span>
				</div>
			)}
		</div>
	);
}
