"use client";

import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@/components/ui/icon";
import { PauseIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import { cn } from "@/utils/ui";
import type { Run } from "@/studio/client/studio-store";
import { useT } from "@/i18n";

/** 0:01.6 on the timeline. */
const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/**
 * The finished lipsync: a small player with a Before / After switch (same moment, same piece), and the three
 * next moves — try another model, undo, watch it in the edit.
 */
export function ResultCard({
	run,
	onTryAnother,
	onUndo,
	onWatch,
	onHide,
}: {
	run: Run;
	onTryAnother: () => void;
	onUndo: () => void;
	onWatch: () => void;
	onHide: () => void;
}) {
	const t = useT();
	const editor = useEditor();
	const result = run.result;
	const after = result ? editor.media.getAssets().find((a) => a.id === result.assetId) : undefined;
	const before = result?.beforeAssetId ? editor.media.getAssets().find((a) => a.id === result.beforeAssetId) : undefined;
	const [side, setSide] = useState<"before" | "after">("after");
	const [playing, setPlaying] = useState(false);
	const video = useRef<HTMLVideoElement>(null);
	// Position inside the piece, kept when switching sides so both show the same moment.
	const offset = useRef(0);

	const base = side === "before" ? (result?.beforeStart ?? 0) : 0;
	const src = side === "before" ? before?.url : after?.url;

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
			if (offset.current >= (result?.length ?? 0) - 0.05) offset.current = 0;
			v.currentTime = base + offset.current;
			void v.play().catch(() => {});
		} else v.pause();
	};

	return (
		<div className="flex flex-col gap-2.5" data-lipsync-card>
			<div className="flex items-center gap-2 text-sm">
				<span className="flex size-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white">✓</span>
				<span className="min-w-0 flex-1 truncate" data-no-translate title={after?.name}>{after?.name ?? t("Lipsync done")}</span>
				<button type="button" className="text-muted-foreground hover:text-foreground text-xs" onClick={onHide}>
					{t("Hide")}
				</button>
			</div>
			{src && (
				<div className="relative overflow-hidden rounded-md bg-black">
					{/* biome-ignore lint/a11y/useMediaCaption: before/after preview */}
					<video
						ref={video}
						src={src}
						playsInline
						preload="metadata"
						className="aspect-video max-h-44 w-full cursor-pointer object-contain"
						onClick={toggle}
						onPlay={() => setPlaying(true)}
						onPause={() => setPlaying(false)}
						onTimeUpdate={(e) => {
							offset.current = Math.max(0, e.currentTarget.currentTime - base);
							if (offset.current >= (result?.length ?? Number.POSITIVE_INFINITY)) e.currentTarget.pause();
						}}
					/>
					<div className="absolute right-2 bottom-2 left-2 flex items-center justify-between">
						<button
							type="button"
							aria-label={playing ? t("Pause") : t("Play")}
							className="flex size-7 items-center justify-center rounded-full bg-black/60 text-white"
							onClick={toggle}
						>
							<HugeiconsIcon icon={playing ? PauseIcon : PlayIcon} className="size-3.5" />
						</button>
						{before && (
							<div className="flex rounded-full bg-black/60 p-0.5 text-[11px] text-white" role="radiogroup" aria-label={t("Compare")}>
								{(["before", "after"] as const).map((s) => (
									<button
										key={s}
										type="button"
										role="radio"
										aria-checked={side === s}
										className={cn("rounded-full px-2.5 py-0.5", side === s ? "bg-white text-black" : "text-white/80")}
										onClick={() => setSide(s)}
									>
										{s === "before" ? t("Before") : t("After")}
									</button>
								))}
							</div>
						)}
					</div>
				</div>
			)}
			{!!result?.kept?.length && (
				<div className="text-muted-foreground flex flex-col gap-0.5 text-xs" data-testid="kept-original">
					<span>{t("The original face was kept where lipsync would look wrong:")}</span>
					{result.kept.map((k) => (
						<span key={`${k.from}-${k.reason}`} className="tabular-nums">
							· {clock(k.from)}–{clock(k.to)} — {k.reason}
						</span>
					))}
				</div>
			)}
			{/* (three equal columns cut «Try another» under «Undo ⌘Z» in the 305 px panel of a 1024 px window: they wrap now) */}
			<div className="flex flex-wrap gap-1.5">
				<Button variant="outline" size="sm" className="min-w-fit flex-1 whitespace-nowrap" onClick={onTryAnother}>
					{t("Try another")}
				</Button>
				<Button variant="outline" size="sm" className="min-w-fit flex-1 whitespace-nowrap" onClick={onUndo} title={t("Undo (⌘Z)")}>
					{t("Undo")} ⌘Z
				</Button>
				<Button variant="outline" size="sm" className="min-w-fit flex-1 whitespace-nowrap" onClick={onWatch}>
					{t("Watch")}
				</Button>
			</div>
		</div>
	);
}
