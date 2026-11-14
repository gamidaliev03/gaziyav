"use client";

import { toast } from "sonner";
import { useActionHandler } from "@/actions/use-action-handler";
import {
	getElementKeyframes,
	getKeyframeAtTime,
	resolveAnimationPathValueAtTime,
} from "@/animation";
import { applyKeyframeEase, KEYFRAME_EASE_LABELS, type KeyframeEase } from "@/animation/keyframe-ease";
import { t as translate } from "@/i18n";
import type { AnimationPath, ElementAnimations } from "@/animation/types";
import type { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { resolveAnimationTarget } from "@/timeline/animation-targets";
import type { ElementRef, TimelineElement } from "@/timeline/types";
import { mediaTime, type MediaTime } from "@/wasm";
import { getElementsUnderPlayhead, listTracks } from "./timeline-edits";
import { deleteKeyframesInScope } from "./keyframe-scope";
import { resetTransform } from "@/components/editor/panels/properties/hooks/reset-params";

type Target = { trackId: string; element: TimelineElement };

/** Selected clips, else the clips under the playhead. */
function getTargets(editor: EditorCore): Target[] {
	const selected = editor.selection.getSelectedElements();
	const refs: ElementRef[] =
		selected.length > 0
			? selected
			: getElementsUnderPlayhead({
					tracks: editor.scenes.getActiveScene().tracks,
					time: editor.playback.getCurrentTime(),
				});
	return editor.timeline
		.getElementsWithTracks({ elements: refs })
		.map(({ track, element }) => ({ trackId: track.id, element }));
}

function animatedPaths(animations: ElementAnimations | undefined): AnimationPath[] {
	return [...new Set(getElementKeyframes({ animations }).map((keyframe) => keyframe.propertyPath))];
}

/**
 * ⌥K: a key on every animated parameter of the clip at the playhead (the curve does not change: each key gets
 * the value it already has there). When every animated parameter has a key there already, ⌥K removes them —
 * like the ◆ beside a parameter.
 */
/** CapCut's «basic» keyframe (⌥⇧K on a clip with no animation yet): position, scale and rotation together. */
const BASIC_KEYFRAME_PATHS = [
	"transform.positionX",
	"transform.positionY",
	"transform.scaleX",
	"transform.scaleY",
	"transform.rotate",
] as AnimationPath[];

function toggleKeyframesAtPlayhead(editor: EditorCore): void {
	const now = editor.playback.getCurrentTime();
	const missing: Parameters<EditorCore["timeline"]["upsertKeyframes"]>[0]["keyframes"] = [];
	const present: Parameters<EditorCore["timeline"]["removeKeyframes"]>[0]["keyframes"] = [];
	let animatedCount = 0;
	for (const { trackId, element } of getTargets(editor)) {
		if (now < element.startTime || now > element.startTime + element.duration) continue;
		const localTime = mediaTime({ ticks: now - element.startTime });
		const animated = animatedPaths(element.animations);
		// Nothing animated yet: the basic keyframe (CapCut), on the transform this clip has.
		const paths = animated.length > 0 ? animated : BASIC_KEYFRAME_PATHS.filter((path) => resolveAnimationTarget({ element, path }));
		for (const propertyPath of paths) {
			animatedCount++;
			const existing = getKeyframeAtTime({ animations: element.animations, propertyPath, time: localTime });
			if (existing) {
				present.push({ trackId, elementId: element.id, propertyPath, keyframeId: existing.id });
				continue;
			}
			const baseValue = resolveAnimationTarget({ element, path: propertyPath })?.getBaseValue();
			if (baseValue == null) continue;
			const value = resolveAnimationPathValueAtTime({
				animations: element.animations,
				propertyPath,
				localTime,
				fallbackValue: baseValue,
			});
			missing.push({ trackId, elementId: element.id, propertyPath, time: localTime, value });
		}
	}
	if (animatedCount === 0) {
		toast.info("Select a clip under the playhead to add a keyframe");
		return;
	}
	if (missing.length > 0) {
		editor.timeline.upsertKeyframes({ keyframes: missing });
		return;
	}
	editor.timeline.removeKeyframes({ keyframes: present });
}

/** ⌥; / ⌥': the playhead to the previous / next key of the selected clips (of every clip when none is selected). */
function goToKeyframe(editor: EditorCore, direction: "previous" | "next"): void {
	const now = editor.playback.getCurrentTime();
	const selected = editor.selection.getSelectedElements();
	const elements =
		selected.length > 0
			? editor.timeline.getElementsWithTracks({ elements: selected }).map(({ element }) => element)
			: listTracks(editor.scenes.getActiveScene().tracks).flatMap((track): TimelineElement[] => [...track.elements]);
	let best: number | null = null;
	for (const element of elements) {
		for (const keyframe of getElementKeyframes({ animations: element.animations })) {
			if (keyframe.time < 0 || keyframe.time > element.duration) continue;
			const time = element.startTime + keyframe.time;
			if (direction === "next" ? time > now && (best === null || time < best) : time < now && (best === null || time > best)) {
				best = time;
			}
		}
	}
	if (best === null) {
		toast.info(direction === "next" ? "No keyframe after the playhead" : "No keyframe before the playhead");
		return;
	}
	editor.playback.seek({ time: mediaTime({ ticks: best }) as MediaTime });
}

/** F9 family: the ease of the selected keys; without a selection, of the keys under the playhead. */
function setEase(editor: EditorCore, ease: KeyframeEase): void {
	const byElement = new Map<string, { trackId: string; elementId: string; paths: Map<AnimationPath, string[]> }>();
	const add = (trackId: string, elementId: string, propertyPath: AnimationPath, keyframeId: string) => {
		const entry = byElement.get(elementId) ?? { trackId, elementId, paths: new Map() };
		entry.paths.set(propertyPath, [...(entry.paths.get(propertyPath) ?? []), keyframeId]);
		byElement.set(elementId, entry);
	};
	const selectedKeys = editor.selection.getSelectedKeyframes();
	if (selectedKeys.length > 0) {
		for (const ref of selectedKeys) add(ref.trackId, ref.elementId, ref.propertyPath, ref.keyframeId);
	} else {
		const now = editor.playback.getCurrentTime();
		for (const { trackId, element } of getTargets(editor)) {
			const localTime = now - element.startTime;
			for (const keyframe of getElementKeyframes({ animations: element.animations })) {
				if (keyframe.time === localTime) add(trackId, element.id, keyframe.propertyPath, keyframe.id);
			}
		}
	}
	if (byElement.size === 0) {
		toast.info("Select keyframes, or put the playhead on one");
		return;
	}
	let count = 0;
	const updates = editor.timeline
		.getElementsWithTracks({ elements: [...byElement.values()] })
		.flatMap(({ track, element }) => {
			const entry = byElement.get(element.id);
			if (!entry) return [];
			let animations = element.animations;
			for (const [propertyPath, keyframeIds] of entry.paths) {
				animations = applyKeyframeEase({ animations, propertyPath, keyframeIds, ease });
				count += keyframeIds.length;
			}
			return [{ trackId: track.id, elementId: element.id, patch: { animations } }];
		});
	editor.timeline.updateElements({ updates });
	toast(translate("{ease} · {n} keyframes", { ease: translate(KEYFRAME_EASE_LABELS[ease]), n: count }), { id: "keyframe-ease", duration: 1200 });
}

export function useKeyframeActions() {
	const editor = useEditor();
	useActionHandler("toggle-keyframe", () => toggleKeyframesAtPlayhead(editor), undefined);
	useActionHandler("previous-keyframe", () => goToKeyframe(editor, "previous"), undefined);
	useActionHandler("next-keyframe", () => goToKeyframe(editor, "next"), undefined);
	useActionHandler("keyframe-ease", () => setEase(editor, "ease"), undefined);
	useActionHandler("keyframe-ease-in", () => setEase(editor, "ease-in"), undefined);
	useActionHandler("keyframe-ease-out", () => setEase(editor, "ease-out"), undefined);
	useActionHandler("keyframe-linear", () => setEase(editor, "linear"), undefined);
	useActionHandler("keyframe-hold", () => setEase(editor, "hold"), undefined);
	useActionHandler(
		"delete-keyframes-parameter",
		() => {
			if (deleteKeyframesInScope(editor, "parameter") === 0) toast.info("Select a keyframe of the parameter first");
		},
		undefined,
	);
	useActionHandler(
		"delete-keyframes-clip",
		() => {
			if (deleteKeyframesInScope(editor, "clip") === 0) toast.info("Select a clip with keyframes, or one of its keyframes");
		},
		undefined,
	);
	useActionHandler(
		"reset-transform",
		() => {
			const clips = getTargets(editor).filter(({ element }) => "params" in element);
			if (clips.length === 0) toast.info("Select a clip to reset its Transform");
			else if (resetTransform({ editor, clips }) === 0) toast.info("The Transform is already reset");
		},
		undefined,
	);
}
