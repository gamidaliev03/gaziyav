// Touch on the timeline (mobile, 14.11). THE SEAM: a touch gesture re-enters the timeline as the very DOM events the
// desktop already handles — a drag becomes mousedown on the pressed part + mousemove / mouseup on the document (the
// controllers' own listeners: element-interaction-controller, resize-controller, trim/pointer.ts, playhead-controller,
// seek-controller); a tap becomes mousedown + mouseup + click; a long-press becomes contextmenu (the one context menu);
// a two-finger pan becomes a wheel (the timeline's one wheel listener: scroll + the ruler / labels follow); a pinch
// becomes a ⌘-wheel (the same listener's zoom around the point under the fingers). So every gesture ends in the SAME
// command as the mouse — one undo step each — and no controller is edited. Two-finger tap = undo, three = redo
// (invokeAction, the same as ⌘Z / ⇧⌘Z).
//
// A mouse never enters: the listener returns on pointerType "mouse" before touching anything, so with a mouse (or on
// the desktop, where this is never attached) everything behaves exactly as before.
//
// Pointer-native parts (fade handles, the volume line, the crop box) already speak pointer events and work
// with a finger as they are: a press on them is let through untouched (POINTER_NATIVE).
import { invokeAction } from "@/actions";
import { type Gesture, GestureRecognizer, inertiaSteps, pinchToWheelDelta, type RecognizerConfig } from "./recognizer";

export const POINTER_NATIVE = "[data-fade-handle], .touch-none, [data-pointer-native]";
const ELEMENT = "[data-timeline-element-id]";
/** Parts whose drag is always theirs (never a scroll): the trim edges and the keyframe diamonds (mouse-driven). */
const GRAB = "[data-trim-handle], [data-keyframe-refs]";

export interface TimelineBridgeOptions {
	/** Is this clip selected (the editor's selection, not the DOM's): a one-finger drag moves only a selected clip. */
	isSelected: (elementId: string) => boolean;
	/** The haptic tick where the platform has one (navigator.vibrate on Android; iOS Safari has none — a no-op). */
	tick?: () => void;
	config?: Partial<RecognizerConfig>;
}

/** What a one-finger drag that starts here does. Pure (tested): the press target's role and the selection decide. */
export type DragRole = "trim" | "move" | "pan" | "native";
export function dragRoleFor(target: { native: boolean; trimHandle: boolean; elementId: string | null }, selected: boolean, afterLongPress: boolean): DragRole {
	if (target.native) return "native";
	// a clip is edited by a finger only when it is selected, or picked up by holding it (long-press, then drag): a
	// plain swipe over clips — their edges included — scrolls the timeline, so scrolling never edits by accident
	const mine = selected || afterLongPress;
	if (target.trimHandle && mine) return "trim";
	if (target.elementId && mine) return "move";
	return "pan";
}

type Pressed = { el: Element; native: boolean; trimHandle: boolean; elementId: string | null };

function mouse(type: string, x: number, y: number, button = 0): MouseEvent {
	return new MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		composed: true,
		clientX: x,
		clientY: y,
		screenX: x,
		screenY: y,
		button,
		buttons: type === "mouseup" || type === "click" ? 0 : button === 2 ? 2 : 1,
		view: window,
	});
}

function wheel(root: Element, x: number, y: number, deltaX: number, deltaY: number, zoom: boolean): void {
	// To the element under the fingers, never to the root itself: the timeline's one wheel listener is on the timeline
	// INSIDE the root (the phone's wrapper), and an event dispatched on an ancestor never reaches it — the first touch
	// walk (14.11) scrolled nothing and zoomed nothing.
	const under = typeof document === "undefined" ? null : document.elementFromPoint(x, y);
	const target = under && root.contains(under) ? under : (root.querySelector("[data-timeline-tracks-scroll]") ?? root);
	target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaX, deltaY, deltaMode: 0, ctrlKey: zoom }));
}

/** Attaches touch to the timeline's root (the element holding the one wheel listener). Returns the detach. */
export function attachTimelineTouch(root: HTMLElement, opts: TimelineBridgeOptions): () => void {
	const rec = new GestureRecognizer(opts.config);
	let pressed: Pressed | null = null;
	let role: DragRole | null = null;
	let last = { x: 0, y: 0 };
	let timer: ReturnType<typeof setInterval> | null = null;
	let glide: number | null = null;
	let native = false;

	const stopGlide = () => {
		if (glide !== null) cancelAnimationFrame(glide);
		glide = null;
	};
	const play = (steps: Array<{ dx: number; dy: number }>, x: number, y: number) => {
		stopGlide();
		let i = 0;
		const frame = () => {
			const s = steps[i++];
			if (!s) return void (glide = null);
			wheel(root, x, y, -s.dx, -s.dy, false);
			glide = requestAnimationFrame(frame);
		};
		glide = requestAnimationFrame(frame);
	};

	const apply = (gestures: Gesture[]) => {
		for (const g of gestures) {
			switch (g.kind) {
				case "tap": {
					if (!pressed) break;
					pressed.el.dispatchEvent(mouse("mousedown", g.x, g.y));
					document.dispatchEvent(mouse("mouseup", g.x, g.y));
					pressed.el.dispatchEvent(mouse("click", g.x, g.y));
					break;
				}
				case "long-press": {
					if (!pressed?.elementId) break;
					opts.tick?.();
					// the right button's press selects the clip (element controller), contextmenu opens the one menu
					pressed.el.dispatchEvent(mouse("mousedown", g.x, g.y, 2));
					pressed.el.dispatchEvent(mouse("contextmenu", g.x, g.y, 2));
					break;
				}
				case "drag-start": {
					if (!pressed) break;
					role = dragRoleFor(pressed, pressed.elementId ? opts.isSelected(pressed.elementId) : false, g.afterLongPress);
					if (g.afterLongPress) {
						// the held press opened the menu: close it (Esc, the app's one cancel) before the pick-up drag
						document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
					}
					if (role === "move" || role === "trim") {
						pressed.el.dispatchEvent(mouse("mousedown", g.x0, g.y0));
						document.dispatchEvent(mouse("mousemove", g.x, g.y));
					} else if (role === "pan") {
						wheel(root, g.x, g.y, -(g.x - g.x0), -(g.y - g.y0), false);
					}
					last = { x: g.x, y: g.y };
					break;
				}
				case "drag-move": {
					if (role === "move" || role === "trim") document.dispatchEvent(mouse("mousemove", g.x, g.y));
					else if (role === "pan") wheel(root, g.x, g.y, -(g.x - last.x), -(g.y - last.y), false);
					last = { x: g.x, y: g.y };
					break;
				}
				case "drag-end": {
					if (role === "move" || role === "trim") document.dispatchEvent(mouse("mouseup", g.x, g.y));
					else if (role === "pan") play(inertiaSteps({ vx: g.vx, vy: g.vy }), g.x, g.y);
					role = null;
					break;
				}
				case "drag-cancel": {
					// the app's one cancel: the controllers registered their cancellers (editor/cancel-interaction)
					if (role === "move" || role === "trim") invokeAction("cancel-interaction");
					role = null;
					break;
				}
				case "two-start":
					stopGlide();
					last = { x: g.cx, y: g.cy };
					break;
				case "two": {
					const zoom = pinchToWheelDelta(g.scale);
					if (Math.abs(zoom) > 0.01) wheel(root, g.cx, g.cy, 0, zoom, true);
					if (g.dx || g.dy) wheel(root, g.cx, g.cy, -g.dx, -g.dy, false);
					break;
				}
				case "two-end":
					if (g.vx || g.vy) play(inertiaSteps({ vx: g.vx, vy: g.vy }), last.x, last.y);
					break;
				case "multi-tap":
					invokeAction(g.fingers === 2 ? "undo" : "redo");
					opts.tick?.();
					break;
			}
		}
	};

	// one clock for the samples and the long-press timer (event.timeStamp's origin is not the same in every engine)
	const sample = (e: PointerEvent) => ({ id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() });

	const onDown = (e: PointerEvent) => {
		if (e.pointerType === "mouse") return;
		const target = e.target instanceof Element ? e.target : null;
		if (!target) return;
		if (rec.phase() === "idle") {
			native = !!target.closest(POINTER_NATIVE);
			if (native) return; // the part handles the finger itself
			stopGlide();
			pressed = {
				el: target,
				native: false,
				trimHandle: !!target.closest(GRAB),
				elementId: target.closest<HTMLElement>(ELEMENT)?.dataset.timelineElementId ?? null,
			};
		} else if (native) return;
		// ours from here: no compatibility mouse events, no React pointer handlers below, no page scroll / zoom
		e.preventDefault();
		e.stopPropagation();
		try {
			root.setPointerCapture(e.pointerId);
		} catch {}
		apply(rec.down(sample(e)));
		if (!timer) timer = setInterval(() => apply(rec.tick(performance.now())), 50);
	};
	const onMove = (e: PointerEvent) => {
		if (e.pointerType === "mouse" || native) return;
		e.preventDefault();
		apply(rec.move(sample(e)));
	};
	const end = (e: PointerEvent, cancelled: boolean) => {
		if (e.pointerType === "mouse") return;
		if (native) {
			if (e.isPrimary) native = false;
			return;
		}
		apply(cancelled ? rec.cancel(sample(e)) : rec.up(sample(e)));
		if (rec.phase() === "idle") {
			pressed = null;
			if (timer) clearInterval(timer);
			timer = null;
		}
	};
	const onUp = (e: PointerEvent) => end(e, false);
	const onCancel = (e: PointerEvent) => end(e, true);
	// iOS Safari's own pinch-zoom of the page and its double-tap zoom are off for the timeline (touch-action), and a
	// long-press must not open the system's text-selection loupe or the image callout
	const blockNative = (e: Event) => e.preventDefault();

	const prevTouchAction = root.style.touchAction;
	root.style.touchAction = "none";
	root.style.setProperty("-webkit-user-select", "none");
	root.style.setProperty("-webkit-touch-callout", "none");
	root.addEventListener("pointerdown", onDown, { capture: true, passive: false });
	root.addEventListener("pointermove", onMove, { capture: true, passive: false });
	root.addEventListener("pointerup", onUp, { capture: true });
	root.addEventListener("pointercancel", onCancel, { capture: true });
	root.addEventListener("gesturestart", blockNative); // WebKit's own pinch events
	return () => {
		stopGlide();
		if (timer) clearInterval(timer);
		root.style.touchAction = prevTouchAction;
		root.removeEventListener("pointerdown", onDown, { capture: true });
		root.removeEventListener("pointermove", onMove, { capture: true });
		root.removeEventListener("pointerup", onUp, { capture: true });
		root.removeEventListener("pointercancel", onCancel, { capture: true });
		root.removeEventListener("gesturestart", blockNative);
	};
}
