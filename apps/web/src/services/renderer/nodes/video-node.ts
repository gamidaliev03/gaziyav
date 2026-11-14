import type { Tracker } from "@/motion/types";
import {
	VisualNode,
	type ResolvedVisualSourceNodeState,
	type VisualNodeParams,
} from "./visual-node";

export interface VideoNodeParams extends VisualNodeParams {
	url: string;
	file: File;
	mediaId: string;
	/** Timeline element id (keys the tracker-action surfaces). */
	elementId?: string;
	/** Trackers with actions (blur, pixelate, spotlight, colour pop) drawn into the picture. */
	trackers?: Tracker[];
	/** Rendered smooth-motion files of this media (src/motion), used while `retime.smooth` is on. */
	proxies?: Array<{ mediaId: string; file: File; a: number; b: number; m: number; fps: number }>;
}

export class VideoNode extends VisualNode<
	VideoNodeParams,
	ResolvedVisualSourceNodeState
> {}
