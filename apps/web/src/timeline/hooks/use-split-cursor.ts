"use client";

import { type RefObject, useEffect } from "react";

/**
 * The Split tool's blade cursor over the tracks, set on the one element under the pointer.
 *
 * It was a class on the tracks container that gave every element under it `cursor: crosshair !important`
 * (`[&_*]:cursor-crosshair!`): pressing B or A restyled the whole tree under the tracks — 5 815 elements, 25–65 ms on
 * a 30-minute project zoomed out (speed, 11.11, DevTools trace). The pointer only ever shows the cursor of the element
 * it is over, so that element alone gets the crosshair (inline, `!important`, as the class did), and gives it back when
 * the pointer leaves it or the tool changes: one element restyled when the pointer comes onto a new one, none on B or A.
 * Its own inline cursor, if it had one, is put back as it was.
 */
export function useSplitCursor(containerRef: RefObject<HTMLElement | null>, active: boolean): void {
	useEffect(() => {
		const container = containerRef.current;
		if (!active || !container) return;
		let current: HTMLElement | null = null;
		let saved: { value: string; priority: string } | null = null;
		const release = () => {
			if (!current) return;
			if (saved?.value) current.style.setProperty("cursor", saved.value, saved.priority);
			else current.style.removeProperty("cursor");
			current = null;
			saved = null;
		};
		const take = (target: EventTarget | null) => {
			const element = target instanceof HTMLElement || target instanceof SVGElement ? (target as HTMLElement) : null;
			if (element === current) return;
			release();
			// the container itself kept its own cursor under the class too (it applied to what is under it)
			if (!element || element === container || !container.contains(element)) return;
			saved = { value: element.style.getPropertyValue("cursor"), priority: element.style.getPropertyPriority("cursor") };
			element.style.setProperty("cursor", "crosshair", "important");
			current = element;
		};
		let lastX = -1;
		let lastY = -1;
		let frame = 0;
		const move = (event: MouseEvent) => {
			lastX = event.clientX;
			lastY = event.clientY;
			take(event.target);
		};
		// a press of the blade replaces the clip under a pointer that does not move: the new piece shows the blade too
		const up = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				if (lastX >= 0) take(document.elementFromPoint(lastX, lastY));
			});
		};
		container.addEventListener("mousemove", move, { passive: true });
		container.addEventListener("mouseup", up, { passive: true });
		container.addEventListener("mouseleave", release, { passive: true });
		// B pressed with the pointer already over the tracks: the element under it shows the blade at once
		const hovered = container.querySelectorAll(":hover");
		if (hovered.length > 0) take(hovered[hovered.length - 1]);
		return () => {
			cancelAnimationFrame(frame);
			container.removeEventListener("mousemove", move);
			container.removeEventListener("mouseup", up);
			container.removeEventListener("mouseleave", release);
			release();
		};
	}, [containerRef, active]);
}
