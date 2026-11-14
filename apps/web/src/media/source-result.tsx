"use client";

// A result that stays in its source (an AI generator) until the user takes it: dragged onto the timeline,
// double-clicked (timeline, at the playhead) or added with + (Media only). Only then is it imported into Media, so
// the takes nobody wanted never clutter it.
import { useRef, useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@/components/ui/icon";
import { Add01Icon, Cancel01Icon, PauseIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { insertSourceRange } from "@/components/editor/panels/assets/source/source-monitor";
import { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import type { MediaAsset } from "@/media/types";

const taken = new Map<string, Promise<MediaAsset>>();

/** Imports a source result into Media once; the same asset afterwards, unless it was removed from Media. */
export async function takeOnce(key: string, load: () => Promise<MediaAsset>): Promise<MediaAsset> {
	const pending = taken.get(key);
	if (pending) {
		const known = await pending.catch(() => null);
		if (known && EditorCore.getInstance().media.getAssets().some((a) => a.id === known.id)) return known;
	}
	const run = load();
	taken.set(key, run);
	return run;
}

export function SourceResult({
	id,
	name,
	kind,
	url,
	dur = 0,
	take,
	onDiscard,
}: {
	id: string;
	name: string;
	kind: "image" | "video" | "audio";
	/** Preview of the file (not imported). */
	url: string;
	/** Seconds; 0 for a picture. */
	dur?: number;
	take: () => Promise<MediaAsset>;
	onDiscard?: () => void;
}) {
	const editor = useEditor();
	const failed = (e: unknown) => toast.error((e as Error).message);
	const toTimeline = () => void take().then((asset) => insertSourceRange({ editor, asset }), failed);
	const toMedia = () => void take().then((asset) => toast.success(`${asset.name} added to Media`), failed);
	const stop = (e: React.SyntheticEvent) => e.stopPropagation();
	return (
		<div data-source-result={id}>
			<DraggableItem
				name={name}
				preview={
					<div className="group relative size-full overflow-hidden rounded bg-muted">
						{kind === "image" ? (
							// biome-ignore lint/performance/noImgElement: a local preview, not an optimizable asset
							<img src={url} alt={name} className="size-full object-cover" draggable={false} />
						) : kind === "video" ? (
							<video
								src={url}
								muted
								loop
								playsInline
								preload="metadata"
								className="size-full object-cover"
								onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
								onMouseLeave={(e) => e.currentTarget.pause()}
							/>
						) : (
							<AudioPreview url={url} />
						)}
						<div className="absolute top-1 right-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
							<button type="button" aria-label="Add to Media" title="Add to Media" className="bg-background/85 hover:bg-background rounded p-0.5" onClick={(e) => { stop(e); toMedia(); }} onDoubleClick={stop}>
								<HugeiconsIcon icon={Add01Icon} className="size-3.5" />
							</button>
							{onDiscard ? (
								<button type="button" aria-label="Discard" title="Discard" className="bg-background/85 hover:bg-background rounded p-0.5" onClick={(e) => { stop(e); onDiscard(); }} onDoubleClick={stop}>
									<HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
								</button>
							) : null}
						</div>
					</div>
				}
				dragData={{ id, type: "source-file", name, mediaType: kind, dur, take }}
				aspectRatio={kind === "audio" ? 3 : kind === "image" ? 1 : 16 / 9}
				shouldShowPlusOnDrag={false}
				onAddToTimeline={toTimeline}
			/>
		</div>
	);
}

function AudioPreview({ url }: { url: string }) {
	const ref = useRef<HTMLAudioElement>(null);
	const [playing, setPlaying] = useState(false);
	return (
		<div className="flex size-full items-center justify-center">
			<button
				type="button"
				aria-label={playing ? "Pause" : "Play"}
				className="bg-background/80 hover:bg-background rounded-full p-1.5"
				onClick={(e) => {
					e.stopPropagation();
					const a = ref.current;
					if (!a) return;
					if (a.paused) void a.play().catch(() => {});
					else a.pause();
				}}
				onDoubleClick={(e) => e.stopPropagation()}
			>
				<HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} className="size-4" />
			</button>
			{/* biome-ignore lint/a11y/useMediaCaption: a music / voice preview */}
			<audio ref={ref} src={url} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
		</div>
	);
}
