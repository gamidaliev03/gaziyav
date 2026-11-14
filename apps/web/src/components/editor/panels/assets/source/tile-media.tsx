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

/** In/Out of a media item as a bar along the bottom of its tile. */
export function MarksBar({ asset }: { asset: MediaAsset }) {
	const marks = useSourceMarks((state) => state.marks[asset.id]);
	if (!marks || !asset.duration || (marks.in === undefined && marks.out === undefined)) return null;
	const start = Math.max(0, Math.min(1, (marks.in ?? 0) / asset.duration));
	const end = Math.max(start, Math.min(1, (marks.out ?? asset.duration) / asset.duration));
	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-black/50" data-marks-bar>
			<div className="absolute inset-y-0 bg-yellow-400" style={{ left: `${start * 100}%`, width: `${(end - start) * 100}%` }} />
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
