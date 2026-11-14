"use client";

// The scopes strip under the player's picture: waveform, RGB parade, vectorscope with the skin-tone line, histogram —
// drawn from the very frame the player shows (controller.ts). A 32 px bar with a chip per scope, then the scopes; the
// top edge drags to resize. Opened by the Color section's «Scopes» button or ⌘K «Scopes».
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Chip, ChipRow } from "@/components/ui/chips";
import { Hint } from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { cn } from "@/utils/ui";
import { scopesController } from "./controller";
import type { ScopeCell } from "./engine";
import { barTargets, PLOT_MARGIN, VEC_RADIUS } from "./math";
import { SCOPE_KINDS, SCOPE_TITLES, SCOPES_MAX_HEIGHT, SCOPES_MIN_HEIGHT, type ScopeKind, useScopes } from "./store";

const LEVEL_MARKS = [100, 75, 50, 25, 0];
const levelTop = (percent: number) => `${(1 - PLOT_MARGIN - (percent / 100) * (1 - 2 * PLOT_MARGIN)) * 100}%`;
const TARGETS = barTargets(0.75);
/** Under this width (CSS px) the bar drops its title so the four chips stay whole (1024 × 640 in Russian). */
const NARROW_BELOW = 520;

/** Mounted once in the player (preview/components/index.tsx); draws nothing while the strip is closed. */
export function ScopesStrip() {
	const open = useScopes((s) => s.open);
	return open ? <Strip /> : null;
}

function Strip() {
	const t = useT();
	const shown = useScopes((s) => s.shown);
	const chosenHeight = useScopes((s) => s.height);
	const mode = useScopes((s) => s.mode);
	const tinted = useScopes((s) => s.tinted);
	const rootRef = useRef<HTMLDivElement>(null);
	const areaRef = useRef<HTMLDivElement>(null);
	const gpuRef = useRef<HTMLCanvasElement>(null);
	const cpuRef = useRef<HTMLCanvasElement>(null);
	// With no height chosen: about a quarter of the player, so a small window keeps its picture.
	const [autoHeight, setAutoHeight] = useState(120);
	const height = chosenHeight || autoHeight;

	useLayoutEffect(() => {
		const parent = rootRef.current?.parentElement;
		if (!parent) return;
		const fit = () => setAutoHeight(Math.round(Math.min(160, Math.max(SCOPES_MIN_HEIGHT, parent.clientHeight * 0.26))));
		fit();
		const observer = new ResizeObserver(fit);
		observer.observe(parent);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		scopesController.mount(gpuRef.current, cpuRef.current);
		return () => scopesController.mount(null, null);
	}, []);

	// Narrow (a small window): the bar keeps its four chips whole and drops its title.
	const [narrow, setNarrow] = useState(false);
	const measure = useCallback(() => {
		const area = areaRef.current;
		if (!area) return;
		const dpr = window.devicePixelRatio || 1;
		const box = area.getBoundingClientRect();
		setNarrow(box.width < NARROW_BELOW);
		// The canvas lies on whole device pixels, one canvas pixel on one screen pixel. The panels' widths are fractions
		// of a pixel; a canvas left there is resampled by the browser, and a one-pixel trace (a colour bar's dot on the
		// vectorscope, a graticule line) is smeared over two pixels at half its brightness.
		const left = Math.round(box.left * dpr);
		const top = Math.round(box.top * dpr);
		const width = Math.max(1, Math.round(box.right * dpr) - left);
		const heightPx = Math.max(1, Math.round(box.bottom * dpr) - top);
		for (const canvas of [gpuRef.current, cpuRef.current]) {
			if (!canvas) continue;
			if (canvas.width !== width || canvas.height !== heightPx) {
				canvas.width = width;
				canvas.height = heightPx;
			}
			canvas.style.width = `${width / dpr}px`;
			canvas.style.height = `${heightPx / dpr}px`;
			canvas.style.transform = `translate(${left / dpr - box.left}px, ${top / dpr - box.top}px)`;
		}
		const cells: ScopeCell[] = [];
		for (const element of area.querySelectorAll<HTMLElement>("[data-scope-cell]")) {
			const r = element.getBoundingClientRect();
			const x = Math.max(0, Math.round(r.left * dpr) - left);
			const y = Math.max(0, Math.round(r.top * dpr) - top);
			const w = Math.min(width - x, Math.round(r.right * dpr) - Math.round(r.left * dpr));
			const h = Math.min(heightPx - y, Math.round(r.bottom * dpr) - Math.round(r.top * dpr));
			if (w >= 2 && h >= 2) cells.push({ kind: element.dataset.scopeCell as ScopeKind, x, y, width: w, height: h });
		}
		scopesController.layout(cells);
	}, []);

	// the strip can move without changing size (the player's panel resized above it, the window): laid on whole
	// pixels again
	useEffect(() => {
		const parent = rootRef.current?.parentElement;
		if (!parent) return;
		const observer = new ResizeObserver(() => measure());
		observer.observe(parent);
		window.addEventListener("resize", measure);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, [measure]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the cells move when a scope is switched on or off or the strip's height changes
	useLayoutEffect(() => {
		const area = areaRef.current;
		if (!area) return;
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(area);
		return () => observer.disconnect();
	}, [measure, shown, height]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the drawing changes when the trace's colouring is switched
	useEffect(() => {
		scopesController.restyle();
	}, [tinted]);

	// Drag the top edge to resize; a double-click goes back to the height chosen from the player's.
	const drag = useRef<{ startY: number; startHeight: number } | null>(null);
	const kinds = SCOPE_KINDS.filter((kind) => shown[kind]);

	return (
		<div ref={rootRef} className="bg-background relative flex shrink-0 flex-col border-t" data-scopes-strip={mode}>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: a resize edge for the pointer; the strip's size is not needed by keyboard users */}
			<div
				className="hover:bg-primary/40 absolute inset-x-0 -top-0.5 z-10 h-1.5 cursor-row-resize touch-none"
				data-scopes-resize=""
				title={t("Drag to resize the scopes")}
				onPointerDown={(event) => {
					if (event.button !== 0) return;
					event.currentTarget.setPointerCapture(event.pointerId);
					drag.current = { startY: event.clientY, startHeight: height };
				}}
				onPointerMove={(event) => {
					if (!drag.current) return;
					useScopes.getState().setHeight(drag.current.startHeight + (drag.current.startY - event.clientY));
				}}
				onPointerUp={() => {
					drag.current = null;
				}}
				onPointerCancel={() => {
					drag.current = null;
				}}
				onDoubleClick={() => useScopes.setState({ height: 0 })}
			/>
			<div className="flex h-8 shrink-0 items-center gap-2 px-2" data-scopes-bar="">
				{!narrow && <span className="shrink-0 text-xs font-medium">{t("Scopes")}</span>}
				<ChipRow aria-label={t("Scopes shown")} className="min-w-0 flex-1">
					{SCOPE_KINDS.map((kind) => (
						<Chip key={kind} active={shown[kind]} className={narrow ? "px-2" : undefined} data-scope-chip={kind} onClick={() => useScopes.getState().toggleKind(kind)}>
							{t(SCOPE_TITLES[kind])}
						</Chip>
					))}
				</ChipRow>
				{mode === "cpu" && (
					<span className="text-muted-foreground shrink-0 text-[11px]" data-scopes-slow="" title={t("The graphics chip's fast path is not available: the scopes update a few times a second.")}>
						{t("Slower mode")}
					</span>
				)}
				<Hint label={t("Close the scopes")}>
					<button
						type="button"
						aria-label={t("Close the scopes")}
						data-scopes-close=""
						className="text-muted-foreground hover:text-foreground hover:bg-accent grid size-6 shrink-0 place-items-center rounded-sm"
						onClick={() => useScopes.getState().setOpen(false)}
					>
						<HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
					</button>
				</Hint>
			</div>
			<div ref={areaRef} className="relative flex min-w-0 gap-1 px-1 pb-1" style={{ height: Math.min(SCOPES_MAX_HEIGHT, height) }} data-scopes-area="">
				<canvas ref={gpuRef} className={cn("pointer-events-none absolute inset-0 size-full", mode === "cpu" && "hidden")} data-scopes-canvas="gpu" />
				<canvas ref={cpuRef} className={cn("pointer-events-none absolute inset-0 size-full", mode !== "cpu" && "hidden")} data-scopes-canvas="cpu" />
				{kinds.map((kind) => (
					<ScopeCellView key={kind} kind={kind} />
				))}
			</div>
		</div>
	);
}

/** One scope's place on the strip: the picture is on the canvas behind; this holds its numbers and letters. */
function ScopeCellView({ kind }: { kind: ScopeKind }) {
	const t = useT();
	const label = t(SCOPE_TITLES[kind]);
	if (kind === "vectorscope") {
		return (
			<div role="img" aria-label={label} title={t("Vectorscope: colour and its strength. The line is where skin tones fall.")} data-scope-cell={kind} className="relative aspect-square h-full shrink-0 overflow-hidden rounded-sm">
				{TARGETS.map((target) => {
					// each letter just outside its box, away from the centre
					const length = Math.hypot(target.cb, target.cr) || 1;
					const out = 0.085;
					const cb = target.cb + (target.cb / length) * out;
					const cr = target.cr + (target.cr / length) * out;
					return (
						<span
							key={target.id}
							className="text-foreground/55 pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-[9px] leading-none font-medium select-none"
							style={{ left: `${50 + (cb / VEC_RADIUS) * 50}%`, top: `${50 - (cr / VEC_RADIUS) * 50}%` }}
						>
							{target.id}
						</span>
					);
				})}
			</div>
		);
	}
	if (kind === "histogram") return <HistogramCell label={label} />;
	return (
		<div
			role="img"
			aria-label={label}
			title={kind === "waveform" ? t("Waveform: brightness across the picture, left to right, 0–100 %.") : t("RGB parade: red, green and blue side by side, 0–100 %.")}
			data-scope-cell={kind}
			className={cn("relative h-full min-w-0 overflow-hidden rounded-sm", kind === "parade" ? "flex-[1.5]" : "flex-[1.2]")}
		>
			{LEVEL_MARKS.map((percent) => (
				<span key={percent} className="text-foreground/45 pointer-events-none absolute left-1 -translate-y-1/2 text-[9px] leading-none tabular-nums select-none" style={{ top: levelTop(percent) }}>
					{percent}
				</span>
			))}
		</div>
	);
}

function HistogramCell({ label }: { label: string }) {
	const t = useT();
	const readout = useScopes((s) => s.readout);
	const percent = (share: number) => (share >= 0.1 ? Math.round(share * 100) : Math.round(share * 1000) / 10);
	return (
		<div role="img" aria-label={label} title={t("Histogram: how many pixels at each level, darkest on the left.")} data-scope-cell="histogram" className="relative h-full min-w-0 flex-1 overflow-hidden rounded-sm">
			{readout && (
				<span
					className="text-foreground/55 pointer-events-none absolute top-1 left-1.5 text-[9px] leading-none tabular-nums select-none"
					data-scopes-readout=""
					title={t("Brightness of the darkest 1 %, the middle and the brightest 1 % of the picture")}
				>
					{Math.round(readout.low)} · {Math.round(readout.median)} · {Math.round(readout.high)} %
				</span>
			)}
			{/* under the three numbers, never beside them: the cell can be 100 px wide */}
			{readout && (readout.clipped > 0.001 || readout.crushed > 0.001) && (
				<span className="text-primary pointer-events-none absolute top-[15px] left-1.5 text-[9px] leading-none tabular-nums select-none" data-scopes-clipped="">
					{readout.clipped > 0.001 ? t("Clipped {n} %", { n: percent(readout.clipped) }) : t("Crushed {n} %", { n: percent(readout.crushed) })}
				</span>
			)}
		</div>
	);
}
