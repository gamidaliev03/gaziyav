// Split Scenes (Kadr: Assist → Split at Scenes): ffmpeg finds the shot changes inside the clip's piece of the
// file, and the clip — with its detached sound, if any — is cut there. One ⌘Z.
import { EditorCore } from "@/core";
import { uploadOnce } from "@/studio/client/api";
import { mediaTimeFromSeconds, type MediaTime } from "@/wasm";
import { SplitAtTimesCommand } from "./commands";
import { runAssist } from "./run";
import { allTracks, type ClipRef, isVideoClip, pickClip, type ResolvedClip } from "./target";

const post = async <T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> => {
	let res: Response;
	try {
		res = await fetch(`/api/assist/${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Studio": "1" },
			body: JSON.stringify(body),
			signal,
		});
	} catch {
		if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
		throw new Error("Gaziyav's local server is not responding. Restart Gaziyav.");
	}
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
	return data as T;
};
export { post as assistPost };

/** Frames per second of the project. */
export function projectFps(editor: EditorCore): number {
	const fps = editor.project.getActiveOrNull()?.settings.fps;
	const f = fps ? fps.numerator / fps.denominator : 30;
	return Number.isFinite(f) && f > 0 ? f : 30;
}

/** Frame-exact timeline time (ticks) for timeline seconds. */
export function frameTime(editor: EditorCore, seconds: number): MediaTime {
	const fps = projectFps(editor);
	return mediaTimeFromSeconds({ seconds: Math.round(seconds * fps) / fps });
}

/** The clip's own sound when it was detached to an audio track: same media, same place. */
function detachedSound(editor: EditorCore, clip: ResolvedClip): ClipRef[] {
	const el = clip.element;
	if (el.type !== "video") return [];
	return allTracks(editor).flatMap((t) =>
		t.type !== "audio"
			? []
			: t.elements
					.filter(
						(a) =>
							a.type === "audio" &&
							a.sourceType === "upload" &&
							a.mediaId === el.mediaId &&
							a.startTime === el.startTime &&
							a.duration === el.duration,
					)
					.map((a) => ({ trackId: t.id, elementId: a.id })),
	);
}

export function splitScenes(ref?: ClipRef, sensitivity = 0.5) {
	const editor = EditorCore.getInstance();
	const clip = pickClip(editor, ref, isVideoClip);
	return runAssist("Split scenes", async (ctl) => {
		if (!clip?.asset) throw new Error("Select a video clip on the timeline first.");
		ctl.stage("Reading the clip", 0);
		const up = await uploadOnce(`media:${clip.asset.id}`, clip.asset.file, (p) => ctl.stage("Reading the clip", p));
		const r = await ctl.job<{ cuts: number[] }>(() =>
			post("scenes", { fileId: up.fileId, start: clip.sourceStart, length: clip.sourceLength, sensitivity }),
		);
		// The clip may have been moved or trimmed meanwhile: map onto where it is now.
		const now = pickClip(editor, { trackId: clip.trackId, elementId: clip.element.id }, isVideoClip);
		if (!now || now.sourceStart !== clip.sourceStart || now.sourceLength !== clip.sourceLength) {
			throw new Error("The clip changed while scenes were being found. Run Split scenes again.");
		}
		// Never closer than a frame to the clip's ends (no 1-frame slivers).
		const frame = mediaTimeFromSeconds({ seconds: 1 / projectFps(editor) }) as number;
		const lo = (now.element.startTime as number) + frame;
		const hi = (now.element.startTime as number) + (now.element.duration as number) - frame;
		const times = [...new Set(r.cuts.map((c) => frameTime(editor, now.timeAt(c)) as number))]
			.filter((t) => t >= lo && t <= hi)
			.map((t) => t as MediaTime);
		if (times.length === 0) return { message: "No scene changes found in this clip" };
		const targets = [{ trackId: now.trackId, elementId: now.element.id }, ...detachedSound(editor, now)];
		const ripple = editor.command.isRippleEnabled;
		editor.command.isRippleEnabled = false; // a split never moves anything
		try {
			editor.command.execute({ command: new SplitAtTimesCommand(targets, times) });
		} finally {
			editor.command.isRippleEnabled = ripple;
		}
		const after = editor.scenes.getActiveScene().tracks;
		return {
			message: `Split into ${times.length + 1} scenes`,
			undo: () => {
				if (editor.scenes.getActiveScene().tracks === after) editor.command.undo();
			},
		};
	});
}
