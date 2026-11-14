// «Remove pauses» from a clip's right-click menu: only that clip is listened to and cut; the rest of the
// timeline follows (one ⌘Z). The wait is a Job on the clip itself (craft B: it breathes while it listens, × in the
// activity list stops it, a failure stays there with ↻); only the result, with its Undo, is a toast.
import { toast } from "sonner";
import { EditorCore } from "@/core";
import { jobCenter, useJobsStore } from "@/jobs/store";
import { SEAM_FADE } from "@/hear/cuts";
import { findSounding, planPauses } from "@/hear/client";
import { transcribeTimeline } from "@/transcribe/timeline";
import { TICKS_PER_SECOND } from "@/wasm";
import { findCuts, totalLength } from "./detect";
import { applyCuts } from "./remove";

/**
 * The cuts, the seamless way (hear/cuts.ts on the app's server): pauses over 400 ms shortened to this speaker's own
 * pause, fillers out with their air, frame-exact edges inside the silence, never through a word or a breath. Null when
 * the clip can't be heard there (then the plain detector below decides).
 */
async function seamlessCuts(elementId: string, signal?: AbortSignal): Promise<Array<{ start: number; end: number }> | null> {
	const clip = findSounding(elementId);
	if (!clip) return null;
	try {
		return (await planPauses(clip, {}, signal)).cuts;
	} catch (error) {
		if ((error as Error)?.name === "AbortError") throw error;
		console.warn("[remove pauses] seamless plan unavailable:", error);
		return null;
	}
}

let busy = false;

/** What happened, in words (Gaziyav AI reports it as is). */
export async function removePausesInClip({ trackId, elementId }: { trackId: string; elementId: string }): Promise<string> {
	if (busy) return "Already finding pauses in a clip; wait for it to finish.";
	busy = true;
	const editor = EditorCore.getInstance();
	const ac = new AbortController();
	const job = jobCenter.start({ kind: "other", title: "Remove pauses", stage: "Finding pauses", place: { elements: [elementId] }, cancel: () => ac.abort() });
	const id = `pauses-${job}`;
	const stopped = () => {
		if (ac.signal.aborted) throw new DOMException("Cancelled", "AbortError");
	};
	try {
		const seamless = await seamlessCuts(elementId, ac.signal);
		stopped();
		if (seamless) {
			if (seamless.length === 0) {
				toast.success("No pauses to remove in this clip", { id });
				return "No pauses to remove in this clip.";
			}
			const after = applyCuts(editor, seamless, TICKS_PER_SECOND, SEAM_FADE);
			const done = `Removed ${seamless.length} ${seamless.length === 1 ? "pause" : "pauses"} · ${totalLength(seamless).toFixed(1)} s`;
			toast.success(done, {
				id,
				action: {
					label: "Undo",
					onClick: () => {
						if (editor.scenes.getActiveScene().tracks === after) editor.command.undo();
					},
				},
			});
			return `${done}: each cut inside a pause (frame-exact), the speaker's natural pause kept at every join, ${Math.round(SEAM_FADE * 1000)} ms audio fades there.`;
		}
		const t = await transcribeTimeline({
			editor,
			target: { trackId, elementId },
			title: "Finding pauses",
			signal: ac.signal,
		});
		stopped();
		// Work in clip time so the clip's own start and end count as edges.
		const shift = <T extends { start: number; end: number }>(s: T): T => ({ ...s, start: s.start - t.from, end: s.end - t.from });
		const cuts = findCuts({ words: t.words.map(shift), speech: t.speech.map(shift), duration: t.to - t.from }).map((c) => ({
			...c,
			start: c.start + t.from,
			end: c.end + t.from,
		}));
		if (cuts.length === 0) {
			toast.success("No pauses to remove in this clip", { id });
			return "No pauses to remove in this clip.";
		}
		const after = applyCuts(editor, cuts, TICKS_PER_SECOND);
		const done = `Removed ${cuts.length} ${cuts.length === 1 ? "pause" : "pauses"} · ${totalLength(cuts).toFixed(1)} s`;
		toast.success(done, {
			id,
			action: {
				label: "Undo",
				onClick: () => {
					if (editor.scenes.getActiveScene().tracks === after) editor.command.undo();
				},
			},
		});
		return `${done}.`;
	} catch (error) {
		if ((error as Error)?.name === "AbortError" || ac.signal.aborted) {
			jobCenter.remove(job);
			return "Stopped.";
		}
		const message = (error as Error)?.message || "Could not remove pauses. Try again.";
		// on its object: the clip's row in the activity list, ↻ runs it again
		if (useJobsStore.getState().jobs.some((j) => j.id === job)) {
			jobCenter.fail(job, message);
			jobCenter.update(job, { retry: () => void removePausesInClip({ trackId, elementId }) });
		} else toast.error(message, { id });
		return message;
	} finally {
		busy = false;
		// done (its result is the toast with Undo) or stopped: the clip lets go; a failure stays with ↻
		if (useJobsStore.getState().jobs.find((j) => j.id === job)?.status === "running") jobCenter.remove(job);
	}
}
