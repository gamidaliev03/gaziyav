"use client";

// Inspector → AI tab of a video clip: pick an AI effect, set it up, Apply / Re-run; what the clip shows now,
// the running jobs (progress, time left, Cancel) and "Use original".
import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
	InspectorRow,
	InspectorSlider,
	Segmented,
	Split,
} from "@/components/editor/panels/properties/components/inspector-ui";
import { NumberParamField } from "@/components/editor/panels/properties/components/property-param-field";
import { useEditor } from "@/editor/use-editor";
import { etaSeconds, formatDuration, jobCenter, useJobsStore } from "@/jobs/store";
import type { ParamDefinition, ParamValue } from "@/params";
import type { TimelineElement } from "@/timeline";
import { applyToClip, applyToPhoto, jobIdsOfClip, restoreOriginal } from "../apply";
import { FAMILIES, isVisible, type NeuralFamilyId, neuralEffect } from "../catalog";
import { useNeuralSettings, valuesIn } from "../settings-store";
import { AiStepSwitch } from "./ai-step-switch";
import { usePropertiesStore } from "@/components/editor/panels/properties/stores/properties-store";
import { THIS_COMPUTER } from "@/utils/platform";

// Each AI effect has one place (Cutout → Remove background, Fix → Enhance / Reduce noise, AI → Upscale): the
// sections pass `only`; the picker below is what the full list (no `only`) shows.
const FAMILY_OPTIONS: Array<{ value: NeuralFamilyId; label: string }> = [
	{ value: "enhance", label: "Enhance" },
	{ value: "denoise", label: "Denoise" },
	{ value: "upscale", label: "Upscale" },
];

/** A dropdown sized like the inspector's other controls. */
function Dropdown<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
	return (
		<Select value={value} onValueChange={(v) => onChange(v as T)}>
			<SelectTrigger aria-label={label} className="h-7 w-full text-xs">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{options.map((o) => (
					<SelectItem key={o.value} value={o.value} className="text-xs">
						{o.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/** The AI effects of a clip; `only`: one effect's own place (Video → Remove BG shows Remove Background alone). */
export function NeuralInspector({ element, trackId, only }: { element: TimelineElement; trackId: string; only?: NeuralFamilyId }) {
	const mediaId = element.type === "video" || element.type === "image" ? element.mediaId : null;
	const asset = useEditor((e) => (mediaId ? e.media.getAssets().find((a) => a.id === mediaId) : undefined), ["media"]);
	const info = asset?.neural;
	const chosen = useNeuralSettings((s) => s.picked);
	const picked: NeuralFamilyId = only ?? (FAMILY_OPTIONS.some((o) => o.value === chosen) ? chosen : "enhance");
	const stored = useNeuralSettings((s) => s.values[picked]);
	const pick = useNeuralSettings((s) => s.pick);
	const setValue = useNeuralSettings((s) => s.setValue);
	const setValues = useNeuralSettings((s) => s.setValues);
	const values = useMemo(() => valuesIn(picked, { [picked]: stored }), [picked, stored]);
	const family = FAMILIES[picked];

	// A clip that shows an AI result opens with that effect and its settings, ready for Re-run.
	const appliedFamily = info ? neuralEffect(info.effect)?.family : undefined;
	// biome-ignore lint/correctness/useExhaustiveDependencies: a clip opens with the effect it shows, once per result file (not on every settings change)
	useEffect(() => {
		// Retouch, Remove Background and the sound tools have their own places (Video → Retouch / Remove BG, Audio): the
		// list here stays on its effects; an effect's own place opens with what the clip shows.
		if (!info || !appliedFamily || FAMILIES[appliedFamily].tool) return;
		if (only ? appliedFamily !== only : !FAMILY_OPTIONS.some((o) => o.value === appliedFamily)) return;
		if (!only) pick(appliedFamily);
		setValues(appliedFamily, info.params as Record<string, ParamValue>);
	}, [asset?.id]);

	const jobIds = jobIdsOfClip(element.id);
	const jobs = useJobsStore((s) => s.jobs);
	const running = jobs.filter((j) => j.status === "running" && jobIds.includes(j.id));
	const failed = jobs.find((j) => j.status === "error" && jobIds.includes(j.id) && !j.seen);
	const now = Date.now();

	const isRerun = !!info && appliedFamily === picked;
	// a photo has Remove background only (one PNG with alpha); a video every effect
	const apply = () => (element.type === "image" ? applyToPhoto(trackId, element.id, values) : applyToClip(trackId, element.id, picked, values));

	return (
		<div data-ai-inspector className="flex flex-col gap-2">
			{info && (!only || appliedFamily === only) && (
				<InspectorRow rowId="ai.applied" label="On this clip" stacked>
					<div className="bg-accent/50 flex min-w-0 flex-col rounded-md px-2.5 py-1.5" data-ai-clip={info.effect}>
						<span className="text-xs font-medium">{info.label}</span>
						<span className="text-muted-foreground text-[11px]">
							{info.quality === "balanced"
								? info.exportId
									? "Export uses the accurate cut-out"
									: "Accurate cut-out for export in progress"
								: `Made on ${THIS_COMPUTER} · original kept`}
						</span>
					</div>
				</InspectorRow>
			)}
			{only && <AiStepSwitch element={element} trackId={trackId} families={[only]} />}
			{!only && (
				<>
					<InspectorRow rowId="ai.effect" label="Effect">
						<Dropdown label="AI effect" value={picked} options={FAMILY_OPTIONS} onChange={(v) => pick(v)} />
					</InspectorRow>
					<InspectorRow rowId="ai.removeBg" label="Background">
						<button
							type="button"
							data-ai-remove-bg-link
							className="text-primary h-7 min-w-0 max-w-full truncate text-left text-xs hover:underline"
							onClick={() => usePropertiesStore.getState().setActiveTab({ elementType: "video", tabId: "cutout" })}
						>
							Remove background in Cutout →
						</button>
					</InspectorRow>
				</>
			)}
			{family.params.filter((p) => isVisible(p, values)).map((param) => (
				<ParamRow
					key={`${picked}.${param.key}`}
					param={param}
					value={values[param.key] ?? param.default}
					onChange={(v) => setValue(picked, param.key, v)}
				/>
			))}
			{running.map((job) => {
				const eta = etaSeconds(job, now);
				return (
					<InspectorRow key={job.id} rowId="ai.progress" label={job.title.includes("export") ? "Export copy" : "Working"}>
						<div className="flex min-w-0 flex-col gap-1" data-ai-progress={job.id}>
							<div className="bg-accent h-1.5 w-full overflow-hidden rounded-full">
								<div className="bg-primary h-full transition-[width]" style={{ width: `${Math.round((job.progress ?? 0) * 100)}%` }} />
							</div>
							<div className="flex items-center justify-between gap-2">
								<span className="text-muted-foreground truncate text-[11px]">
									{Math.round((job.progress ?? 0) * 100)}%{eta != null ? ` · ~${formatDuration(eta)} left` : ""}
								</span>
								<button type="button" className="text-muted-foreground hover:text-foreground text-[11px]" onClick={() => job.cancel?.()}>
									Cancel
								</button>
							</div>
						</div>
					</InspectorRow>
				);
			})}
			{failed && (
				<p className="text-destructive pl-[calc(var(--insp-label)+0.5rem)] text-[11px] leading-snug @max-[17.5rem]/insp:pl-0">
					{failed.message}
				</p>
			)}
			<div className="flex gap-1.5 pl-[calc(var(--insp-label)+0.5rem)] @max-[17.5rem]/insp:pl-0">
				<Button size="sm" className="h-7 flex-1 text-xs" data-ai-apply onClick={() => {
					if (failed) jobCenter.markSeen((j) => j.id === failed.id);
					apply();
				}}>
					{isRerun ? "Re-run" : "Apply to clip"}
				</Button>
				{info && (!only || appliedFamily === only) && (
					<Button size="sm" variant="secondary" className="h-7 text-xs" data-ai-original onClick={() => restoreOriginal(trackId, element.id)}>
						Use original
					</Button>
				)}
			</div>
		</div>
	);
}

function ParamRow({ param, value, onChange }: { param: ParamDefinition; value: ParamValue; onChange: (v: ParamValue) => void }) {
	const isDefault = String(value) === String(param.default);
	const reset = () => onChange(param.default);
	if (param.type === "select") {
		// Two short options side by side (2× | 4×); longer lists as a dropdown.
		return (
			<InspectorRow rowId={`ai.${param.key}`} label={param.label} onReset={reset} isDefault={isDefault} stackWhenNarrow>
				{param.options.length <= 2 ? (
					<Segmented label={param.label} value={String(value)} options={param.options} onChange={(v) => onChange(v)} />
				) : (
					<Dropdown label={param.label} value={String(value)} options={param.options} onChange={(v) => onChange(v)} />
				)}
			</InspectorRow>
		);
	}
	if (param.type === "color") {
		return (
			<InspectorRow rowId={`ai.${param.key}`} label={param.label} onReset={reset} isDefault={isDefault}>
				<ColorPicker
					className="w-full"
					value={String(value).replace(/^#/, "").toUpperCase()}
					onChange={(hex) => onChange(`#${hex}`)}
					onChangeEnd={(hex) => onChange(`#${hex}`)}
				/>
			</InspectorRow>
		);
	}
	if (param.type === "number") {
		const n = Number(value);
		return (
			<InspectorRow rowId={`ai.${param.key}`} label={param.label} onReset={reset} isDefault={isDefault}>
				<Split slider>
					<InspectorSlider
						label={param.label}
						min={param.min}
						max={param.max ?? param.min + 1}
						step={param.step}
						value={n}
						onChange={(v) => onChange(v)}
						onCommit={() => {}}
					/>
					<NumberParamField param={param} value={n} onPreview={(v) => onChange(v)} onCommit={() => {}} />
				</Split>
			</InspectorRow>
		);
	}
	return null;
}
