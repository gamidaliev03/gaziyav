"use client";

import { useEffect, useRef, useState } from "react";
import {
	BULK_DELETE_NOTICE_MIN,
	deleteLiveSelection,
	liveSelectedElements,
} from "./delete-selection";
import { toast } from "sonner";
import { t as translate } from "@/i18n";
import { countClips } from "@/actions/use-editor-actions";
import { splitTargets } from "@/timeline/split-targets";
import { useActionHandler } from "@/actions/use-action-handler";
import { useEditor } from "@/editor/use-editor";
import { useElementSelection } from "@/timeline/hooks/element/use-element-selection";
import { SplitElementsCommand } from "@/commands/timeline/element/split-elements";
import type { EditorCore } from "@/core";
import type { ElementRef } from "@/timeline/types";
import { mediaTime, TICKS_PER_SECOND } from "@/wasm";
import { useInOutStore, resolveInOutRange } from "@/in-out/store";
import { useShellStore } from "@/components/editor/shell-store";
import { focusPanel, focusPanelSearch } from "@/keyboard/navigation";
import { ShuttleController, shuttleStopKey } from "./shuttle";
import { useKadrActions } from "./use-kadr-actions";
import { useCapcutTools } from "./use-capcut-tools";
import { cutSelectedKeyframes } from "./keyframe-scope";
import { useKeyframeActions } from "./use-keyframe-actions";
import { useCapCutActions } from "./use-capcut-actions";
import { TracksEditCommand } from "./tracks-edit-command";
import { isTrackLocked, withoutLockedClips } from "@/timeline/track-lock";
import { appPrefs } from "@/settings/app-prefs";
import {
	findAdjacentEditPoint,
	getElementsUnderPlayhead,
	listTracks,
} from "./timeline-edits";
import { rememberAttributes, useAttributesClipboard } from "./attributes-clipboard";
import { extendEditToPlayhead, trimEdgeByFrames } from "./keyboard-trim";
import type { GroupResizeUpdate, ResizeSide } from "@/timeline/group-resize";
import { trimLoop } from "@/timeline/trim/loop";
import type { TimelineElement } from "@/timeline";
import { FOCUS_TIMECODE_EVENT } from "@/components/editable-timecode";

/** Settings → Edit → «Step forward or back many N frames». */
const largeStepFrames = () => appPrefs().stepFrames;

function getTicksPerFrame(editor: EditorCore): number {
	const fps = editor.project.getActiveOrNull()?.settings.fps;
	if (!fps) return Math.round(TICKS_PER_SECOND / 30);
	return Math.round((TICKS_PER_SECOND * fps.denominator) / fps.numerator);
}

function seekTicks(editor: EditorCore, ticks: number): void {
	const duration = editor.timeline.getTotalDuration();
	// On a frame: J / K / L shuttle in between frames, and ⌘B there cut pieces shorter than a frame.
	const perFrame = getTicksPerFrame(editor);
	const onFrame = Math.round(ticks / perFrame) * perFrame;
	const clamped = Math.max(0, Math.min(duration, onFrame));
	editor.playback.seek({ time: mediaTime({ ticks: clamped }) });
}

function getActiveProjectId(editor: EditorCore): string | null {
	return editor.project.getActiveOrNull()?.metadata.id ?? null;
}

/**
 * Hotkey actions added for the Kadr / CapCut / Final Cut keymaps: shuttle, 10-frame
 * steps, edit points, In/Out marks, split all, ripple trims and deletes, nudge,
 * select under playhead and attribute copy/paste. Every edit is one undo step.
 */
export function useHotkeyActions() {
	const editor = useEditor();
	const { selectedElements, setElementSelection } = useElementSelection();
	const [shuttle] = useState(
		() =>
			new ShuttleController({
				isPlaying: () => editor.playback.getIsPlaying(),
				play: () => editor.playback.play(),
				pause: () => editor.playback.pause(),
				getTime: () => editor.playback.getCurrentTime(),
				seek: (ticks) => seekTicks(editor, ticks),
				getDuration: () => editor.timeline.getTotalDuration(),
				ticksPerSecond: TICKS_PER_SECOND,
				ticksPerFrame: () => getTicksPerFrame(editor),
			}),
	);
	useEffect(() => () => shuttle.dispose(), [shuttle]);
	useKadrActions();
	useKeyframeActions();
	useCapCutActions();
	// K3: every key of the keymap pressed and checked in the running editor — `await window.__gaziyavKeyCheck()` (dev only).
	useEffect(() => {
		if (process.env.NODE_ENV === "production") return;
		const target = window as unknown as { __gaziyavKeyCheck?: (options?: { only?: string[] }) => Promise<unknown> };
		target.__gaziyavKeyCheck = (options) => import("./dev/key-check").then((module) => module.runKeyCheck(options));
		return () => {
			delete target.__gaziyavKeyCheck;
		};
	}, []);
	useCapcutTools();

	const stopAtOutRef = useRef<(() => void) | null>(null);
	useEffect(() => () => stopAtOutRef.current?.(), []);

	const getTargets = (): ElementRef[] => {
		if (selectedElements.length > 0) return selectedElements;
		return getElementsUnderPlayhead({
			tracks: withoutLockedClips(editor.scenes.getActiveScene().tracks),
			time: editor.playback.getCurrentTime(),
		});
	};

	// --- Playback --------------------------------------------------------------
	useActionHandler(
		"toggle-play",
		() => {
			if (shuttle.isShuttling()) {
				shuttle.stop();
				return;
			}
			editor.playback.toggle();
		},
		undefined,
	);
	// K held + L / J: one frame forward / back, the shuttle stopped (Premiere, Final Cut).
	const stepWithStopHeld = (frames: number) => {
		shuttle.stop();
		seekTicks(editor, editor.playback.getCurrentTime() + frames * getTicksPerFrame(editor));
	};
	// (while a picked cut loops — timeline/trim/loop.ts — J and L move the cut a frame: the shuttle stays out)
	useActionHandler("shuttle-forward", () => (trimLoop.on ? undefined : shuttleStopKey.isHeld() ? stepWithStopHeld(1) : shuttle.forward()), undefined);
	useActionHandler("shuttle-backward", () => (trimLoop.on ? undefined : shuttleStopKey.isHeld() ? stepWithStopHeld(-1) : shuttle.backward()), undefined);
	useActionHandler("shuttle-stop", () => shuttle.stop(), undefined);

	useActionHandler(
		"frame-step-forward-large",
		() => {
			seekTicks(
				editor,
				editor.playback.getCurrentTime() +
					largeStepFrames() * getTicksPerFrame(editor),
			);
		},
		undefined,
	);
	useActionHandler(
		"frame-step-backward-large",
		() => {
			seekTicks(
				editor,
				editor.playback.getCurrentTime() -
					largeStepFrames() * getTicksPerFrame(editor),
			);
		},
		undefined,
	);

	const goToEditPoint = (direction: "previous" | "next") => {
		// The playhead lands on the frame nearest a cut: a cut between frames (a sound 5.0416 s long) was found again from
		// that frame, and ↓ stood still (targeted test 05.11). A cut within half a frame of where it is counts as here.
		const tracks = editor.scenes.getActiveScene().tracks;
		const half = getTicksPerFrame(editor) / 2;
		let from = editor.playback.getCurrentTime() as number;
		for (let i = 0; i < 64; i++) {
			const point = findAdjacentEditPoint({ tracks, time: mediaTime({ ticks: Math.round(from) }), direction });
			if (point === null) return;
			if (Math.abs(point - (editor.playback.getCurrentTime() as number)) > half) {
				seekTicks(editor, point);
				return;
			}
			from = direction === "next" ? point + 1 : point - 1;
		}
	};
	useActionHandler("previous-edit", () => goToEditPoint("previous"), undefined);
	useActionHandler("next-edit", () => goToEditPoint("next"), undefined);

	// --- In / Out -------------------------------------------------------------
	useActionHandler(
		"mark-in",
		() => {
			useInOutStore.getState().setIn({
				time: editor.playback.getCurrentTime(),
				projectId: getActiveProjectId(editor),
			});
		},
		undefined,
	);
	useActionHandler(
		"mark-out",
		() => {
			// Out is a frame of the range (Premiere, Final Cut): the range ends after the frame on screen, so I..O lasts
			// (O−I)+1 frames. The stored end is that exclusive edge; at the very end there is no frame to include.
			const now = editor.playback.getCurrentTime();
			const total = editor.timeline.getTotalDuration();
			useInOutStore.getState().setOut({
				time: now < total ? Math.min(now + getTicksPerFrame(editor), total) : now,
				projectId: getActiveProjectId(editor),
			});
		},
		undefined,
	);
	useActionHandler(
		"mark-clip",
		() => {
			const targets = getTargets();
			const found = editor.timeline.getElementsWithTracks({ elements: targets });
			if (found.length === 0) {
				toast.info("Select a clip or put the playhead over one");
				return;
			}
			const start = Math.min(...found.map(({ element }) => element.startTime));
			const end = Math.max(
				...found.map(({ element }) => element.startTime + element.duration),
			);
			useInOutStore
				.getState()
				.setRange({ start, end, projectId: getActiveProjectId(editor) });
		},
		undefined,
	);
	useActionHandler(
		"clear-in-out",
		() => useInOutStore.getState().clear(),
		undefined,
	);
	useActionHandler("clear-in", () => useInOutStore.getState().clearIn(), undefined);
	useActionHandler("clear-out", () => useInOutStore.getState().clearOut(), undefined);
	const goToMark = (mark: "inPoint" | "outPoint") => {
		const time = useInOutStore.getState()[mark];
		if (time === null) {
			toast.info(translate(mark === "inPoint" ? "No In mark (I)" : "No Out mark (O)"));
			return;
		}
		shuttle.stop();
		// ⇧O lands on the Out frame itself, the last frame of the range (the stored end is the edge after it).
		const frame = mark === "outPoint" ? time - getTicksPerFrame(editor) : time;
		seekTicks(editor, Math.max(0, Math.min(frame, editor.timeline.getTotalDuration())));
	};
	useActionHandler("goto-timecode", () => window.dispatchEvent(new Event(FOCUS_TIMECODE_EVENT)), undefined);
	useActionHandler("goto-in", () => goToMark("inPoint"), undefined);
	useActionHandler("goto-out", () => goToMark("outPoint"), undefined);
	useActionHandler(
		"play-in-to-out",
		() => {
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
			shuttle.stop();
			stopAtOutRef.current?.();
			seekTicks(editor, range.start);
			editor.playback.play();
			const unsubscribe = editor.playback.onUpdate((time) => {
				if (time >= range.end) {
					stop();
					editor.playback.pause();
					seekTicks(editor, range.end);
				}
			});
			const unsubscribeState = editor.playback.subscribe(() => {
				if (!editor.playback.getIsPlaying()) stop();
			});
			function stop() {
				unsubscribe();
				unsubscribeState();
				stopAtOutRef.current = null;
			}
			stopAtOutRef.current = stop;
		},
		undefined,
	);

	// --- Editing ----------------------------------------------------------------
	useActionHandler(
		"split-all",
		() => {
			const time = editor.playback.getCurrentTime();
			const targets = splitTargets({ tracks: editor.scenes.getActiveScene().tracks, time, selected: [], all: true });
			if (targets.length === 0) return;
			editor.timeline.splitElements({ elements: targets, splitTime: time });
		},
		undefined,
	);

	/** Q / W: cut the clip up to / from the playhead and close the gap (Kadr ripple trim). */
	const trimToPlayhead = (side: "start" | "end") => {
		const time = editor.playback.getCurrentTime();
		const before = editor.scenes.getActiveScene().tracks;
		const targets = editor.timeline
			.getElementsWithTracks({ elements: getTargets() })
			.filter(
				// a locked track takes no edit (tlc2, register A1)
				({ track, element }) =>
					!isTrackLocked(track) && time > element.startTime && time < element.startTime + element.duration,
			)
			.map(({ track, element }) => ({ trackId: track.id, elementId: element.id }));
		if (targets.length === 0) return;
		const firstStart = Math.min(
			...editor.timeline
				.getElementsWithTracks({ elements: targets })
				.map(({ element }) => element.startTime),
		);

		const split = new SplitElementsCommand({
			elements: targets,
			splitTime: time,
			retainSide: side === "start" ? "right" : "left",
		});
		split.execute();
		const after = editor.scenes.getActiveScene().tracks;
		split.undo();

		const command = new TracksEditCommand({
			before,
			after,
			ripple: true,
			selection: side === "start" ? split.getRightSideElements() : targets,
		});
		if (side === "start") {
			// Q moves the playhead to the cut; ⌘Z gives back the clip and the playhead where Q was pressed (it stayed at the
			// cut, so a second try meant finding the spot again), ⇧⌘Z the cut and the playhead at it. The step SAYS it
			// navigates: the history's «⌘Z leaves the playhead where the hand put it» (commands.ts keepPlayhead, 14.11) took
			// this undo's seek back and the playhead stayed at the cut (the timeline night test's red, found 15.11).
			(command as { navigates?: boolean }).navigates = true;
			const undoCut = command.undo.bind(command);
			command.undo = () => {
				undoCut();
				seekTicks(editor, time);
			};
			const redoCut = command.redo.bind(command);
			command.redo = () => {
				const result = redoCut();
				seekTicks(editor, firstStart);
				return result;
			};
		}
		editor.command.execute({ command });
		if (side === "start") seekTicks(editor, firstStart);
	};
	useActionHandler("split-left", () => trimToPlayhead("start"), undefined);
	useActionHandler("split-right", () => trimToPlayhead("end"), undefined);

	useActionHandler(
		"ripple-delete",
		() => {
			const before = countClips(editor);
			const count = deleteLiveSelection({ editor, ripple: true });
			const linked = Math.max(0, before - countClips(editor) - count);
			if (count >= BULK_DELETE_NOTICE_MIN || linked > 0) {
				toast(linked > 0 ? translate("Deleted {n} clips and {m} linked (sound, captions, layers)", { n: count, m: linked }) : translate("Deleted {n} clips", { n: count }), {
					id: "bulk-delete",
					action: { label: translate("Undo"), onClick: () => editor.command.undo() },
				});
			}
		},
		undefined,
	);

	useActionHandler(
		"cut-selected",
		() => {
			if (cutSelectedKeyframes(editor)) return;
			const live = liveSelectedElements(editor);
			if (live.length === 0) return;
			if (!editor.clipboard.copy()) return;
			const [first] = editor.timeline.getElementsWithTracks({ elements: live });
			if (first) rememberAttributes(first.element);
			deleteLiveSelection({ editor });
		},
		undefined,
	);

	// «,» «.» ⌥← ⌥→: ONE handler, timeline/trim/use-trim-actions.ts nudgeEdit (tlc2, register A4: two ran on one press).

	// Trims to the frame and E (keyboard-trim.ts): committed as a trim by mouse is, in one undo step.
	const commitTrim = (updates: GroupResizeUpdate[] | null) => {
		if (!updates) return;
		editor.timeline.updateElements({
			updates: updates.map(({ trackId, elementId, patch }) => ({ trackId, elementId, patch: patch as Partial<TimelineElement> })),
		});
	};
	const trimEdge = (side: ResizeSide, frames: number) => {
		const fps = editor.project.getActiveOrNull()?.settings.fps;
		if (!fps) return;
		const tracks = editor.scenes.getActiveScene().tracks;
		commitTrim(
			trimEdgeByFrames({
				tracks,
				selection: editor.selection.getSelectedElements(),
				side,
				frames,
				fps,
				rippleTrackId: editor.command.isRippleEnabled ? tracks.main.id : null,
			}),
		);
	};
	useActionHandler("trim-end-earlier", () => trimEdge("right", -1), undefined);
	useActionHandler("trim-end-later", () => trimEdge("right", 1), undefined);
	useActionHandler("trim-start-earlier", () => trimEdge("left", -1), undefined);
	useActionHandler("trim-start-later", () => trimEdge("left", 1), undefined);
	useActionHandler(
		"extend-edit",
		() => {
			const fps = editor.project.getActiveOrNull()?.settings.fps;
			if (!fps) return;
			commitTrim(
				extendEditToPlayhead({
					tracks: editor.scenes.getActiveScene().tracks,
					selection: editor.selection.getSelectedElements(),
					time: editor.playback.getCurrentTime(),
					fps,
				}),
			);
		},
		undefined,
	);

	useActionHandler(
		"select-at-playhead",
		() => {
			const tracks = editor.scenes.getActiveScene().tracks;
			const under = getElementsUnderPlayhead({
				tracks,
				time: editor.playback.getCurrentTime(),
			});
			if (under.length === 0) {
				toast.info("No clip under the playhead");
				return;
			}
			// Prefer the topmost visual clip (overlay tracks are listed first).
			const ordered = listTracks(tracks).map((track) => track.id);
			under.sort((a, b) => ordered.indexOf(a.trackId) - ordered.indexOf(b.trackId));
			setElementSelection({ elements: [under[0]] });
		},
		undefined,
	);

	useActionHandler(
		"copy-attributes",
		() => {
			const [first] = editor.timeline.getElementsWithTracks({
				elements: selectedElements.length > 0 ? selectedElements : getTargets(),
			});
			if (!first) {
				toast.info("Select a clip to copy its attributes");
				return;
			}
			rememberAttributes(first.element);
			toast.success(translate("Attributes of «{name}» copied", { name: first.element.name }));
		},
		undefined,
	);
	useActionHandler(
		"paste-attributes",
		() => {
			// ⌥⌘V asks what to paste (transform, color, effects, speed, sound, keyframes, style): the dialog applies it.
			if (!useAttributesClipboard.getState().source) {
				toast.info("Copy a clip first (⌘C or ⌥⌘C)");
				return;
			}
			if (selectedElements.length === 0) {
				toast.info("Select the clips to paste onto");
				return;
			}
			useAttributesClipboard.setState({ dialogOpen: true });
		},
		undefined,
	);

	// --- View -------------------------------------------------------------------
	useActionHandler(
		"export-project",
		() => {
			if (editor.project.getActiveOrNull()) {
				useShellStore.getState().setExportOpen(true);
			}
		},
		undefined,
	);
	useActionHandler(
		"show-shortcuts",
		() => useShellStore.getState().setDialog("shortcuts"),
		undefined,
	);
	useActionHandler("focus-search", () => void focusPanelSearch(), undefined);
	useActionHandler("focus-next-panel", () => focusPanel(1), undefined);
	useActionHandler("focus-previous-panel", () => focusPanel(-1), undefined);
}
