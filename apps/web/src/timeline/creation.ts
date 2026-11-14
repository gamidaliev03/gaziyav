import { mediaTime, mediaTimeFromSeconds, TICKS_PER_SECOND } from "@/wasm";

export const DEFAULT_NEW_ELEMENT_DURATION = mediaTime({
	ticks: 5 * TICKS_PER_SECOND,
});

/** Settings → Edit → Image duration: how long a picture lasts when it is added (seconds; set by settings/app-prefs). */
let stillSeconds = 5;
export const setStillSeconds = (seconds: number) => {
	if (Number.isFinite(seconds) && seconds > 0) stillSeconds = seconds;
};
export const stillDuration = () => mediaTimeFromSeconds({ seconds: stillSeconds });

export function toElementDurationTicks({
	seconds,
}: {
	seconds: number | null | undefined;
}) {
	if (seconds == null) {
		return stillDuration();
	}

	return mediaTimeFromSeconds({ seconds });
}
