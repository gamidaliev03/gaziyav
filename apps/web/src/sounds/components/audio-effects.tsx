"use client";

// Inspector → the clip's sound: «Clean up» (isolate the voice, reduce noise, gate — a card each with its switch), then
// every audio effect applied to the clip as a section of its own in the order they process the sound (sounds/mix/fx.ts)
// — its fx switch, presets, ↺ and × — and «+» to add one (the list's Audio heading). A drag is one undo step (previewed while it moves, committed on release);
// the sound renders again once the setting stops (media/audio.ts), the old one playing until then («Applying…»).
// The equalizer draws its curve with a point per band (drag: frequency ↔, gain ↕); the compressor its transfer curve.
import { Cancel01Icon, Add01Icon, ArrowTurnBackwardIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import { useRef, useState } from "react";
import { InspectorGroup, InspectorRow, InspectorSlider, Split } from "@/components/editor/panels/properties/components/inspector-ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useEditor } from "@/editor/use-editor";
import { useT } from "@/i18n";
import { useAudioFxStatus } from "@/media/audio";
import {
	AUDIO_FX,
	type AudioFxDef,
	type AudioFxId,
	compressorCurve,
	EQ_BAND_TYPES,
	EQ_PRESETS,
	type EqBand,
	type EqBandType,
	eqResponse,
	fxKey,
	hasOwnSettings,
	MAX_EQ_BANDS,
	readEqBands,
	readFxSettings,
} from "@/sounds/mix/fx";
import type { TimelineElement } from "@/timeline";
import { useElementPreview } from "@/timeline/hooks/use-element-preview";
import { cn } from "@/utils/ui";

type Params = Record<string, unknown>;

/** The clean-up of a sound: the voice isolated, the noise reduced, the gaps gated. */
const CLEANUP: readonly AudioFxId[] = ["isolate", "denoise", "gate"];
const isCleanup = (def: AudioFxDef) => CLEANUP.includes(def.id);
/** Applied: switched on, or switched off with settings of its own kept (Premiere's fx off). */
const isApplied = (def: AudioFxDef, params: Params) => params[def.param] === true || hasOwnSettings(params, def.id);

function useFxWriter(element: TimelineElement, trackId: string) {
	const editor = useEditor();
	const { renderElement, previewUpdates, commit } = useElementPreview({ trackId, elementId: element.id, fallback: element });
	const params = ("params" in renderElement ? renderElement.params : {}) as Params;
	/** One undo step: these params changed (null: the setting back to its default — params merge, a key stays). */
	const write = (patch: Record<string, unknown>) => {
		editor.timeline.updateElements({ updates: [{ trackId, elementId: element.id, patch: { params: patch } as Partial<TimelineElement> }] });
	};
	const preview = (patch: Record<string, unknown>) => previewUpdates({ params: { ...params, ...patch } } as Partial<TimelineElement>);
	return { params, write, preview, commit };
}

export function AudioEffectsSection({ element, trackId, part = "cleanup" }: { element: TimelineElement; trackId: string; part?: "cleanup" | "effects" }) {
	const t = useT();
	const { params, write, preview, commit } = useFxWriter(element, trackId);
	const applying = useAudioFxStatus((s) => !!s.applying[element.id]);
	const error = useAudioFxStatus((s) => s.error[element.id] ?? "");
	if (part === "effects") {
		const applied = AUDIO_FX.filter((def) => !isCleanup(def) && isApplied(def, params));
		if (applied.length === 0) return null;
		return (
			<div data-audio-effects="effects">
				{applied.map((def) => (
					<FxSection key={def.id} def={def} params={params} write={write} preview={preview} commit={commit} />
				))}
			</div>
		);
	}
	return (
		<InspectorGroup
			id="audio.cleanup"
			title={t("Clean up")}
			trailing={
				<span className={cn("text-[11px]", applying ? "text-primary" : "text-muted-foreground")} data-audio-fx-state={applying ? "applying" : error ? "error" : "ready"}>
					{applying ? t("Applying…") : ""}
				</span>
			}
		>
			<div className="flex flex-col gap-1.5 pb-1" data-audio-effects="cleanup">
				{error && <p className="text-destructive text-[11px] leading-snug">{error}</p>}
				{AUDIO_FX.filter(isCleanup).map((def) => (
					<FxCard key={def.id} def={def} params={params} write={write} preview={preview} commit={commit} />
				))}
			</div>
		</InspectorGroup>
	);
}

/** «+» on the sound's heading: the audio effects not on the clip yet; one is added switched on (one undo step). */
export function AudioEffectsAdd({ element, trackId }: { element: TimelineElement; trackId: string }) {
	const t = useT();
	const { params, write } = useFxWriter(element, trackId);
	const free = AUDIO_FX.filter((def) => !isCleanup(def) && !isApplied(def, params));
	if (free.length === 0) return null;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label={t("Add audio effect")}
					title={t("Add audio effect")}
					data-audio-fx-add=""
					className="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring flex size-6 items-center justify-center rounded-sm outline-none focus-visible:ring-1"
				>
					<HugeiconsIcon icon={Add01Icon} className="size-3.5" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{free.map((def) => (
					<DropdownMenuItem key={def.id} data-audio-fx-add-item={def.id} onSelect={() => write({ [def.param]: true })}>
						{t(def.label)}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** An applied audio effect as a section: fx switch (off keeps its settings), presets, ↺ (settings back), × (off and gone). */
function FxSection({
	def,
	params,
	write,
	preview,
	commit,
}: {
	def: AudioFxDef;
	params: Params;
	write: (patch: Record<string, unknown>) => void;
	preview: (patch: Record<string, unknown>) => void;
	commit: () => void;
}) {
	const t = useT();
	const enabled = params[def.param] === true;
	const own = hasOwnSettings(params, def.id);
	const ownKeys = Object.keys(params).filter((k) => k.startsWith(`fx.${def.id}.`) && params[k] !== null);
	const reset = () => write(Object.fromEntries(ownKeys.map((k) => [k, null])));
	const remove = () => write({ [def.param]: false, ...Object.fromEntries(ownKeys.map((k) => [k, null])) });
	const hasBody = def.params.length > 0 || def.id === "voice";
	return (
		<InspectorGroup
			id={`audio.fx.${def.id}`}
			title={t(def.label)}
			muted={!enabled}
			leading={<Switch aria-label={t("{name} on", { name: t(def.label) })} checked={enabled} onCheckedChange={(value) => write({ [def.param]: value })} data-audio-fx-switch="" />}
			sectionProps={{ "data-audio-fx": def.id, "data-audio-fx-on": enabled ? "on" : "off" }}
			trailing={
				<span className="flex items-center gap-0.5">
					<FxPresets def={def} write={write} />
					{own && (
						<button type="button" aria-label={t("Reset")} title={t("Reset")} onClick={reset} className="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center" data-audio-fx-reset="">
							<HugeiconsIcon icon={ArrowTurnBackwardIcon} className="size-3.5" />
						</button>
					)}
					<button type="button" aria-label={t("Remove {name}", { name: t(def.label) })} title={t("Remove")} onClick={remove} className="text-muted-foreground hover:text-foreground flex size-6 items-center justify-center" data-audio-fx-remove="">
						<HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
					</button>
				</span>
			}
		>
			{hasBody ? (
				<div className={cn("flex flex-col gap-1.5", !enabled && "opacity-50")}>
					<FxBody def={def} params={params} write={write} preview={preview} commit={commit} />
				</div>
			) : null}
		</InspectorGroup>
	);
}

/** A preset menu of an effect (none for one without presets). */
function FxPresets({ def, write }: { def: AudioFxDef; write: (patch: Record<string, unknown>) => void }) {
	const t = useT();
	const presets = def.id === "voice" ? EQ_PRESETS.map((p) => ({ id: p.id, label: p.label })) : (def.presets ?? []);
	if (presets.length === 0) return null;
	const applyPreset = (id: string) => {
		if (def.id === "voice") {
			const preset = EQ_PRESETS.find((p) => p.id === id);
			if (preset) write({ [def.param]: true, [fxKey("voice", "bands")]: JSON.stringify(preset.bands) });
			return;
		}
		const preset = def.presets?.find((p) => p.id === id);
		if (preset) write({ [def.param]: true, ...Object.fromEntries(Object.entries(preset.values).map(([k, v]) => [fxKey(def.id, k), v])) });
	};
	return (
		<Select value="" onValueChange={applyPreset}>
			<SelectTrigger aria-label={t("Preset")} title={t("Preset")} className="h-6 w-auto gap-1 border-none bg-transparent px-1.5 text-[11px] @max-[17.5rem]/insp:[&>span:first-child]:hidden" data-audio-fx-presets="">
				<SelectValue placeholder={t("Preset")} />
			</SelectTrigger>
			<SelectContent>
				{presets.map((p) => (
					<SelectItem key={p.id} value={p.id} className="text-xs" data-audio-fx-preset={p.id}>
						{t(p.label)}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/** An effect's settings: the equalizer's curve, the compressor's graph, or a row per setting. */
function FxBody({
	def,
	params,
	write,
	preview,
	commit,
}: {
	def: AudioFxDef;
	params: Params;
	write: (patch: Record<string, unknown>) => void;
	preview: (patch: Record<string, unknown>) => void;
	commit: () => void;
}) {
	const t = useT();
	const values = readFxSettings(params, def.id);
	if (def.id === "voice") return <EqEditor params={params} write={write} preview={preview} commit={commit} />;
	return (
		<>
			{def.id === "compressor" && <CompressorGraph values={values} />}
			{def.params.map((p) => (
				<InspectorRow key={p.key} rowId={`fx.${def.id}.${p.key}`} label={t(p.label)} stackWhenNarrow isDefault={values[p.key] === p.default} onReset={() => write({ [fxKey(def.id, p.key)]: null })}>
					<Split slider>
						<InspectorSlider
							label={t(p.label)}
							min={p.min}
							max={p.max}
							step={p.step}
							value={values[p.key]}
							onChange={(v) => preview({ [fxKey(def.id, p.key)]: v })}
							onCommit={commit}
						/>
						{/* a field, not a caption: in a narrow inspector the slider is hidden and the number is the control (B8) */}
						<NumberBox
							label={t(p.label)}
							value={values[p.key]}
							unit={p.unit ? t(p.unit) : ""}
							min={p.min}
							max={p.max}
							step={p.step}
							onChange={(v) => write({ [fxKey(def.id, p.key)]: v })}
						/>
					</Split>
				</InspectorRow>
			))}
		</>
	);
}

function FxCard({
	def,
	params,
	write,
	preview,
	commit,
}: {
	def: AudioFxDef;
	params: Params;
	write: (patch: Record<string, unknown>) => void;
	preview: (patch: Record<string, unknown>) => void;
	commit: () => void;
}) {
	const t = useT();
	const enabled = params[def.param] === true;
	const own = hasOwnSettings(params, def.id);
	const [open, setOpen] = useState(enabled);
	const values = readFxSettings(params, def.id);
	const ownKeys = Object.keys(params).filter((k) => k.startsWith(`fx.${def.id}.`) && params[k] !== null);
	const reset = () => write(Object.fromEntries(ownKeys.map((k) => [k, null])));
	const presets = def.id === "voice" ? EQ_PRESETS.map((p) => ({ id: p.id, label: p.label })) : (def.presets ?? []);
	const applyPreset = (id: string) => {
		if (def.id === "voice") {
			const preset = EQ_PRESETS.find((p) => p.id === id);
			if (preset) write({ [def.param]: true, [fxKey("voice", "bands")]: JSON.stringify(preset.bands) });
			return;
		}
		const preset = def.presets?.find((p) => p.id === id);
		if (preset) write({ [def.param]: true, ...Object.fromEntries(Object.entries(preset.values).map(([k, v]) => [fxKey(def.id, k), v])) });
	};
	const hasBody = def.params.length > 0 || def.id === "voice";
	return (
		<div className={cn("rounded-md border border-white/[.07]", enabled ? "bg-accent/40" : "bg-transparent")} data-audio-fx={def.id} data-audio-fx-on={enabled ? "on" : "off"}>
			<div className="flex h-8 items-center gap-2 px-2.5">
				<Switch
					aria-label={t("{name} on", { name: t(def.label) })}
					checked={enabled}
					onCheckedChange={(value) => {
						write({ [def.param]: value });
						if (value) setOpen(true);
					}}
					data-audio-fx-switch=""
				/>
				<button
					type="button"
					className={cn("min-w-0 flex-1 truncate text-left text-xs font-medium", !enabled && "text-muted-foreground")}
					onClick={() => hasBody && setOpen(!open)}
					aria-expanded={hasBody ? open : undefined}
				>
					{t(def.label)}
				</button>
				{presets.length > 0 && (
					<Select value="" onValueChange={applyPreset}>
						<SelectTrigger aria-label={t("Preset")} title={t("Preset")} className="h-6 w-auto gap-1 border-none bg-transparent px-1.5 text-[11px] @max-[17.5rem]/insp:[&>span:first-child]:hidden" data-audio-fx-presets="">
							<SelectValue placeholder={t("Preset")} />
						</SelectTrigger>
						<SelectContent>
							{presets.map((p) => (
								<SelectItem key={p.id} value={p.id} className="text-xs" data-audio-fx-preset={p.id}>
									{t(p.label)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
				{own && (
					<button type="button" aria-label={t("Reset")} title={t("Back to the defaults")} onClick={reset} className="text-muted-foreground hover:text-foreground" data-audio-fx-reset="">
						<HugeiconsIcon icon={ArrowTurnBackwardIcon} className="size-3.5" />
					</button>
				)}
			</div>
			{enabled && open && hasBody && (
				<div className="flex flex-col gap-1.5 px-2.5 pb-2.5">
					{def.id === "voice" ? (
						<EqEditor params={params} write={write} preview={preview} commit={commit} />
					) : (
						<>
							{def.id === "compressor" && <CompressorGraph values={values} />}
							{def.params.map((p) => (
								<InspectorRow key={p.key} rowId={`fx.${def.id}.${p.key}`} label={t(p.label)} stackWhenNarrow isDefault={values[p.key] === p.default} onReset={() => write({ [fxKey(def.id, p.key)]: null })}>
									<Split slider>
										<InspectorSlider
											label={t(p.label)}
											min={p.min}
											max={p.max}
											step={p.step}
											value={values[p.key]}
											onChange={(v) => preview({ [fxKey(def.id, p.key)]: v })}
											onCommit={commit}
										/>
										{/* a field, not a caption: in a narrow inspector the slider is hidden and the number is the control (B8) */}
										<NumberBox
											label={t(p.label)}
											value={values[p.key]}
											unit={p.unit ? t(p.unit) : ""}
											min={p.min}
											max={p.max}
											step={p.step}
											onChange={(v) => write({ [fxKey(def.id, p.key)]: v })}
										/>
									</Split>
								</InspectorRow>
							))}
						</>
					)}
				</div>
			)}
		</div>
	);
}

// ── the equalizer ──

const W = 260;
const H = 110;
const F_MIN = 20;
const F_MAX = 20000;
const G_MAX = 18;
const xOf = (f: number) => (Math.log10(f / F_MIN) / Math.log10(F_MAX / F_MIN)) * W;
const fOf = (x: number) => F_MIN * (F_MAX / F_MIN) ** Math.min(1, Math.max(0, x / W));
const yOf = (g: number) => H / 2 - (g / G_MAX) * (H / 2 - 6);
const gOf = (y: number) => Math.max(-G_MAX, Math.min(G_MAX, ((H / 2 - y) / (H / 2 - 6)) * G_MAX));
const TYPE_LABEL: Record<EqBandType, string> = { highpass: "High-pass", lowshelf: "Low shelf", peak: "Peak", highshelf: "High shelf", lowpass: "Low-pass" };
const hasGain = (type: EqBandType) => type === "peak" || type === "lowshelf" || type === "highshelf";

function EqEditor({ params, write, preview, commit }: { params: Params; write: (p: Record<string, unknown>) => void; preview: (p: Record<string, unknown>) => void; commit: () => void }) {
	const t = useT();
	const stored = readEqBands(params[fxKey("voice", "bands")]);
	const bands = stored ?? EQ_PRESETS[0].bands;
	const svgRef = useRef<SVGSVGElement>(null);
	const [drag, setDrag] = useState<number | null>(null);
	const key = fxKey("voice", "bands");
	const set = (next: EqBand[], live: boolean) => (live ? preview({ [key]: JSON.stringify(next) }) : write({ [key]: JSON.stringify(next) }));
	const change = (index: number, patch: Partial<EqBand>, live = false) => set(bands.map((b, i) => (i === index ? { ...b, ...patch } : b)), live);
	const curve = Array.from({ length: 97 }, (_, i) => {
		const f = F_MIN * (F_MAX / F_MIN) ** (i / 96);
		return `${i === 0 ? "M" : "L"}${xOf(f).toFixed(1)},${yOf(Math.max(-G_MAX, Math.min(G_MAX, eqResponse(bands, f)))).toFixed(1)}`;
	}).join("");
	const pointAt = (event: React.PointerEvent) => {
		const r = svgRef.current?.getBoundingClientRect();
		if (!r) return null;
		return { x: ((event.clientX - r.left) / r.width) * W, y: ((event.clientY - r.top) / r.height) * H };
	};
	return (
		<div className="flex flex-col gap-1.5" data-eq-editor="">
			<svg
				ref={svgRef}
				viewBox={`0 0 ${W} ${H}`}
				className="bg-background/60 w-full touch-none rounded border border-white/[.07]"
				onPointerMove={(event) => {
					if (drag === null) return;
					const p = pointAt(event);
					if (!p) return;
					const band = bands[drag];
					change(drag, { f: Math.round(fOf(p.x)), ...(hasGain(band.type) ? { g: Math.round(gOf(p.y) * 10) / 10 } : {}) }, true);
				}}
				onPointerUp={() => {
					if (drag !== null) commit();
					setDrag(null);
				}}
				onPointerLeave={() => {
					if (drag !== null) commit();
					setDrag(null);
				}}
				data-eq-curve=""
			>
				<title>{t("Equalizer curve")}</title>
				{[100, 1000, 10000].map((f) => (
					<line key={f} x1={xOf(f)} x2={xOf(f)} y1={0} y2={H} className="stroke-white/10" />
				))}
				<line x1={0} x2={W} y1={H / 2} y2={H / 2} className="stroke-white/15" />
				<path d={curve} className="stroke-primary fill-none" strokeWidth={1.6} />
				{bands.map((b, i) => (
					<circle
						// biome-ignore lint/suspicious/noArrayIndexKey: a band is its place in the list
						key={i}
						cx={xOf(b.f)}
						cy={yOf(hasGain(b.type) ? b.g : 0)}
						r={drag === i ? 6 : 5}
						className={cn("cursor-grab stroke-white", drag === i ? "fill-primary" : "fill-primary/70")}
						strokeWidth={1}
						onPointerDown={(event) => {
							(event.target as Element).setPointerCapture?.(event.pointerId);
							setDrag(i);
						}}
						data-eq-point={i}
					/>
				))}
			</svg>
			{bands.map((b, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: a band is its place in the list
				<div key={i} className="grid grid-cols-[5.5rem_1fr_1fr_1fr_auto] items-center gap-1 text-[11px] @max-[17.5rem]/insp:grid-cols-[1fr_1fr_1fr_auto]" data-eq-band={i}>
					<Select value={b.type} onValueChange={(v) => change(i, { type: v as EqBandType })}>
						<SelectTrigger aria-label={t("Band type")} className="h-6 px-1.5 text-[11px] @max-[17.5rem]/insp:col-span-3">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{EQ_BAND_TYPES.map((type) => (
								<SelectItem key={type} value={type} className="text-xs">
									{t(TYPE_LABEL[type])}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<NumberBox label={t("Frequency")} value={b.f} unit={t("Hz")} min={20} max={20000} step={1} onChange={(v) => change(i, { f: v })} />
					<NumberBox label={t("Gain")} value={b.g} unit={t("dB")} min={-24} max={24} step={0.5} disabled={!hasGain(b.type)} onChange={(v) => change(i, { g: v })} />
					<NumberBox label="Q" value={b.q} unit="Q" min={0.1} max={10} step={0.05} onChange={(v) => change(i, { q: v })} />
					<button type="button" aria-label={t("Remove band")} className="text-muted-foreground hover:text-foreground px-1 @max-[17.5rem]/insp:col-start-4 @max-[17.5rem]/insp:row-start-1" onClick={() => set(bands.filter((_, j) => j !== i), false)}>
						×
					</button>
				</div>
			))}
			{bands.length < MAX_EQ_BANDS && (
				<button type="button" className="text-primary self-start text-[11px] hover:underline" onClick={() => set([...bands, { type: "peak", f: 1000, g: 0, q: 1 }], false)} data-eq-add="">
					+ {t("Add band")}
				</button>
			)}
		</div>
	);
}

function NumberBox({ label, value, unit, min, max, step, disabled, onChange }: { label: string; value: number; unit: string; min: number; max: number; step: number; disabled?: boolean; onChange: (v: number) => void }) {
	const [text, setText] = useState<string | null>(null);
	const done = () => {
		if (text === null) return;
		const v = Number(text.replace(",", "."));
		setText(null);
		if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, Math.round(v / step) * step)));
	};
	return (
		<label className={cn("bg-background/60 flex h-6 min-w-0 items-center rounded border border-white/[.07] px-1", disabled && "opacity-40")} title={label}>
			<input
				aria-label={label}
				disabled={disabled}
				value={text ?? String(Math.round(value * 100) / 100)}
				onChange={(event) => setText(event.target.value)}
				onBlur={done}
				onKeyDown={(event) => {
					if (event.key === "Enter") (event.target as HTMLInputElement).blur();
				}}
				className="w-full min-w-0 bg-transparent text-[11px] tabular-nums outline-none"
			/>
			<span className="text-muted-foreground shrink-0 text-[10px]">{unit}</span>
		</label>
	);
}

// ── the compressor ──

function CompressorGraph({ values }: { values: Record<string, number> }) {
	const t = useT();
	const size = 96;
	const lo = -60;
	const pos = (db: number) => ((db - lo) / -lo) * size;
	const path = Array.from({ length: 61 }, (_, i) => {
		const input = lo + i;
		const out = Math.max(lo, Math.min(0, compressorCurve(input, { threshold: values.threshold, ratio: values.ratio, knee: values.knee, makeup: values.makeup })));
		return `${i === 0 ? "M" : "L"}${pos(input).toFixed(1)},${(size - pos(out)).toFixed(1)}`;
	}).join("");
	return (
		<div className="flex items-end gap-2" data-compressor-graph="">
			<svg viewBox={`0 0 ${size} ${size}`} className="bg-background/60 size-24 shrink-0 rounded border border-white/[.07]">
				<title>{t("Compressor curve")}</title>
				<line x1={0} y1={size} x2={size} y2={0} className="stroke-white/15" strokeDasharray="2 2" />
				<line x1={pos(values.threshold)} x2={pos(values.threshold)} y1={0} y2={size} className="stroke-white/20" />
				<path d={path} className="stroke-primary fill-none" strokeWidth={1.6} />
			</svg>
			<p className="text-muted-foreground text-[10px] leading-snug">
				{t("in → out, −60…0 dB")}
				<br />
				{values.ratio.toFixed(1)}:1 · {values.threshold} dB
			</p>
		</div>
	);
}

export type { AudioFxId };
