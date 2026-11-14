// Registers the motion tools in the inspector (Properties panel) slots:
//   speed        — one Speed plugin (speed-plugin.tsx), registered by the built-in sections;
//   Motion tab ("animation", after the clip's Animation at 100) — Tracker (200) for video clips, Follow (300) for any
//   visual layer, Make vertical (400) for video clips; Stabilize (500) is in sections/capcut.tsx.
import { registerInspectorSection } from "@/components/editor/panels/properties/slots";
import { EditorCore } from "@/core";
import type { TimelineElement, TimelineTrack, VideoElement } from "@/timeline";
import { FollowSection, MakeVerticalSection, TrackerSection } from "./components/tracking-sections";

const isVideo = (e: { type: string }) => e.type === "video";
const isVisual = (e: { type: string }) => ["video", "image", "text", "sticker", "graphic"].includes(e.type);
/** Something to follow: a tracker on another clip of the scene (without one the Tracking tab of a photo or sticker was empty). */
const hasTrackerToFollow = (element: TimelineElement) => {
	const tracks = EditorCore.getInstance().scenes.getActiveSceneOrNull()?.tracks;
	if (!tracks) return false;
	return ([tracks.main, ...tracks.overlay] as TimelineTrack[]).some((track) =>
		(track.elements as TimelineElement[]).some((e) => e.type === "video" && e.id !== element.id && (e.trackers?.length ?? 0) > 0),
	);
};

registerInspectorSection({
	id: "motion.tracker",
	tab: "animation",
	title: "Tracker",
	order: 200,
	bare: true,
	appliesTo: isVideo,
	render: ({ element, trackId }) => <TrackerSection element={element as VideoElement} trackId={trackId} />,
});
registerInspectorSection({
	id: "motion.make-vertical",
	tab: "animation",
	title: "Make vertical",
	order: 400,
	bare: true,
	appliesTo: isVideo,
	render: ({ element, trackId }) => <MakeVerticalSection element={element as VideoElement} trackId={trackId} />,
});
registerInspectorSection({
	id: "motion.follow",
	tab: "animation",
	title: "Follow",
	order: 300,
	bare: true,
	appliesTo: (e) => isVisual(e) && hasTrackerToFollow(e),
	render: ({ element, trackId }) => <FollowSection element={element} trackId={trackId} />,
});
