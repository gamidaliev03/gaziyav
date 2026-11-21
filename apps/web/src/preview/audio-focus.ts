// ONE sound at a time: the timeline's playback and the panels' previews (a voice sample, a sound effect, a track of the
// library) must never play together — the owner, 17.11: «когда на таймлайне что-то включаю, пример звучания голоса ТТС
// или музыки глохнет». A preview asks for the focus before it plays (which pauses the timeline); starting the timeline
// stops every preview registered here. No imports: this module is a leaf, so the playback manager can use it without a
// cycle.
const stoppers = new Set<() => void>();

/** A preview that must stop when the timeline starts playing. Returns its unregister. */
export function registerAudioPreview(stop: () => void): () => void {
	stoppers.add(stop);
	return () => stoppers.delete(stop);
}

/** Stops every preview (a panel's sample, the library's track). Called when the timeline starts playing. */
export function stopPreviews(): void {
	for (const stop of [...stoppers]) {
		try {
			stop();
		} catch {}
	}
}
