"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MediaAsset } from "@/media/types";
import { useSourceMarks } from "@/media/source-marks";
import { buildWaveformSourceKey } from "@/media/waveform-summary";
import { waveformCache } from "@/services/waveform-cache/service";
import { clearSkim, setSkim, useSourceStore } from "./source-store";

/** A playable URL for a media item (its own blob URL, else one made from the file). */
export function useAssetUrl(asset: MediaAsset | null | undefined): string | null {
	const made = useMemo(() => (asset && !asset.url && asset.file ? URL.createObjectURL(asset.file) : null), [asset]);
	useEffect(() => () => {
		if (made) URL.revokeObjectURL(made);
	}, [made]);
	return asset?.url ?? made;
}

/** Peaks (0..1) of a media item's sound, `count` bars. */
export function useWaveformPeaks(asset: MediaAsset | null | undefined, count: number): number[] | null {
	const [peaks, setPeaks] = useState<number[] | null>(null);
	useEffect(() => {
		if (!asset || asset.type === "image") return;
		let cancelled = false;
		waveformCache
			.getSourceSummary({ sourceKey: buildWaveformSourceKey({ kind: "media", id: asset.id }), sourceFile: asset.file })
			.then((summary) => {
				if (cancelled) return;
				const amps = summary.amplitudes;
				const out: number[] = [];
				let max = 0;
				for (let i = 0; i < count; i++) {
					const a = Math.floor((i * amps.length) / count);
					const b = Math.max(a + 1, Math.floor(((i + 1) * amps.length) / count));
					let peak = 0;
					for (let j = a; j < b && j < amps.length; j++) peak = Math.max(peak, amps[j] ?? 0);
					out.push(peak);
					max = Math.max(max, peak);
				}
				setPeaks(out.map((v) => (max > 0 ? v / max : 0)));
			})
			.catch(() => setPeaks([]));
		return () => {
			cancelled = true;
		};
	}, [asset, count]);
	return peaks;
}

export function WaveformBars({ peaks, className }: { peaks: number[] | null; className?: string }) {
	if (!peaks?.length) return null;
	const w = 100 / peaks.length;
	return (
		<svg className={className} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
			{peaks.map((p, i) => {
				const h = Math.max(2, p * 92);
				// biome-ignore lint/suspicious/noArrayIndexKey: a bar per position of the waveform
				return <rect key={i} x={i * w + w * 0.15} width={w * 0.7} y={50 - h / 2} height={h} rx={0.4} fill="currentColor" />;
			})}
		</svg>
	);
}

/**
 * In/Out of a media item as a bar along the bottom of its tile. The marked part slides as a whole by its middle (the
 */
export function MarksBar({ asset }: { asset: MediaAsset }) {
	const marks = useSourceMarks((state) => state.marks[asset.id]);
	const track = useRef<HTMLDivElement>(null);
	if (!marks || !asset.duration || (marks.in === undefined && marks.out === undefined)) return null;
	const duration = asset.duration;
	const from = Math.max(0, Math.min(duration, marks.in ?? 0));
	const to = Math.max(from, Math.min(duration, marks.out ?? duration));
	const start = from / duration;
	const end = to / duration;
	const slide = (event: React.PointerEvent<HTMLDivElement>) => {
		// the tile under it is draggable and opens the item on a click: this press is the bar's alone
		event.preventDefault();
		event.stopPropagation();
		const width = track.current?.getBoundingClientRect().width || 1;
		const x0 = event.clientX;
		const length = to - from;
		const move = (ev: PointerEvent) => {
			const next = Math.max(0, Math.min(Math.max(0, duration - length), from + ((ev.clientX - x0) / width) * duration));
			useSourceMarks.setState((state) => ({ marks: { ...state.marks, [asset.id]: { in: next, out: next + length } } }));
		};
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};
	const quiet = (event: React.SyntheticEvent) => {
		event.preventDefault();
		event.stopPropagation();
	};
	return (
		<div ref={track} className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-black/50" data-marks-bar>
			<div
				className="pointer-events-auto absolute inset-y-0 cursor-grab bg-yellow-400 active:cursor-grabbing"
				style={{ left: `${start * 100}%`, width: `${(end - start) * 100}%` }}
				title="Drag to move the marked part"
				data-marks-range
				draggable={false}
				onPointerDown={slide}
				onMouseDown={quiet}
				onClick={quiet}
				onDragStart={quiet}
			>
				{/* a taller place to grab than the 4-px line */}
				<span className="absolute inset-x-0 -top-2 bottom-0" />
			</div>
			<button
				type="button"
				aria-label="Clear In / Out"
				title="Clear In / Out"
				data-marks-clear
				draggable={false}
				className="pointer-events-auto absolute -top-3.5 hidden size-3.5 -translate-x-1/2 items-center justify-center rounded-full bg-black/70 text-[9px] leading-none text-white group-hover:flex"
				style={{ left: `${Math.min(96, Math.max(4, end * 100))}%` }}
				onPointerDown={quiet}
				onMouseDown={quiet}
				onClick={(event) => {
					quiet(event);
					useSourceMarks.getState().clear({ id: asset.id });
				}}
			>
				×
			</button>
		</div>
	);
}

/** Video tile: moving the pointer across it scrubs through the clip (FCP / Premiere hover scrub). */
export function HoverScrubVideo({ asset }: { asset: MediaAsset }) {
	const [x, setX] = useState<number | null>(null);
	const video = useRef<HTMLVideoElement>(null);
	const pending = useRef<number | null>(null);
	const url = useAssetUrl(x === null ? null : asset);
	const playhead = useSourceStore((state) => (state.assetId === asset.id && asset.duration ? state.time / asset.duration : null));
	useEffect(() => () => clearSkim(asset.id), [asset.id]);

	const seek = (fraction: number) => {
		const v = video.current;
		const d = asset.duration ?? v?.duration ?? 0;
		if (!v || !d) return;
		const t = Math.max(0, Math.min(d - 0.05, fraction * d));
		if (v.seeking) {
			pending.current = t; // only the latest position matters
			return;
		}
		v.currentTime = t;
	};

	return (
		<div
			className="absolute inset-0"
			data-hover-scrub
			onPointerMove={(event) => {
				const r = event.currentTarget.getBoundingClientRect();
				const fraction = Math.max(0, Math.min(1, (event.clientX - r.left) / r.width));
				setX(fraction);
				seek(fraction);
				// one playhead with the source monitor: it goes where the line is, and I / O mark there (source-store.ts)
				const d = asset.duration ?? video.current?.duration ?? 0;
				if (d > 0) setSkim({ assetId: asset.id, seconds: Math.min(Math.max(0, d - 0.05), fraction * d), duration: d, fps: (asset as { fps?: number }).fps });
			}}
			onPointerLeave={() => {
				setX(null);
				pending.current = null;
				clearSkim(asset.id);
			}}
		>
			{/* the pointer away: the source monitor's playhead, when it shows this item — the same line */}
			{x === null && playhead !== null && <div className="pointer-events-none absolute inset-y-0 w-px bg-white/90" style={{ left: `${Math.min(1, playhead) * 100}%` }} data-source-playhead />}
			{x !== null && url && (
				<>
					<video
						ref={video}
						src={url}
						muted
						playsInline
						preload="auto"
						className="pointer-events-none absolute inset-0 size-full rounded bg-black object-cover"
						onLoadedMetadata={() => seek(x)}
						onSeeked={(event) => {
							const t = pending.current;
							pending.current = null;
							if (t !== null) event.currentTarget.currentTime = t;
						}}
					/>
					<div className="pointer-events-none absolute inset-y-0 w-px bg-white/90" style={{ left: `${x * 100}%` }} />
				</>
			)}
		</div>
	);
}

/** Audio tile: the waveform, a hover line, and the source playhead while the source preview plays it. */
export function AudioTileWaveform({ asset }: { asset: MediaAsset }) {
	const peaks = useWaveformPeaks(asset, 40);
	const [x, setX] = useState<number | null>(null);
	useEffect(() => () => clearSkim(asset.id), [asset.id]);
	const playhead = useSourceStore((state) => (state.assetId === asset.id && asset.duration ? state.time / asset.duration : null));
	return (
		<div
			className="text-primary/80 relative flex size-full items-center rounded border bg-muted/30 px-1"
			onPointerMove={(event) => {
				const r = event.currentTarget.getBoundingClientRect();
				const fraction = Math.max(0, Math.min(1, (event.clientX - r.left) / r.width));
				setX(fraction);
				if (asset.duration) setSkim({ assetId: asset.id, seconds: fraction * asset.duration, duration: asset.duration });
			}}
			onPointerLeave={() => {
				setX(null);
				clearSkim(asset.id);
			}}
		>
			{peaks?.length ? (
				<WaveformBars peaks={peaks} className="h-3/5 w-full" />
			) : (
				<span className="text-muted-foreground w-full text-center text-xs">Audio</span>
			)}
			{x !== null && <div className="pointer-events-none absolute inset-y-0 w-px bg-white/70" style={{ left: `${x * 100}%` }} />}
			{playhead !== null && (
				<div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white" style={{ left: `${Math.min(1, playhead) * 100}%` }} />
			)}
		</div>
	);
}
