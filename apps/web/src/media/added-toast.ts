// The one way a new file (a generation, an AI result, a YouTube download) announces itself: it is in Media, and
// one click on the toast puts it on the timeline at the playhead — nothing jumps onto the timeline by itself.
import { toast } from "sonner";
import type { EditorCore } from "@/core";
import type { MediaAsset } from "@/media/types";
import { placeOnTimeline } from "@/studio/client/editor-bridge";
import { TICKS_PER_SECOND } from "@/wasm";

export function announceInMedia(editor: EditorCore, asset: MediaAsset, what: string, options: { id?: string | number; description?: string } = {}) {
	toast.success(`${what} added to Media`, {
		id: options.id,
		description: options.description ?? asset.name,
		duration: 8000,
		action: {
			label: "Add to timeline",
			onClick: () => {
				if (!editor.media.getAssets().some((a) => a.id === asset.id)) return;
				placeOnTimeline(editor, asset, editor.playback.getCurrentTime() / TICKS_PER_SECOND);
			},
		},
	});
}
