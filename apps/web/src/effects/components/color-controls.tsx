"use client";

// The parts of the Color section: a centred slider row, the curves editor, HSL and the colour wheels. Each edit goes
// through `edit`: start (the tracks before) → preview (live, no history) → end (one ⌘Z step).
import { useRef, useState } from "react";
import { Segmented } from "@/components/ui/segmented";
import { Slider } from "@/components/ui/slider";
import {
	CURVE_CHANNELS,
	CURVE_X,
	type CurveChannel,
	curveKey,
	HSL_RANGES,
	type HslAxis,
	hslKey,
	WHEELS,
	wheelKey,
} from "@/effects/definitions/studio/color";
import { useT } from "@/i18n";
import type { ParamValues } from "@/params";
import { cn } from "@/utils/ui";

export interface ColorEdit {
	start: () => void;
	preview: (patch: ParamValues) => void;
	end: () => void;
	apply: (patch: ParamValues) => void;
}

const n = (p: ParamValues, key: string, fallback: number) => {
	const v = Number(p[key] ?? fallback);
	return Number.isFinite(v) ? v : fallback;
};

export function ColorSlider({
	label,
	paramKey,
	params,
	edit,
	min = -100,
	max = 100,
	step = 1,
	neutral = 0,
	swatch,
}: {
	label: string;
	paramKey: string;
	params: ParamValues;
	edit: ColorEdit;
	min?: number;
	max?: number;
	step?: number;
	neutral?: number;
	swatch?: string;
}) {
	const value = n(params, paramKey, neutral);
	return (
		// (a narrow inspector — a 1024-px window: tighter gaps, a shorter name and value, so the slider keeps a draggable length)
		<div className="flex h-7 items-center gap-2 px-4 @max-[17.5rem]/insp:gap-1" data-color-param={paramKey}>
			{swatch && <span className="size-2.5 shrink-0 rounded-full" style={{ background: swatch }} />}
			{/* CapCut: the name is text, not a button (a click on it did nothing); a double-click on the slider resets */}
			<span title={label} className="text-muted-foreground line-clamp-2 w-[5.5rem] shrink-0 cursor-default text-left text-xs leading-tight select-none @max-[17.5rem]/insp:w-[5rem]">
				{label}
			</span>
			<Slider
				aria-label={label}
				className="h-7 min-w-0 flex-1"
				min={min}
				max={max}
				step={step}
				origin={min < neutral ? neutral : undefined}
				value={[value]}
				onValueChange={([next]) => {
					edit.start();
					edit.preview({ [paramKey]: next });
				}}
				onValueCommit={edit.end}
				onPointerUp={edit.end}
				onDoubleClick={() => edit.apply({ [paramKey]: neutral })}
				trackClassName="relative h-[3px] w-full grow overflow-hidden rounded-full bg-[var(--track,rgba(255,255,255,.16))]"
				thumbSize={12}
				thumbClassName="block size-3 rounded-full border-0 bg-white shadow-[0_1px_3px_rgba(0,0,0,.55),0_0_0_.5px_rgba(0,0,0,.3)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] outline-none"
			/>
			<span className="w-9 shrink-0 text-right text-xs tabular-nums @max-[17.5rem]/insp:w-7">{step < 1 ? value.toFixed(2) : Math.round(value)}</span>
		</div>
	);
}

/** The same curve the shader draws: Catmull-Rom through five points at x = 0, ¼, ½, ¾, 1 (all 0…1). */
export function curveAt(x: number, ys: number[]): number {
	const t = Math.min(1, Math.max(0, x)) * 4;
	const i = Math.min(Math.floor(t), 3);
	const f = t - i;
	const p1 = ys[i];
	const p2 = ys[i + 1];
	const p0 = i === 0 ? 2 * p1 - p2 : ys[i - 1];
	const p3 = i === 3 ? 2 * p2 - p1 : ys[i + 2];
	const v = 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f * f * f);
	return Math.min(1, Math.max(0, v));
}

const CHANNEL_COLOR: Record<CurveChannel, string> = { m: "#ffffff", r: "#f87171", g: "#4ade80", b: "#60a5fa" };

export function CurvesEditor({ params, edit }: { params: ParamValues; edit: ColorEdit }) {
	const t = useT();
	const [channel, setChannel] = useState<CurveChannel>("m");
	const svg = useRef<SVGSVGElement>(null);
	const dragging = useRef<number | null>(null);
	const ys = CURVE_X.map((x, i) => n(params, curveKey(channel, i), x));
	const path = Array.from({ length: 51 }, (_, k) => {
		const x = k / 50;
		return `${k === 0 ? "M" : "L"}${(x * 100).toFixed(2)},${(100 - curveAt(x, ys.map((y) => y / 100)) * 100).toFixed(2)}`;
	}).join(" ");
	const valueAt = (clientY: number) => {
		const r = svg.current?.getBoundingClientRect();
		if (!r) return 0;
		return Math.round(Math.min(100, Math.max(0, 100 - ((clientY - r.top) / r.height) * 100)));
	};
	const pointAt = (clientX: number) => {
		const r = svg.current?.getBoundingClientRect();
		if (!r) return 0;
		return Math.min(4, Math.max(0, Math.round(((clientX - r.left) / r.width) * 4)));
	};
	return (
		<div className="flex flex-col gap-2 px-4 pb-1" data-color-curves>
			<Segmented
				aria-label={t("Curve")}
				value={channel}
				onValueChange={setChannel}
				items={CURVE_CHANNELS.map((c) => ({ value: c, label: c === "m" ? "RGB" : c.toUpperCase() }))}
			/>
			<svg
				ref={svg}
				viewBox="-2 -2 104 104"
				className="aspect-square w-full max-w-60 touch-none self-center rounded-md bg-black/30"
				role="img"
				aria-label={t("Curve")}
				onPointerDown={(event) => {
					if (event.button !== 0) return;
					event.currentTarget.setPointerCapture(event.pointerId);
					dragging.current = pointAt(event.clientX);
					edit.start();
					edit.preview({ [curveKey(channel, dragging.current)]: valueAt(event.clientY) });
				}}
				onPointerMove={(event) => {
					if (dragging.current === null) return;
					edit.preview({ [curveKey(channel, dragging.current)]: valueAt(event.clientY) });
				}}
				onPointerUp={() => {
					if (dragging.current === null) return;
					dragging.current = null;
					edit.end();
				}}
				onDoubleClick={(event) => {
					const i = pointAt(event.clientX);
					edit.apply({ [curveKey(channel, i)]: CURVE_X[i] });
				}}
			>
				{[25, 50, 75].map((g) => (
					<g key={g} stroke="rgba(255,255,255,.08)" strokeWidth={0.5}>
						<line x1={g} y1={0} x2={g} y2={100} />
						<line x1={0} y1={g} x2={100} y2={g} />
					</g>
				))}
				<line x1={0} y1={100} x2={100} y2={0} stroke="rgba(255,255,255,.15)" strokeWidth={0.5} strokeDasharray="2 2" />
				<path d={path} fill="none" stroke={CHANNEL_COLOR[channel]} strokeWidth={1.2} />
				{ys.map((y, i) => (
					<circle key={CURVE_X[i]} cx={CURVE_X[i]} cy={100 - y} r={2.6} fill={CHANNEL_COLOR[channel]} stroke="#000" strokeWidth={0.6} data-curve-point={i} />
				))}
			</svg>
		</div>
	);
}

export function HslControls({ params, edit }: { params: ParamValues; edit: ColorEdit }) {
	const t = useT();
	const [axis, setAxis] = useState<HslAxis>("h");
	return (
		<div className="flex flex-col gap-1 pb-1" data-color-hsl>
			<div className="px-4 pb-1">
				<Segmented
					aria-label="HSL"
					value={axis}
					onValueChange={setAxis}
					items={[
						{ value: "h", label: t("Hue") },
						{ value: "s", label: t("Saturation") },
						{ value: "l", label: t("Luminance") },
					]}
				/>
			</div>
			{HSL_RANGES.map((range) => (
				<ColorSlider key={range.id} label={t(range.label)} paramKey={hslKey(axis, range.id)} params={params} edit={edit} swatch={range.swatch} />
			))}
		</div>
	);
}

function WheelPad({ wheel, params, edit }: { wheel: (typeof WHEELS)[number]; params: ParamValues; edit: ColorEdit }) {
	const t = useT();
	const pad = useRef<HTMLDivElement>(null);
	const dragging = useRef(false);
	const xKey = wheelKey(wheel.id, "x");
	const yKey = wheelKey(wheel.id, "y");
	const x = n(params, xKey, 0);
	const y = n(params, yKey, 0);
	const at = (clientX: number, clientY: number) => {
		const r = pad.current?.getBoundingClientRect();
		if (!r) return { [xKey]: 0, [yKey]: 0 };
		let dx = ((clientX - r.left) / r.width) * 2 - 1;
		let dy = 1 - ((clientY - r.top) / r.height) * 2;
		const len = Math.hypot(dx, dy);
		if (len > 1) {
			dx /= len;
			dy /= len;
		}
		return { [xKey]: Math.round(dx * 100) / 100, [yKey]: Math.round(dy * 100) / 100 };
	};
	return (
		<div className="flex min-w-0 flex-1 flex-col items-center gap-1.5" data-color-wheel={wheel.id}>
			<div
				ref={pad}
				role="slider"
				tabIndex={0}
				aria-label={t(wheel.label)}
				aria-valuemin={-100}
				aria-valuemax={100}
				aria-valuenow={Math.round(x * 100)}
				aria-valuetext={`${Math.round(x * 100)}, ${Math.round(y * 100)}`}
				className="relative aspect-square w-full max-w-[5.5rem] cursor-crosshair touch-none rounded-full ring-1 ring-white/10"
				style={{
					background:
						"radial-gradient(circle, rgba(32,32,36,1) 0%, rgba(32,32,36,.55) 45%, rgba(32,32,36,0) 72%), conic-gradient(from 90deg, #ff4d4d, #ff4dff, #4d6bff, #4dffff, #4dff6b, #ffff4d, #ff4d4d)",
				}}
				onPointerDown={(event) => {
					if (event.button !== 0) return;
					event.currentTarget.setPointerCapture(event.pointerId);
					dragging.current = true;
					edit.start();
					edit.preview(at(event.clientX, event.clientY));
				}}
				onPointerMove={(event) => {
					if (dragging.current) edit.preview(at(event.clientX, event.clientY));
				}}
				onPointerUp={() => {
					if (!dragging.current) return;
					dragging.current = false;
					edit.end();
				}}
				onDoubleClick={() => edit.apply({ [xKey]: 0, [yKey]: 0 })}
				onKeyDown={(event) => {
					const d: Record<string, [number, number]> = { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, 0.05], ArrowDown: [0, -0.05] };
					const step = d[event.key];
					if (!step) return;
					event.preventDefault();
					edit.apply({ [xKey]: Math.max(-1, Math.min(1, Math.round((x + step[0]) * 100) / 100)), [yKey]: Math.max(-1, Math.min(1, Math.round((y + step[1]) * 100) / 100)) });
				}}
			>
				<span
					className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/50 bg-white shadow"
					style={{ left: `${50 + x * 50}%`, top: `${50 - y * 50}%` }}
				/>
			</div>
			<span className="text-muted-foreground text-xs">{t(wheel.label)}</span>
		</div>
	);
}

export function WheelsControls({ params, edit }: { params: ParamValues; edit: ColorEdit }) {
	const t = useT();
	return (
		<div className="flex flex-col gap-1 pb-1" data-color-wheels>
			<div className="flex gap-2 px-4">
				{WHEELS.map((wheel) => (
					<WheelPad key={wheel.id} wheel={wheel} params={params} edit={edit} />
				))}
			</div>
			{WHEELS.map((wheel) => (
				<ColorSlider key={wheel.id} label={`${t(wheel.label)} · ${t("level")}`} paramKey={wheelKey(wheel.id, "level")} params={params} edit={edit} />
			))}
		</div>
	);
}

/** Small «changed» dot next to a group title. */
export function ChangedDot({ on }: { on: boolean }) {
	return <span aria-hidden className={cn("bg-primary size-1.5 rounded-full transition-opacity", on ? "opacity-100" : "opacity-0")} />;
}
