import { PasteCommand } from "@/commands/timeline";
import { regroupCopies } from "@/timeline/groups";
import { lockstepSounds } from "@/timeline/linkage";
import type { ClipboardHandler } from "../types";

export const ElementsClipboardHandler = {
	type: "elements",

	canCopy({ selectedElements }) {
		return selectedElements.length > 0;
	},

	copy({ editor, selectedElements }) {
		if (selectedElements.length === 0) {
			return null;
		}

		const picked = editor.timeline.getElementsWithTracks({
			elements: selectedElements,
		});
		// A clip's detached sound in lockstep with it (timeline/linkage.ts isLockstepPair) is copied with it: the copy of a
		// clip whose sound was detached pasted silent (pro-core, 09.11).
		const tracks = editor.scenes.getActiveScene().tracks;
		const have = new Set(picked.map(({ element }) => element.id));
		const sounds = picked.flatMap(({ element }) =>
			lockstepSounds(tracks, element).flatMap(({ trackId, element: sound }) => {
				const track = tracks.audio.find((t) => t.id === trackId);
				if (!track || have.has(sound.id)) return [];
				have.add(sound.id);
				return [{ track, element: sound }];
			}),
		);
		const results = [...picked, ...sounds];
		const items = results.map(({ track, element }) => {
			const { id: _elementId, ...elementWithoutId } = element;
			return {
				trackId: track.id,
				trackType: track.type,
				element: elementWithoutId,
			};
		});

		if (items.length === 0) {
			return null;
		}

		return {
			type: "elements",
			items,
		};
	},

	paste({ entry, context }) {
		if (entry.items.length === 0) {
			return null;
		}

		// The track of the selected clip (after ⌘C the copied clips are still selected: their own track), else the
		// track the first copied clip came from.
		const targetTrackId = context.mode ? (context.selectedElements[0]?.trackId ?? entry.items[0].trackId) : undefined;
		// Pasted clips of a group (⌘G) are a new group of their own, never more members of the copied one.
		const regrouped = regroupCopies(entry.items.map((item) => item.element as Parameters<typeof regroupCopies>[0][number]));
		return new PasteCommand({
			time: context.time,
			clipboardItems: entry.items.map((item, index) => ({ ...item, element: regrouped[index] as typeof item.element })),
			targetTrackId,
			mode: context.mode,
		});
	},
} satisfies ClipboardHandler<"elements">;
