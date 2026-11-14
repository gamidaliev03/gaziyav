// Touch on the player (mobile, 14.11). Same seam as the timeline: gestures become what the desktop already handles.
//   tap on the picture            = play / pause (invokeAction "toggle-play", the space bar's action)
//   one-finger drag on a selected clip's box = move it (the preview's own mouse handles: mousedown/move/up, one step)
//   one-finger horizontal swipe elsewhere   = scrub (frame steps: the ← → actions, one per `pxPerFrame`)
//   two-finger tap = undo, three-finger tap = redo
// Pinch on the picture to scale the selected clip is round 2 (the preview's transform handles take a corner drag:
// it will be bridged as a corner drag about the box's centre, so it stays the same command).
import { invokeAction } from "@/actions";
import { GestureRecognizer, type RecognizerConfig } from "./recognizer";

export interface PlayerTouchOptions {
	/** Does this press land on a selected clip's box or its handles (the preview overlay's own parts)? */
	isOnSelectedBox: (target: Element) => boolean;
	pxPerFrame?: number;
	config?: Partial<RecognizerConfig>;
}

export function attachPlayerTouch(root: HTMLElement, opts: PlayerTouchOptions): () => void {
	const rec = new GestureRecognizer(opts.config);
	const pxPerFrame = opts.pxPerFrame ?? 12;
	let pressed: Element | null = null;
	let mode: "box" | "scrub" | null = null;
	let carried = 0;
	let lastX = 0;

	const mouse = (type: string, x: number, y: number) =>
		new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "mouseup" ? 0 : 1, view: window });

	const sample = (e: PointerEvent) => ({ id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() });
	const handle = (list: ReturnType<GestureRecognizer["down"]>) => {
		for (const g of list) {
			if (g.kind === "tap") invokeAction("toggle-play");
			else if (g.kind === "multi-tap") invokeAction(g.fingers === 2 ? "undo" : "redo");
			else if (g.kind === "drag-start" && pressed) {
				mode = opts.isOnSelectedBox(pressed) ? "box" : Math.abs(g.x - g.x0) >= Math.abs(g.y - g.y0) ? "scrub" : null;
				if (mode === "box") {
					pressed.dispatchEvent(mouse("mousedown", g.x0, g.y0));
					document.dispatchEvent(mouse("mousemove", g.x, g.y));
				}
				carried = g.x - g.x0;
				lastX = g.x;
			} else if (g.kind === "drag-move") {
				if (mode === "box") document.dispatchEvent(mouse("mousemove", g.x, g.y));
				else if (mode === "scrub") {
					carried += g.x - lastX;
					while (Math.abs(carried) >= pxPerFrame) {
						invokeAction(carried > 0 ? "frame-step-forward" : "frame-step-backward");
						carried -= Math.sign(carried) * pxPerFrame;
					}
				}
				lastX = g.x;
			} else if (g.kind === "drag-end") {
				if (mode === "box") document.dispatchEvent(mouse("mouseup", g.x, g.y));
				mode = null;
			} else if (g.kind === "drag-cancel") {
				if (mode === "box") invokeAction("cancel-interaction");
				mode = null;
			}
		}
	};

	const onDown = (e: PointerEvent) => {
		if (e.pointerType === "mouse") return;
		if (rec.phase() === "idle") pressed = e.target instanceof Element ? e.target : null;
		e.preventDefault();
		e.stopPropagation();
		handle(rec.down(sample(e)));
	};
	const onMove = (e: PointerEvent) => {
		if (e.pointerType === "mouse") return;
		e.preventDefault();
		handle(rec.move(sample(e)));
	};
	const onUp = (e: PointerEvent) => {
		if (e.pointerType === "mouse") return;
		handle(rec.up(sample(e)));
	};
	const onCancel = (e: PointerEvent) => {
		if (e.pointerType === "mouse") return;
		handle(rec.cancel(sample(e)));
	};
	const prev = root.style.touchAction;
	root.style.touchAction = "none";
	root.addEventListener("pointerdown", onDown, { capture: true, passive: false });
	root.addEventListener("pointermove", onMove, { capture: true, passive: false });
	root.addEventListener("pointerup", onUp, { capture: true });
	root.addEventListener("pointercancel", onCancel, { capture: true });
	return () => {
		root.style.touchAction = prev;
		root.removeEventListener("pointerdown", onDown, { capture: true });
		root.removeEventListener("pointermove", onMove, { capture: true });
		root.removeEventListener("pointerup", onUp, { capture: true });
		root.removeEventListener("pointercancel", onCancel, { capture: true });
	};
}
