import { useEffect, useReducer, useState, type DragEvent, type RefObject } from "react";
import { toast } from "sonner";
import { useEditor } from "@/editor/use-editor";
import { useCommittedRef } from "@/hooks/use-committed-ref";
import { t } from "@/i18n";
import type { SnapPoint } from "@/timeline/snapping";
import { useTimelineStore } from "@/timeline/timeline-store";
import {
	DragDropController,
	type DragDropConfig,
} from "@/timeline/controllers/drag-drop-controller";
import { TRANSITION_DRAG_MIME } from "@/transitions/components/assets-view";
import type { TimelineDragData } from "@/timeline/drag";
import type { SceneTracks } from "@/timeline";
import { getTracksTopOffset } from "@/timeline/tracks-offset";
import { mainRowBand } from "@/timeline/placement/row-band";

interface UseTimelineDragDropProps {
	containerRef: RefObject<HTMLDivElement | null>;
	headerRef?: RefObject<HTMLElement | null>;
	tracksScrollRef?: RefObject<HTMLDivElement | null>;
	zoomLevel: number;
	onSnapPointChange?: (snapPoint: SnapPoint | null) => void;
}

/** A picture (not a sound) is in the hand: over the main track it goes into the row (rule A). */
function carriesPicture(dragData: TimelineDragData | null, event: DragEvent, assets: ReturnType<DragDropConfig["getMediaAssets"]>): boolean {
	if (dragData) {
		if (dragData.type === "source-file") return dragData.mediaType !== "audio";
		if (dragData.type !== "media") return false;
		const ids = dragData.ids ?? [dragData.id];
		const first = ids.map((id) => assets.find((a) => a.id === id)).find((a) => a && a.type !== "audio");
		return first ? true : dragData.mediaType !== "audio" && ids.length === 1;
	}
	if (!event.dataTransfer?.types?.includes("Files")) return false;
	const types = Array.from(event.dataTransfer.items ?? [], (item) => item.type);
	return !types[0]?.startsWith("audio/");
}

export function useTimelineDragDrop({
	containerRef,
	headerRef,
	tracksScrollRef,
	zoomLevel,
	onSnapPointChange,
}: UseTimelineDragDropProps) {
	const editor = useEditor();

	const config: DragDropConfig = {
		zoomLevel,
		getContainerEl: () => containerRef.current,
		getHeaderEl: () => headerRef?.current ?? null,
		getTracksScrollEl: () => tracksScrollRef?.current ?? null,
		getActiveProjectFps: () => editor.project.getActive()?.settings.fps ?? null,
		getActiveProjectId: () =>
			editor.project.getActiveOrNull()?.metadata.id ?? null,
		getSceneTracks: () => editor.scenes.getActiveScene().tracks,
		getCurrentPlayheadTime: () => editor.playback.getCurrentTime(),
		getMediaAssets: () => editor.media.getAssets(),
		originalSizeOf: (id) => editor.media.getEditingOriginal(id)?.file.size,
		dragSource: editor.timeline.dragSource,
		addMediaAsset: (args) => editor.media.addMediaAsset(args),
		executeCommand: (command) => editor.command.execute({ command }),
		insertElement: (args) => editor.timeline.insertElement(args),
		addClipEffect: (args) => editor.timeline.addClipEffect(args),
		isSnappingEnabled: () => useTimelineStore.getState().snappingEnabled,
		onSnapPointChange,
	};
	const configRef = useCommittedRef(config);
	const [controller] = useState(() => new DragDropController({ configRef }));
	// and bottom bands, the hairline gaps beside it — is the row, never a new track. The event is handed on with the
	// pointer's height moved into the main row's middle, so the controller's own row rule (the cut nearer the cursor,
	// the row's end, 0 for an empty row) decides, and its ghost shows exactly that place.
	const [row] = useState(() => {
		const toRow = (event: DragEvent): DragEvent => {
			const cfg = configRef.current;
			const tracks: SceneTracks | null = editor.scenes.getActiveSceneOrNull()?.tracks ?? null;
			if (!tracks || tracks.main.locked) return event;
			if (!carriesPicture(cfg.dragSource.getActive(), event, cfg.getMediaAssets())) return event;
			const scroll = cfg.getTracksScrollEl();
			const rect = scroll?.getBoundingClientRect() ?? cfg.getContainerEl()?.getBoundingClientRect();
			if (!rect) return event;
			const header = cfg.getHeaderEl()?.getBoundingClientRect().height ?? 0;
			const y = event.clientY - rect.top + (scroll?.scrollTop ?? 0) - header - getTracksTopOffset();
			const band = mainRowBand(tracks);
			if (y < band.top || y >= band.bottom) return event;
			const clientY = event.clientY + (band.middle - y);
			return Object.create(event, { clientY: { value: clientY } }) as DragEvent;
		};
		// Why the drag held over the timeline cannot land there: a browser never sends `drop` where the drop effect is
		// «none», so it is said when the drag ends over the timeline in that state (rule A: never silent).
		// A release over a place that refuses the drop reaches the timeline as `dragleave` first (the HTML drag rules),
		// then `dragend`: the reason is kept through that leave and said on dragend when the leave was the release
		// itself (a few hundred ms); a drag that left the timeline and wandered on says nothing.
		let why: string | null = null;
		let leftAt = Number.POSITIVE_INFINITY;
		const RELEASE_LEAVE_MS = 300;
		const whyNow = (event: DragEvent): string | null => {
			const transition = !configRef.current.dragSource.getActive() && !!event.dataTransfer?.types?.includes(TRANSITION_DRAG_MIME);
			if (transition && !controller.dropCut) return "A transition goes on a cut between two clips";
			if (controller.isForbidden) return "This can't go on the timeline";
			return null;
		};
		return {
			onDragOver: (event: DragEvent) => {
				controller.onDragOver(toRow(event));
				why = whyNow(event);
				leftAt = Number.POSITIVE_INFINITY;
			},
			onDragLeave: (event: DragEvent) => {
				controller.onDragLeave(event);
				if (!controller.isDragOver) leftAt = performance.now();
			},
			takeWhy: () => {
				const said = performance.now() - leftAt <= RELEASE_LEAVE_MS || leftAt === Number.POSITIVE_INFINITY ? why : null;
				why = null;
				leftAt = Number.POSITIVE_INFINITY;
				return said;
			},
			onDrop: (event: DragEvent) => {
				why = null;
				leftAt = Number.POSITIVE_INFINITY;
				// A drop that cannot land says why in one line — never silent (rule A).
				const cfg = configRef.current;
				const dragData = cfg.dragSource.getActive();
				const transition = !dragData && !!event.dataTransfer?.types?.includes(TRANSITION_DRAG_MIME);
				const forbidden = controller.isForbidden;
				const target = controller.dropTarget;
				const cut = controller.dropCut;
				controller.onDrop(toRow(event));
				if (transition && !cut) toast(t("A transition goes on a cut between two clips"));
				else if (forbidden) toast(t("This can't go on the timeline"));
				else if (dragData?.type === "effect" && dragData.applyTo && !target?.targetElement) toast(t("Drop it on a clip"));
				else if (dragData && !target) toast(t("Nothing here can take it"));
			},
		};
	});

	const [, rerender] = useReducer((n: number) => n + 1, 0);
	useEffect(() => controller.subscribe(rerender), [controller]);
	useEffect(() => () => controller.destroy(), [controller]);
	// Whatever takes the drop (a cut marker stops it before the timeline sees it) or wherever the drag is let go, the
	// timeline's ghost and cut bar go: after the drop's own handlers have run (a task later), and on dragend.
	useEffect(() => {
		const reset = () => {
			const said = row.takeWhy();
			if (said) toast(t(said));
			controller.reset();
		};
		const afterDrop = () => setTimeout(reset, 0);
		window.addEventListener("dragend", reset, true);
		window.addEventListener("drop", afterDrop, true);
		return () => {
			window.removeEventListener("dragend", reset, true);
			window.removeEventListener("drop", afterDrop, true);
		};
	}, [controller, row]);

	return {
		isDragOver: controller.isDragOver,
		dropTarget: controller.dropTarget,
		dragElementType: controller.dragElementType,
		dropGhost: controller.dropGhost,
		isDropForbidden: controller.isForbidden,
		dropCut: controller.dropCut,
		dragProps: {
			onDragEnter: controller.onDragEnter,
			onDragOver: row.onDragOver,
			onDragLeave: row.onDragLeave,
			onDrop: row.onDrop,
		},
	};
}
