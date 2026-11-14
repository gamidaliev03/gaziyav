"use client";

// Inspector → Video → Speed: ONE plugin for everything about time — speed, curve, keep pitch, freeze frame,
// reverse and optical flow (the user's rule: these are parameters of Speed, not separate plugins).
// CapCut's two pages on top: Normal (one speed for the whole clip: slider and field) and Curve (speed ramps). A clip
// with a ramp opens on Curve; a speed set on Normal makes the clip constant again (one ⌘Z).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { InspectorGroup, InspectorRow, Segmented } from "@/components/editor/panels/properties/components/inspector-ui";
import { SpeedFields } from "@/speed/components/speed-tab";
import type { AudioElement, VideoElement } from "@/timeline";
import { freezeFrame } from "../freeze";
import { OpticalFlowSection, ReverseSection, SpeedRampSection } from "./speed-sections";

type Page = "normal" | "curve";

export function SpeedPlugin({ element, trackId }: { element: VideoElement | AudioElement; trackId: string }) {
	const video = element.type === "video" ? element : null;
	const ramped = element.retime?.mode === "curve" && !!element.retime.curve;
	const [page, setPage] = useState<Page>(ramped ? "curve" : "normal");
	return (
		<InspectorGroup id="speed" title="Speed" defaultOpen>
			<div className="flex flex-col gap-2" data-speed-page={page}>
				<Segmented<Page>
					label="Speed type"
					value={page}
					options={[
						{ value: "normal", label: "Normal" },
						{ value: "curve", label: "Curve" },
					]}
					onChange={setPage}
				/>
				{page === "normal" ? (
					<>
						<SpeedFields element={element} trackId={trackId} />
						{video && (
							<>
								<InspectorRow rowId="speed.freeze" label="Freeze frame" hint="A still of the frame at the playhead, cut into the clip" inline>
									<Button size="sm" variant="secondary" className="h-7" title="A still of the frame at the playhead, cut into the clip" data-motion-freeze onClick={() => void freezeFrame({ trackId, elementId: video.id })}>
										Add
									</Button>
								</InspectorRow>
								<ReverseSection element={video} trackId={trackId} inline />
								<OpticalFlowSection element={video} trackId={trackId} inline />
							</>
						)}
					</>
				) : (
					<SpeedRampSection element={element} trackId={trackId} inline />
				)}
			</div>
		</InspectorGroup>
	);
}
