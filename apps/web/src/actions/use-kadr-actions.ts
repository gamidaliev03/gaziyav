"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useActionHandler } from "@/actions/use-action-handler";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { useShellStore } from "@/components/editor/shell-store";
import { useEditor } from "@/editor/use-editor";
import { t as translate } from "@/i18n";
import { useLoopStore } from "@/preview/loop-store";
import { resolveInOutRange, useInOutStore } from "@/in-out/store";
import { getEditorPanels } from "@/keyboard/navigation";
import { revealInspectorSection } from "@/components/editor/panels/properties/reveal";
import { closeComposition, isComposition, openComposition } from "@/montage/compositions";
import { useStudioStore } from "@/studio/client/studio-store";
import { DEFAULTS } from "@/timeline/defaults";
import { buildTextElement } from "@/timeline/element-utils";
import { useElementSelection } from "@/timeline/hooks/element/use-element-selection";
import type { ElementRef, TimelineElement } from "@/timeline/types";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";
import { getElementsUnderPlayhead, listTracks } from "./timeline-edits";
import { liftOrExtractRange } from "@/timeline/gaps";

const TITLE_SECONDS = 3;

/**
 * ⌘R (Kadr / Premiere «Speed/Duration…»): the Speed group of the clip's tab in view and its value selected, so
 * typing «2» ↩ sets 2×. It only switched the inspector tab: Speed sits below the fold of that tab, nothing moved.
 * The inspector follows a new selection a render later, hence the retries.
 */
function revealSpeedField(attempt = 0): void {
	const retry = () => {
		if (attempt < 12) requestAnimationFrame(() => revealSpeedField(attempt + 1));
	};
	const group = document.querySelector<HTMLElement>('[data-inspector-group="speed"]');
	if (!group) return retry();
	group.querySelector<HTMLButtonElement>('button[aria-label^="Expand"]')?.click();
	const input = group.querySelector<HTMLInputElement>('input[type="text"], input:not([type])');
	if (!input) return retry();
	group.scrollIntoView({ block: "nearest" });
	input.focus({ preventScroll: true });
	input.select();
}

/** Kadr's command table (kadr-port-spec §A10) for everything OpenCut's engine can do. */
export function useKadrActions() {
	const editor = useEditor();
	const { selectedElements, setElementSelection } = useElementSelection();
	const followRef = useRef(false);

	const menu = (command: string) => {
		const studioMenu = (window as unknown as { __studioMenu?: (cmd: string) => boolean })
			.__studioMenu;
		studioMenu?.(command);
	};

	/** Selected clips, or the topmost clip under the playhead. */
	const targetElements = (): Array<{ trackId: string; element: TimelineElement }> => {
		const refs: ElementRef[] =
			selectedElements.length > 0
				? selectedElements
				: getElementsUnderPlayhead({
						tracks: editor.scenes.getActiveScene().tracks,
						time: editor.playback.getCurrentTime(),
					}).slice(0, 1);
		return editor.timeline
			.getElementsWithTracks({ elements: refs })
			.map(({ track, element }) => ({ trackId: track.id, element }));
	};

	// --- ; Lift / ' Extract -------------------------------------------------------
	const liftOrExtract = (closeGap: boolean) => {
		const { inPoint, outPoint } = useInOutStore.getState();
		const range = resolveInOutRange({
			inPoint,
			outPoint,
			duration: editor.timeline.getTotalDuration(),
		});
		if (!range) {
			toast.info("Mark In (I) and Out (O) first");
			return;
		}
		// Lift on the magnetic main row leaves a gap clip of the same length (blind3 F6: it was refused); Extract closes it.
		liftOrExtractRange({ editor, range, closeGap });
		useInOutStore.getState().clear();
		editor.playback.seek({ time: mediaTime({ ticks: Math.round(range.start) }) });
	};
	useActionHandler("lift-in-out", () => liftOrExtract(false), undefined);
	useActionHandler("extract-in-out", () => liftOrExtract(true), undefined);

	// --- A / ⇧A: select forward / backward from the playhead ------------------------
	const selectFromPlayhead = (forward: boolean) => {
		const time = editor.playback.getCurrentTime();
		const refs: ElementRef[] = [];
		for (const track of listTracks(editor.scenes.getActiveScene().tracks)) {
			for (const element of track.elements) {
				const end = element.startTime + element.duration;
				if (forward ? end > time : element.startTime < time) {
					refs.push({ trackId: track.id, elementId: element.id });
				}
			}
		}
		setElementSelection({ elements: refs });
	};
	useActionHandler("select-forward", () => selectFromPlayhead(true), undefined);
	useActionHandler("select-backward", () => selectFromPlayhead(false), undefined);

	// --- ⌥↑ / ⌥↓: move clips to the next track of the same kind ---------------------
	const moveTrack = (step: -1 | 1) => {
		if (selectedElements.length === 0) return;
		const tracks = listTracks(editor.scenes.getActiveScene().tracks);
		const moving = new Set(selectedElements.map((ref) => ref.elementId));
		const moves = [];
		for (const { track, element } of editor.timeline.getElementsWithTracks({
			elements: selectedElements,
		})) {
			const from = tracks.findIndex((t) => t.id === track.id);
			let target = null;
			for (let index = from + step; index >= 0 && index < tracks.length; index += step) {
				const candidate = tracks[index];
				if (candidate.type !== track.type) continue;
				const end = element.startTime + element.duration;
				const blocked = candidate.elements.some(
					(other) =>
						!moving.has(other.id) &&
						element.startTime < other.startTime + other.duration &&
						end > other.startTime,
				);
				if (!blocked) {
					target = candidate;
					break;
				}
			}
			if (!target) {
				toast.info(step < 0 ? "No free track above" : "No free track below");
				return;
			}
			moves.push({
				sourceTrackId: track.id,
				targetTrackId: target.id,
				elementId: element.id,
				newStartTime: element.startTime,
			});
		}
		editor.timeline.moveElements({ moves, createTracks: [] });
	};
	useActionHandler("move-to-track-above", () => moveTrack(-1), undefined);
	useActionHandler("move-to-track-below", () => moveTrack(1), undefined);

	// --- ⌘⌥T title, F match frame, ⌘R speed ---------------------------------------
	useActionHandler(
		"add-title",
		() => {
			if (!editor.project.getActiveOrNull()) return;
			const element = buildTextElement({
				raw: {
					...DEFAULTS.text.element,
					name: "Title",
					duration: mediaTime({ ticks: TITLE_SECONDS * TICKS_PER_SECOND }),
				},
				startTime: editor.playback.getCurrentTime(),
			});
			editor.timeline.insertElement({ element, placement: { mode: "auto" } });
		},
		undefined,
	);
	useActionHandler(
		"match-frame",
		() => {
			const media = targetElements().find(
				({ element }) => "mediaId" in element && typeof element.mediaId === "string",
			);
			if (!media || !("mediaId" in media.element)) {
				toast.info("No media clip under the playhead");
				return;
			}
			useAssetsPanelStore.getState().setActiveTab("media");
			useAssetsPanelStore.getState().requestRevealMedia(String(media.element.mediaId));
		},
		undefined,
	);
	useActionHandler(
		"speed-duration",
		() => {
			const target = targetElements().find(
				({ element }) => element.type === "video" || element.type === "audio",
			);
			if (!target) {
				toast.info("Select a video or audio clip");
				return;
			}
			setElementSelection({
				elements: [{ trackId: target.trackId, elementId: target.element.id }],
			});
			// ⌘R: the clip's Speed section in the one-list inspector — unfolded, scrolled to and lit (reveal.ts), its field
			// focused; the tab it used to set no longer exists
			revealInspectorSection("speed", { trackId: target.trackId, elementId: target.element.id });
			revealSpeedField();
		},
		undefined,
	);

	// --- Loop playback / selection follows playhead (toggles) -------------------------
	useActionHandler(
		"toggle-loop",
		() => {
			const loop = useLoopStore.getState().toggleLoop();
			toast(translate(loop ? "Loop playback on" : "Loop playback off"), { duration: 1200 });
		},
		undefined,
	);
	useActionHandler(
		"toggle-follow-select",
		() => {
			followRef.current = !followRef.current;
			toast(
				followRef.current ? "Selection follows the playhead" : "Selection stays put",
				{ duration: 1200 },
			);
		},
		undefined,
	);
	useEffect(() => {
		const loopStart = () => {
			const { inPoint, outPoint } = useInOutStore.getState();
			return resolveInOutRange({
				inPoint,
				outPoint,
				duration: editor.timeline.getTotalDuration(),
			});
		};
		const offUpdate = editor.playback.onUpdate((time) => {
			if (!useLoopStore.getState().loop) return;
			const range = loopStart();
			if (range && time >= range.end) {
				editor.playback.seek({ time: mediaTime({ ticks: Math.round(range.start) }) });
			}
		});
		const offState = editor.playback.subscribe(() => {
			if (!useLoopStore.getState().loop || editor.playback.getIsPlaying()) return;
			const duration = editor.timeline.getTotalDuration();
			if (duration > 0 && editor.playback.getCurrentTime() >= duration) {
				const range = loopStart();
				editor.playback.seek({
					time: mediaTime({ ticks: Math.round(range?.start ?? 0) }),
				});
				editor.playback.play();
			}
		});
		const offSeek = editor.playback.onSeek((time) => {
			if (!followRef.current || editor.playback.getIsPlaying()) return;
			const [top] = getElementsUnderPlayhead({
				tracks: editor.scenes.getActiveScene().tracks,
				time,
			});
			if (top) editor.selection.setSelectedElements({ elements: [top] });
		});
		return () => {
			offUpdate();
			offState();
			offSeek();
		};
	}, [editor]);

	// --- Tracks, composition, panels, project ----------------------------------------
	useActionHandler("add-video-track", () => void editor.timeline.addTrack({ type: "video" }), undefined);
	useActionHandler("add-audio-track", () => void editor.timeline.addTrack({ type: "audio" }), undefined);
	useActionHandler(
		"enter-composition",
		() => {
			const [ref] = editor.selection.getSelectedElements();
			if (!ref || editor.selection.getSelectedElements().length !== 1) return;
			const [found] = editor.timeline.getElementsWithTracks({ elements: [ref] });
			if (found && isComposition(found.element)) void openComposition(found.element, editor);
		},
		undefined,
	);
	useActionHandler(
		"exit-composition",
		() => {
			if (editor.scenes.getActiveSceneOrNull()?.isMain) return;
			void closeComposition(editor);
		},
		undefined,
	);
	useActionHandler("show-media", () => useAssetsPanelStore.getState().setActiveTab("media"), undefined);
	useActionHandler("show-effects", () => useAssetsPanelStore.getState().setActiveTab("effects"), undefined);
	useActionHandler("show-captions", () => useAssetsPanelStore.getState().setActiveTab("captions"), undefined);
	useActionHandler(
		"show-inspector",
		() => {
			// Leaf panels: assets, preview, properties, timeline.
			const properties = getEditorPanels()[2];
			if (!properties) return;
			if (!properties.hasAttribute("tabindex")) properties.tabIndex = -1;
			properties.focus();
		},
		undefined,
	);
	useActionHandler("project-settings", () => useShellStore.getState().setDialog("settings"), undefined);
	useActionHandler("new-project", () => menu("new-project"), undefined);
	useActionHandler("import-media", () => menu("import"), undefined);
	useActionHandler("show-projects", () => menu("projects"), undefined);
	useActionHandler("close-project", () => menu("projects"), undefined);
	useActionHandler("import-link", () => useStudioStore.getState().setYoutubeOpen(true), undefined);
	useActionHandler(
		"save-project",
		() => {
			void editor.save.flush().then((ok) => {
				// ⌘S also keeps this moment as a version (home → project menu → Restore previous version)
				if (ok) editor.project.backupNow();
				if (ok) toast.success("Saved", { duration: 1200 });
				else toast.error("Couldn't save the project", { description: "Please try again" });
			});
		},
		undefined,
	);
}
