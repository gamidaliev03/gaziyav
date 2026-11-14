import type { TimelineDragData } from "@/timeline/drag";

const TIMELINE_DRAG_MIME = "application/x-timeline-drag";

/** The drag in the hand right now, for the one drag chip (components/editor/drag-ghost.ts): what it is called, its kind. */
let inHand: TimelineDragData | null = null;
export const timelineDragInHand = (): TimelineDragData | null => inHand;

/**
 * Owns the state of an in-progress timeline drag session.
 *
 * Exists because browsers restrict `DataTransfer.getData()` to the `drop`
 * event for security — during `dragover`/`dragenter` only `types` is
 * readable. The drop target needs the payload (element type, target
 * element types, source duration) while the pointer is hovering, so we
 * keep a live copy here and hand it out via {@link getActive}.
 */
export class TimelineDragSource {
	private active: TimelineDragData | null = null;

	begin({
		dataTransfer,
		dragData,
	}: {
		dataTransfer: DataTransfer;
		dragData: TimelineDragData;
	}): void {
		dataTransfer.setData(TIMELINE_DRAG_MIME, JSON.stringify(dragData));
		dataTransfer.effectAllowed = "copy";
		this.active = dragData;
		inHand = dragData;
	}

	end(): void {
		if (inHand === this.active) inHand = null;
		this.active = null;
	}

	getActive(): TimelineDragData | null {
		return this.active;
	}

	isActive(): boolean {
		return this.active !== null;
	}
}
