"use client";

// The sample's answer (lip5, rule E): ~3 s of the real face, played in the panel with Before / After — nothing on the
// timeline, no undo step. From it: the whole at its price (the sample is reused only when the server says so), or
// another model.

import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { PauseIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useEditor } from "@/editor/use-editor";
import { cn } from "@/utils/ui";
import { useT } from "@/i18n";
import { studioApi } from "@/studio/client/api";
import type { Run } from "@/studio/client/studio-store";
import { falModel } from "@/fal/models";

export function SamplePlayer({
	run,
	wholePrice,
	reuse,
	onWhole,
	onOtherModel,
	onHide,
	wholeModel,
}: {
	run: Run;
	/** The model the whole run uses: a sample made by another one says so. */
	wholeModel: string;
	/** «≈ 20 ¢» from the pre-flight; empty while it answers. */
	wholePrice: string;
	/** The server says the whole run takes the sample's seconds from here. */
	reuse: boolean;
	onWhole: () => void;
	onOtherModel: () => void;
	onHide: () => void;
}) {
	const t = useT();
	const editor = useEditor();
	const s = run.sample;
	const before = s?.beforeAssetId ? editor.media.getAssets().find((a) => a.id === s.beforeAssetId) : undefined;
	const [side, setSide] = useState<"before" | "after">("after");
	const [playing, setPlaying] = useState(false);
	const video = useRef<HTMLVideoElement>(null);
	const offset = useRef(0);
	const actions = useRef<HTMLDivElement>(null);
	// the sample lands: its two next moves come into view in the panel's own scroll (no layout box is scrolled)
	useEffect(() => {
		const row = actions.current;
		if (!row) return;
		let box: HTMLElement | null = row.parentElement;
		while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
		if (!box) return;
		const over = row.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom;
		if (over > 0) box.scrollTop += over + 8;
	}, [s?.fileId]);
	const length = s ? Math.max(0.1, s.to - s.from) : 0;
	const base = side === "before" ? (s?.beforeStart ?? 0) + (s?.from ?? 0) : 0;
	const src = side === "before" ? before?.url : s ? studioApi.fileUrl(s.fileId) : undefined;

	// biome-ignore lint/correctness/useExhaustiveDependencies: seeks when the source changes; playing is read at that moment
	useEffect(() => {
		const v = video.current;
		if (!v || !src) return;
		const seek = () => {
			v.currentTime = base + offset.current;
			if (playing) void v.play().catch(() => {});
		};
		if (v.readyState >= 1) seek();
		else v.addEventListener("loadedmetadata", seek, { once: true });
	}, [src, base]);

	const toggle = () => {
		const v = video.current;
		if (!v) return;
		if (v.paused) {
			if (offset.current >= length - 0.05) offset.current = 0;
			v.currentTime = base + offset.current;
			void v.play().catch(() => {});
		} else v.pause();
	};
	if (!s) return null;
	return (
		<div className="flex flex-col gap-2" data-lipsync-sample>
			<div className="flex items-center gap-2 text-xs">
				<span className="min-w-0 flex-1 truncate">
					{t("Sample")} · <span data-no-translate>{falModel(s.model)?.title ?? s.model}</span>
				</span>
				<button type="button" className="text-muted-foreground hover:text-foreground" onClick={onHide} data-sample-hide>
					{t("Hide")}
				</button>
			</div>
			<div className="relative overflow-hidden rounded-md bg-black">
				{/* biome-ignore lint/a11y/useMediaCaption: sample before/after */}
				<video
					ref={video}
					src={src}
					playsInline
					preload="auto"
					data-sample-video={side}
					className="aspect-video max-h-36 w-full cursor-pointer object-contain [@media(max-height:720px)]:max-h-24"
					onClick={toggle}
					onPlay={() => setPlaying(true)}
					onPause={() => setPlaying(false)}
					onTimeUpdate={(e) => {
						offset.current = Math.max(0, e.currentTarget.currentTime - base);
						if (offset.current >= length) e.currentTarget.pause();
					}}
				/>
				<div className="absolute right-2 bottom-2 left-2 flex items-center justify-between">
					<button type="button" aria-label={playing ? t("Pause") : t("Play")} className="flex size-7 items-center justify-center rounded-full bg-black/60 text-white" onClick={toggle} data-sample-play>
						<HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} className="size-3.5" />
					</button>
					{before && (
						<div className="flex rounded-full bg-black/60 p-0.5 text-[11px] text-white" role="radiogroup" aria-label={t("Compare")}>
							{(["before", "after"] as const).map((x) => (
								<button key={x} type="button" role="radio" aria-checked={side === x} className={cn("rounded-full px-2.5 py-0.5", side === x ? "bg-white text-black" : "text-white/80")} onClick={() => setSide(x)}>
									{x === "before" ? t("Before") : t("After")}
								</button>
							))}
						</div>
					)}
				</div>
			</div>
			<div ref={actions} className="flex flex-wrap gap-1.5">
				<Button size="sm" className="min-w-fit flex-1 justify-between gap-2 whitespace-nowrap tabular-nums" disabled={!wholePrice} onClick={onWhole} data-sample-whole>
					<span>{t("Make the whole")}</span>
					<span className="opacity-80">{wholePrice || <Spinner className="size-3" />}</span>
				</Button>
				<Button variant="outline" size="sm" className="min-w-fit flex-1 whitespace-nowrap" onClick={onOtherModel} data-sample-other>
					{t("Another model")}
				</Button>
			</div>
			{(falModel(s.model)?.title ?? s.model) !== wholeModel && (
				<span className="text-muted-foreground text-[11px]" data-sample-model-note>
					{t("The sample is made by")} <span data-no-translate>{falModel(s.model)?.title ?? s.model}</span>; {t("the whole by")} <span data-no-translate>{wholeModel}</span>
				</span>
			)}
			{reuse && (
				<span className="text-muted-foreground text-[11px]" data-sample-reuse>
					{t("The sample goes into the whole: its seconds are not paid again")}
				</span>
			)}
		</div>
	);
}
