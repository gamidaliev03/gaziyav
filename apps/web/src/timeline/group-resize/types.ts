import type { FrameRate } from "opencut-wasm";
import type { ElementRef, RetimeConfig } from "@/timeline/types";
import type { MediaTime } from "@/wasm";

export type ResizeSide = "left" | "right";

export interface GroupResizeMember extends ElementRef {
	startTime: MediaTime;
	duration: MediaTime;
	trimStart: MediaTime;
	trimEnd: MediaTime;
	sourceDuration?: MediaTime;
	retime?: RetimeConfig;
	/** Beat marks (⌘J), clip-time offsets: a trim keeps them on their frames of the picture. */
	beats?: number[];
	leftNeighborBound: MediaTime | null;
	rightNeighborBound: MediaTime | null;
	/**
	 * The magnet's head: pulling the left edge out recovers the clip's trimmed head with no floor at the neighbour or at 0
	 * (only the source limits it). The controller keeps the clip's start where it is and pushes the clips after it, as
	 * the tail does.
	 */
	leftUnbounded?: boolean;
}

export interface GroupResizeUpdate extends ElementRef {
	patch: {
		trimStart: MediaTime;
		trimEnd: MediaTime;
		startTime: MediaTime;
		duration: MediaTime;
		beats?: number[];
	};
}

export interface GroupResizeResult {
	deltaTime: MediaTime;
	updates: GroupResizeUpdate[];
	/** The drag asked for more than the clip allows (its source's end, a neighbour, its shortest length). */
	limited?: boolean;
}

export interface ComputeGroupResizeArgs {
	members: GroupResizeMember[];
	side: ResizeSide;
	deltaTime: MediaTime;
	fps: FrameRate;
	/** The edge snapped to a snap point: keep the delta as is instead of putting the edge on a frame. */
	exact?: boolean;
}
