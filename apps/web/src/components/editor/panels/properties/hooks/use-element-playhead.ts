import { useEditor } from "@/editor/use-editor";
import { getElementLocalTime } from "@/animation";
import { addMediaTime, mediaTime, type MediaTime } from "@/wasm";

/** Where the playhead is inside a clip (clamped to it), and whether it is over the clip at all. */
export function getElementPlayhead({
	playheadTime,
	startTime,
	duration,
}: {
	playheadTime: MediaTime;
	startTime: MediaTime;
	duration: MediaTime;
}) {
	const localTime = mediaTime({
		ticks: getElementLocalTime({
			timelineTime: playheadTime,
			elementStartTime: startTime,
			elementDuration: duration,
		}),
	});
	const isPlayheadWithinElementRange =
		playheadTime >= startTime &&
		playheadTime <= addMediaTime({ a: startTime, b: duration });

	return { localTime, isPlayheadWithinElementRange };
}

const OVER = -1;
const OUTSIDE = -2;

/**
 * What a row needs from the playhead, as a value that changes only when the row would show something else: the time
 * itself for an animated clip (its values follow the playhead), otherwise — while the playhead is being dragged — only
 * whether it is over the clip (the ◆ enables). A drag across a clip without keyframes re-rendered every inspector row
 * on every frame (~140 components per seek) though its numbers don't move. On release (or any single seek) the exact
 * time comes back, so a ◆ clicked afterwards keys the right frame.
 */
export function playheadKey({
	playheadTime,
	isScrubbing,
	animated,
	startTime,
	duration,
}: {
	playheadTime: MediaTime;
	isScrubbing: boolean;
	animated: boolean;
	startTime: MediaTime;
	duration: MediaTime;
}): number {
	if (animated || !isScrubbing) return playheadTime;
	return getElementPlayhead({ playheadTime, startTime, duration }).isPlayheadWithinElementRange ? OVER : OUTSIDE;
}

export function useElementPlayhead({
	startTime,
	duration,
	animated = true,
	elementId,
}: {
	startTime: MediaTime;
	duration: MediaTime;
	/** The clip has keyframes (its values change with the playhead). Default true: re-render on every seek. */
	animated?: boolean;
	/**
	 * perfb: the clip's place is read live from the timeline (a section marked placementFree is not re-rendered when the
	 * clip only moves, so the props' startTime may be the old one): the rows re-render only when the place changed.
	 */
	elementId?: string;
}) {
	const editor = useEditor();
	const placeOf = (e: typeof editor): { startTime: MediaTime; duration: MediaTime } => {
		if (!elementId) return { startTime, duration };
		const tracks = e.timeline.getPreviewTracks() ? null : e.scenes.getActiveSceneOrNull()?.tracks;
		if (!tracks) return { startTime, duration };
		for (const track of [tracks.main, ...tracks.overlay, ...tracks.audio]) {
			const found = (track.elements as Array<{ id: string; startTime: MediaTime; duration: MediaTime }>).find((x) => x.id === elementId);
			if (found) return { startTime: found.startTime, duration: found.duration };
		}
		return { startTime, duration };
	};
	const key = useEditor(
		(e) => {
			const place = placeOf(e);
			const at = playheadKey({
				playheadTime: e.playback.getCurrentTime(),
				isScrubbing: e.playback.getIsScrubbing(),
				animated,
				startTime: place.startTime,
				duration: place.duration,
			});
			return elementId ? `${at}|${place.startTime}|${place.duration}` : at;
		},
		elementId ? ["playback", "timeline", "scenes"] : ["playback"],
	);
	const place = placeOf(editor);
	const k = typeof key === "string" ? Number(key.split("|")[0]) : key;
	const playheadTime = k >= 0 ? (k as MediaTime) : editor.playback.getCurrentTime();
	return getElementPlayhead({ playheadTime, startTime: place.startTime, duration: place.duration });
}
