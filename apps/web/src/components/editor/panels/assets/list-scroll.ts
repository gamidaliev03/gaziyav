// The live preview of a tile under the pointer (a Remotion composition) waits its turn in the shared tile-preview queue
// (utils/scroll-idle-queue): none is built while a list scrolls, one per frame after it stops.
import { useEffect, useState } from "react";
import { whenScrollIdle } from "@/utils/scroll-idle-queue";

/**
 * `active` (a tile hovered) once the lists are still and its turn has come: a pointer resting on a tile while the list
 * scrolls under it builds nothing until the scroll stops.
 */
export function useWhenStill(active: boolean): boolean {
	const [on, setOn] = useState(false);
	useEffect(() => {
		setOn(false);
		if (!active) return;
		let alive = true;
		whenScrollIdle(() => {
			if (alive) setOn(true);
		});
		return () => {
			alive = false;
		};
	}, [active]);
	return active && on;
}
