import type { SceneTracks, TimelineTrack } from "@/timeline";
import { effectiveGraphicDefinitionId } from "@/generators/document";
import { byTier } from "@/platform/hardware-client";
import { getSourceTimeAtClipTime } from "@/retime";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";
import { SMOOTH_VERSION } from "@/motion/smooth";
import type { MediaAsset } from "@/media/types";
import { readCrop } from "@/timeline/crop";
import { RootNode } from "./nodes/root-node";
import { VideoNode, type VideoNodeParams } from "./nodes/video-node";
import type { VisualNodeParams } from "./nodes/visual-node";
import { makeFollowResolver, type FollowResolver } from "@/motion/follow";
import { ImageNode } from "./nodes/image-node";
import { TextNode } from "./nodes/text-node";
import { StickerNode } from "./nodes/sticker-node";
import { GraphicNode } from "./nodes/graphic-node";
import { ColorNode } from "./nodes/color-node";
import { BlurBackgroundNode } from "./nodes/blur-background-node";
import { EffectLayerNode } from "./nodes/effect-layer-node";
import type { AnyBaseNode } from "./nodes/base-node";
import { applyTrackTransitions, getTrackTransitions } from "@/transitions/scene";
import { getTransitionDefinition } from "@/transitions/definitions";
import {
	type LayerSide,
	type LayerTransitionWindow,
	layerTransitionMode,
	layerTransitionWindow,
	sideExtension,
	sideVideoTiming,
} from "@/transitions/layer";
import { LayerTransitionNode } from "./nodes/layer-transition-node";
import { readLayerShadow } from "@/shadow/layer-shadow";
import type { TBackground, TCanvasSize } from "@/project/types";
import { DEFAULT_BACKGROUND_BLUR_INTENSITY } from "@/background/blur";
import {
	buildTransformFromParams,
	readBlendModeFromParams,
	readOpacityFromParams,
} from "@/rendering";

/** A clip's params, only when it animates In / Out / Loop (most clips don't: nothing extra per frame). */
function clipAnimOf(params: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
	if (!params) return undefined;
	const set = (k: string) => typeof params[k] === "string" && params[k] !== "none";
	return set("anim.in") || set("anim.out") || set("anim.loop") ? params : undefined;
}

const PREVIEW_MAX_IMAGE_SIZE = 2048;
/** Pictures in the player at most this big (an 8 GB Mac: 1280 — the export always uses them whole). */
const previewMaxImageSize = () => byTier({ base: 1280, standard: PREVIEW_MAX_IMAGE_SIZE, pro: PREVIEW_MAX_IMAGE_SIZE });

function hasFollowers(tracks: SceneTracks): boolean {
	for (const track of [tracks.main, ...tracks.overlay] as TimelineTrack[]) {
		if ((track.elements as Array<{ follow?: unknown }>).some((e) => e.follow)) return true;
	}
	return false;
}

function getVisibleSortedElements({ track }: { track: TimelineTrack }) {
	return track.elements
		.filter((element) => !("hidden" in element && element.hidden))
		.slice()
		.sort((a, b) => {
			if (a.startTime !== b.startTime) return a.startTime - b.startTime;
			return a.id.localeCompare(b.id);
		});
}

/** Clips closer than this (ticks) touch on the timeline / continue each other in the source. */
const CONTINUITY_TOLERANCE = TICKS_PER_SECOND / 50;

/**
 * Decoder per video clip, as a key suffix to its media id ("" = the media's own decoder).
 * Back-to-back pieces of one recording that jump in the source (pauses removed, jump cuts) alternate between two
 * decoders, so the next piece's decoder is opened and positioned (preroll) while the current piece plays: with one
 * decoder per file every such cut sought at playback time (90–320 ms freezes). A piece that continues the previous
 * one in the source (a plain split) keeps its decoder. Overlay tracks have their own decoders: the same file on two
 * tracks at once made one decoder seek back and forth every frame.
 */
function decoderLanes({ track, isMain }: { track: TimelineTrack; isMain: boolean }): Map<string, string> {
	const lanes = new Map<string, string>();
	const base = isMain ? "" : `@${track.id}`;
	let previous: Extract<TimelineTrack["elements"][number], { type: "video" }> | null = null;
	let previousLane = base;
	for (const element of getVisibleSortedElements({ track })) {
		if (element.type !== "video") continue;
		let lane = base;
		if (previous && previous.mediaId === element.mediaId) {
			const touches = Math.abs(previous.startTime + previous.duration - element.startTime) <= CONTINUITY_TOLERANCE;
			const sourceEnd =
				previous.trimStart +
				getSourceTimeAtClipTime({ clipTime: previous.duration, retime: previous.retime, duration: previous.duration });
			const continues = touches && Math.abs(sourceEnd - element.trimStart) <= CONTINUITY_TOLERANCE;
			// Also across a short gap: the previous piece still plays while this one is pre-rolled.
			lane = continues ? previousLane : previousLane === base ? `${base}#b` : base;
		}
		if (lane) lanes.set(element.id, lane);
		previous = element;
		previousLane = lane;
	}
	return lanes;
}

type TrackBuild = {
	mainTrack?: TimelineTrack;
	mediaMap: Map<string, MediaAsset>;
	canvasSize: TCanvasSize;
	isPreview?: boolean;
	follow?: FollowResolver;
};

/** Side A or B of an adjustment-layer transition being built (transitions/layer.ts). */
type SideBuild = { window: LayerTransitionWindow; side: LayerSide };

function buildTrackNodes({
	tracks,
	mainTrack,
	mediaMap,
	canvasSize,
	isPreview,
	follow,
	side,
}: TrackBuild & {
	/** Bottom to top. */
	tracks: TimelineTrack[];
	side?: SideBuild;
}): AnyBaseNode[] {
	const nodes: AnyBaseNode[] = [];
	const build: TrackBuild = { mainTrack, mediaMap, canvasSize, isPreview, follow };

	for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
		const track = tracks[trackIndex];
		const elements = getVisibleSortedElements({ track });
		const hasTransitions = getTrackTransitions(track).length > 0;
		const trackNodes: AnyBaseNode[] = hasTransitions ? [] : nodes;
		const nodeByElementId = new Map<string, AnyBaseNode>();
		const lanes = decoderLanes({ track, isMain: track === mainTrack });

		for (const element of elements) {
			const extension = side ? sideExtension({ element, window: side.window, side: side.side }) : null;
			if (side && !extension) continue;
			if (element.type === "effect" && element.transition) {
				wrapInLayerTransition({ element, nodes, below: tracks.slice(0, trackIndex), build });
			}
			const before = trackNodes.length;
			buildElementNode({ element, trackNodes, mediaMap, canvasSize, isPreview });
			if (trackNodes.length > before) {
				const node = trackNodes[trackNodes.length - 1];
				nodeByElementId.set(element.id, node);
				const lane = lanes.get(element.id);
				if (lane && node instanceof VideoNode) node.params.decoderKey = `${node.params.mediaId}${lane}`;
				attachMotion({ node, element, mediaMap, follow });
				if (extension && (extension.before > 0 || extension.after > 0)) extendNode(node, extension);
			}
		}

		if (hasTransitions) {
			applyTrackTransitions({ track, nodes: trackNodes, nodeByElementId });
			nodes.push(...trackNodes);
		}
	}

	return nodes;
}

/**
 * An adjustment layer with a transition: everything built so far (the tracks below it) goes into a
 * LayerTransitionNode; a "pair" transition with a cut also gets the composite below as side A and side B.
 */
function wrapInLayerTransition({
	element,
	nodes,
	below,
	build,
}: {
	element: Extract<TimelineTrack["elements"][number], { type: "effect" }>;
	nodes: AnyBaseNode[];
	below: TimelineTrack[];
	build: TrackBuild;
}) {
	const transition = element.transition;
	if (!transition || !getTransitionDefinition(transition.type) || element.duration <= 0) return;
	const window = layerTransitionWindow({ layer: element, tracksBelow: below });
	const mode = layerTransitionMode(transition.type);
	const node = new LayerTransitionNode({
		transitionType: transition.type,
		transitionParams: transition.params ?? {},
		start: window.start,
		end: window.end,
		cut: window.cut,
		mode,
	});
	const live = new RootNode({ duration: 0 });
	live.children = nodes.splice(0, nodes.length);
	node.add(live);
	if (mode === "pair" && window.cut !== null) {
		for (const side of ["A", "B"] as const) {
			const group = new RootNode({ duration: 0 });
			group.children = buildTrackNodes({ ...build, tracks: below, side: { window, side } });
			node.add(group);
		}
	}
	nodes.push(node);
}

/** Side A/B timing: the node plays `before` earlier and `after` longer (a video reads its handles, or holds its edge frame). */
function extendNode(node: AnyBaseNode, extension: { before: number; after: number }) {
	if (node instanceof VideoNode) {
		const p = node.params;
		Object.assign(p, sideVideoTiming({ clip: p, extension }));
		p.excludeRanges = undefined;
		return;
	}
	if (node instanceof TextNode) {
		const p = node.params;
		p.startTime = mediaTime({ ticks: p.startTime - extension.before });
		p.duration = mediaTime({ ticks: p.duration + extension.before + extension.after });
		return;
	}
	const p = node.params as Partial<VisualNodeParams> | undefined;
	if (p && typeof p.timeOffset === "number" && typeof p.duration === "number") {
		p.timeOffset -= extension.before;
		p.duration += extension.before + extension.after;
		p.excludeRanges = undefined;
	}
}

function buildElementNode({
	element,
	trackNodes: nodes,
	mediaMap,
	canvasSize,
	isPreview,
}: {
	element: TimelineTrack["elements"][number];
	trackNodes: AnyBaseNode[];
	mediaMap: Map<string, MediaAsset>;
	canvasSize: TCanvasSize;
	isPreview?: boolean;
}): void {
	{
		{
			if (element.type === "effect") {
				nodes.push(
					new EffectLayerNode({
						effectType: element.effectType,
						effectParams: element.params,
						timeOffset: element.startTime,
						duration: element.duration,
					}),
				);
				return;
			}

			if (element.type === "video" || element.type === "image") {
				const own = mediaMap.get(element.mediaId);
				// Effects → AI: the clip shows the fast result; export uses the accurate copy once it's ready.
				const twin = !isPreview && own?.neural?.exportId ? mediaMap.get(own.neural.exportId) : undefined;
				const mediaAsset = twin?.file && twin.url ? twin : own;
				if (!mediaAsset?.file || !mediaAsset?.url) {
					return;
				}

				if (element.type === "video" && mediaAsset.type === "video") {
					nodes.push(
						new VideoNode({
							mediaId: mediaAsset.id,
							url: mediaAsset.url,
							file: mediaAsset.file,
							duration: element.duration,
							timeOffset: element.startTime,
							trimStart: element.trimStart,
							trimEnd: element.trimEnd,
							retime: element.retime,
							transform: buildTransformFromParams({ params: element.params }),
							animations: element.animations,
							opacity: readOpacityFromParams({ params: element.params }),
							blendMode: readBlendModeFromParams({ params: element.params }),
							effects: element.effects ?? [],
							masks: element.masks ?? [],
							clipAnim: clipAnimOf(element.params),
							shadow: readLayerShadow(element.params) ?? undefined,
							crop: readCrop(element.params) ?? undefined,
						}),
					);
				}
				if (element.type === "image" && mediaAsset.type === "image") {
					nodes.push(
						new ImageNode({
							url: mediaAsset.url,
							duration: element.duration,
							timeOffset: element.startTime,
							trimStart: element.trimStart,
							trimEnd: element.trimEnd,
							transform: buildTransformFromParams({ params: element.params }),
							animations: element.animations,
							opacity: readOpacityFromParams({ params: element.params }),
							blendMode: readBlendModeFromParams({ params: element.params }),
							effects: element.effects ?? [],
							masks: element.masks ?? [],
							clipAnim: clipAnimOf(element.params),
							shadow: readLayerShadow(element.params) ?? undefined,
							crop: readCrop(element.params) ?? undefined,
							...(isPreview && {
								maxSourceSize: previewMaxImageSize(),
							}),
						}),
					);
				}
			}

			if (element.type === "text") {
				nodes.push(
					new TextNode({
						...element,
						transform: buildTransformFromParams({ params: element.params }),
						opacity: readOpacityFromParams({ params: element.params }),
						blendMode: readBlendModeFromParams({ params: element.params }),
						canvasCenter: { x: canvasSize.width / 2, y: canvasSize.height / 2 },
						canvasHeight: canvasSize.height,
						textBaseline: "middle",
						effects: element.effects ?? [],
					}),
				);
			}

			if (element.type === "sticker") {
				nodes.push(
					new StickerNode({
						stickerId: element.stickerId,
						intrinsicWidth: element.intrinsicWidth,
						intrinsicHeight: element.intrinsicHeight,
						duration: element.duration,
						timeOffset: element.startTime,
						trimStart: element.trimStart,
						trimEnd: element.trimEnd,
						transform: buildTransformFromParams({ params: element.params }),
						animations: element.animations,
						opacity: readOpacityFromParams({ params: element.params }),
						blendMode: readBlendModeFromParams({ params: element.params }),
						clipAnim: clipAnimOf(element.params),
							shadow: readLayerShadow(element.params) ?? undefined,
						effects: element.effects ?? [],
					}),
				);
			}

			if (element.type === "graphic") {
				nodes.push(
					new GraphicNode({
						definitionId: effectiveGraphicDefinitionId(element),
						params: element.params,
						canvasSize,
						duration: element.duration,
						timeOffset: element.startTime,
						trimStart: element.trimStart,
						trimEnd: element.trimEnd,
						transform: buildTransformFromParams({ params: element.params }),
						animations: element.animations,
						opacity: readOpacityFromParams({ params: element.params }),
						blendMode: readBlendModeFromParams({ params: element.params }),
						clipAnim: clipAnimOf(element.params),
							shadow: readLayerShadow(element.params) ?? undefined,
						effects: element.effects ?? [],
						masks: element.masks ?? [],
					}),
				);
			}
		}
	}
}

function buildBlurBackgroundNodes({
	track,
	mediaMap,
	blurIntensity,
}: {
	track: TimelineTrack | undefined;
	mediaMap: Map<string, MediaAsset>;
	blurIntensity: number;
}): AnyBaseNode[] {
	if (!track) {
		return [];
	}

	const nodes: AnyBaseNode[] = [];
	const elements = getVisibleSortedElements({ track });
	const lanes = decoderLanes({ track, isMain: true });

	for (const element of elements) {
		if (element.type !== "video" && element.type !== "image") {
			continue;
		}

		const mediaAsset = mediaMap.get(element.mediaId);
		if (
			!mediaAsset?.file ||
			!mediaAsset?.url ||
			(mediaAsset.type !== "video" && mediaAsset.type !== "image")
		) {
			continue;
		}

		nodes.push(
			new BlurBackgroundNode({
				mediaId: mediaAsset.id,
				url: mediaAsset.url,
				file: mediaAsset.file,
				mediaType: mediaAsset.type,
				duration: element.duration,
				timeOffset: element.startTime,
				trimStart: element.trimStart,
				trimEnd: element.trimEnd,
				retime: element.type === "video" ? element.retime : undefined,
				blurIntensity,
				decoderKey: lanes.has(element.id) ? `${mediaAsset.id}${lanes.get(element.id)}` : undefined,
			}),
		);
	}

	return nodes;
}

export type BuildSceneParams = {
	canvasSize: TCanvasSize;
	tracks: SceneTracks;
	mediaAssets: MediaAsset[];
	duration: number;
	background: TBackground;
	isPreview?: boolean;
};

/** Motion (src/motion): follow offsets, tracker actions and smooth-motion files on the element's node. */
function attachMotion({
	node,
	element,
	mediaMap,
	follow,
}: {
	node: AnyBaseNode;
	element: TimelineTrack["elements"][number];
	mediaMap: Map<string, MediaAsset>;
	follow?: FollowResolver;
}) {
	const params = node.params as VisualNodeParams | undefined;
	if (!params || typeof params !== "object") return;
	const link = element.follow;
	if (link && follow) params.followOffset = (t: number) => follow(link, t);
	if (node instanceof VideoNode && element.type === "video") {
		node.params.elementId = element.id;
		if (element.trackers?.length) node.params.trackers = element.trackers;
		if (element.retime?.smooth) {
			const proxies: NonNullable<VideoNodeParams["proxies"]> = [];
			for (const asset of mediaMap.values()) {
				const mp = asset.motionProxy;
				if (mp && mp.of === element.mediaId && !mp.reverse && (mp.v ?? 1) >= SMOOTH_VERSION && asset.file) {
					proxies.push({ mediaId: asset.id, file: asset.file, a: mp.a, b: mp.b, m: mp.m, fps: mp.fps });
				}
			}
			if (proxies.length) node.params.proxies = proxies;
		}
	}
}

export function buildScene({
	canvasSize,
	tracks,
	mediaAssets,
	duration,
	background,
	isPreview,
}: BuildSceneParams) {
	const rootNode = new RootNode({ duration });
	const mediaMap = new Map(mediaAssets.map((m) => [m.id, m]));

	const visibleTracks = [
		...tracks.overlay.filter((track) => !("hidden" in track && track.hidden)),
		...(!tracks.main.hidden ? [tracks.main] : []),
	];
	const orderedTracksBottomToTop = visibleTracks.slice().reverse();
	const mainTrack = tracks.main.hidden ? undefined : tracks.main;

	const allNodes = buildTrackNodes({
		tracks: orderedTracksBottomToTop,
		mainTrack,
		mediaMap,
		canvasSize,
		isPreview,
		follow: hasFollowers(tracks) ? makeFollowResolver(tracks, canvasSize) : undefined,
	});

	if (background.type === "blur") {
		const blurNodes = buildBlurBackgroundNodes({
			track: mainTrack,
			mediaMap,
			blurIntensity:
				background.blurIntensity ?? DEFAULT_BACKGROUND_BLUR_INTENSITY,
		});
		for (const node of blurNodes) {
			rootNode.add(node);
		}
	} else if (
		background.type === "color" &&
		background.color !== "transparent"
	) {
		rootNode.add(new ColorNode({ color: background.color }));
	}

	for (const node of allNodes) {
		rootNode.add(node);
	}

	return rootNode;
}
