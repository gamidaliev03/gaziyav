"use client";

// Right-click a video clip: Track face / subject / object, Speed (rates, Freeze frame, Reverse, Optical flow),
// Make vertical. Tracking opens the clip's Motion tab on the Tracker, Speed its Speed tab (docs/EDITOR-MAP.md).
import { HugeiconsIcon } from "@/components/ui/icon";
import { DashboardSpeed02Icon, SmartPhone01Icon, Target02Icon } from "@hugeicons/core-free-icons";
import { ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "@/components/ui/context-menu";
import { usePropertiesStore } from "@/components/editor/panels/properties/stores/properties-store";
import { revealInspectorSection } from "@/components/editor/panels/properties/reveal";
import { EditorCore } from "@/core";
import type { TimelineElement, VideoElement } from "@/timeline/types";
import { reframeClips, renderSmooth, toggleReverse, trackClip } from "../client";
import { freezeFrame } from "../freeze";
import { useMotionStore } from "../store";

// Tracking lives in the Motion tab (the Tracker section), Speed in the Speed tab. Both used to open the wrong tab
// (AI / Video), where neither the tracker's progress nor the speed was.
function focus(trackId: string, elementId: string, tab: "tracking" | "speed") {
	const editor = EditorCore.getInstance();
	editor.selection.setSelectedElements({ elements: [{ trackId, elementId }] });
	if (!revealInspectorSection(tab === "tracking" ? "motion.tracker" : "speed", { trackId, elementId }))
		usePropertiesStore.getState().setActiveTab({ elementType: "video", tabId: tab === "tracking" ? "animation" : "speed" });
}

function setSpeed(trackId: string, clip: VideoElement, rate: number) {
	const { curve: _c, mode: _m, ...keep } = clip.retime ?? { rate: 1, maintainPitch: true };
	EditorCore.getInstance().timeline.updateElementRetime({ trackId, elementId: clip.id, retime: { ...keep, rate, mode: "constant" } });
}

function toggleSmooth(trackId: string, clip: VideoElement) {
	const on = !clip.retime?.smooth;
	EditorCore.getInstance().timeline.updateElementRetime({
		trackId,
		elementId: clip.id,
		retime: { ...(clip.retime ?? { rate: 1, maintainPitch: true }), smooth: on },
	});
	if (on) void renderSmooth(clip.id);
}

export function MotionMenuItems({ trackId, element }: { trackId: string; element: TimelineElement | null }) {
	if (!element || element.type !== "video") return null;
	const clip = element as VideoElement;
	const stop = (e: React.MouseEvent) => e.stopPropagation();
	return (
		<>
			<ContextMenuSub>
				<ContextMenuSubTrigger icon={<HugeiconsIcon icon={Target02Icon} />}>Track</ContextMenuSubTrigger>
				<ContextMenuSubContent>
					<ContextMenuItem
						data-motion-menu="track-face"
						onClick={(e: React.MouseEvent) => {
							stop(e);
							focus(trackId, clip.id, "tracking");
							void trackClip({ elementId: clip.id, kind: "face" });
						}}
					>
						Face
					</ContextMenuItem>
					<ContextMenuItem
						data-motion-menu="track-subject"
						onClick={(e: React.MouseEvent) => {
							stop(e);
							focus(trackId, clip.id, "tracking");
							useMotionStore.getState().setDraw({ elementId: clip.id, mode: "subject", kind: "subject" });
						}}
					>
						Subject (click it)…
					</ContextMenuItem>
					<ContextMenuItem
						data-motion-menu="track-object"
						onClick={(e: React.MouseEvent) => {
							stop(e);
							focus(trackId, clip.id, "tracking");
							useMotionStore.getState().setDraw({ elementId: clip.id, mode: "object", kind: "object" });
						}}
					>
						Object (draw a box)…
					</ContextMenuItem>
				</ContextMenuSubContent>
			</ContextMenuSub>
			<ContextMenuSub>
				<ContextMenuSubTrigger icon={<HugeiconsIcon icon={DashboardSpeed02Icon} />}>Speed</ContextMenuSubTrigger>
				<ContextMenuSubContent>
					{[0.5, 1, 1.5, 2, 3].map((rate) => (
						<ContextMenuItem
							key={rate}
							data-motion-menu={`speed-${rate}`}
							onClick={(e: React.MouseEvent) => {
								stop(e);
								setSpeed(trackId, clip, rate);
							}}
						>
							{rate}×{(clip.retime?.rate ?? 1) === rate && clip.retime?.mode !== "curve" ? "  ✓" : ""}
						</ContextMenuItem>
					))}
					<ContextMenuSeparator />
					<ContextMenuItem
						data-motion-menu="freeze"
						onClick={(e: React.MouseEvent) => {
							stop(e);
							void freezeFrame({ trackId, elementId: clip.id });
						}}
					>
						Freeze frame
					</ContextMenuItem>
					<ContextMenuItem
						data-motion-menu="reverse"
						onClick={(e: React.MouseEvent) => {
							stop(e);
							void toggleReverse(clip.id);
						}}
					>
						{clip.reversed ? "Reverse  ✓" : "Reverse"}
					</ContextMenuItem>
					<ContextMenuItem
						data-motion-menu="optical-flow"
						onClick={(e: React.MouseEvent) => {
							stop(e);
							toggleSmooth(trackId, clip);
						}}
					>
						{clip.retime?.smooth ? "Optical flow  ✓" : "Optical flow"}
					</ContextMenuItem>
				</ContextMenuSubContent>
			</ContextMenuSub>
			<ContextMenuSub>
				<ContextMenuSubTrigger icon={<HugeiconsIcon icon={SmartPhone01Icon} />}>Make vertical</ContextMenuSubTrigger>
				<ContextMenuSubContent>
					{(["9:16", "4:5", "1:1", "16:9"] as const).map((aspect) => (
						<ContextMenuItem
							key={aspect}
							data-motion-menu={`aspect-${aspect}`}
							onClick={(e: React.MouseEvent) => {
								stop(e);
								focus(trackId, clip.id, "tracking");
								const editor = EditorCore.getInstance();
								const ids = new Set(editor.selection.getSelectedElements().map((s) => s.elementId));
								ids.add(clip.id);
								void reframeClips([...ids], aspect);
							}}
						>
							{aspect === "9:16" ? "9:16 — keep the face in frame" : aspect}
						</ContextMenuItem>
					))}
					<ContextMenuItem
						data-motion-menu="keep-in-frame"
						onClick={(e: React.MouseEvent) => {
							stop(e);
							focus(trackId, clip.id, "tracking");
							void reframeClips([clip.id], null);
						}}
					>
						Keep in frame (this canvas)
					</ContextMenuItem>
				</ContextMenuSubContent>
			</ContextMenuSub>
		</>
	);
}
