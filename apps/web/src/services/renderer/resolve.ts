import { videoCache as sharedVideoCache } from "@/services/video-cache/service";
import { toast } from "sonner";
import { type FollowOffset, followPlace } from "@/motion/follow";
import { resolveTextAnimFrame } from "@/animation/presets";
import { mediaTimeToSeconds, roundMediaTime, TICKS_PER_SECOND } from "@/wasm";
import { getElementLocalTime } from "@/animation";
import { resolveEffectParamsAtTime } from "@/animation/effect-param-channel";
import {
	buildGaussianBlurPasses,
	intensityToSigma,
} from "@/effects/definitions/blur";
import {
	buildEffectTimeContext,
	effectsRegistry,
	resolveEffectPasses,
} from "@/effects";
import type { Effect, EffectPass, EffectTimeContext } from "@/effects/types";
import { getSourceTimeAtClipTime } from "@/retime";
import { applyTrackerFx, hasActiveFx } from "@/motion/region-fx";
import { pickSmoothProxy } from "@/motion/smooth";
import {
	DEFAULT_GRAPHIC_SOURCE_SIZE,
	resolveGraphicElementParamsAtTime,
} from "@/graphics";
import {
	buildTextBackgroundFromElement,
	buildTextPaintFromElement,
	getTextMeasurementContext,
	measureTextElement,
} from "@/text/measure-element";
import { resolveColorAtTime, resolveOpacityAtTime } from "@/animation/values";
import { resolveTransformAtTime } from "@/rendering/animation-values";
import type { CanvasRenderer } from "./canvas-renderer";
import type { AnyBaseNode } from "./nodes/base-node";
import {
	BlurBackgroundNode,
	type BackdropSource,
	type ResolvedBlurBackgroundNodeState,
} from "./nodes/blur-background-node";
import {
	EffectLayerNode,
	type ResolvedEffectLayerNodeState,
} from "./nodes/effect-layer-node";
import {
	GraphicNode,
	type ResolvedGraphicNodeState,
} from "./nodes/graphic-node";
import { ImageNode, loadImageSource } from "./nodes/image-node";
import { StickerNode, loadStickerSource } from "./nodes/sticker-node";
import { TextNode, type ResolvedTextNodeState } from "./nodes/text-node";
import { VideoNode } from "./nodes/video-node";
import {
	TransitionNode,
	type ResolvedTransitionNodeState,
} from "./nodes/transition-node";
import { getTransitionDefinition } from "@/transitions/definitions";
import { layerTransitionProgress } from "@/transitions/layer";
import {
	LayerTransitionNode,
	type ResolvedLayerTransitionNodeState,
} from "./nodes/layer-transition-node";
import type {
	ResolvedVisualNodeState,
	ResolvedVisualSourceNodeState,
	VisualNodeParams,
} from "./nodes/visual-node";

/**
 * While the user scrubs: how long a video layer may take to reach the new time. A layer whose decoder is still
 * seeking shows its last frame, and `late` collects those seeks — the frame is drawn again once they are done. With
 * 8 video layers every scrub frame waited for all 8 seeks (~100 ms): a quarter of the hand's steps reached the player.
 */
export type FrameBudget = { ms: number; late: Promise<unknown>[] };

type ResolveContext = {
	renderer: CanvasRenderer;
	time: number;
	budget?: FrameBudget;
};

export async function resolveRenderTree({
	node,
	renderer,
	time,
	budget,
}: {
	node: AnyBaseNode;
	renderer: CanvasRenderer;
	time: number;
	budget?: FrameBudget;
}): Promise<void> {
	await resolveNode({
		node,
		context: {
			renderer,
			time,
			budget,
		},
	});
}

/**
 * A video file that can't be read (damaged, emptied, not a format the decoder knows) must not take the whole picture
 * down: one such clip blanked the player for every layer and stopped the export with no name (targeted test 05.11). In
 * the player the clip is left out and the user is told once which file it is; an export stops and names the file.
 */
const brokenTold = new Set<string>();
async function readable<T>(context: ResolveContext, file: { name?: string } | undefined, key: string, request: Promise<T | null>): Promise<T | null> {
	try {
		return await request;
	} catch (error) {
		const name = file?.name || "a video";
		if (context.renderer.videoCache !== sharedVideoCache) {
			throw new Error(`Couldn't read «${name}»: the file is damaged or not a video Gaziyav can open. Replace it in Media (right-click → Replace) or delete its clip, then export again.`);
		}
		if (!brokenTold.has(key)) {
			brokenTold.add(key);
			console.warn("Unreadable video", name, error);
			toast.error("A video file can't be read — the rest of the project plays", {
				id: `unreadable-${key}`,
				description: `${name} · replace it in Media (right-click → Replace) or delete its clip`,
				duration: 10_000,
			});
		}
		return null;
	}
}

/** The decoder's frame at the asked time, or within the scrub budget its last one (`late` gets the seek). */
export async function frameWithin<T>(
	context: { budget?: FrameBudget },
	request: Promise<T | null>,
	shown: () => T | null,
): Promise<T | null> {
	const budget = context.budget;
	if (!budget) return request;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<typeof LATE>((resolve) => {
		timer = setTimeout(() => resolve(LATE), budget.ms);
	});
	const first = await Promise.race([request, late]);
	clearTimeout(timer);
	if (first !== LATE) return first;
	const last = shown();
	// A layer that never showed a frame waits for it (nothing to show meanwhile).
	if (!last) return request;
	budget.late.push(request);
	return last;
}
const LATE = Symbol("late");

/** The moment each decoder last came back empty on a still frame (one redraw per decoder and moment, no loop). */
const emptyAt = new Map<string, number>();
/** How long after an empty layer the still frame is drawn again. */
export const EMPTY_LAYER_REDRAW_MS = 120;

/**
 * A video layer that is on screen at this moment but got no frame (its decoder was closed or had none yet) leaves a
 * picture without it: on a still frame (the player paused, `budget` set) that picture is drawn again once, shortly,
 * through the late-layer path the preview already redraws on — never a silent frame with a layer missing (polish3,
 * 11.11). Playback draws the next frame anyway; the export has no budget and gets its errors thrown.
 */
export function redrawOnceWithout(context: { budget?: FrameBudget }, decoderKey: string, sourceSeconds: number): boolean {
	const budget = context.budget;
	if (!budget) return false;
	if (emptyAt.get(decoderKey) === sourceSeconds) return false;
	emptyAt.set(decoderKey, sourceSeconds);
	budget.late.push(new Promise<void>((resolve) => setTimeout(resolve, EMPTY_LAYER_REDRAW_MS)));
	return true;
}

async function resolveNode({
	node,
	context,
}: {
	node: AnyBaseNode;
	context: ResolveContext;
}): Promise<void> {
	if (node instanceof VideoNode) {
		node.resolved = await resolveVideoNode({ node, context });
	} else if (node instanceof ImageNode) {
		node.resolved = await resolveImageNode({ node, context });
	} else if (node instanceof StickerNode) {
		node.resolved = await resolveStickerNode({ node, context });
	} else if (node instanceof GraphicNode) {
		node.resolved = resolveGraphicNode({ node, context });
	} else if (node instanceof TextNode) {
		node.resolved = resolveTextNode({ node, context });
	} else if (node instanceof BlurBackgroundNode) {
		node.resolved = await resolveBlurBackgroundNode({ node, context });
	} else if (node instanceof EffectLayerNode) {
		node.resolved = resolveEffectLayerNode({ node, context });
	} else if (node instanceof LayerTransitionNode) {
		node.resolved = resolveLayerTransitionNode({ node, context });
		// Inside a pair's window only sides A and B are drawn (the live composite below is not decoded at all).
		const sides = node.resolved ? node.sides : null;
		const active = sides ?? node.children.slice(0, 1);
		await Promise.all(active.map((child) => resolveNode({ node: child, context })));
		return;
	} else if (node instanceof TransitionNode) {
		node.resolved = resolveTransitionNode({ node, context });
		if (!node.resolved) {
			for (const child of node.children) child.resolved = null;
			return;
		}
	}

	await Promise.all(
		node.children.map((child) => resolveNode({ node: child, context })),
	);
}

export function rendererFps(renderer: CanvasRenderer): number {
	const fps = renderer.fps;
	return fps && fps.denominator > 0 ? fps.numerator / fps.denominator : 30;
}

export function effectTimeFor({
	renderer,
	localTicks,
	durationTicks,
}: {
	renderer: CanvasRenderer;
	localTicks: number;
	durationTicks: number;
}): EffectTimeContext {
	return buildEffectTimeContext({
		localTicks,
		durationTicks,
		ticksPerSecond: TICKS_PER_SECOND,
		fps: rendererFps(renderer),
	});
}

function resolveEffectPassGroups({
	effects,
	animations,
	localTime,
	width,
	height,
	time,
}: {
	effects: Effect[] | undefined;
	animations: VisualNodeParams["animations"];
	localTime: number;
	width: number;
	height: number;
	time?: EffectTimeContext;
}): EffectPass[][] {
	return (effects ?? [])
		.filter((effect) => effect.enabled)
		.map((effect) => {
			const resolvedParams = resolveEffectParamsAtTime({
				effectId: effect.id,
				params: effect.params,
				animations,
				localTime,
			});
			const definition = effectsRegistry.get(effect.type);
			return resolveEffectPasses({
				definition,
				effectParams: resolvedParams,
				width,
				height,
				time,
			});
		})
		.filter((group) => group.length > 0);
}

function resolveVisualState({
	params,
	context,
	sourceWidth,
	sourceHeight,
}: {
	params: VisualNodeParams;
	context: ResolveContext;
	sourceWidth: number;
	sourceHeight: number;
}): ResolvedVisualNodeState | null {
	const clipTime = context.time - params.timeOffset;
	if (clipTime < 0 || clipTime >= params.duration) {
		return null;
	}
	if (isExcluded({ params, time: context.time })) {
		return null;
	}

	const localTime = getElementLocalTime({
		timelineTime: context.time,
		elementStartTime: params.timeOffset,
		elementDuration: params.duration,
	});
	let transform = withFollow(
		resolveTransformAtTime({
			baseTransform: params.transform,
			animations: params.animations,
			localTime,
		}),
		params.followOffset?.(context.time),
	);
	let opacity = resolveOpacityAtTime({
		baseOpacity: params.opacity,
		animations: params.animations,
		localTime,
	});
	// In / Out / Loop presets of a video, photo or sticker (same function in preview and export)
	if (params.clipAnim) {
		const frame = resolveTextAnimFrame({
			params: params.clipAnim,
			animations: params.animations,
			duration: params.duration,
			localTime,
			canvasWidth: context.renderer.width,
			canvasHeight: context.renderer.height,
		});
		transform = {
			...transform,
			position: { x: transform.position.x + frame.offsetX, y: transform.position.y + frame.offsetY },
			scaleX: transform.scaleX * frame.scale,
			scaleY: transform.scaleY * frame.scale,
			rotate: transform.rotate + frame.rotate,
		};
		opacity *= frame.opacity;
	}
	const containScale = Math.min(
		context.renderer.width / sourceWidth,
		context.renderer.height / sourceHeight,
	);
	const effectWidth = Math.round(
		Math.abs(sourceWidth * containScale * transform.scaleX),
	);
	const effectHeight = Math.round(
		Math.abs(sourceHeight * containScale * transform.scaleY),
	);

	return {
		localTime,
		transform,
		opacity,
		effectPasses: resolveEffectPassGroups({
			effects: params.effects,
			animations: params.animations,
			localTime,
			width: effectWidth,
			height: effectHeight,
			time: effectTimeFor({
				renderer: context.renderer,
				localTicks: clipTime,
				durationTicks: params.duration,
			}),
		}),
	};
}

/** A layer that follows a tracker keeps its own position/scale relative to the tracked object. */
function withFollow<T extends { position: { x: number; y: number }; scaleX: number; scaleY: number; rotate: number }>(
	transform: T,
	offset: FollowOffset | null | undefined,
): T {
	if (!offset) return transform;
	// A layer on a tracked object: carried, scaled and turned with it (motion/follow.ts followPlace).
	const p = followPlace({ x: transform.position.x, y: transform.position.y, scaleX: transform.scaleX, scaleY: transform.scaleY, rotate: transform.rotate }, offset);
	return { ...transform, position: { x: p.x, y: p.y }, scaleX: p.scaleX, scaleY: p.scaleY, rotate: p.rotate };
}

const rendererIds = new WeakMap<object, number>();
const fxVersions = new WeakMap<object, number>();
let motionCounter = 0;
function idOf(map: WeakMap<object, number>, key: object): number {
	let id = map.get(key);
	if (id === undefined) {
		id = ++motionCounter;
		map.set(key, id);
	}
	return id;
}

function isExcluded({
	params,
	time,
}: {
	params: VisualNodeParams;
	time: number;
}): boolean {
	const ranges = params.excludeRanges;
	if (!ranges) return false;
	return ranges.some((range) => time >= range.start && time < range.end);
}

/** The decoder a video clip reads from: its lane or transition key, else its media. */
export function decoderKeyOf(params: VideoNode["params"]): string {
	return params.decoderKey ?? params.mediaId;
}

/** Source time (s) shown at `clipTime` (ticks into the clip): trim, retime and transition clamp applied. */
export function videoSourceSeconds(params: VideoNode["params"], clipTime: number): number {
	let sourceTimeTicks =
		params.trimStart +
		getSourceTimeAtClipTime({
			clipTime,
			retime: params.retime,
			duration: params.duration,
		});
	const clamp = params.sourceClamp;
	if (clamp) {
		sourceTimeTicks = Math.min(clamp.max, Math.max(clamp.min, sourceTimeTicks));
	}
	return mediaTimeToSeconds({ time: roundMediaTime({ time: sourceTimeTicks }) });
}

async function resolveVideoNode({
	node,
	context,
}: {
	node: VideoNode;
	context: ResolveContext;
}): Promise<ResolvedVisualSourceNodeState | null> {
	const clipTime = context.time - node.params.timeOffset;
	if (clipTime < 0 || clipTime >= node.params.duration) {
		return null;
	}

	if (isExcluded({ params: node.params, time: context.time })) {
		return null;
	}

	const sourceSeconds = videoSourceSeconds(node.params, clipTime);
	// Smooth slow motion: the optical-flow file for this media, when one covers this moment.
	const proxy = pickSmoothProxy(node.params.proxies, node.params.retime, sourceSeconds);
	const smoothFrame = proxy
		? await readable(
				context,
				proxy.file,
				proxy.mediaId,
				context.renderer.videoCache.getFrameAt({
					mediaId: node.params.decoderKey ? `${node.params.decoderKey}~${proxy.mediaId}` : proxy.mediaId,
					file: proxy.file,
					time: Math.max(0, (sourceSeconds - proxy.a) * proxy.m),
				}),
			)
		: null;
	// Export uses its own cache (performance fix); decoder lanes and transitions give clips their own decoders.
	const decoderKey = decoderKeyOf(node.params);
	const frame =
		smoothFrame ??
		(await frameWithin(
			context,
			readable(
				context,
				node.params.file,
				node.params.mediaId,
				context.renderer.videoCache.getFrameAt({
					mediaId: decoderKey,
					file: node.params.file,
					time: sourceSeconds,
				}),
			),
			() => context.renderer.videoCache.shownFrame(decoderKey),
		));
	if (!frame) {
		redrawOnceWithout(context, decoderKey, sourceSeconds);
		return null;
	}
	emptyAt.delete(decoderKey);
	// Tracker actions (blur / pixelate / spotlight / colour pop) drawn into the picture itself.
	let source: CanvasImageSource = frame.canvas;
	let sourceKey: number | string = frame.timestamp;
	if (node.params.trackers && hasActiveFx(node.params.trackers)) {
		const fxCanvas = applyTrackerFx({
			key: `${idOf(rendererIds, context.renderer)}:${node.params.decoderKey ?? ""}:${node.params.elementId ?? node.params.mediaId}`,
			source: frame.canvas,
			width: frame.canvas.width,
			height: frame.canvas.height,
			trackers: node.params.trackers,
			sourceTime: sourceSeconds,
		});
		if (fxCanvas) {
			source = fxCanvas;
			sourceKey = `${frame.timestamp}:fx${idOf(fxVersions, node.params.trackers)}`;
		}
	}

	const visualState = resolveVisualState({
		params: node.params,
		context,
		sourceWidth: frame.canvas.width,
		sourceHeight: frame.canvas.height,
	});
	if (!visualState) {
		return null;
	}

	return {
		...visualState,
		source,
		// pooled decoder canvases are reused for other frames: key the upload by timestamp too
		sourceKey: smoothFrame ? `${sourceKey}:smooth` : sourceKey,
		sourceWidth: frame.canvas.width,
		sourceHeight: frame.canvas.height,
	};
}

async function resolveImageNode({
	node,
	context,
}: {
	node: ImageNode;
	context: ResolveContext;
}): Promise<ResolvedVisualSourceNodeState | null> {
	const source = await loadImageSource({
		url: node.params.url,
		maxSourceSize: node.params.maxSourceSize,
	});
	const visualState = resolveVisualState({
		params: node.params,
		context,
		sourceWidth: source.width,
		sourceHeight: source.height,
	});
	if (!visualState) {
		return null;
	}

	return {
		...visualState,
		source: source.source,
		sourceWidth: source.width,
		sourceHeight: source.height,
	};
}

async function resolveStickerNode({
	node,
	context,
}: {
	node: StickerNode;
	context: ResolveContext;
}): Promise<ResolvedVisualSourceNodeState | null> {
	const source = await loadStickerSource({ stickerId: node.params.stickerId });
	const sourceWidth = node.params.intrinsicWidth ?? source.width;
	const sourceHeight = node.params.intrinsicHeight ?? source.height;
	const visualState = resolveVisualState({
		params: node.params,
		context,
		sourceWidth,
		sourceHeight,
	});
	if (!visualState) {
		return null;
	}

	return {
		...visualState,
		source: source.source,
		sourceWidth,
		sourceHeight,
	};
}

function resolveGraphicNode({
	node,
	context,
}: {
	node: GraphicNode;
	context: ResolveContext;
}): ResolvedGraphicNodeState | null {
	const visualState = resolveVisualState({
		params: node.params,
		context,
		sourceWidth: DEFAULT_GRAPHIC_SOURCE_SIZE,
		sourceHeight: DEFAULT_GRAPHIC_SOURCE_SIZE,
	});
	if (!visualState) {
		return null;
	}

	// generators are seeded by the clip's frame number (player = export = after ⌘Z), never the clock
	const rate = context.renderer.fps;
	const fps = rate && rate.denominator > 0 ? rate.numerator / rate.denominator : 30;
	const frame = Math.round((Math.max(0, visualState.localTime) / TICKS_PER_SECOND) * fps);
	return {
		...visualState,
		resolvedParams: resolveGraphicElementParamsAtTime({
			element: node.params,
			localTime: visualState.localTime,
		}),
		frame,
		fps,
	};
}

function resolveTextNode({
	node,
	context,
}: {
	node: TextNode;
	context: ResolveContext;
}): ResolvedTextNodeState | null {
	if (
		context.time < node.params.startTime ||
		context.time >= node.params.startTime + node.params.duration
	) {
		return null;
	}

	const localTime = getElementLocalTime({
		timelineTime: context.time,
		elementStartTime: node.params.startTime,
		elementDuration: node.params.duration,
	});
	const background = buildTextBackgroundFromElement({ element: node.params });
	const textColor = resolveColorAtTime({
		baseColor:
			typeof node.params.params.color === "string"
				? node.params.params.color
				: "#ffffff",
		animations: node.params.animations,
		propertyPath: "color",
		localTime,
	});

	// Text animation presets (in/out/loop) — same function for preview and export.
	const canvasWidth = node.params.canvasCenter.x * 2;
	const animFrame = resolveTextAnimFrame({
		params: node.params.params,
		animations: node.params.animations,
		duration: node.params.duration,
		localTime,
		canvasWidth,
		canvasHeight: node.params.canvasHeight,
	});
	const baseTransform = withFollow(
		resolveTransformAtTime({
			baseTransform: node.params.transform,
			animations: node.params.animations,
			localTime,
		}),
		(node.params as { followOffset?: VisualNodeParams["followOffset"] }).followOffset?.(context.time),
	);

	return {
		paint: buildTextPaintFromElement({
			element: node.params,
			textColor,
			localTime,
			animFrame,
		}),
		transform: {
			...baseTransform,
			position: {
				x: baseTransform.position.x + animFrame.offsetX,
				y: baseTransform.position.y + animFrame.offsetY,
			},
			scaleX: baseTransform.scaleX * animFrame.scale,
			scaleY: baseTransform.scaleY * animFrame.scale,
			rotate: baseTransform.rotate + animFrame.rotate,
		},
		opacity:
			resolveOpacityAtTime({
				baseOpacity: node.params.opacity,
				animations: node.params.animations,
				localTime,
			}) * animFrame.opacity,
		textColor: resolveColorAtTime({
			baseColor:
				typeof node.params.params.color === "string"
					? node.params.params.color
					: "#ffffff",
			animations: node.params.animations,
			propertyPath: "color",
			localTime,
		}),
		backgroundColor: resolveColorAtTime({
			baseColor: background.color,
			animations: node.params.animations,
			propertyPath: "background.color",
			localTime,
		}),
		effectPasses: resolveEffectPassGroups({
			effects: node.params.effects,
			animations: node.params.animations,
			localTime,
			width: context.renderer.width,
			height: context.renderer.height,
			time: effectTimeFor({
				renderer: context.renderer,
				localTicks: context.time - node.params.startTime,
				durationTicks: node.params.duration,
			}),
		}),
		measuredText: measureTextElement({
			element: node.params,
			canvasHeight: node.params.canvasHeight,
			canvasWidth,
			animFrame,
			localTime,
			ctx: getTextMeasurementContext(),
		}),
	};
}

async function resolveBlurBackgroundNode({
	node,
	context,
}: {
	node: BlurBackgroundNode;
	context: ResolveContext;
}): Promise<ResolvedBlurBackgroundNodeState | null> {
	const clipTime = context.time - node.params.timeOffset;
	if (clipTime < 0 || clipTime >= node.params.duration) {
		return null;
	}

	const backdropSource = await resolveBackdropSource({
		node,
		clipTime,
		renderer: context.renderer,
	});
	if (!backdropSource) {
		return null;
	}

	return {
		backdropSource,
		passes: buildGaussianBlurPasses({
			sigmaX: intensityToSigma({
				intensity: node.params.blurIntensity,
				resolution: context.renderer.width,
				reference: 1920,
			}),
			sigmaY: intensityToSigma({
				intensity: node.params.blurIntensity,
				resolution: context.renderer.height,
				reference: 1080,
			}),
		}),
	};
}

async function resolveBackdropSource({
	node,
	clipTime,
	renderer,
}: {
	node: BlurBackgroundNode;
	clipTime: number;
	renderer: CanvasRenderer;
}): Promise<BackdropSource | null> {
	if (node.params.mediaType === "video") {
		const sourceTimeTicks =
			node.params.trimStart +
			getSourceTimeAtClipTime({
				clipTime,
				retime: node.params.retime,
				duration: node.params.duration,
			});
		const ask = () =>
			renderer.videoCache.getFrameAt({
				// The clip's own decoder (same lane): one decode serves the clip and its blurred backdrop.
				mediaId: node.params.decoderKey ?? node.params.mediaId,
				file: node.params.file,
				time: mediaTimeToSeconds({ time: roundMediaTime({ time: sourceTimeTicks }) }),
			});
		// Asked together with the clip itself, the newer request wins and this one gets the decoder's current frame —
		// none yet on the first picture after opening (the blur stayed black until the playhead moved). Once more.
		// An unreadable file has no backdrop (its clip says so once, above): never the whole picture's failure.
		const safely = () => ask().catch(() => null);
		const frame = (await safely()) ?? (await safely());
		if (!frame) {
			return null;
		}

		return {
			source: frame.canvas,
			width: frame.canvas.width,
			height: frame.canvas.height,
		};
	}

	const source = await loadImageSource({ url: node.params.url });
	return {
		source: source.source,
		width: source.width,
		height: source.height,
	};
}

function resolveEffectLayerNode({
	node,
	context,
}: {
	node: EffectLayerNode;
	context: ResolveContext;
}): ResolvedEffectLayerNodeState | null {
	const time = context.time;
	if (
		time < node.params.timeOffset - 1e-6 ||
		time >= node.params.timeOffset + node.params.duration + 1e-6
	) {
		return null;
	}

	const definition = effectsRegistry.get(node.params.effectType);
	const passes = resolveEffectPasses({
		definition,
		effectParams: node.params.effectParams,
		width: context.renderer.width,
		height: context.renderer.height,
		time: effectTimeFor({
			renderer: context.renderer,
			localTicks: time - node.params.timeOffset,
			durationTicks: node.params.duration,
		}),
	});
	if (passes.length === 0) {
		return null;
	}

	return {
		passes,
	};
}

function resolveTransitionNode({
	node,
	context,
}: {
	node: TransitionNode;
	context: ResolveContext;
}): ResolvedTransitionNodeState | null {
	const { start, duration, transitionType, transitionParams } = node.params;
	if (context.time < start || context.time >= start + duration) {
		return null;
	}
	const definition = getTransitionDefinition(transitionType);
	if (!definition) {
		return null;
	}
	const time = effectTimeFor({
		renderer: context.renderer,
		localTicks: context.time - start,
		durationTicks: duration,
	});
	return {
		passes: [
			{
				shader: definition.type,
				uniforms: {
					u_time: time.time,
					u_progress: time.progress,
					u_frame: time.frame,
					u_params: (definition.pack?.(transitionParams) ?? [0]).slice(0, 32),
				},
			},
		],
	};
}

function resolveLayerTransitionNode({
	node,
	context,
}: {
	node: LayerTransitionNode;
	context: ResolveContext;
}): ResolvedLayerTransitionNodeState | null {
	const { start, end, cut, transitionType, transitionParams } = node.params;
	if (context.time < start || context.time >= end) {
		return null;
	}
	const definition = getTransitionDefinition(transitionType);
	if (!definition) {
		return null;
	}
	// The shader's clock runs with its progress (time = progress × length), so the cut is its middle in both.
	const duration = end - start;
	const progress = layerTransitionProgress({ start, end, cut }, context.time);
	const time = effectTimeFor({
		renderer: context.renderer,
		localTicks: progress * duration,
		durationTicks: duration,
	});
	return {
		passes: [
			{
				shader: definition.type,
				uniforms: {
					u_time: time.time,
					u_progress: progress,
					u_frame: time.frame,
					u_params: (definition.pack?.(transitionParams) ?? [0]).slice(0, 32),
				},
			},
		],
	};
}
