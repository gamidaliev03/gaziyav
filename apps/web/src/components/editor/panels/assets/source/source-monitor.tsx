"use client";

import { useT } from "@/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft01Icon, PauseIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { buildLandingElement, markedRange, useSourceMarks } from "@/media/source-marks";
import type { MediaAsset } from "@/media/types";
import { sayFittedToVideo } from "@/sound/fitted";
import { addAssetsAtPlayhead } from "@/timeline/placement/row-place";
import { cn } from "@/utils/ui";
import { SOURCE_SCOPE_ATTR, sourceControls, useSourceStore, takeOpenAt } from "./source-store";
import { useAssetUrl, useWaveformPeaks, WaveformBars } from "./tile-media";

const fmt = (s: number) => {
	const t = Math.max(0, s);
	return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
};

/** Puts the marked range (or the whole item) on the timeline at the playhead. */
export function insertSourceRange({ editor, asset }: { editor: EditorCore; asset: MediaAsset }): void {
	const element = buildLandingElement({ asset, startTime: editor.playback.getCurrentTime(), tracks: editor.scenes.getActiveSceneOrNull()?.tracks });
	editor.timeline.insertElement({ element, placement: { mode: "auto" } });
	// a song cut to the video's end says so, with the whole song one click away (sound/fitted.ts)
	sayFittedToVideo(editor, asset, element);
}

/**
 * into the row on the main track — at the cut after the clip under the playhead — and the playhead goes to the new
 * clip's end, so the next «+» lays the next clip after it; a sound goes under the film at the playhead. Several items
 * go in their order, as one undo step.
 */
export function insertMediaIntoRow({ editor, assets }: { editor: EditorCore; assets: readonly MediaAsset[] }): void {
	if (assets.length === 1 && assets[0].type === "audio") {
		insertSourceRange({ editor, asset: assets[0] });
		return;
	}
	addAssetsAtPlayhead({ editor, assets });
}

/**
 * Source preview in the main player (as in CapCut): a media item clicked in Media plays here with its own playhead,
 * scrub bar and In/Out, over the timeline's picture, so the Media tiles never move. Space / J K L / I O / ← → act on
 * it while the focus is in Media or here; double-click on the tile, ↵ or «Insert» put only the marked range on the
 * timeline at the playhead. The timeline's picture comes back with ✕, when the timeline plays or on a press in the
 * timeline.
 */
export function SourcePlayer() {
	const editor = useEditor();
	const assets = useEditor((e) => e.media.getAssets());
	const assetId = useSourceStore((state) => state.assetId);
	const close = useSourceStore((state) => state.close);
	const asset = assets.find((a) => a.id === assetId) ?? null;
	useEffect(() => {
		if (assetId && !asset) close();
	}, [assetId, asset, close]);
	useEffect(() => {
		if (!assetId) return;
		const offPlay = editor.playback.subscribe(() => {
			if (editor.playback.getIsPlaying()) close();
		});
		// Any press in the timeline (ruler, a clip, an empty row) goes back to the timeline's picture. Not a selection
		// change by itself: an insert from the source selects the new clip, and the source stays for the next range.
		const onPress = (event: PointerEvent) => {
			if ((event.target as Element | null)?.closest?.('section[aria-label="Timeline"]')) close();
		};
		document.addEventListener("pointerdown", onPress, true);
		return () => {
			offPlay();
			document.removeEventListener("pointerdown", onPress, true);
		};
	}, [assetId, close, editor]);
	if (!asset) return null;
	return <Monitor key={asset.id} asset={asset} editor={editor} onClose={close} />;
}

function Monitor({ asset, editor, onClose }: { asset: MediaAsset; editor: EditorCore; onClose: () => void }) {
	const tr = useT();
	const url = useAssetUrl(asset);
	const media = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
	const root = useRef<HTMLDivElement>(null);
	const marks = useSourceMarks((state) => state.marks[asset.id]);
	const setIn = useSourceMarks((state) => state.setIn);
	const setOut = useSourceMarks((state) => state.setOut);
	const clearMarks = useSourceMarks((state) => state.clear);
	const [time, setTime] = useState(0);
	const [playing, setPlaying] = useState(false);
	const reverse = useRef<{ rate: number; last: number; frame: number } | null>(null);
	const duration = asset.duration ?? 0;
	const isImage = asset.type === "image";
	const peaks = useWaveformPeaks(asset.type === "audio" ? asset : null, 120);
	const assetFps = (asset as { fps?: number }).fps;
	const fps = assetFps && assetFps > 0 ? assetFps : 30;

	// The source playhead for the tiles (audio waveform playhead), a few times a second.
	useEffect(() => {
		const id = window.setInterval(() => {
			const m = media.current;
			if (m) useSourceStore.getState().setTime(m.currentTime);
		}, 120);
		return () => window.clearInterval(id);
	}, []);

	// Smooth playhead while playing.
	useEffect(() => {
		if (!playing) return;
		let frame = 0;
		const tick = () => {
			if (media.current) setTime(media.current.currentTime);
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [playing]);

	const stopReverse = useCallback(() => {
		if (reverse.current) cancelAnimationFrame(reverse.current.frame);
		reverse.current = null;
	}, []);
	useEffect(() => stopReverse, [stopReverse]);

	const seek = useCallback(
		(t: number) => {
			const m = media.current;
			const clamped = Math.max(0, Math.min(duration || m?.duration || 0, t));
			if (m) m.currentTime = clamped;
			setTime(clamped);
		},
		[duration],
	);

	const pause = useCallback(() => {
		stopReverse();
		media.current?.pause();
	}, [stopReverse]);

	const play = useCallback(
		(rate = 1) => {
			const m = media.current;
			if (!m) return;
			stopReverse();
			// At the end (or at Out), start again from In.
			const range = markedRange({ asset });
			const end = range?.end ?? duration;
			if (end && m.currentTime >= end - 0.05) m.currentTime = range?.start ?? 0;
			m.playbackRate = rate;
			void m.play().catch(() => {});
		},
		[asset, duration, stopReverse],
	);

	const runReverse = useCallback(
		(rate: number) => {
			const m = media.current;
			if (!m) return;
			m.pause();
			stopReverse();
			const state = { rate, last: performance.now(), frame: 0 };
			const tick = (now: number) => {
				const elapsed = (now - state.last) / 1000;
				state.last = now;
				const next = Math.max(0, m.currentTime - elapsed * state.rate);
				m.currentTime = next;
				setTime(next);
				if (next <= 0) {
					reverse.current = null;
					return;
				}
				state.frame = requestAnimationFrame(tick);
			};
			state.frame = requestAnimationFrame(tick);
			reverse.current = state;
		},
		[stopReverse],
	);

	// the source monitor's Insert (↵ with I / O marked) stays the pro edit at the playhead (pro-core H)
	const insert = useCallback(() => {
		insertSourceRange({ editor, asset });
		const range = markedRange({ asset });
		toast.success(range ? `Inserted ${fmt(range.end - range.start)} of «${asset.name}»` : `Inserted «${asset.name}»`, { duration: 1500 });
	}, [editor, asset]);

	// Keys from the global keyboard handler (Space, J K L, I O, ← →) while the Media panel has focus.
	useEffect(() => {
		sourceControls.current = {
			toggle: () => {
				const m = media.current;
				if (!m || isImage) return;
				if (m.paused && !reverse.current) play();
				else pause();
			},
			shuttle: (direction) => {
				const m = media.current;
				if (!m || isImage) return;
				if (direction === 0) return pause();
				if (direction > 0) {
					const rate = !m.paused && !reverse.current ? Math.min(8, m.playbackRate * 2) : 1;
					play(rate);
				} else {
					runReverse(reverse.current ? Math.min(8, reverse.current.rate * 2) : 1);
				}
			},
			step: (frames) => {
				pause();
				seek((media.current?.currentTime ?? 0) + frames / fps);
			},
			markIn: () => !isImage && setIn({ id: asset.id, seconds: media.current?.currentTime ?? 0 }),
			markOut: () => !isImage && setOut({ id: asset.id, seconds: Math.min(duration || Infinity, (media.current?.currentTime ?? 0) + 1 / fps) }),
			clearMarks: () => clearMarks({ id: asset.id }),
			clearIn: () => useSourceMarks.getState().clearIn({ id: asset.id }),
			clearOut: () => useSourceMarks.getState().clearOut({ id: asset.id }),
			gotoIn: () => {
				const mark = useSourceMarks.getState().marks[asset.id]?.in;
				if (mark === undefined) return;
				pause();
				seek(mark);
			},
			gotoOut: () => {
				const mark = useSourceMarks.getState().marks[asset.id]?.out;
				if (mark === undefined) return;
				pause();
				seek(Math.max(0, mark - 1 / fps)); // the Out frame itself: the stored end is the edge after it
			},
			gotoStart: () => seek(0),
			gotoEnd: () => seek(duration),
			seek: (seconds) => {
				// a tile's hover line: the playhead goes with it (never while the source plays — source-store.ts setSkim)
				stopReverse();
				seek(seconds);
			},
			insert,
		};
		// opened by a mark on a hovered tile: it opens where that mark is
		const at = takeOpenAt(asset.id);
		if (at !== null) seek(at);
		return () => {
			sourceControls.current = null;
		};
	}, [asset.id, clearMarks, duration, fps, insert, isImage, pause, play, runReverse, seek, setIn, setOut, stopReverse]);

	useEffect(() => {
		useSourceStore.getState().setPlaying(playing);
	}, [playing]);

	const range = markedRange({ asset, marks });
	const length = range ? range.end - range.start : duration;

	return (
		<div
			ref={root}
			tabIndex={-1}
			data-source-monitor
			{...{ [SOURCE_SCOPE_ATTR]: "" }}
			className="bg-background group/source absolute inset-0 z-20 flex flex-col gap-2 p-2 outline-none"
			onPointerDown={() => {
				// Clicking anywhere in the source preview makes it the keyboard target (Space, I, O…).
				if (!root.current?.contains(document.activeElement)) root.current?.focus({ preventScroll: true });
			}}
		>
			<div className="flex items-center gap-1.5">
				<span className="group-focus-within/source:bg-primary group-focus-within/source:text-primary-foreground bg-muted text-muted-foreground rounded px-1 text-[9px] font-semibold tracking-wide">
					SOURCE
				</span>
				<span className="min-w-0 flex-1 truncate text-xs" title={asset.name}>
					{asset.name}
				</span>
				{/* The way back to the edit, said in words: a lone ✕ in the corner left newcomers thinking their timeline was gone. */}
				<button
					type="button"
					data-source-back
					aria-label="Back to the timeline"
					title="Back to the timeline's picture"
					className="bg-foreground text-background hover:bg-foreground/90 focus-visible:ring-ring flex h-6 shrink-0 items-center gap-1 rounded-full pr-2.5 pl-2 text-[11px] font-medium focus-visible:ring-2 focus-visible:outline-hidden"
					onClick={onClose}
				>
					<HugeiconsIcon icon={ArrowLeft01Icon} className="size-3" />
					Back to timeline
				</button>
			</div>
			<div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded bg-black">
				{isImage ? (
					// eslint-disable-next-line @next/next/no-img-element
					url && <img src={url} alt="" className="max-h-full max-w-full object-contain" />
				) : asset.type === "video" ? (
					// biome-ignore lint/a11y/useMediaCaption: source preview of the user's own clip
					// eslint-disable-next-line jsx-a11y/media-has-caption
					<video
						ref={(el) => {
							media.current = el;
						}}
						src={url ?? undefined}
						preload="auto"
						playsInline
						className="size-full cursor-pointer object-contain"
						onClick={() => sourceControls.current?.toggle()}
						onPlay={() => setPlaying(true)}
						onPause={() => setPlaying(false)}
						onTimeUpdate={(e) => !playing && setTime(e.currentTarget.currentTime)}
						onSeeked={(e) => setTime(e.currentTarget.currentTime)}
					/>
				) : (
					<div className="text-primary/80 flex h-1/3 w-full items-center px-4">
						<WaveformBars peaks={peaks} className="h-full w-full" />
						{/* eslint-disable-next-line jsx-a11y/media-has-caption */}
						<audio
							ref={(el) => {
								media.current = el;
							}}
							src={url ?? undefined}
							preload="auto"
							onPlay={() => setPlaying(true)}
							onPause={() => setPlaying(false)}
							onSeeked={(e) => setTime(e.currentTarget.currentTime)}
						/>
					</div>
				)}
			</div>
			{!isImage && (
				<>
					<ScrubBar
						duration={duration}
						time={time}
						range={range}
						marks={marks}
						onSeek={(t) => {
							pause();
							seek(t);
						}}
						onMoveRange={(start, end) => useSourceMarks.setState((state) => ({ marks: { ...state.marks, [asset.id]: { in: start, out: end } } }))}
					/>
					<div className="flex flex-wrap items-center gap-1">
						<Button
							variant="ghost"
							size="icon"
							className="size-7"
							aria-label={playing ? "Pause source" : "Play source"}
							onClick={() => sourceControls.current?.toggle()}
						>
							{playing ? <HugeiconsIcon icon={PauseIcon} className="size-3.5" /> : <HugeiconsIcon icon={PlayIcon} className="size-3.5" />}
						</Button>
						<span className="text-muted-foreground text-[10px] tabular-nums">
							{fmt(time)} / {fmt(duration)}
						</span>
						<div className="ml-auto flex items-center gap-1">
							{/* «Clear» stands BEFORE In and Out: the row is pressed to the right, so the two never move when it
							    appears — at the end it took the place of «Out», and a second click there wiped the marks (15.11) */}
							{range && (
								<Button variant="ghost" size="sm" className="h-6 px-1 text-[10px]" title="Clear In/Out (⌥X)" onClick={() => clearMarks({ id: asset.id })} data-source-clear>
									Clear
								</Button>
							)}
							<Button variant="outline" size="sm" className="h-6 px-1.5 text-[10px]" title="Mark In (I)" onClick={() => sourceControls.current?.markIn()} data-source-mark="in">
								In
							</Button>
							<Button variant="outline" size="sm" className="h-6 px-1.5 text-[10px]" title="Mark Out (O)" onClick={() => sourceControls.current?.markOut()} data-source-mark="out">
								Out
							</Button>
						</div>
					</div>
				</>
			)}
			<div className="flex items-center gap-1.5">
				<Button size="sm" className="h-7 flex-1 text-xs" onClick={insert} title="Insert at the timeline playhead (↵ or double-click the tile)" data-source-insert>
					{tr("Insert {what} at playhead", { what: range ? fmt(length) : tr("whole clip") })}
				</Button>
			</div>
		</div>
	);
}

function ScrubBar({
	duration,
	time,
	range,
	marks,
	onSeek,
	onMoveRange,
}: {
	duration: number;
	time: number;
	range: { start: number; end: number } | null;
	marks: { in?: number; out?: number } | undefined;
	onSeek: (t: number) => void;
	/** The marked range slid as a whole (its length kept). */
	onMoveRange: (start: number, end: number) => void;
}) {
	const bar = useRef<HTMLDivElement>(null);
	// a press inside the marked range that moves slides the range (the owner, 14.11: the whole In–Out by its middle,
	// in the source too); a press that does not move — and any press outside the range — is a seek, as before
	const drag = useRef<{ range: { start: number; end: number } | null; x0: number; moved: boolean } | null>(null);
	const pct = (t: number) => `${(Math.max(0, Math.min(t, duration)) / Math.max(duration, 0.001)) * 100}%`;
	const at = (clientX: number) => {
		const r = bar.current?.getBoundingClientRect();
		if (!r) return 0;
		return (Math.max(0, Math.min(clientX - r.left, r.width)) / r.width) * duration;
	};
	return (
		<div
			ref={bar}
			data-source-scrub
			className={cn("bg-accent relative h-5 cursor-pointer touch-none overflow-hidden rounded")}
			onPointerDown={(event) => {
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				const t = at(event.clientX);
				const inside = range && t >= range.start && t <= range.end ? range : null;
				drag.current = { range: inside, x0: event.clientX, moved: false };
				if (!inside) onSeek(t);
			}}
			onPointerMove={(event) => {
				const d = drag.current;
				if (!d || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
				if (!d.range) return onSeek(at(event.clientX));
				const dx = event.clientX - d.x0;
				if (!d.moved && Math.abs(dx) < 3) return;
				d.moved = true;
				const width = bar.current?.getBoundingClientRect().width || 1;
				const length = d.range.end - d.range.start;
				const start = Math.max(0, Math.min(Math.max(0, duration - length), d.range.start + (dx / width) * duration));
				onMoveRange(start, start + length);
			}}
			onPointerUp={(event) => {
				const d = drag.current;
				drag.current = null;
				if (d?.range && !d.moved) onSeek(at(event.clientX));
			}}
			onPointerCancel={() => {
				drag.current = null;
			}}
		>
			{range && (
				<div
					data-source-range
					className="absolute inset-y-0 cursor-grab border-x-2 border-yellow-400 bg-yellow-400/25 active:cursor-grabbing"
					style={{ left: pct(range.start), width: `calc(${pct(range.end)} - ${pct(range.start)})` }}
				/>
			)}
			{!range && marks?.in !== undefined && <div className="absolute inset-y-0 w-0.5 bg-yellow-400" style={{ left: pct(marks.in) }} />}
			<div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: pct(time) }} />
		</div>
	);
}
