// Clip order on the main video track for Gaziyav AI and Claude: put one clip at a position and keep the track packed
// back to back — what dragging a clip along the magnetic main track does. One ⌘Z (a tracks snapshot).
import { TracksSnapshotCommand } from "@/commands/timeline";
import type { EditorCore } from "@/core";
import type { TimelineElement } from "@/timeline";

export function reorderMainTrack(editor: EditorCore, elementId: string, index: number): TimelineElement[] {
	const before = editor.scenes.getActiveScene().tracks;
	const clips = [...(before.main.elements as TimelineElement[])].sort((a, b) => a.startTime - b.startTime);
	const from = clips.findIndex((e) => e.id === elementId);
	if (from < 0) throw new Error("That clip isn't on the main track.");
	const [clip] = clips.splice(from, 1);
	clips.splice(Math.min(clips.length, Math.max(0, Math.round(index))), 0, clip);
	let t = Math.min(...clips.map((e) => e.startTime));
	const packed = clips.map((e) => {
		const placed = { ...e, startTime: t } as TimelineElement;
		t += e.duration;
		return placed;
	});
	const after = { ...before, main: { ...before.main, elements: packed } } as typeof before;
	editor.command.execute({ command: new TracksSnapshotCommand({ before, after }) });
	return packed;
}

/** The position a clip dropped at `start` (ticks) takes among the others, by their middles — as a drag decides. */
export function mainIndexAt(editor: EditorCore, elementId: string, start: number): number {
	const others = (editor.scenes.getActiveScene().tracks.main.elements as TimelineElement[]).filter((e) => e.id !== elementId);
	return others.filter((e) => e.startTime + e.duration / 2 < start).length;
}

/** Whether [start, start + duration) on the main track runs into another clip there. */
export function overlapsOnMain(editor: EditorCore, elementId: string, start: number, duration: number): boolean {
	return (editor.scenes.getActiveScene().tracks.main.elements as TimelineElement[]).some(
		(e) => e.id !== elementId && start < e.startTime + e.duration && e.startTime < start + duration,
	);
}
