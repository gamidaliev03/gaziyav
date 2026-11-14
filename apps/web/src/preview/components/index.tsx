"use client";

import { onFontReady } from "@/fonts/bundled";
import { useLayerProxies } from "@/montage/layer-proxies";
import { playbackTracks } from "@/montage/compositions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import { useContainerSize } from "@/hooks/use-container-size";
import { usePlayerFullscreen } from "@/preview/hooks/use-player-fullscreen";
import { cn } from "@/utils/ui";
import { useActionHandler } from "@/actions/use-action-handler";
import {
	CanvasRenderer,
	onCompositorTakeover,
	previewDecodeScale,
} from "@/services/renderer/canvas-renderer";
import { isWarming, onShaderReady } from "@/services/renderer/compositor/pipeline-warmup";
import { wasmCompositor } from "@/services/renderer/compositor/wasm-compositor";
import { prerollUpcomingClips } from "@/services/renderer/preroll";
import { setThumbnailsPaused } from "@/services/video-cache/thumbnails";
import { TICKS_PER_SECOND } from "@/wasm";
import type { RootNode } from "@/services/renderer/nodes/root-node";
import { buildScene } from "@/services/renderer/scene-builder";
import { PreviewOverlayLayer } from "./overlay-layer";
import { PreviewInteractionOverlay } from "./preview-interaction-overlay";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import type {
	PreviewOverlayControl,
	PreviewOverlayInstance,
} from "@/preview/overlays";
import { PreviewContextMenu } from "./context-menu";
import { PreviewToolbar } from "./toolbar";
import { SourcePlayer } from "@/components/editor/panels/assets/source/source-monitor";
import {
	PreviewViewportProvider,
	usePreviewViewportState,
} from "./preview-viewport";
import { effectiveQuality, QUALITY_FACTOR, usePlaybackQuality } from "@/preview/playback-quality";
import { t } from "@/i18n";
import { PlayerDropHint, usePlayerDrop } from "./player-drop";
import { ScopesStrip } from "@/colour/scopes/strip";

/** Preview frames are decoded this much sharper than the screen needs (clips zoomed in, Zoom Punch). */
const DECODE_HEADROOM = 1.25;
/** Scrubbing: how long a video layer may take to reach the hand's time before the frame shows its last one. */
const SCRUB_LAYER_BUDGET_MS = 30;

function usePreviewSize() {
	const canvasSize = useEditor(
		(e) => e.project.getActive()?.settings.canvasSize,
	);

	return {
		width: canvasSize?.width,
		height: canvasSize?.height,
	};
}

function normalizeWheelDelta({
	delta,
	deltaMode,
	pageSize,
}: {
	delta: number;
	deltaMode: number;
	pageSize: number;
}): number {
	if (deltaMode === WheelEvent.DOM_DELTA_LINE) {
		return delta * 16;
	}

	if (deltaMode === WheelEvent.DOM_DELTA_PAGE) {
		return delta * pageSize;
	}

	return delta;
}

export function PreviewPanel({
	overlayControls,
	overlayInstances,
	onOverlayVisibilityChange,
}: {
	overlayControls: PreviewOverlayControl[];
	overlayInstances: PreviewOverlayInstance[];
	onOverlayVisibilityChange: (params: {
		overlayId: string;
		isVisible: boolean;
	}) => void;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [container, setContainer] = useState<HTMLDivElement | null>(null);
	const { isFullscreen, toggleFullscreen } = usePlayerFullscreen();
	// CapCut ⇧⌘F: the player full screen, like its button.
	useActionHandler("player-fullscreen", () => toggleFullscreen(), undefined);
	const handleContainerRef = useCallback((node: HTMLDivElement | null) => {
		containerRef.current = node;
		setContainer(node);
	}, []);
	// A tile dropped on the player goes on the timeline at the playhead (player-drop.tsx).
	const { over: dropOver, dropProps } = usePlayerDrop();

	return (
		<div
			ref={handleContainerRef}
			{...dropProps}
			data-preview-fullscreen={isFullscreen ? "true" : undefined}
			className={cn(
				"panel bg-background flex min-h-0 min-w-0 flex-col",
				isFullscreen ? "fixed inset-0 z-[60]" : "relative size-full rounded-sm border",
			)}
		>
			<PreviewCanvas
				container={container}
				isFullscreen={isFullscreen}
				onToggleFullscreen={toggleFullscreen}
				overlayControls={overlayControls}
				overlayInstances={overlayInstances}
				onOverlayVisibilityChange={onOverlayVisibilityChange}
			/>
			<RenderTreeController />
			{dropOver && <PlayerDropHint />}
		</div>
	);
}

function RenderTreeController() {
	const editor = useEditor();
	const tracks = useEditor(
		(e) => e.timeline.getPreviewTracks() ?? e.scenes.getActiveScene().tracks,
	);
	const mediaAssets = useEditor((e) => e.media.getAssets());
	// Only the background: the project object changes on every zoom/scroll save,
	// which re-ran a deep compare of every track here (296 clips: several ms).
	const background = useEditor(
		(e) => e.project.getActiveOrNull()?.settings.background ?? null,
		["project"],
	);
	const scenes = useEditor((e) => e.scenes.getScenes());
	const proxyVersion = useLayerProxies((s) => s.version);

	const { width, height } = usePreviewSize();

	// Inputs are immutable store snapshots: identity changes exactly when they do.
	// biome-ignore lint/correctness/useExhaustiveDependencies: scenes and the proxy version change the picture though the effect reads them through the editor
	useEffect(() => {
		if (!background) return;

		const duration = editor.timeline.getTotalDuration();
		const renderTree = buildScene({
			// Remotion AI Compositions play as their inner clips; AI layers go to the Remotion overlay.
			tracks: playbackTracks(editor, tracks),
			mediaAssets,
			duration,
			canvasSize: { width, height },
			background,
			isPreview: true,
		});

		editor.renderer.setRenderTree({ renderTree });
	}, [tracks, scenes, mediaAssets, background, width, height, editor, proxyVersion]);

	return null;
}

function PreviewCanvas({
	container,
	isFullscreen,
	onToggleFullscreen,
	overlayControls,
	overlayInstances,
	onOverlayVisibilityChange,
}: {
	container: HTMLElement | null;
	isFullscreen: boolean;
	onToggleFullscreen: () => void;
	overlayControls: PreviewOverlayControl[];
	overlayInstances: PreviewOverlayInstance[];
	onOverlayVisibilityChange: (params: {
		overlayId: string;
		isVisible: boolean;
	}) => void;
}) {
	const canvasMountRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const lastFrameRef = useRef(-1);
	const lastSceneRef = useRef<RootNode | null>(null);
	const renderingRef = useRef(false);
	const incompleteRef = useRef(false);
	const { width: nativeWidth, height: nativeHeight } = usePreviewSize();
	const viewportSize = useContainerSize({ containerRef: viewportRef });
	const editor = useEditor();
	// Settings only (same object across zoom/scroll saves, unlike the project).
	const projectSettings = useEditor(
		(e) => e.project.getActive().settings,
		["project"],
	);
	// The scene is read in the frame loop below, not subscribed to: a subscription re-rendered the whole
	// preview (toolbar, overlays, context menu, source player) on every timeline edit for nothing.
	const viewport = usePreviewViewportState({
		canvasHeight: nativeHeight,
		canvasWidth: nativeWidth,
		viewportHeight: viewportSize.height,
		viewportRef,
		viewportWidth: viewportSize.width,
	});
	const { canPan, panByScreenDelta, scaleZoom } = viewport;

	const renderer = useMemo(() => {
		return new CanvasRenderer({
			width: nativeWidth,
			height: nativeHeight,
			fps: projectSettings.fps,
			capDecodeSize: true,
		});
	}, [nativeWidth, nativeHeight, projectSettings.fps]);

	// Mount the compositor's output canvas directly into the preview. wgpu
	// renders straight into this element, so there is no intermediate copy —
	// the container div owns positioning/styling, the canvas itself fills it.
	useEffect(() => {
		const mount = canvasMountRef.current;
		if (!mount) return;
		const outputCanvas = renderer.getOutputCanvas();
		outputCanvas.style.display = "block";
		outputCanvas.style.width = "100%";
		outputCanvas.style.height = "100%";
		mount.appendChild(outputCanvas);
		return () => {
			if (outputCanvas.parentElement === mount) {
				mount.removeChild(outputCanvas);
			}
		};
	}, [renderer]);

	// Frames are requested only when the picture can change: the playhead moved (seek, playback), the
	// scene changed, another renderer drew into the shared compositor (export, snapshot), or a frame could
	// not be drawn yet. A requestAnimationFrame loop used to run forever: on an idle editor that was a full
	// frame on the main thread 60–120 times a second.
	const wakeRef = useRef<() => void>(() => {});

	// Filmstrip thumbnails decode only while the preview neither plays nor scrubs.
	useEffect(() => {
		const sync = () => setThumbnailsPaused(editor.playback.getIsPlaying() || editor.playback.getIsScrubbing());
		sync();
		const unsubscribe = editor.playback.subscribe(sync);
		return () => {
			unsubscribe();
			setThumbnailsPaused(false);
		};
	}, [editor.playback]);

	// Video frames as sharp as the picture on screen in device pixels (a 4K project in a ~900 px panel: a quarter
	// of the pixels per frame), with headroom for zoomed-in clips; in 1/8 steps so a resize re-decodes rarely, and
	// smaller only once the size has settled.
	const sceneWidth = viewport.sceneWidth;
	const appliedScaleRef = useRef(0);
	const quality = usePlaybackQuality(effectiveQuality);
	useEffect(() => {
		if (!nativeWidth || !sceneWidth) return;
		const scale = previewDecodeScale({
			sceneWidth,
			canvasWidth: nativeWidth,
			devicePixelRatio: window.devicePixelRatio,
			headroom: DECODE_HEADROOM,
		}) * QUALITY_FACTOR[quality];
		const apply = () => {
			appliedScaleRef.current = scale;
			if (renderer.setDecodeScale(scale)) {
				lastFrameRef.current = -1;
				wakeRef.current();
			}
		};
		if (scale >= appliedScaleRef.current) {
			apply();
			return;
		}
		const timer = setTimeout(apply, 400);
		return () => clearTimeout(timer);
	}, [renderer, sceneWidth, nativeWidth, quality]);

	const render = useCallback(() => {
		const renderTree = editor.renderer.getRenderTree();
		if (!renderTree || renderingRef.current) return;

		// The preview axis shows the frame under the pointer on the timeline; the playhead's otherwise.
		const renderTime = Math.min(
			editor.playback.getPreviewTime() ?? editor.playback.getCurrentTime(),
			editor.timeline.getLastFrameTime(),
		);
		const ticksPerFrame = Math.round(
			(TICKS_PER_SECOND * renderer.fps.denominator) / renderer.fps.numerator,
		);
		const frame = Math.floor(renderTime / ticksPerFrame);

		if (
			frame === lastFrameRef.current &&
			renderTree === lastSceneRef.current &&
			// An export draws into the same compositor canvas: once it is done,
			// show the playhead frame again instead of the export's last frame.
			renderer.showsOwnFrame()
		) {
			return;
		}

		renderingRef.current = true;
		lastSceneRef.current = renderTree;
		lastFrameRef.current = frame;
		// Also where the playhead rests (not while scrubbing): Play then starts with the next cut's decoder ready.
		const playing = editor.playback.getIsPlaying();
		if (playing || !editor.playback.getIsScrubbing()) {
			prerollUpcomingClips({ renderer, root: renderTree, time: renderTime, throttle: playing });
		}
		// A still frame (a click, a scrub, a paused edit): a layer still seeking after 30 ms shows its last frame,
		// then the exact frame is drawn when the seek ends. A layer that never showed one waits — nothing stale.
		const stillFrame = !playing;
		renderer
			.render({ node: renderTree, time: renderTime, scrubBudgetMs: stillFrame ? SCRUB_LAYER_BUDGET_MS : undefined })
			.then((rendered) => {
				// Drawn with a layer's last frame: drawn again once its seek is done (the scrub may have stopped there).
				const late = rendered ? renderer.lastFrameLate : null;
				if (late) {
					void late.then(() => {
						lastFrameRef.current = -1;
						wakeRef.current();
					});
				}
				// Skipped while an export holds the compositor: redraw afterwards.
				if (!rendered) lastFrameRef.current = -1;
				// Drawn without a pass whose shader was still compiling (a new transition shows as a cut for a moment):
				// drawn again when that shader is ready (onShaderReady below), not every frame meanwhile.
				incompleteRef.current = rendered && wasmCompositor.lastFrameIncomplete;
				// Its compile may have ended while this frame was drawn: then draw it again right away.
				if (incompleteRef.current && !isWarming()) lastFrameRef.current = -1;
				// Speed tests (perf-core.mjs) count the frames the player really shows; nothing happens unless they ask.
				const stats = (window as { __previewStats?: { frames: number; frame: number; at: number; partial?: number } }).__previewStats;
				if (rendered && stats) {
					stats.frames++;
					stats.frame = frame;
					stats.at = performance.now();
					// a layer still showed its last frame (scrubbing)
					if (late) stats.partial = (stats.partial ?? 0) + 1;
				}
			})
			.catch((error) => console.error("Preview frame failed", error))
			.finally(() => {
				// Never leave the preview frozen after a failed frame.
				renderingRef.current = false;
				// Look again: the playhead or the scene may have changed meanwhile, or the frame was skipped.
				wakeRef.current();
			});
	}, [renderer, editor.renderer, editor.playback, editor.timeline]);

	useEffect(() => {
		let frameRequest = 0;
		let stopped = false;
		const tick = () => {
			frameRequest = 0;
			if (!stopped) render();
		};
		const schedule = () => {
			if (!frameRequest && !stopped) frameRequest = requestAnimationFrame(tick);
		};
		wakeRef.current = schedule;
		schedule();
		const unsubscribers = [
			editor.playback.subscribe(schedule),
			// Playback advances in its own animation frame: draw in that same frame, as the old loop could.
			editor.playback.onUpdate(() => {
				if (frameRequest) {
					cancelAnimationFrame(frameRequest);
					frameRequest = 0;
				}
				tick();
			}),
			editor.renderer.subscribe(schedule),
			editor.timeline.subscribe(schedule),
			editor.playback.onPreviewTime(schedule),
			onCompositorTakeover(schedule),
			// a downloaded font replaced its stand-in: the paused frame shows the real letters
			onFontReady(() => {
				lastFrameRef.current = -1;
				schedule();
			}),
			onShaderReady(() => {
				if (!incompleteRef.current) return;
				lastFrameRef.current = -1;
				schedule();
			}),
		];
		return () => {
			stopped = true;
			if (frameRequest) cancelAnimationFrame(frameRequest);
			for (const unsubscribe of unsubscribers) unsubscribe();
			wakeRef.current = () => {};
		};
	}, [render, editor.playback, editor.renderer, editor.timeline]);

	useEffect(() => {
		const container = viewportRef.current;
		if (!container) return;

		let pendingZoomDelta = 0;
		let pendingPanDeltaX = 0;
		let pendingPanDeltaY = 0;
		let zoomRafId: ReturnType<typeof requestAnimationFrame> | null = null;
		let panRafId: ReturnType<typeof requestAnimationFrame> | null = null;

		const onWheel = (event: WheelEvent) => {
			const normalizedDeltaX = normalizeWheelDelta({
				delta: event.deltaX,
				deltaMode: event.deltaMode,
				pageSize: container.clientWidth,
			});
			const normalizedDeltaY = normalizeWheelDelta({
				delta: event.deltaY,
				deltaMode: event.deltaMode,
				pageSize: container.clientHeight,
			});
			const isZoomGesture = event.ctrlKey || event.metaKey;
			if (isZoomGesture) {
				event.preventDefault();
				pendingZoomDelta += normalizedDeltaY;

				if (zoomRafId === null) {
					zoomRafId = requestAnimationFrame(() => {
						const cappedDelta =
							Math.sign(pendingZoomDelta) *
							Math.min(Math.abs(pendingZoomDelta), 30);
						const zoomFactor = Math.exp(-cappedDelta / 300);

						scaleZoom({ factor: zoomFactor });
						pendingZoomDelta = 0;
						zoomRafId = null;
					});
				}

				return;
			}

			if (!canPan) {
				return;
			}

			if (normalizedDeltaX === 0 && normalizedDeltaY === 0) {
				return;
			}

			event.preventDefault();
			pendingPanDeltaX += normalizedDeltaX;
			pendingPanDeltaY += normalizedDeltaY;

			if (panRafId === null) {
				panRafId = requestAnimationFrame(() => {
					panByScreenDelta({
						deltaX: pendingPanDeltaX,
						deltaY: pendingPanDeltaY,
					});
					pendingPanDeltaX = 0;
					pendingPanDeltaY = 0;
					panRafId = null;
				});
			}
		};

		container.addEventListener("wheel", onWheel, {
			capture: true,
			passive: false,
		});

		return () => {
			container.removeEventListener("wheel", onWheel, {
				capture: true,
			});
			if (zoomRafId !== null) {
				cancelAnimationFrame(zoomRafId);
			}
			if (panRafId !== null) {
				cancelAnimationFrame(panRafId);
			}
		};
	}, [canPan, panByScreenDelta, scaleZoom]);

	return (
		<PreviewViewportProvider value={viewport}>
			<div className="flex size-full min-h-0 min-w-0 flex-col">
				{/* Covering the window (player full screen), the title row is the window's title bar: room for the
				    traffic lights on the left, and it drags the window (studio-titlebar). In the editor the row is gone
				    (design review 05.11: «Player» over the player only took height from the picture): the name stays for
				    VoiceOver, ≡ moves to the end of the player's bar. */}
				{isFullscreen ? (
					<div className="studio-titlebar flex h-9 shrink-0 items-center justify-between px-3 text-sm font-medium" data-player-title>
						<PlayerTitle />
					</div>
				) : (
					<div className="sr-only" data-player-title>
						<PlayerTitle />
					</div>
				)}
				{/* A press on the player's empty margin (outside the frame's own area) deselects, as beside the frame. */}
				<div
					className="relative flex min-h-0 min-w-0 flex-1 p-1 pb-0"
					onPointerDown={(event) => {
						if (event.target === event.currentTarget && event.button === 0) editor.selection.clearSelection();
					}}
				>
					<ContextMenu>
						<ContextMenuTrigger asChild>
							<div
								ref={viewportRef}
								className="relative flex size-full min-h-0 min-w-0 items-center justify-center overflow-hidden"
							>
							<div
								ref={canvasMountRef}
								data-preview-frame=""
								className="absolute block border"
								style={{
									left: viewport.sceneLeft,
									top: viewport.sceneTop,
									width: viewport.sceneWidth,
									height: viewport.sceneHeight,
									background:
										projectSettings.background.type === "blur"
											? "transparent"
											: projectSettings.background.color,
								}}
							/>
								<PreviewOverlayLayer
									instances={overlayInstances}
									plane="under-interaction"
								/>
								<PreviewInteractionOverlay />
								<PreviewOverlayLayer
									instances={overlayInstances}
									plane="over-interaction"
								/>
							</div>
						</ContextMenuTrigger>
						<PreviewContextMenu
							onToggleFullscreen={onToggleFullscreen}
							container={container}
							overlayControls={overlayControls}
							onOverlayVisibilityChange={onOverlayVisibilityChange}
						/>
					</ContextMenu>
					{/* A media item clicked in Media plays here, over the timeline's picture. */}
					<SourcePlayer />
				</div>
				{/* The colour scopes (src/colour/scopes): a strip between the picture and the bar, nothing while closed. */}
				<ScopesStrip />
				<PreviewToolbar isFullscreen={isFullscreen} onToggleFullscreen={onToggleFullscreen} />
			</div>
		</PreviewViewportProvider>
	);
}

/** CapCut: «Player», and «Player-Timeline 02» once the project has several timelines. */
/** «Player» (VoiceOver, full screen). One project, one timeline (14.11): no timeline's name after it, no timelines menu. */
function PlayerTitle() {
	return <span data-player-title-text="">{t("Player")}</span>;
}
