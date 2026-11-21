import type { ElementAnimations } from "@/animation/types";
import type { Effect } from "@/effects/types";
import type { Mask } from "@/masks/types";
import type { ParamValues } from "@/params";
import type { MediaTime } from "@/wasm";
import type { FollowLink, ReversedLink, SpeedCurve, Tracker } from "@/motion/types";
import type { LayerTransition } from "@/transitions/types";

export type ElementRef = {
	trackId: string;
	elementId: string;
};

export interface Bookmark {
	time: MediaTime;
	note?: string;
	color?: string;
	duration?: MediaTime;
	/** A scene mark (the Scenes view, src/chapters): a scene runs from this mark to the next; the note is its title. */
	chapter?: true;
}

export interface TScene {
	id: string;
	name: string;
	isMain: boolean;
	/** The inner timeline of a compound clip / AI composition: never a timeline tab, also once its clip is deleted. */
	nested?: boolean;
	/** A compound clip kept in Media, placed nowhere (an older project's extra timeline: timeline/join-timelines.ts). */
	inMedia?: boolean;
	/** What it was before the one-timeline conversion (its tab's name, whether it was the main one). */
	formerTimeline?: { name: string; isMain: boolean };
	tracks: SceneTracks;
	bookmarks: Bookmark[];
	createdAt: Date;
	updatedAt: Date;
}

export type TrackType = "video" | "text" | "audio" | "graphic" | "effect";

interface BaseTrack {
	id: string;
	name: string;
	/** CapCut 🔒: the track's clips can't be selected or edited (timeline/track-lock.ts). */
	locked?: boolean;
}

export interface VideoTrack extends BaseTrack {
	type: "video";
	elements: (VideoElement | ImageElement | GraphicElement)[];
	muted: boolean;
	hidden: boolean;
	/** The mixer's Solo (src/sound/solo.ts): while any track is soloed, only the soloed ones are heard and exported. */
	solo?: boolean;
	/** On the MAIN track only: the timeline's master — its fader and limiter (src/sound/master.ts). */
	master?: MasterMix;
}

/** The master of a timeline: what the mix goes through last, in the player and in the export alike. */
export interface MasterMix {
	/** The master fader, dB (0 = as mixed). */
	gainDb: number;
	/** The true-peak limiter holds the peaks at this ceiling (dBTP); absent = no limiter. */
	ceilingDb?: number;
}

export interface TextTrack extends BaseTrack {
	type: "text";
	elements: TextElement[];
	hidden: boolean;
}

export interface AudioTrack extends BaseTrack {
	type: "audio";
	elements: AudioElement[];
	muted: boolean;
	/** The mixer's Solo (src/sound/solo.ts). */
	solo?: boolean;
}

export interface GraphicTrack extends BaseTrack {
	type: "graphic";
	elements: (StickerElement | GraphicElement)[];
	hidden: boolean;
}

export interface EffectTrack extends BaseTrack {
	type: "effect";
	elements: EffectElement[];
	hidden: boolean;
}

export type TimelineTrack =
	| VideoTrack
	| TextTrack
	| AudioTrack
	| GraphicTrack
	| EffectTrack;

export type OverlayTrack = VideoTrack | TextTrack | GraphicTrack | EffectTrack;

export interface SceneTracks {
	overlay: OverlayTrack[];
	main: VideoTrack;
	audio: AudioTrack[];
}

export interface RetimeConfig {
	/** Constant speed; with a curve, its average (source span ÷ clip duration). */
	rate: number;
	maintainPitch?: boolean;
	/** "curve" = speed ramp (`curve`). */
	mode?: "constant" | "curve";
	curve?: SpeedCurve;
	/** Smooth slow motion: the picture comes from an optical-flow file (media `motionProxy`) when it is ready. */
	smooth?: boolean;
	/** Frame-rate up-conversion with optical flow: project fps ÷ source fps (e.g. 2 for 30 → 60 fps). */
	fpsBoost?: number;
}

interface BaseAudioElement extends BaseTimelineElement {
	type: "audio";
	buffer?: AudioBuffer;
	retime?: RetimeConfig;
}

export interface UploadAudioElement extends BaseAudioElement {
	sourceType: "upload";
	mediaId: string;
	/** Detached from this video clip (⌃⇧S): «Restore» puts it back into that clip (timeline/audio-separation). */
	detachedFrom?: string;
}

export interface LibraryAudioElement extends BaseAudioElement {
	sourceType: "library";
	sourceUrl: string;
}

export type AudioElement = UploadAudioElement | LibraryAudioElement;

interface BaseTimelineElement {
	id: string;
	name: string;
	duration: MediaTime;
	startTime: MediaTime;
	trimStart: MediaTime;
	trimEnd: MediaTime;
	sourceDuration?: MediaTime;
	animations?: ElementAnimations;
	params: ParamValues;
	/** Moves with a tracker of a video clip (src/motion). */
	follow?: FollowLink;
	/** CapCut group (⌘G): clips with the same id are selected, moved and deleted together (timeline/groups.ts). */
	groupId?: string;
	/** CapCut beat marks (⌘J) on a clip with sound: times from the clip's start (ticks); clips snap to them. */
	beats?: number[];
}

export interface VideoElement extends BaseTimelineElement {
	type: "video";
	mediaId: string;
	isSourceAudioEnabled?: boolean;
	hidden?: boolean;
	retime?: RetimeConfig;
	effects?: Effect[];
	masks?: Mask[];
	/** Tracked faces / objects / subjects of this clip (src/motion). */
	trackers?: Tracker[];
	/** Set while the clip plays a reversed copy of its media. */
	reversed?: ReversedLink;
	/** An AI effect switched off in the inspector (its eye): the result's media id, shown again when switched on. */
	aiOff?: string;
}

export interface ImageElement extends BaseTimelineElement {
	type: "image";
	mediaId: string;
	hidden?: boolean;
	effects?: Effect[];
	masks?: Mask[];
	/** Remove background switched off in the inspector: the result's media id, shown again when switched on. */
	aiOff?: string;
}

export interface TextElement extends BaseTimelineElement {
	type: "text";
	hidden?: boolean;
	effects?: Effect[];
}

export interface StickerElement extends BaseTimelineElement {
	type: "sticker";
	stickerId: string;
	/** Natural dimensions of the sticker asset, stored at insert time. Used by renderer and preview bounds to avoid split-brain geometry. */
	intrinsicWidth?: number;
	intrinsicHeight?: number;
	hidden?: boolean;
	effects?: Effect[];
}

export interface GraphicElement extends BaseTimelineElement {
	type: "graphic";
	definitionId: string;
	hidden?: boolean;
	effects?: Effect[];
	masks?: Mask[];
}

export interface EffectElement extends BaseTimelineElement {
	type: "effect";
	effectType: string;
	/** Switched off (V / the clip menu's Hide): the layer stays on the timeline and changes nothing in the frame. */
	hidden?: boolean;
	/** A transition dropped on the layer: it transitions everything below the layer over the layer's span (transitions/layer.ts). */
	transition?: LayerTransition;
}

export type ElementUpdatePatch = { params?: Partial<ParamValues> };

export type TimelineElement =
	| AudioElement
	| VideoElement
	| ImageElement
	| TextElement
	| StickerElement
	| GraphicElement
	| EffectElement;

export type ElementType = TimelineElement["type"];

function elementTypes<T extends ElementType[]>(...types: T): T {
	return types;
}

export const MASKABLE_ELEMENT_TYPES = elementTypes("video", "image", "graphic");

export type MaskableElement = Extract<
	TimelineElement,
	{ type: (typeof MASKABLE_ELEMENT_TYPES)[number] }
>;

export const RETIMABLE_ELEMENT_TYPES = elementTypes("video", "audio");

export type RetimableElement = Extract<
	TimelineElement,
	{ type: (typeof RETIMABLE_ELEMENT_TYPES)[number] }
>;

export const VISUAL_ELEMENT_TYPES = elementTypes(
	"video",
	"image",
	"text",
	"sticker",
	"graphic",
);

export type VisualElement = Extract<
	TimelineElement,
	{ type: (typeof VISUAL_ELEMENT_TYPES)[number] }
>;

export type CreateUploadAudioElement = Omit<UploadAudioElement, "id">;
export type CreateLibraryAudioElement = Omit<LibraryAudioElement, "id">;
export type CreateAudioElement =
	| CreateUploadAudioElement
	| CreateLibraryAudioElement;
export type CreateVideoElement = Omit<VideoElement, "id">;
export type CreateImageElement = Omit<ImageElement, "id">;
export type CreateTextElement = Omit<TextElement, "id">;
export type CreateStickerElement = Omit<StickerElement, "id">;
export type CreateGraphicElement = Omit<GraphicElement, "id">;
export type CreateEffectElement = Omit<EffectElement, "id">;
export type CreateTimelineElement =
	| CreateAudioElement
	| CreateVideoElement
	| CreateImageElement
	| CreateTextElement
	| CreateStickerElement
	| CreateGraphicElement
	| CreateEffectElement;

export interface ElementDragState {
	isDragging: boolean;
	elementId: string | null;
	dragElementIds: string[];
	dragTimeOffsets: Record<string, MediaTime>;
	trackId: string | null;
	startMouseX: number;
	startMouseY: number;
	startElementTime: MediaTime;
	clickOffsetTime: MediaTime;
	currentTime: MediaTime;
	currentMouseY: number;
}

export type ElementDragView =
	| { readonly kind: "idle" }
	| {
			readonly kind: "dragging";
			readonly anchorElementId: string;
			readonly trackId: string;
			readonly memberTimeOffsets: ReadonlyMap<string, MediaTime>;
			readonly startMouseX: number;
			readonly startMouseY: number;
			readonly startElementTime: MediaTime;
			readonly clickOffsetTime: MediaTime;
			readonly currentTime: MediaTime;
			readonly currentMouseX: number;
			readonly currentMouseY: number;
			readonly dropTarget: DropTarget | null;
			/** Where each dragged clip lands on release, exactly as the drop will put it (the ghost under the floating
			 * clip), a clip going to a new track too: on the line where that track opens. */
			readonly landing: readonly DragLanding[];
	  };

export interface DragLanding {
	readonly elementId: string;
	readonly trackId: string;
	readonly startTime: MediaTime;
	readonly duration: MediaTime;
	/** Set when the clip goes to a new track: it opens on the line above the track now at this index (display order). */
	readonly newTrackAt?: number;
}

export interface DropTarget {
	trackIndex: number;
	isNewTrack: boolean;
	insertPosition: "above" | "below" | null;
	xPosition: MediaTime;
	targetElement: { elementId: string; trackId: string } | null;
	/** The magnetic main track: the drop goes in at the cut at `xPosition` and the clips after it move along. */
	insertOnMain?: boolean;
}

export interface ComputeDropTargetParams {
	elementType: ElementType;
	mouseX: number;
	mouseY: number;
	tracks: SceneTracks;
	playheadTime: MediaTime;
	isExternalDrop: boolean;
	elementDuration: MediaTime;
	pixelsPerSecond: number;
	zoomLevel: number;
	verticalDragDirection?: "up" | "down" | null;
	startTimeOverride?: MediaTime;
	excludeElementId?: string;
	targetElementTypes?: string[];
	/** Drops from outside the timeline: this close to a track's top or bottom edge opens a new track there. */
	edgeInsertPx?: number;
}

export interface ClipboardItem {
	trackId: string;
	trackType: TrackType;
	element: CreateTimelineElement;
}
