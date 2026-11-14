"use client";
// A bottom sheet over the timeline (mobile, 14.11): half the timeline's height, its grabber drags it down to close
// (past a third of its height, or a downward fling), a tap on the grabber closes it too. The player stays visible
// above it, so a change made in the sheet is seen at once.
import { type ReactNode, useRef, useState } from "react";
import { useT } from "@/i18n";

export function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
	const t = useT();
	const [dy, setDy] = useState(0);
	const start = useRef<{ y: number; t: number } | null>(null);
	const box = useRef<HTMLDivElement>(null);

	return (
		<div
			ref={box}
			role="dialog"
			aria-label={t("Tools")}
			className="gz-sheet bg-background border-border absolute inset-x-0 bottom-0 z-30 flex max-h-full min-h-[50%] flex-col rounded-t-2xl border-t shadow-2xl"
			style={{ transform: dy > 0 ? `translateY(${dy}px)` : undefined }}
		>
			<button
				type="button"
				aria-label={t("Close")}
				className="flex h-7 shrink-0 touch-none items-center justify-center"
				onPointerDown={(e) => {
					start.current = { y: e.clientY, t: performance.now() };
					e.currentTarget.setPointerCapture(e.pointerId);
				}}
				onPointerMove={(e) => start.current && setDy(Math.max(0, e.clientY - start.current.y))}
				onPointerUp={(e) => {
					const s = start.current;
					start.current = null;
					const moved = s ? e.clientY - s.y : 0;
					const speed = s ? moved / Math.max(1, performance.now() - s.t) : 0;
					const h = box.current?.offsetHeight ?? 1;
					if (moved < 4 || moved > h / 3 || speed > 0.5) onClose();
					setDy(0);
				}}
			>
				<span className="bg-muted-foreground/40 h-1 w-10 rounded-full" />
			</button>
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
		</div>
	);
}
