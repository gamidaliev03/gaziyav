import type { FrameRate } from "opencut-wasm";
import type { TScene } from "@/timeline/types";
import type { MediaTime } from "@/wasm";

export type TBackground =
	| {
			type: "color";
			color: string;
	  }
	| {
			type: "blur";
			blurIntensity: number;
	  };

export interface TCanvasSize {
	width: number;
	height: number;
}

export interface TProjectMetadata {
	id: string;
	name: string;
	thumbnail?: string;
	/** When the card's picture was made: a project changed well after it shows an old picture (repairThumbnails). */
	thumbnailAt?: Date;
	duration: MediaTime;
	createdAt: Date;
	updatedAt: Date;
	/** Set while the project sits in Trash (CapCut keeps it there 30 days, then deletes it). */
	trashedAt?: Date;
	/** The user gave it a name: kept even while it is still empty (an empty untouched project is not kept). */
	renamed?: boolean;
}

export interface TProjectSettings {
	fps: FrameRate;
	canvasSize: TCanvasSize;
	canvasSizeMode?: "preset" | "custom";
	lastCustomCanvasSize?: TCanvasSize | null;
	originalCanvasSize?: TCanvasSize | null;
	/**
	 * The shape came from the first clip (CapCut's «Original»), not from a choice on the start page: when the timeline
	 * is emptied, the next first clip gives its own (commands/timeline/element/insert-element.ts).
	 */
	canvasFromClip?: boolean;
	background: TBackground;
}

export interface TTimelineViewState {
	zoomLevel: number;
	scrollLeft: number;
	playheadTime: MediaTime;
}

export interface TProject {
	metadata: TProjectMetadata;
	scenes: TScene[];
	currentSceneId: string;
	settings: TProjectSettings;
	version: number;
	timelineViewState?: TTimelineViewState;
	/** 1: one timeline, extra ones are compound clips in Media (timeline/join-timelines.ts); absent in older saves. */
	timelineModel?: number;
}

export type TProjectSortKey = "createdAt" | "updatedAt" | "name" | "duration";
export type TSortOrder = "asc" | "desc";
export type TProjectSortOption = `${TProjectSortKey}-${TSortOrder}`;
