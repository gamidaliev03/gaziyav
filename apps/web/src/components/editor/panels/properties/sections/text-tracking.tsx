"use client";

// Text → Tracking (CapCut): the text follows a face in the video under it. One click tracks the face over that clip
// (Apple Vision on this Mac: motion/client.ts trackClip) and attaches the text to it (motion/commands.ts attachFollower);
// with trackers in the project the Follow group under this one picks among them.
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { trackClip } from "@/motion/client";
import { attachFollower } from "@/motion/commands";
import { MotionJobLine } from "@/motion/components/speed-sections";
import { jobFor, useMotionStore } from "@/motion/store";
import type { TimelineElement, TimelineTrack, VideoElement } from "@/timeline";

/** The video the text sits on: at the playhead when it is over the text, else at the text's start; main track first. */
function videoUnder(tracks: { main: TimelineTrack; overlay: TimelineTrack[] } | null, element: TimelineElement, now: number): VideoElement | null {
	if (!tracks) return null;
	const t = now >= element.startTime && now < element.startTime + element.duration ? now : element.startTime;
	for (const track of [tracks.main, ...tracks.overlay]) {
		for (const el of track.elements as TimelineElement[]) {
			if (el.type === "video" && t >= el.startTime && t < el.startTime + el.duration) return el as VideoElement;
		}
	}
	return null;
}

export function TextTrackingSection({ element }: { element: TimelineElement }) {
	const tracks = useEditor((e) => e.scenes.getActiveSceneOrNull()?.tracks ?? null, ["scenes", "timeline"]);
	const now = useEditor((e) => Number(e.playback.getCurrentTime()), ["playback"]);
	const video = videoUnder(tracks as { main: TimelineTrack; overlay: TimelineTrack[] } | null, element, now);
	const jobs = useMotionStore((s) => s.jobs);
	const job = video ? jobFor(jobs, video.id, "track") : null;
	const busy = job?.status === "running";
	const following = !!element.follow;
	const track = async () => {
		if (!video) return;
		try {
			const tracker = await trackClip({ elementId: video.id, kind: "face" });
			if (tracker && attachFollower(EditorCore.getInstance(), element.id, video.id, tracker.id)) toast.success(`The text follows ${tracker.name}`);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : String(error));
		}
	};
	const hint = following
		? "The text moves with a tracked face; another one or None is in Follow below"
		: video
			? `Follows a face in “${video.name}”, tracked on this Mac`
			: "Put the text over a video clip to make it follow a face";
	return (
		<div className="flex flex-col gap-2 px-4 pt-3 pb-4" data-text-tracking={following ? "on" : "off"}>
			<Button size="sm" title={hint} disabled={!video || busy} onClick={() => void track()} data-text-track="face">
				{busy ? "Tracking…" : following ? "Track again" : "Track a face"}
			</Button>
			{(busy || job?.status === "error") && <MotionJobLine job={job} onRetry={() => void track()} />}
		</div>
	);
}
