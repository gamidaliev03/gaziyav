"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import type { TimelineElement } from "@/timeline";
import { applyTextStyle, type ClipScope } from "../apply-to-all";

/** «Apply to all» for a text's look (font, size, stroke, shadow, box… not the words): one ⌘Z. */
export function ApplyTextStyle({ element, trackId }: { element: TimelineElement; trackId: string }) {
	const editor = useEditor();
	const apply = (scope: ClipScope) => {
		const changed = applyTextStyle(editor, { trackId, elementId: element.id }, scope);
		toast[changed > 0 ? "success" : "info"](
			changed > 0 ? `Style applied to ${changed} ${changed === 1 ? "text" : "texts"}` : scope === "selected" ? "Select the other texts first" : "No other texts on this track",
		);
	};
	return (
		<div className="mt-2.5 flex flex-wrap items-center gap-1.5">
			<span className="text-muted-foreground mr-1 text-xs">Style to</span>
			<Button size="sm" variant="secondary" className="h-6 px-2 text-xs" data-text-style-apply="selected" onClick={() => apply("selected")}>
				Selected texts
			</Button>
			<Button size="sm" variant="secondary" className="h-6 px-2 text-xs" data-text-style-apply="track" onClick={() => apply("track")}>
				All on the track
			</Button>
		</div>
	);
}
