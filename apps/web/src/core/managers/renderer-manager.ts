import type { EditorCore } from "@/core";
import { sliceActiveSceneToRange } from "@/in-out/slice";
import { playbackTracks } from "@/montage/compositions";
import type { RootNode } from "@/services/renderer/nodes/root-node";
import type { ExportOptions, ExportResult } from "@/export";
import { CanvasRenderer } from "@/services/renderer/canvas-renderer";
import { VideoCache } from "@/services/video-cache/service";
import { SceneExporter } from "@/services/renderer/scene-exporter";
import { type BuildAudio, BuildExporter, BuildFallback } from "@/export/build/exporter";
import { planBuild } from "@/export/build/plan";
import { buildScene } from "@/services/renderer/scene-builder";
import { waitForNeuralExportQuality } from "@/neural/pending";
import { cloudPause } from "@/content/client/pause";
import { waitForLibraryFiles } from "@/library/export-wait";
import { requireFonts } from "@/fonts/bundled";
import { getElementFontFamilies } from "@/timeline/element-utils";
import { createTimelineAudioBuffer } from "@/media/audio";
import { formatTimecode } from "opencut-wasm";
import { downloadBlob } from "@/utils/browser";
import type { SceneTracks, TimelineElement } from "@/timeline";

type SnapshotResult =
	| { success: true; blob: Blob; filename: string }
	| { success: false; error: string };

export class RendererManager {
	private renderTree: RootNode | null = null;
	private _isDegraded = false;
	private listeners = new Set<() => void>();

	constructor(private editor: EditorCore) {}

	get isDegraded(): boolean {
		return this._isDegraded;
	}

	setDegraded(degraded: boolean): void {
		if (this._isDegraded === degraded) return;
		this._isDegraded = degraded;
		this.notify();
	}

	setRenderTree({ renderTree }: { renderTree: RootNode | null }): void {
		this.renderTree = renderTree;
		this.notify();
	}

	getRenderTree(): RootNode | null {
		return this.renderTree;
	}

	async saveSnapshot(): Promise<{ success: boolean; error?: string }> {
		const snapshot = await this.createSnapshot();
		if (!snapshot.success) {
			return snapshot;
		}

		downloadBlob({ blob: snapshot.blob, filename: snapshot.filename });
		return { success: true };
	}

	async copySnapshot(): Promise<{ success: boolean; error?: string }> {
		if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
			return {
				success: false,
				error: "Clipboard image copy is not supported in this browser",
			};
		}

		const snapshot = await this.createSnapshot();
		if (!snapshot.success) {
			return snapshot;
		}

		try {
			await navigator.clipboard.write([
				new ClipboardItem({
					[snapshot.blob.type || "image/png"]: snapshot.blob,
				}),
			]);
			return { success: true };
		} catch (error) {
			console.error("Copy snapshot failed:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	private async createSnapshot(): Promise<SnapshotResult> {
		try {
			const renderTree = this.getRenderTree();
			const activeProject = this.editor.project.getActive();

			if (!renderTree || !activeProject) {
				return { success: false, error: "No project or scene to capture" };
			}

			const duration = this.editor.timeline.getTotalDuration();
			if (duration === 0) {
				return { success: false, error: "Project is empty" };
			}

			const { canvasSize, fps } = activeProject.settings;
			const renderTime = Math.min(
				this.editor.playback.getCurrentTime(),
				this.editor.timeline.getLastFrameTime(),
			);

			// Own decoders: the preview's draw frames only as sharp as the panel shows them.
			const renderer = new CanvasRenderer({
				width: canvasSize.width,
				height: canvasSize.height,
				fps,
				videoCache: new VideoCache(),
			});

			const tempCanvas = document.createElement("canvas");
			tempCanvas.width = canvasSize.width;
			tempCanvas.height = canvasSize.height;

			try {
				await renderer.renderToCanvas({
					node: renderTree,
					time: renderTime,
					targetCanvas: tempCanvas,
				});
			} finally {
				renderer.videoCache.clearAll();
			}

			const blob = await new Promise<Blob | null>((resolve) => {
				tempCanvas.toBlob((result) => resolve(result), "image/png");
			});

			if (!blob) {
				return { success: false, error: "Failed to create image" };
			}

			const timecode = formatTimecode({ time: renderTime, rate: fps })!.replace(/:/g, "-");
			const safeName =
				activeProject.metadata.name.replace(/[<>:"/\\|?*]/g, "-").trim() ||
				"snapshot";
			const filename = `${safeName}-${timecode}.png`;

			return { success: true, blob, filename };
		} catch (error) {
			console.error("Snapshot capture failed:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	async exportProject({
		options,
		onProgress,
		onCancel,
	}: {
		options: ExportOptions;
		/** `etaSeconds`: the time left by the measured speed (null: nothing measured yet); absent: not known this way. */
		onProgress?: ({ progress, etaSeconds }: { progress: number; etaSeconds?: number | null }) => void;
		onCancel?: () => boolean;
	}): Promise<ExportResult> {
		const { format, quality, fps, includeAudio } = options;

		try {
			// In→Out first (splits on the real scene), then AI compositions are flattened for rendering.
			const sceneTracks = playbackTracks(
				this.editor,
				options.range ? sliceActiveSceneToRange({ editor: this.editor, range: options.range }) : null,
			);
			const tracks = options.elements
				? onlyElements(sceneTracks, options.elements)
				: options.mainTrackOnly
					? { main: sceneTracks.main, overlay: [], audio: [] }
					: sceneTracks;
			// Text is drawn with its real fonts: a font that comes from the internet is fetched first, and the export stops
			// with a readable error rather than draw its stand-in.
			await requireFonts(getElementFontFamilies({ tracks }));
			// Effects → AI: accurate Remove Background copies still being made are finished first.
			if (!(await waitForNeuralExportQuality(() => !!onCancel?.()))) {
				return { success: false, cancelled: true };
			}
			// Library sounds still in the cloud come down first (offline: it waits and says so; never a missing sound).
			if (!(await waitForLibraryFiles(tracks, () => !!onCancel?.()))) {
				return { success: false, cancelled: true };
			}
			// An editing copy (a smooth H.264 for the preview) gives way to the user's own file: the export renders the
			// original picture and sound, not another generation of compression (or 10 → 8 bits).
			const mediaAssets = await this.editor.media.withExportOriginals(this.editor.media.getAssets());
			const activeProject = this.editor.project.getActive();

			if (!activeProject) {
				return { success: false, error: "No active project" };
			}

			const duration = options.mainTrackOnly
				? sceneTracks.main.elements.reduce(
						(end, element) => Math.max(end, element.startTime + element.duration),
						0,
					)
				: options.range
					? options.range.end - options.range.start
					: this.editor.timeline.getTotalDuration();
			if (duration === 0) {
				return { success: false, error: "Project is empty" };
			}

			const exportFps = fps ?? activeProject.settings.fps;
			// H.264 takes even sizes only (a project saved with an odd custom size failed at Export).
			const set = activeProject.settings.canvasSize;
			const canvasSize = { width: Math.max(2, set.width - (set.width % 2)), height: Math.max(2, set.height - (set.height % 2)) };

			// Export as a build (export/build): the film's stretches, each with a key of everything that can change its
			// pixels, and what the app's work folder already holds of them. Null: this export is made the old way.
			const plan = await planBuild({ options, tracks, mediaAssets, duration, canvasSize, background: activeProject.settings.background, fps: exportFps }).catch(() => null);

			// (held in an object: it is set from inside mixSound and let go of by the build exporter)
			const mix: { buffer: AudioBuffer | null } = { buffer: null };
			/** Mixes the soundtrack; false when the export was cancelled meanwhile. */
			const mixSound = async (): Promise<boolean> => {
				// The soundtrack of a long timeline takes a while to decode and mix: the bar keeps moving (5 → 14 %)
				// and Cancel works during it too (the unfinished mix is dropped).
				// (no time left is said while the sound is mixed: its speed is not measured)
				onProgress?.({ progress: 0.05, etaSeconds: null });
				const mixing = createTimelineAudioBuffer({
					tracks,
					mediaAssets,
					duration,
					normalize: options.normalizeLoudness ?? false,
					targetLufs: options.targetLufs,
				});
				void mixing.catch(() => {});
				let cancelledWhileMixing = false;
				const started = performance.now();
				let watch: ReturnType<typeof setInterval> | undefined;
				const cancelled = new Promise<null>((resolve) => {
					watch = setInterval(() => {
						if (onCancel?.()) {
							cancelledWhileMixing = true;
							resolve(null);
							return;
						}
						const seconds = (performance.now() - started) / 1000;
						onProgress?.({ progress: 0.05 + 0.09 * (1 - Math.exp(-seconds / 20)), etaSeconds: null });
					}, 200);
				});
				try {
					mix.buffer = await Promise.race([mixing, cancelled]);
				} finally {
					clearInterval(watch);
				}
				return !cancelledWhileMixing;
			};
			// The mix an earlier export of the same sound encoded is used as it is: nothing is mixed or encoded again.
			let keptSound: BuildAudio | null = null;
			if (includeAudio) {
				if (plan?.audioKey && plan.kept.has(plan.audioKey)) {
					const entry = await plan.cache.get(plan.audioKey);
					if (entry?.head.kind === "audio" && entry.packets.length > 0) keptSound = { key: plan.audioKey, head: entry.head, packets: entry.packets };
				}
				if (!keptSound && !(await mixSound())) return { success: false, cancelled: true };
			}

			const scene = buildScene({
				tracks,
				mediaAssets,
				duration,
				canvasSize,
				background: activeProject.settings.background,
			});

			/** Runs one exporter to its end, with the bar, the time left and Cancel. */
			const run = async (exporter: SceneExporter | BuildExporter): Promise<ExportResult> => {
				let last = 0;
				exporter.on("progress", (progress: number) => {
					last = includeAudio ? 0.15 + progress * 0.85 : progress;
					onProgress?.({ progress: last });
				});
				exporter.on("eta", (seconds: number | null) => onProgress?.({ progress: last, etaSeconds: seconds }));
				let cancelled = false;
				const cancelInterval = setInterval(() => {
					if (onCancel?.()) {
						cancelled = true;
						exporter.cancel();
					}
				}, 100);
				try {
					const made = await exporter.export({ rootNode: scene });
					if (cancelled) return { success: false, cancelled: true };
					if (!made) return { success: false, error: "Export failed to produce buffer" };
					return made instanceof ArrayBuffer ? { success: true, buffer: made } : { success: true, bytes: made.bytes };
				} finally {
					clearInterval(cancelInterval);
				}
			};

			if (plan && (format === "mp4" || format === "mov")) {
				const sound: BuildAudio | null = keptSound ?? (mix.buffer && plan.audioKey ? { key: plan.audioKey, buffer: mix.buffer } : null);
				// (the mix is the exporter's from here: it lets go of it once it is encoded — an hour of it is 1.4 GB; made the
				// old way after all, the sound is mixed again)
				const hadSound = !!mix.buffer;
				if (sound && "buffer" in sound) mix.buffer = null;
				const exporter = new BuildExporter({
					width: canvasSize.width,
					height: canvasSize.height,
					outputSize: options.size,
					cover: options.cover,
					master: options.master,
					bitrate: options.bitrate,
					toFile: options.toFile,
					hardwareEncoding: options.hardwareEncoding,
					fps: exportFps,
					format,
					quality,
					audio: sound,
					segments: plan.segments,
					cache: plan.cache,
					kept: plan.kept,
				});
				try {
					const result = await run(exporter);
					(globalThis as { __exportBuild?: unknown }).__exportBuild = { ...exporter.report, at: Date.now() };
					return result;
				} catch (error) {
					// Anything this way of exporting can't do is done the old way, from the start of the file.
					if (!(error instanceof BuildFallback)) throw error;
					console.warn(`[export] rendered the old way: ${error.message}`);
					(globalThis as { __exportBuild?: unknown }).__exportBuild = { fallback: error.message, at: Date.now() };
					await options.toFile?.reset?.();
					if (includeAudio && (keptSound || hadSound) && !mix.buffer && !(await mixSound())) return { success: false, cancelled: true };
				}
			}

			return await run(
				new SceneExporter({
					width: canvasSize.width,
					height: canvasSize.height,
					outputSize: options.size,
					cover: options.cover,
					master: options.master,
					bitrate: options.bitrate,
					toFile: options.toFile,
					hardwareEncoding: options.hardwareEncoding,
					fps: exportFps,
					format,
					quality,
					shouldIncludeAudio: !!includeAudio,
					audioBuffer: mix.buffer || undefined,
				}),
			);
		} catch (error) {
			console.error("Export failed:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : typeof error === "string" && error ? error : "Unknown export error",
			};
		} finally {
			// Background downloads of the content cloud may go on again.
			cloudPause("export", false);
		}
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => {
			fn();
		});
	}
}

/** Export selected clips: the scene with only these elements; `plain` drops effects, masks and animations (CapCut's
 * «Include all changes» off keeps position, size and speed). */
function onlyElements(tracks: SceneTracks, { ids, plain }: { ids: string[]; plain?: boolean }): SceneTracks {
	const keep = new Set(ids);
	const pick = <T extends { elements: readonly TimelineElement[] }>(track: T): T => ({
		...track,
		elements: track.elements
			.filter((element) => keep.has(element.id))
			.map((element) => (plain ? ({ ...element, effects: [], masks: [], animations: undefined } as TimelineElement) : element)),
	});
	return { ...tracks, main: pick(tracks.main), overlay: tracks.overlay.map(pick), audio: tracks.audio.map(pick) } as SceneTracks;
}
