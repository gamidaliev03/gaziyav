"use client";

import { rememberAttributes } from "./attributes-clipboard";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { t as translate } from "@/i18n";
import { useTimelineStore } from "@/timeline/timeline-store";
import { useActionHandler } from "@/actions/use-action-handler";
import { useEditor } from "@/editor/use-editor";
import { useElementSelection } from "@/timeline/hooks/element/use-element-selection";
import {
	addMediaTime,
	maxMediaTime,
	mediaTime,
	mediaTimeFromSeconds,
	minMediaTime,
	subMediaTime,
	TICKS_PER_SECOND,
	ZERO_MEDIA_TIME,
} from "@/wasm";
import { useKeyframeSelection } from "@/timeline/hooks/element/use-keyframe-selection";
import { selectAllKeyframesStep } from "./keyframe-scope";
import { getElementsAtTime, hasMediaId } from "@/timeline";
import { cancelInteraction } from "@/editor/cancel-interaction";
import { splitTargets } from "@/timeline/split-targets";
import { invokeAction } from "@/actions";
import { canToggleSourceAudio } from "@/timeline/audio-separation";
import { withoutLockedClips } from "@/timeline/track-lock";
import {
	activateScope,
	clearActiveScope,
	type ScopeEntry,
} from "@/selection/scope";
import { useCommittedRef } from "@/hooks/use-committed-ref";
import { useHotkeyActions } from "./use-hotkey-actions";
import {
	BULK_DELETE_NOTICE_MIN,
	deleteLiveSelection,
} from "./delete-selection";
import type { EditorCore } from "@/core";
import { canJoinCut, findCut, findNearestCut, joinCut, removeTransition, useSelectedCut } from "@/transitions/commands";

function notifyBulkDelete({ editor, count, linked = 0 }: { editor: EditorCore; count: number; linked?: number }) {
	// Linkage took sound, captions or layers along: said, with Undo (it went silently before — check-edit).
	if (count < BULK_DELETE_NOTICE_MIN && linked === 0) return;
	const message = linked > 0
		? count === 1
			? translate("Deleted the clip and {m} linked (sound, captions, layers)", { m: linked })
			: translate("Deleted {n} clips and {m} linked (sound, captions, layers)", { n: count, m: linked })
		: translate("Deleted {n} clips", { n: count });
	toast(message, {
		id: "bulk-delete",
		action: { label: translate("Undo"), onClick: () => editor.command.undo() },
	});
}

/** Every clip on the open timeline: how many a step took with it beyond the selection. */
export function countClips(editor: EditorCore): number {
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	if (!tracks) return 0;
	return [...tracks.overlay, tracks.main, ...tracks.audio].reduce((n, track) => n + track.elements.length, 0);
}

export function useEditorActions() {
	const editor = useEditor();
	const { selectedElements, setElementSelection } = useElementSelection();
	const { selectedKeyframes, clearKeyframeSelection } = useKeyframeSelection();
	const selectedMaskPointSelection = useEditor((e) =>
		e.selection.getSelectedMaskPointSelection(),
	);
	const toggleSnapping = useTimelineStore((s) => s.toggleSnapping);
	const toggleRippleEditing = useTimelineStore((s) => s.toggleRippleEditing);
	const hasTimelineSelection =
		selectedElements.length > 0 ||
		selectedKeyframes.length > 0 ||
		selectedMaskPointSelection !== null;
	const hasTimelineSelectionRef = useCommittedRef(hasTimelineSelection);
	const clearTimelineSelectionRef = useCommittedRef(() => {
		editor.selection.clearSelection();
	});
	const clearTimelineActiveSelectionRef = useCommittedRef(() => {
		editor.selection.clearMostSpecificSelection();
	});
	const [timelineScope] = useState<ScopeEntry>(() => ({
		hasSelection: () => hasTimelineSelectionRef.current,
		clear: () => {
			clearTimelineSelectionRef.current();
		},
		clearActive: () => {
			clearTimelineActiveSelectionRef.current();
		},
	}));

	useEffect(() => {
		if (!hasTimelineSelection) {
			return;
		}

		return activateScope({ entry: timelineScope });
	}, [hasTimelineSelection, timelineScope]);

	useHotkeyActions();

	useActionHandler(
		"stop-playback",
		() => {
			if (editor.playback.getIsPlaying()) {
				editor.playback.toggle();
			}
			editor.playback.seek({ time: ZERO_MEDIA_TIME });
		},
		undefined,
	);

	useActionHandler(
		"seek-forward",
		(args) => {
			const seconds = args?.seconds ?? 1;
			const delta = mediaTimeFromSeconds({ seconds });
			editor.playback.seek({
				time: minMediaTime({
					a: editor.timeline.getTotalDuration(),
					b: addMediaTime({
						a: editor.playback.getCurrentTime(),
						b: delta,
					}),
				}),
			});
		},
		undefined,
	);

	useActionHandler(
		"seek-backward",
		(args) => {
			const seconds = args?.seconds ?? 1;
			const delta = mediaTimeFromSeconds({ seconds });
			editor.playback.seek({
				time: maxMediaTime({
					a: ZERO_MEDIA_TIME,
					b: subMediaTime({
						a: editor.playback.getCurrentTime(),
						b: delta,
					}),
				}),
			});
		},
		undefined,
	);

	useActionHandler(
		"frame-step-forward",
		() => {
			const fps = editor.project.getActive().settings.fps;
			const ticksPerFrame = mediaTime({
				ticks: Math.round(
					(TICKS_PER_SECOND * fps.denominator) / fps.numerator,
				),
			});
			editor.playback.seek({
				time: minMediaTime({
					a: editor.timeline.getTotalDuration(),
					b: addMediaTime({
						a: editor.playback.getCurrentTime(),
						b: ticksPerFrame,
					}),
				}),
			});
		},
		undefined,
	);

	useActionHandler(
		"frame-step-backward",
		() => {
			const fps = editor.project.getActive().settings.fps;
			const ticksPerFrame = mediaTime({
				ticks: Math.round(
					(TICKS_PER_SECOND * fps.denominator) / fps.numerator,
				),
			});
			editor.playback.seek({
				time: maxMediaTime({
					a: ZERO_MEDIA_TIME,
					b: subMediaTime({
						a: editor.playback.getCurrentTime(),
						b: ticksPerFrame,
					}),
				}),
			});
		},
		undefined,
	);

	useActionHandler(
		"jump-forward",
		(args) => {
			const seconds = args?.seconds ?? 5;
			const delta = mediaTimeFromSeconds({ seconds });
			editor.playback.seek({
				time: minMediaTime({
					a: editor.timeline.getTotalDuration(),
					b: addMediaTime({
						a: editor.playback.getCurrentTime(),
						b: delta,
					}),
				}),
			});
		},
		undefined,
	);

	useActionHandler(
		"jump-backward",
		(args) => {
			const seconds = args?.seconds ?? 5;
			const delta = mediaTimeFromSeconds({ seconds });
			editor.playback.seek({
				time: maxMediaTime({
					a: ZERO_MEDIA_TIME,
					b: subMediaTime({
						a: editor.playback.getCurrentTime(),
						b: delta,
					}),
				}),
			});
		},
		undefined,
	);

	useActionHandler(
		"goto-start",
		() => {
			editor.playback.seek({ time: ZERO_MEDIA_TIME });
		},
		undefined,
	);

	useActionHandler(
		"goto-end",
		() => {
			// On a frame: a timeline ending between frames (a sound 5.0416 s long, an older project) put the playhead there.
			const duration = editor.timeline.getTotalDuration();
			const fps = editor.project.getActive().settings.fps;
			const perFrame = (TICKS_PER_SECOND * fps.denominator) / fps.numerator;
			editor.playback.seek({ time: mediaTime({ ticks: Math.round(Math.floor(duration / perFrame + 1e-9) * perFrame) }) });
		},
		undefined,
	);

	useActionHandler(
		"split",
		() => {
			const currentTime = editor.playback.getCurrentTime();
			// timeline/split-targets.ts: the selected clips under the playhead, or with nothing selected the main track's
			// clip there (its linked items stay with their piece); every track at once is ⇧⌘B. Locked tracks never.
			const elementsToSplit = splitTargets({ tracks: editor.scenes.getActiveScene().tracks, time: currentTime, selected: selectedElements, all: false });

			if (elementsToSplit.length === 0) return;

			editor.timeline.splitElements({
				elements: elementsToSplit,
				splitTime: currentTime,
			});
		},
		undefined,
	);

	useActionHandler(
		"delete-selected",
		() => {
			// The playhead parked exactly between two halves of one clip (nothing selected): ⌫ cancels the split — the way a
			// person means it («ставлю плейхед на середину и жму Delete»), without having to pick the cut first.
			if (editor.selection.getActiveSelectionKind() === null) {
				// 0.05 s: snapping lands the playhead exactly on a cut; this much grace covers a hand-placed one.
				const near = findNearestCut(editor.playback.getCurrentTime());
				if (near && Math.abs(near.time - editor.playback.getCurrentTime()) <= 6000 && canJoinCut(near)) {
					joinCut(near);
					useSelectedCut.getState().setCut(null);
					return;
				}
			}
			// A clicked transition (it let go of the clips): ⌫ / Delete take it off the cut, as the inspector's button does.
			const cut = useSelectedCut.getState().cut;
			if (cut && editor.selection.getActiveSelectionKind() === null) {
				const info = findCut(cut);
				// A transition: it comes off. Two halves of one clip: the cut goes (the clip is whole again). Either way ⌫
				// takes back the cut and nothing else — the clips stay where they are.
				if (info?.transition) removeTransition(cut);
				else if (info) joinCut(cut);
				useSelectedCut.getState().setCut(null);
				return;
			}
			switch (editor.selection.getActiveSelectionKind()) {
				case "mask-points":
					if (!selectedMaskPointSelection) {
						return;
					}
					editor.timeline.deleteFreeformPathMaskPoints({
						trackId: selectedMaskPointSelection.trackId,
						elementId: selectedMaskPointSelection.elementId,
						maskId: selectedMaskPointSelection.maskId,
						pointIds: selectedMaskPointSelection.pointIds,
					});
					return;
				case "keyframes":
					if (selectedKeyframes.length === 0) {
						return;
					}
					editor.timeline.removeKeyframes({ keyframes: selectedKeyframes });
					clearKeyframeSelection();
					return;
				case "elements": {
					const before = countClips(editor);
					const count = deleteLiveSelection({ editor });
					notifyBulkDelete({ editor, count, linked: Math.max(0, before - countClips(editor) - count) });
					return;
				}
				default:
					return;
			}
		},
		undefined,
	);

	useActionHandler(
		"toggle-source-audio",
		() => {
			if (selectedElements.length !== 1) {
				return;
			}

			const selectedElement = editor.timeline.getElementsWithTracks({
				elements: selectedElements,
			})[0];
			if (!selectedElement) {
				return;
			}

			const mediaAsset = (() => {
				const { element } = selectedElement;
				if (!hasMediaId(element)) {
					return null;
				}

				return (
					editor.media
						.getAssets()
						.find((asset) => asset.id === element.mediaId) ?? null
				);
			})();
			if (!canToggleSourceAudio(selectedElement.element, mediaAsset)) {
				return;
			}

			editor.timeline.toggleSourceAudioSeparation({
				trackId: selectedElement.track.id,
				elementId: selectedElement.element.id,
			});
		},
		undefined,
	);

	useActionHandler(
		"select-all",
		() => {
			// ⌘A while working in a left panel (Media, Audio…) is not about the timeline: it selected every clip, and the
			// next ⌫ wiped the whole edit.
			if (document.activeElement?.closest?.("[data-assets-panel]")) return;
			// Keys selected: ⌘A selects keys — the parameter's, then (again) the clip's — not every clip.
			const selectedKeys = editor.selection.getSelectedKeyframes();
			if (selectedKeys.length > 0) {
				const owners = [...new Map(selectedKeys.map((ref) => [ref.elementId, { trackId: ref.trackId, elementId: ref.elementId }])).values()];
				const clips = editor.timeline
					.getElementsWithTracks({ elements: owners })
					.map(({ track, element }) => ({ trackId: track.id, element }));
				const keyframes = selectAllKeyframesStep({ clips, selected: selectedKeys });
				if (keyframes) {
					editor.selection.setSelectedKeyframes({ keyframes });
					return;
				}
			}
			const scene = editor.scenes.getActiveScene();
			const allElements = [
				...scene.tracks.overlay,
				scene.tracks.main,
				...scene.tracks.audio,
			].flatMap((track) =>
				track.elements.map((element) => ({
					trackId: track.id,
					elementId: element.id,
				})),
			);
			setElementSelection({ elements: allElements });
		},
		undefined,
	);

	useActionHandler(
		"cancel-interaction",
		() => {
			if (!cancelInteraction()) {
				invokeAction("deselect-all");
			}
		},
		undefined,
	);

	useActionHandler(
		"deselect-all",
		() => {
			if (!clearActiveScope() && !editor.selection.clearMostSpecificSelection()) {
				// Nothing else selected: a clicked transition is deselected too (CapCut's Esc clears everything)
				useSelectedCut.getState().setCut(null);
			}
		},
		undefined,
	);

	useActionHandler(
		"duplicate-selected",
		() => {
			// Nothing selected: no empty undo step.
			if (selectedElements.length === 0) return;
			editor.timeline.duplicateElements({
				elements: selectedElements,
			});
		},
		undefined,
	);

	useActionHandler(
		"toggle-elements-muted-selected",
		() => {
			editor.timeline.toggleElementsMuted({ elements: selectedElements });
		},
		undefined,
	);

	useActionHandler(
		"toggle-elements-visibility-selected",
		() => {
			editor.timeline.toggleElementsVisibility({ elements: selectedElements });
		},
		undefined,
	);

	useActionHandler(
		"toggle-bookmark",
		() => {
			editor.scenes.toggleBookmark({ time: editor.playback.getCurrentTime() });
		},
		undefined,
	);

	useActionHandler(
		"copy-selected",
		() => {
			if (!editor.clipboard.copy()) return;
			// The copied clip is also what «Paste Attributes…» (⌥⌘V) takes its look from.
			const [first] = editor.timeline.getElementsWithTracks({ elements: editor.selection.getSelectedElements() });
			if (first) rememberAttributes(first.element);
		},
		undefined,
	);

	useActionHandler(
		"paste-copied",
		() => {
			editor.clipboard.paste({ mode: "insert" });
		},
		undefined,
	);

	useActionHandler(
		"paste-over",
		() => {
			editor.clipboard.paste({ mode: "over" });
		},
		undefined,
	);

	useActionHandler(
		"toggle-snapping",
		(_args, trigger) => {
			toggleSnapping();
			if (trigger === "keypress") {
				const on = useTimelineStore.getState().snappingEnabled;
				toast(on ? "Snapping on" : "Snapping off", { duration: 1200 });
			}
		},
		undefined,
	);

	useActionHandler(
		"toggle-ripple-editing",
		(_args, trigger) => {
			toggleRippleEditing();
			if (trigger === "keypress") {
				const on = useTimelineStore.getState().rippleEditingEnabled;
				toast(
					on
						? "Main track magnet on: deleting and trimming close gaps"
						: "Main track magnet off: gaps stay",
					{ id: "magnet", duration: 1600 },
				);
			}
		},
		undefined,
	);

	useActionHandler(
		"undo",
		() => {
			editor.command.undo();
		},
		undefined,
	);

	useActionHandler(
		"redo",
		() => {
			editor.command.redo();
		},
		undefined,
	);

	// todo: potnetially unify these two actions:
	useActionHandler(
		"remove-media-asset",
		(args) => {
			if (!args) return;
			editor.media.removeMediaAsset({
				projectId: args.projectId,
				id: args.assetId,
			});
		},
		undefined,
	);

	useActionHandler(
		"remove-media-assets",
		(args) => {
			if (!args) return;
			editor.media.removeMediaAssets({
				projectId: args.projectId,
				ids: args.assetIds,
			});
		},
		undefined,
	);
}