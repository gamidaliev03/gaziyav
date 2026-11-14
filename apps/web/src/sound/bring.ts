// «Bring to target»: the whole timeline to its loudness target, as ONE undoable step on the master.
//
// Properly means: a plain gain first — the mix is measured (BS.1770), and the master fader set so its integrated
// loudness is the target. Only if that gain would put the true peak over the ceiling does the limiter come on, and
// then it is told to hold the peaks, not to make loudness: when reaching the target would mean taking more than a
// decibel of loudness off the peaks (the point where a limiter starts to be heard working), it stops short and
// says so. Nothing is rendered into the clips: the result is two visible values, the master's fader and its limiter.
import type { EditorCore } from "@/core";
import { TracksSnapshotCommand } from "@/commands/timeline/tracks-snapshot";
import { type MeasureResult, MeasureCancelled, measureProgramme } from "./dsp/offline";
import { type MasterMix, masterOf, sameMaster, withMaster } from "./master";
import { planMaster } from "./plan";
import { type TimelineMeasure, renderDryMix, throughMaster, useTimelineLoudness } from "./measure";
import { currentTarget } from "./target-pref";
import { ceilingFor } from "./targets";

/** Under this nothing is brought anywhere: the timeline is silent. */
const SILENT_LUFS = -60;

export interface BroughtToTarget {
	target: number;
	/** The programme before the step (with the master it had) and after it. */
	before: MeasureResult;
	after: MeasureResult;
	master: MasterMix;
	/** True when the loudness is the target (within 0.1 LU). */
	reached: boolean;
	/** False when the master already was what it should be: no step was made. */
	changed: boolean;
}

let controller: AbortController | null = null;
export const cancelBringToTarget = () => controller?.abort();

/**
 * Brings the open timeline to the target (the app's «Target loudness» unless one is given). One ⌘Z takes it back.
 * Throws with a plain sentence when there is nothing to bring; resolves null when cancelled.
 */
export async function bringToTarget(editor: EditorCore, { target = currentTarget() }: { target?: number } = {}): Promise<BroughtToTarget | null> {
	controller?.abort();
	const mine = new AbortController();
	controller = mine;
	const set = useTimelineLoudness.setState;
	set({ progress: 0, stage: "Mixing the timeline", error: null });
	try {
		const scene = editor.scenes.getActiveScene();
		const mix = await renderDryMix(editor);
		if (mine.signal.aborted) throw new MeasureCancelled();
		if (!mix) throw new Error("Nothing on the timeline makes a sound.");
		const channels = Array.from({ length: mix.buffer.numberOfChannels }, (_, c) => mix.buffer.getChannelData(c));
		const sampleRate = mix.buffer.sampleRate;
		set({ progress: 0.4, stage: "Measuring the loudness" });
		const dry = await measureProgramme({ channels, sampleRate, signal: mine.signal, onProgress: (share) => set({ progress: 0.4 + share * 0.2 }) });
		if (!(dry.integrated > SILENT_LUFS)) throw new Error("The timeline is silent: there is nothing to bring to a target.");
		const ceilingDb = ceilingFor(target);
		let pass = 0;
		const plan = await planMaster({
			dry,
			target,
			ceilingDb,
			through: (gainDb) => {
				const from = 0.6 + Math.min(2, pass++) * 0.13;
				set({ stage: "Holding the peaks" });
				return measureProgramme({ channels, sampleRate, gainDb, limiterCeilingDb: ceilingDb, signal: mine.signal, onProgress: (share) => set({ progress: from + share * 0.13 }) });
			},
		});
		if (mine.signal.aborted) throw new MeasureCancelled();

		const old = masterOf(scene.tracks);
		const oldMeasure: TimelineMeasure = { key: mix.key, sceneId: scene.id, dry, out: { ...dry, limiterDb: 0, limiterShare: 0 }, master: { gainDb: 0 }, at: Date.now() };
		const before =
			throughMaster(oldMeasure, old) ??
			(await measureProgramme({ channels, sampleRate, gainDb: old.gainDb, limiterCeilingDb: old.ceilingDb ?? null, signal: mine.signal }));
		const after = plan.out ?? (throughMaster(oldMeasure, plan.master) as MeasureResult);
		// The step is made on the tracks as they are NOW (the measure took a moment; an edit made meanwhile stays).
		const tracksNow = editor.scenes.getActiveScene().tracks;
		const next = withMaster(tracksNow, plan.master);
		const changed = !sameMaster(masterOf(tracksNow), masterOf(next));
		if (changed) editor.command.execute({ command: new TracksSnapshotCommand({ before: tracksNow, after: next }) });
		set({ result: { key: mix.key, sceneId: scene.id, dry, out: after, master: masterOf(next), at: Date.now() }, progress: null, stage: "", error: null });
		return { target, before, after, master: masterOf(next), reached: plan.reached, changed };
	} catch (error) {
		set({ progress: null, stage: "" });
		if (error instanceof MeasureCancelled || mine.signal.aborted) return null;
		throw error;
	} finally {
		if (controller === mine) controller = null;
	}
}
