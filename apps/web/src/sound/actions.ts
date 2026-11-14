// What the sound surfaces do to the project, each as one undoable step, with its notice in words.
import { toast } from "sonner";
import { TracksSnapshotCommand } from "@/commands/timeline/tracks-snapshot";
import { EditorCore } from "@/core";
import { t } from "@/i18n";
import { jobCenter } from "@/jobs/store";
import type { SceneTracks } from "@/timeline";
import { type BroughtToTarget, bringToTarget, cancelBringToTarget } from "./bring";
import { type MasterMix, NO_MASTER, masterOf, sameMaster, withMaster } from "./master";
import { useTimelineLoudness } from "./measure";
import { withSoloToggled } from "./solo";
import { currentTarget } from "./target-pref";
import { useSoundUi } from "./ui-store";
import { formatDelta, formatLufs, formatTarget } from "./targets";

const editorNow = () => EditorCore.getInstance();

/** A change of the open timeline's tracks as one step (nothing happens when nothing changed). */
export function commitTracks(editor: EditorCore, change: (tracks: SceneTracks) => SceneTracks): boolean {
	const scene = editor.scenes.getActiveSceneOrNull();
	if (!scene) return false;
	const before = scene.tracks;
	const after = change(before);
	if (after === before) return false;
	editor.command.execute({ command: new TracksSnapshotCommand({ before, after }) });
	return true;
}

/** The master fader and limiter, stored (one ⌘Z). */
export function commitMaster(editor: EditorCore, master: MasterMix): boolean {
	return commitTracks(editor, (tracks) => (sameMaster(masterOf(tracks), master) ? tracks : withMaster(tracks, master)));
}

export const resetMaster = (editor: EditorCore) => commitMaster(editor, NO_MASTER);

/** S on a strip: the track's solo; with `only` it becomes the one soloed track. */
export function toggleSolo(editor: EditorCore, trackId: string, only = false): boolean {
	return commitTracks(editor, (tracks) => withSoloToggled(tracks, trackId, only));
}

/** The line a finished «Bring to target» says (≤ 72 characters in both languages). */
export function broughtLine(result: BroughtToTarget): string {
	const lufs = formatLufs(result.after.integrated);
	const gain = formatDelta(result.master.gainDb);
	if (!result.changed) return t("Already at {lufs} LUFS: nothing to change", { lufs });
	if (!result.reached) return t("Brought to {lufs} of {target} LUFS: louder would flatten the peaks", { lufs, target: formatTarget(result.target) });
	if (result.master.ceilingDb !== undefined) return t("Brought to {lufs} LUFS: master {gain} dB, peaks held at {tp} dBTP", { lufs, gain, tp: formatTarget(result.master.ceilingDb) });
	return t("Brought to {lufs} LUFS: master {gain} dB", { lufs, gain });
}

let bringing = false;
export const isBringing = () => bringing;

/** «Bring to target» as the button and ⌘K run it: progress in the job list when it takes a while, a notice at the end. */
export async function runBringToTarget(editor: EditorCore = editorNow()): Promise<BroughtToTarget | null> {
	if (bringing) return null;
	bringing = true;
	let job: string | null = null;
	// a short timeline is done before a job line would be read: it gets one only after a second
	const timer = setTimeout(() => {
		job = jobCenter.start({ kind: "other", title: t("Bring to target"), stage: t(useTimelineLoudness.getState().stage || "Mixing the timeline"), progress: useTimelineLoudness.getState().progress ?? 0, cancel: cancelBringToTarget });
	}, 1000);
	const watch = useTimelineLoudness.subscribe((state) => {
		if (job && state.progress !== null) jobCenter.update(job, { stage: t(state.stage), progress: state.progress });
	});
	try {
		const result = await bringToTarget(editor);
		if (!result) {
			if (job) jobCenter.cancelled(job);
			return null;
		}
		const line = broughtLine(result);
		if (job) jobCenter.finish(job, line);
		if (result.changed) toast.success(line, { description: t("⌘Z takes it back") });
		else toast.message(line);
		return result;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (job) jobCenter.fail(job, t(message));
		toast.error(t(message));
		return null;
	} finally {
		clearTimeout(timer);
		watch();
		bringing = false;
	}
}

/** The line a finished «Balance the mix» says (≤ 72 characters in both languages). */
export function balancedLine(result: { changed: boolean; voices: number; music: number; ducks: number; duckDb: number; voiceLufs: number }): string {
	const lufs = formatTarget(result.voiceLufs);
	if (!result.changed) return t("The mix already stands balanced: nothing to change");
	if (result.voices && result.music && result.ducks) return t("Balanced: voice at {lufs} LUFS, music {n} dB lower under words", { lufs, n: result.duckDb });
	if (result.voices) return t("Balanced: voice at {lufs} LUFS", { lufs });
	return t("Balanced: music at {lufs} LUFS", { lufs });
}

let balancing = false;
export const isBalancing = () => balancing;

/** «Balance the mix» as the button and ⌘K run it. */
export async function runBalance(editor: EditorCore = editorNow()) {
	if (balancing) return null;
	balancing = true;
	const { balanceMix, cancelBalance, useBalance } = await import("./balance/run");
	const job = jobCenter.start({ kind: "other", title: t("Balance the mix"), stage: t("Listening to the clips"), progress: 0, cancel: cancelBalance });
	const watch = useBalance.subscribe((state) => {
		if (state.progress !== null) jobCenter.update(job, { stage: t(state.stage), progress: state.progress });
	});
	try {
		const result = await balanceMix(editor, { target: currentTarget(), duckDb: useSoundUi.getState().duckDb });
		if (!result) {
			jobCenter.cancelled(job);
			return null;
		}
		const line = balancedLine(result);
		const detail = [
			result.voices ? t("{n} voice", { n: result.voices }) : "",
			result.music ? t("{n} music", { n: result.music }) : "",
			result.effects ? t("{n} effects", { n: result.effects }) : "",
			result.limiter ? t("limiter on") : "",
		]
			.filter(Boolean)
			.join(" · ");
		jobCenter.finish(job, line);
		jobCenter.update(job, { messageDetail: detail });
		if (result.changed) toast.success(line, { description: `${detail} · ${t("⌘Z takes it back")}` });
		else toast.message(line);
		if (result.byLevel) toast.message(t("Speech was found by its level: the speech model is not on this Mac."));
		return result;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		jobCenter.fail(job, t(message));
		toast.error(t(message));
		return null;
	} finally {
		watch();
		balancing = false;
	}
}

const short = (name: string, max = 26) => (name.length > max ? `${name.slice(0, max - 1)}…` : name);
const seconds = (value: number) => (Math.abs(value) >= 10 ? Math.abs(value).toFixed(1) : Math.abs(value).toFixed(2));

/** The line a finished «Sync by waveform» says (≤ 72 characters with a name of 26). */
export function syncedLine(result: { reference: { name: string }; clips: Array<{ name: string; movedSeconds: number }>; changed: boolean }): string {
	if (!result.changed) return t("Already in sync: nothing moved");
	if (result.clips.length > 1) return t("Synced {n} clips to «{name}»", { n: result.clips.length, name: short(result.reference.name) });
	const clip = result.clips[0];
	return clip.movedSeconds < 0 ? t("Synced: «{name}» is {n} s earlier now", { name: short(clip.name), n: seconds(clip.movedSeconds) }) : t("Synced: «{name}» is {n} s later now", { name: short(clip.name), n: seconds(clip.movedSeconds) });
}

let syncing = false;

/** «Sync by waveform» as the clip's menu and ⌘K run it, on the selected clips. */
export async function runSync(editor: EditorCore = editorNow()) {
	if (syncing) return null;
	syncing = true;
	const { syncByWaveform, cancelSync, useSync, DRIFT_WORTH_SAYING_PPM } = await import("./sync/run");
	const job = jobCenter.start({ kind: "other", title: t("Sync by waveform"), stage: t("Listening"), progress: 0, cancel: cancelSync });
	const watch = useSync.subscribe((state) => {
		if (state.progress !== null) jobCenter.update(job, { stage: `${t(state.stage)} «${short(state.name)}»`, progress: state.progress });
	});
	try {
		const result = await syncByWaveform(editor);
		if (!result) {
			jobCenter.cancelled(job);
			return null;
		}
		const line = syncedLine(result);
		jobCenter.finish(job, line);
		// a camera's own sound doubles the separate one once they are in step: one press mutes it
		const camera = result.reference.type === "video" && result.clips.length > 0 ? result.reference : null;
		const cameraRef = camera ? editor.selection.getSelectedElements().find((ref) => ref.elementId === camera.id) : undefined;
		if (result.changed) {
			toast.success(line, {
				description: t("⌘Z takes it back"),
				...(cameraRef ? { action: { label: t("Mute camera sound"), onClick: () => editor.timeline.updateElements({ updates: [{ trackId: cameraRef.trackId, elementId: cameraRef.elementId, patch: { params: { muted: true } } }] }) } } : {}),
			});
		} else toast.message(line);
		const worst = result.clips.reduce((a, c) => (Math.abs(c.driftPpm) > Math.abs(a.driftPpm) ? c : a), result.clips[0]);
		if (worst && Math.abs(worst.driftPpm) >= DRIFT_WORTH_SAYING_PPM) {
			toast.message(t("Clocks differ by {pct} %: in step mid-clip, {ms} ms apart at the ends", { pct: (Math.abs(worst.driftPpm) / 10000).toFixed(3), ms: Math.round(worst.apartMs) }));
		}
		for (const miss of result.failed.slice(0, 2)) toast.message(t("Not synced: «{name}» — {why}", { name: short(miss.name), why: t(miss.why) }));
		return result;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		jobCenter.fail(job, t(message));
		toast.error(t(message));
		return null;
	} finally {
		watch();
		syncing = false;
	}
}
