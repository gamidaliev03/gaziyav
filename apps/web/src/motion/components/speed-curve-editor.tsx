"use client";

// The speed-ramp editor: speed (log scale 0.1–10×) over the clip, smooth through draggable points.
// Drag a point up/down (speed) and sideways; double-click empty space to add a point, a point to remove it.
import { memo, useMemo, useRef, useState } from "react";
import { getCurveTable, MAX_CURVE_SPEED, MIN_CURVE_SPEED, normalizeCurvePoints, SPEED_CURVE_PRESETS } from "@/retime/curve";
import type { SpeedCurve, SpeedCurvePresetId } from "@/motion/types";
import { cn } from "@/utils/ui";

const W = 280;
const H = 120;
const PAD_X = 10;
const PAD_Y = 12;
const LOG_RANGE = Math.log(MAX_CURVE_SPEED / MIN_CURVE_SPEED);

const yOf = (v: number) => H - PAD_Y - (Math.log(v / MIN_CURVE_SPEED) / LOG_RANGE) * (H - 2 * PAD_Y);
const vOf = (y: number) => MIN_CURVE_SPEED * Math.exp(((H - PAD_Y - y) / (H - 2 * PAD_Y)) * LOG_RANGE);
const xOf = (s: number) => PAD_X + s * (W - 2 * PAD_X);
const sOf = (x: number) => (x - PAD_X) / (W - 2 * PAD_X);

function curvePath(points: SpeedCurve["points"], w = W, h = H, padX = PAD_X, padY = PAD_Y): string {
	const table = getCurveTable({ points });
	const parts: string[] = [];
	for (let i = 0; i <= 80; i++) {
		const s = i / 80;
		const v = table.speed(s);
		const x = padX + s * (w - 2 * padX);
		const y = h - padY - (Math.log(v / MIN_CURVE_SPEED) / LOG_RANGE) * (h - 2 * padY);
		parts.push(`${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`);
	}
	return parts.join(" ");
}

const PRESET_PATHS = new Map<string, string>();
function presetPath(id: string, points: SpeedCurve["points"]): string {
	let d = PRESET_PATHS.get(id);
	if (!d) {
		d = curvePath(points, 48, 24, 2, 3);
		PRESET_PATHS.set(id, d);
	}
	return d;
}

/** Preset tiles (CapCut names): a mini curve and a name each. */
export const SpeedCurvePresets = memo(function SpeedCurvePresets({
	value,
	onPick,
}: {
	value: SpeedCurvePresetId | null;
	onPick: (preset: SpeedCurvePresetId) => void;
}) {
	return (
		<div className="grid grid-cols-4 gap-1.5" data-speed-presets>
			{SPEED_CURVE_PRESETS.map((p) => (
				<button
					key={p.id}
					type="button"
					data-speed-preset={p.id}
					aria-pressed={value === p.id}
					onClick={() => onPick(p.id)}
					className={cn(
						"flex flex-col items-center gap-1 rounded-md border px-1 pt-1.5 pb-1 text-[11px] transition-colors",
						value === p.id ? "border-primary bg-primary/10 text-foreground" : "border-border hover:bg-accent text-muted-foreground",
					)}
				>
					<svg viewBox="0 0 48 24" className="h-5 w-full" aria-hidden>
						<line x1="2" x2="46" y1={12} y2={12} className="stroke-border" strokeWidth="1" strokeDasharray="2 2" />
						<path d={presetPath(p.id, p.points)} fill="none" className="stroke-primary" strokeWidth="1.6" strokeLinecap="round" />
					</svg>
					<span className="leading-none whitespace-nowrap">{p.label}</span>
				</button>
			))}
		</div>
	);
});

export function SpeedCurveEditor({
	curve,
	playhead,
	onPreview,
	onCommit,
}: {
	curve: SpeedCurve;
	/** Source fraction (0..1) under the playhead, when the playhead is on the clip. */
	playhead?: number | null;
	onPreview: (curve: SpeedCurve) => void;
	onCommit: (curve: SpeedCurve) => void;
}) {
	const svgRef = useRef<SVGSVGElement>(null);
	const [draft, setDraft] = useState<SpeedCurve | null>(null);
	const [drag, setDrag] = useState<number | null>(null);
	const shown = draft ?? curve;
	const points = useMemo(() => normalizeCurvePoints(shown.points), [shown.points]);
	const path = useMemo(() => curvePath(points), [points]);

	const toLocal = (e: React.PointerEvent | React.MouseEvent) => {
		const r = svgRef.current!.getBoundingClientRect();
		return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
	};

	const move = (e: React.PointerEvent) => {
		if (drag === null) return;
		const { x, y } = toLocal(e);
		const next = points.map((p) => ({ ...p }));
		const i = drag;
		const v = Math.min(MAX_CURVE_SPEED, Math.max(MIN_CURVE_SPEED, vOf(y)));
		// Snap to 1× near it — the most wanted value.
		next[i].y = Math.abs(Math.log(v)) < 0.06 ? 1 : Math.round(v * 100) / 100;
		if (i > 0 && i < next.length - 1) {
			next[i].x = Math.min(next[i + 1].x - 0.02, Math.max(next[i - 1].x + 0.02, sOf(x)));
		}
		const c = { preset: "custom" as const, points: next };
		setDraft(c);
		onPreview(c);
	};

	const end = () => {
		if (drag === null) return;
		setDrag(null);
		if (draft) onCommit(draft);
		setDraft(null);
	};

	return (
		<div className="flex flex-col gap-1" data-speed-curve-editor>
			<svg
				ref={svgRef}
				viewBox={`0 0 ${W} ${H}`}
				className="bg-accent/40 h-[120px] w-full touch-none rounded-md select-none"
				onPointerMove={move}
				onPointerUp={end}
				onPointerCancel={end}
				onDoubleClick={(e) => {
					if ((e.target as Element).getAttribute("data-curve-point")) return;
					const { x, y } = toLocal(e);
					const s = sOf(x);
					if (s <= 0.01 || s >= 0.99) return;
					const next = normalizeCurvePoints([...points, { x: s, y: vOf(y) }]);
					onCommit({ preset: "custom", points: next });
				}}
			>
				{[0.1, 0.5, 1, 2, 5, 10].map((v) => (
					<g key={v}>
						<line x1={PAD_X} x2={W - PAD_X} y1={yOf(v)} y2={yOf(v)} className={v === 1 ? "stroke-muted-foreground/50" : "stroke-border"} strokeWidth="1" strokeDasharray={v === 1 ? "4 3" : "2 4"} />
						<text x={W - PAD_X - 1} y={yOf(v) - 2} textAnchor="end" className="fill-muted-foreground text-[8px]">
							{v}×
						</text>
					</g>
				))}
				{playhead != null && playhead >= 0 && playhead <= 1 && (
					<line x1={xOf(playhead)} x2={xOf(playhead)} y1={PAD_Y / 2} y2={H - PAD_Y / 2} className="stroke-primary/60" strokeWidth="1" />
				)}
				<path d={path} fill="none" className="stroke-primary" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
				{points.map((p, i) => (
					<circle
						// biome-ignore lint/suspicious/noArrayIndexKey: the curve's points are kept in order; a point is its place
						key={i}
						data-curve-point={i}
						cx={xOf(p.x)}
						cy={yOf(p.y)}
						r={drag === i ? 6 : 5}
						className={cn("fill-background stroke-primary cursor-grab", drag === i && "cursor-grabbing")}
						strokeWidth="2"
						onPointerDown={(e) => {
							e.stopPropagation();
							(e.target as Element).setPointerCapture?.(e.pointerId);
							setDrag(i);
						}}
						onDoubleClick={(e) => {
							e.stopPropagation();
							if (i === 0 || i === points.length - 1 || points.length <= 2) return;
							onCommit({ preset: "custom", points: points.filter((_, k) => k !== i) });
						}}
					>
						<title>{`${p.y.toFixed(2)}× — drag; double-click to remove`}</title>
					</circle>
				))}
			</svg>
			<p className="text-muted-foreground text-[11px]">Drag points · double-click to add or remove</p>
		</div>
	);
}
