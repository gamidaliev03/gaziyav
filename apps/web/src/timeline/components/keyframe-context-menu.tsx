"use client";

import { useEffect } from "react";
import { keyframesInScope, type KeyframeScope } from "@/actions/keyframe-scope";
import type { SelectedKeyframeRef } from "@/animation/types";
import { ContextMenuItem, ContextMenuShortcut } from "@/components/ui/context-menu";
import { useEditor } from "@/editor/use-editor";

const sameKey = (a: SelectedKeyframeRef, b: SelectedKeyframeRef) =>
	a.elementId === b.elementId && a.propertyPath === b.propertyPath && a.keyframeId === b.keyframeId;

/**
 * Right-click on a ◆ on the timeline: delete it (or the selection it belongs to), every key of its parameter, or every
 * key of its clip — one ⌘Z each. The right-clicked ◆ gets selected unless it already is, like a right-clicked clip.
 */
export function KeyframeContextMenuItems({ refs }: { refs: SelectedKeyframeRef[] }) {
	const editor = useEditor();

	useEffect(() => {
		const selected = editor.selection.getSelectedKeyframes();
		if (!refs.some((ref) => selected.some((key) => sameKey(key, ref)))) {
			editor.selection.setSelectedKeyframes({ keyframes: refs });
		}
	}, [editor, refs]);

	const remove = (scope: KeyframeScope) => {
		const selected = editor.selection.getSelectedKeyframes();
		const base = refs.some((ref) => selected.some((key) => sameKey(key, ref))) ? selected : refs;
		const owners = [...new Map(base.map((ref) => [ref.elementId, { trackId: ref.trackId, elementId: ref.elementId }])).values()];
		const clips = editor.timeline
			.getElementsWithTracks({ elements: owners })
			.map(({ track, element }) => ({ trackId: track.id, element }));
		const keyframes = keyframesInScope({ clips, refs: base, scope });
		if (keyframes.length === 0) return;
		editor.timeline.removeKeyframes({ keyframes });
		editor.selection.clearKeyframeSelection();
	};

	return (
		<>
			<ContextMenuItem onClick={() => remove("keys")}>
				Delete
				<ContextMenuShortcut>⌫</ContextMenuShortcut>
			</ContextMenuItem>
			<ContextMenuItem onClick={() => remove("parameter")}>
				Delete All on This Parameter
				<ContextMenuShortcut>⌥⌫</ContextMenuShortcut>
			</ContextMenuItem>
			<ContextMenuItem onClick={() => remove("clip")}>
				Delete All on Clip
				<ContextMenuShortcut>⌥⇧⌫</ContextMenuShortcut>
			</ContextMenuItem>
		</>
	);
}
