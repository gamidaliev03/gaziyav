"use client";

// Media and sounds dropped onto the player go on the timeline at the playhead, as the tile's «+» puts them (CapCut):
// the same item, the same place, whichever way it is added. While one is held over the player, it says so.
import { useCallback, useRef, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import { buildLibraryClip, rememberRecent } from "@/library/client";
import { buildLandingElement, buildSourceRangeElement, markedRange } from "@/media/source-marks";
import { useT } from "@/i18n";
import type { MediaTime } from "@/wasm";
import { TICKS_PER_SECOND } from "@/wasm";

export function usePlayerDrop() {
	const editor = useEditor();
	const [over, setOver] = useState(false);
	const depth = useRef(0);
	const accepts = () => {
		const drag = editor.timeline.dragSource.getActive();
		return !!drag && (drag.type === "media" || drag.type === "library-audio");
	};

	const onDragEnter = useCallback((event: React.DragEvent) => {
		if (!accepts()) return;
		event.preventDefault();
		depth.current += 1;
		setOver(true);
		// biome-ignore lint/correctness/useExhaustiveDependencies: accepts reads the live drag
	}, []);
	const onDragOver = useCallback((event: React.DragEvent) => {
		if (!accepts()) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
		// biome-ignore lint/correctness/useExhaustiveDependencies: accepts reads the live drag
	}, []);
	const onDragLeave = useCallback(() => {
		depth.current = Math.max(0, depth.current - 1);
		if (depth.current === 0) setOver(false);
	}, []);
	const onDrop = useCallback(
		(event: React.DragEvent) => {
			const drag = editor.timeline.dragSource.getActive();
			depth.current = 0;
			setOver(false);
			if (!drag || (drag.type !== "media" && drag.type !== "library-audio")) return;
			event.preventDefault();
			event.stopPropagation();
			let at = editor.playback.getCurrentTime() as number;
			if (drag.type === "library-audio") {
				const { id, name, url, kind, dur, cat, gain } = drag;
				editor.timeline.insertElement({
					element: buildLibraryClip({ entry: { url, name, dur, kind, gain }, startTime: at as MediaTime, tracks: editor.scenes.getActiveScene().tracks }),
					placement: { mode: "auto" },
				});
				rememberRecent({ id, name, url, kind, dur, cat });
				return;
			}
			const byId = new Map(editor.media.getAssets().map((asset) => [asset.id, asset]));
			// Several tiles together: one after another from the playhead.
			for (const assetId of drag.ids ?? [drag.id]) {
				const asset = byId.get(assetId);
				if (!asset) continue;
				const element =
					(drag.ids?.length ?? 1) > 1
						? buildSourceRangeElement({ asset, startTime: at as MediaTime })
						: buildLandingElement({ asset, startTime: at as MediaTime, tracks: editor.scenes.getActiveScene().tracks });
				editor.timeline.insertElement({ element, placement: { mode: "auto" } });
				const range = markedRange({ asset });
				at += Math.round((range ? range.end - range.start : asset.duration ?? 5) * TICKS_PER_SECOND);
			}
		},
		[editor],
	);
	return { over, dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}

/** The hint over the player while something can be dropped on it. */
export function PlayerDropHint() {
	const t = useT();
	return (
		<div className="border-primary bg-primary/10 pointer-events-none absolute inset-2 z-[70] flex items-center justify-center rounded-md border-2 border-dashed" data-player-drop-hint="">
			<span className="bg-background/85 text-foreground rounded-md px-3 py-1.5 text-sm font-medium shadow">{t("Drop to add at the playhead")}</span>
		</div>
	);
}
