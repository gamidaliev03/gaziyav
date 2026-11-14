"use client";

// The clip's effects in the inspector's one list, Premiere's way: each effect a section of its own in the order they
// apply — fx (off keeps it), its settings with ◆ keys, ↺ (back to its defaults), ⋯ (onto other clips, copy; ⌘V pastes
// onto selected clips), × (one ⌘Z brings it back) — dragged by its header to reorder. The clip's grading lives in Color,
// so a colour effect without a look is not listed, and the chroma key is a tool (effects/clip-effect-list.ts). «+» and
// «paste» sit on the list's heading (EffectsHeaderButtons). An effect layer shows the same settings under its own name.
import { useEffect, useState } from "react";
import { buildEffectParamPath } from "@/animation/effect-param-channel";
import { resolveAnimationPathValueAtTime } from "@/animation";
import { useElementPlayhead } from "@/components/editor/panels/properties/hooks/use-element-playhead";
import { useKeyframedParamProperty } from "@/components/editor/panels/properties/hooks/use-keyframed-param-property";
import { keyStepper } from "@/components/editor/panels/properties/hooks/apply-params";
import { removeAnimationPaths } from "@/components/editor/panels/properties/hooks/reset-params";
import { EditorCore } from "@/core";
import type { ParamDefinition } from "@/params";
import { toast } from "sonner";
import { applyEffect, type ClipScope } from "@/actions/apply-to-all";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/tooltip";
import type { ParamValues } from "@/params";
import type { Effect } from "@/effects/types";
import type { EffectElement, VisualElement } from "@/timeline";
import { effectsRegistry } from "@/effects";
import { useEditor } from "@/editor/use-editor";
import { useElementPreview } from "@/timeline/hooks/use-element-preview";
import { PropertyParamField } from "@/components/editor/panels/properties/components/property-param-field";
import { InspectorGroup } from "@/components/editor/panels/properties/components/inspector-ui";
import { HugeiconsIcon } from "@/components/ui/icon";
import type { IconSvgElement } from "@/components/ui/icon";
import {
	Cancel01Icon,
	MoreHorizontalIcon,
	ClipboardPaste,
	Add01Icon,
	ArrowTurnBackwardIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/utils/ui";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { COLOR_EFFECT_TYPE } from "@/effects/definitions/studio/color";
import { ColorControls } from "./adjustment-view";
import { clipEffectRows } from "../clip-effect-list";
import { aiStepsOf, removeAiStep } from "@/neural/apply";
import { neuralEffect } from "@/neural/catalog";
import { revealInspectorSection } from "@/components/editor/panels/properties/reveal";

/** The small icon buttons at the right of an item's name (eye, ⋯, ⧉, ×), each with its tooltip. A menu trigger's
 * props (⋯ under DropdownMenuTrigger asChild) arrive in `data` and land on the button itself. */
function ItemButton({
	icon,
	label,
	title,
	on = false,
	onClick,
	...data
}: {
	icon: IconSvgElement;
	label: string;
	title?: string;
	/** Drawn as pressed (the eye of an effect that is on). */
	on?: boolean;
	onClick?: () => void;
} & Record<`data-${string}`, string>) {
	return (
		<Hint label={title ?? label}>
			<button
				type="button"
				aria-label={label}
				onClick={onClick}
				{...data}
				className={cn(
					"hover:bg-accent focus-visible:ring-ring flex size-6 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-1",
					on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
				)}
			>
				<HugeiconsIcon icon={icon} className="size-3.5" />
			</button>
		</Hint>
	);
}

/** An effect's settings as rows (a preview while dragging, one ⌘Z on release). */
function EffectParams({
	effect,
	renderParams,
	previewParam,
	onCommit,
}: {
	effect: Effect;
	renderParams: ParamValues;
	previewParam: (key: string) => (value: number | string | boolean) => void;
	onCommit: () => void;
}) {
	const definition = effectsRegistry.get(effect.type);
	return (
		<>
			{definition.params.map((param) => (
				<PropertyParamField key={param.key} param={param} value={renderParams[param.key] ?? param.default} onPreview={previewParam(param.key)} onCommit={onCommit} />
			))}
		</>
	);
}

/** An effect layer on the timeline: its settings under its name (a filter or adjustment layer: the Color section). */
export function StandaloneEffectTab({ element, trackId }: { element: EffectElement; trackId: string }) {
	const { renderElement, previewUpdates, commit } = useElementPreview({ trackId, elementId: element.id, fallback: element });
	if (element.effectType === COLOR_EFFECT_TYPE) {
		return (
			<div className="pt-2" data-adjust-color data-color-layer>
				<ColorControls key={element.id} target={{ kind: "layer", trackId, element }} />
			</div>
		);
	}
	const effect: Effect = { id: element.id, type: element.effectType, params: element.params, enabled: true };
	const previewParam = (key: string) => (value: number | string | boolean) => {
		previewUpdates({ params: { ...(renderElement as EffectElement).params, [key]: value } });
	};
	return (
		<InspectorGroup id="effect" title={effectsRegistry.get(element.effectType).name}>
			<div data-effect-layer={element.effectType} className="flex flex-col gap-2">
				<EffectParams effect={effect} renderParams={(renderElement as EffectElement).params} previewParam={previewParam} onCommit={commit} />
			</div>
		</InspectorGroup>
	);
}

/** «Paste effect» (when one is copied) and «+» (the Effects panel) on the list's heading. */
export function EffectsHeaderButtons({ element, trackId }: { element: { id: string }; trackId: string }) {
	const editor = useEditor();
	// ⧉ on an effect copies it with its keys; «Paste» (or ⌘V with clips selected) adds it to them.
	const [hasCopiedEffect, setHasCopiedEffect] = useState(() => editor.clipboard.getEntry()?.type === "effect");
	useEffect(() => editor.clipboard.subscribe(() => setHasCopiedEffect(editor.clipboard.getEntry()?.type === "effect")), [editor]);
	const pasteEffect = () => {
		editor.selection.setSelectedElements({ elements: [{ trackId, elementId: element.id }] });
		editor.clipboard.paste();
	};
	return (
		<div className="flex items-center">
			{hasCopiedEffect && <ItemButton icon={ClipboardPaste} label="Paste effect" title="Paste effect" data-paste-effect="" onClick={pasteEffect} />}
			<ItemButton icon={Add01Icon} label="Add effect" title="Add effect" data-add-effect="" onClick={() => useAssetsPanelStore.getState().setActiveTab("effects")} />
		</div>
	);
}

/** Premiere's fx: the effect on or off (off keeps it and its settings). */
function FxSwitch({ on, name, onToggle }: { on: boolean; name: string; onToggle: () => void }) {
	return (
		<Hint label={on ? "Turn off" : "Turn on"}>
			<button
				type="button"
				aria-label={`Toggle ${name}`}
				aria-pressed={on}
				data-effect-toggle=""
				onClick={onToggle}
				className={cn(
					"focus-visible:ring-ring flex h-5 min-w-6 items-center justify-center rounded-[5px] px-1 font-serif text-[11px] italic leading-none outline-none focus-visible:ring-1",
					on ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground bg-foreground/[0.06]",
				)}
			>
				fx
			</button>
		</Hint>
	);
}

export function ClipEffectsTab({ element, trackId }: { element: VisualElement; trackId: string }) {
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [dropIndex, setDropIndex] = useState<number | null>(null);
	const editor = useEditor();
	const { renderElement, previewUpdates, commit } = useElementPreview({ trackId, elementId: element.id, fallback: element });

	const effects: Effect[] = element.effects ?? [];
	// The clip's filter / LUT is in its Color section (one home): the list holds the video effects only.
	const rows = clipEffectRows(effects).filter((row) => row.kind !== "filter");
	const assets = useEditor((e) => e.media.getAssets(), ["media"]);
	const aiSteps = element.type === "video" || element.type === "image" ? aiStepsOf(assets, element) : [];

	const renderParamsOf = (effectId: string): ParamValues =>
		(renderElement as VisualElement).effects?.find((ef) => ef.id === effectId)?.params ?? effects.find((ef) => ef.id === effectId)?.params ?? {};
	const previewParamOf = (effectId: string) => (key: string) => (value: number | string | boolean) => {
		previewUpdates({
			effects: ((renderElement as VisualElement).effects ?? []).map((existing) =>
				existing.id !== effectId ? existing : { ...existing, params: { ...existing.params, [key]: value } },
			),
		});
	};
	const remove = (effectId: string) => editor.timeline.removeClipEffect({ trackId, elementId: element.id, effectId });
	/** ↺ of an effect: every setting back to its default and its keys gone — one ⌘Z. */
	const resetEffect = (effect: Effect) => {
		const definition = effectsRegistry.get(effect.type);
		const defaults = Object.fromEntries(definition.params.map((param) => [param.key, param.default]));
		const paths = definition.params.map((param) => buildEffectParamPath({ effectId: effect.id, paramKey: param.key }));
		editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					patch: {
						effects: effects.map((existing) => (existing.id === effect.id ? { ...existing, params: { ...existing.params, ...defaults } } : existing)),
						animations: removeAnimationPaths({ animations: element.animations, paths }),
					} as Partial<VisualElement>,
				},
			],
		});
	};
	const isDefaultEffect = (effect: Effect) => {
		const definition = effectsRegistry.get(effect.type);
		return definition.params.every((param) => {
			const value = effect.params[param.key] ?? param.default;
			const animated = !!element.animations?.[buildEffectParamPath({ effectId: effect.id, paramKey: param.key }) as keyof NonNullable<typeof element.animations>];
			return !animated && (param.type === "number" ? Math.abs(Number(value) - param.default) < 1e-9 : value === param.default);
		});
	};

	const drop = (toIndex: number) => {
		if (dragIndex !== null && dragIndex !== toIndex) {
			editor.timeline.reorderClipEffects({ trackId, elementId: element.id, fromIndex: dragIndex, toIndex });
		}
		setDragIndex(null);
		setDropIndex(null);
	};

	if (rows.length === 0 && aiSteps.length === 0) return null;
	return (
		<div className="flex flex-col" data-effect-list="">
			{(element.type === "video" || element.type === "image") && <AiEffectRows trackId={trackId} element={element} steps={aiSteps} />}
			{rows.map((row) => {
				const index = effects.indexOf(row.effect);
				const isDropTarget = dropIndex === index && dragIndex !== null && dragIndex !== index;
				const { effect } = row;
				const definition = effectsRegistry.get(effect.type);
				const apply = (scope: ClipScope) => {
					const changed = applyEffect(editor, { trackId, elementId: element.id, effectId: effect.id }, scope);
					if (changed > 0) toast.success(`${definition.name} added to ${changed} ${changed === 1 ? "clip" : "clips"}`);
				};
				return (
					<InspectorGroup
						key={effect.id}
						id={`effect.${effect.id}`}
						title={definition.name}
						muted={!effect.enabled}
						leading={<FxSwitch on={effect.enabled} name={definition.name} onToggle={() => editor.timeline.toggleClipEffect({ trackId, elementId: element.id, effectId: effect.id })} />}
						sectionProps={{
							"data-clip-effect": effect.type,
							onDragOver: (event: React.DragEvent) => {
								if (dragIndex === null) return;
								event.preventDefault();
								if (index !== dropIndex) setDropIndex(index);
							},
							onDrop: () => drop(index),
							className: cn(
								dragIndex === index && "opacity-40",
								isDropTarget && index < (dragIndex ?? -1) && "border-t-2 border-t-primary",
								isDropTarget && index > (dragIndex ?? -1) && "border-b-2 border-b-primary",
							),
						}}
						headerProps={{
							draggable: true,
							onDragStart: (event) => {
								event.dataTransfer.effectAllowed = "move";
								setDragIndex(index);
							},
							onDragEnd: () => {
								setDragIndex(null);
								setDropIndex(null);
							},
							className: "cursor-grab active:cursor-grabbing",
						}}
						trailing={
							<>
								{!isDefaultEffect(effect) && (
									<ItemButton icon={ArrowTurnBackwardIcon} label={`Reset ${definition.name}`} title="Reset" data-reset-effect="" onClick={() => resetEffect(effect)} />
								)}
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<ItemButton icon={MoreHorizontalIcon} label={`Apply ${definition.name} to other clips`} title="More" data-effect-apply-menu="" />
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem data-effect-apply="selected" onSelect={() => apply("selected" satisfies ClipScope)}>
											Apply to selected clips
										</DropdownMenuItem>
										<DropdownMenuItem data-effect-apply="track" onSelect={() => apply("track" satisfies ClipScope)}>
											Apply to all clips on the track
										</DropdownMenuItem>
										<DropdownMenuItem
											data-copy-effect={effect.type}
											onSelect={() => {
												if (editor.clipboard.copyEffect({ element, effectId: effect.id })) toast.success(`${definition.name} copied: select clips and press ⌘V`);
											}}
										>
											Copy
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
								<ItemButton icon={Cancel01Icon} label={`Remove ${definition.name}`} title="Remove" data-remove-effect="" onClick={() => remove(effect.id)} />
							</>
						}
					>
						<div className={cn("flex flex-col gap-2", !effect.enabled && "opacity-50")}>
							{definition.params.map((param) => (
								<EffectParamRow
									key={param.key}
									element={element}
									trackId={trackId}
									effectId={effect.id}
									param={param}
									base={renderParamsOf(effect.id)[param.key] ?? param.default}
									onPreviewBase={previewParamOf(effect.id)(param.key)}
									onCommit={commit}
								/>
							))}
						</div>
					</InspectorGroup>
				);
			})}
		</div>
	);
}

/**
 * One setting of a clip's effect, keyable like the clip's own properties: ◆ keys it at the playhead (the model's effect
 * keys, timeline.upsertEffectParamKeyframe), ‹ › step between its keys, ↺ takes the keys and the value back. A setting
 * without keys writes exactly what it always wrote (the effect's params, previewed while dragged, one ⌘Z on release).
 */
function EffectParamRow({
	element,
	trackId,
	effectId,
	param,
	base,
	onPreviewBase,
	onCommit,
}: {
	element: VisualElement;
	trackId: string;
	effectId: string;
	param: ParamDefinition;
	base: ParamValues[string];
	onPreviewBase: (value: number | string | boolean) => void;
	onCommit: () => void;
}) {
	const numeric = param.type === "number" && param.keyframable !== false;
	const animatedClip = Object.keys(element.animations ?? {}).length > 0;
	const { localTime, isPlayheadWithinElementRange } = useElementPlayhead({ startTime: element.startTime, duration: element.duration, animated: animatedClip });
	const path = buildEffectParamPath({ effectId, paramKey: param.key });
	const resolved = numeric
		? (resolveAnimationPathValueAtTime({ animations: element.animations, propertyPath: path as never, localTime, fallbackValue: base as number }) as number)
		: base;
	const keyed = useKeyframedParamProperty({
		param,
		trackId,
		elementId: element.id,
		animations: element.animations,
		propertyPath: path as never,
		localTime,
		isPlayheadWithinElementRange,
		resolvedValue: resolved as number | string | boolean,
		buildBaseUpdates: ({ value }) =>
			({
				effects: (element.effects ?? []).map((existing) => (existing.id === effectId ? { ...existing, params: { ...existing.params, [param.key]: value } } : existing)),
			}) as Partial<VisualElement>,
	});
	const animated = numeric && keyed.hasAnimatedKeyframes;
	const editor = EditorCore.getInstance();
	const toggle = () => {
		if (!isPlayheadWithinElementRange) return;
		if (keyed.keyframeIdAtTime) {
			editor.timeline.removeEffectParamKeyframe({ trackId, elementId: element.id, effectId, paramKey: param.key, keyframeId: keyed.keyframeIdAtTime });
			return;
		}
		editor.timeline.upsertEffectParamKeyframe({ trackId, elementId: element.id, effectId, paramKey: param.key, time: localTime, value: Number(resolved) });
	};
	return (
		<PropertyParamField
			param={param}
			value={resolved}
			onPreview={(value) => (animated && isPlayheadWithinElementRange ? keyed.onPreview(value as number) : onPreviewBase(value as number | string | boolean))}
			onCommit={onCommit}
			keyframe={
				numeric
					? {
							isActive: keyed.isKeyframedAtTime,
							isAnimated: keyed.hasAnimatedKeyframes,
							isDisabled: !isPlayheadWithinElementRange,
							onToggle: toggle,
							onReset: keyed.resetParam,
							...(animated ? keyStepper({ editor, element, paths: [path], localTime }) : {}),
						}
					: undefined
			}
		/>
	);
}

/** Where each AI step of a clip is switched on / off and set up (docs/EDITOR-MAP.md). */
const AI_STEP_HOME: Partial<Record<string, string>> = {
	background: "cutout.remove",
	deflicker: "video.deflicker",
	enhance: "fix.enhance",
	denoise: "fix.denoise",
	upscale: "ai.upscale",
	retouch: "retouch.face",
};

/**
 * The AI steps on the clip (a new file made from it: Remove background, Remove flickers…), listed so nothing changes
 * the clip unseen; each leads to its own section, where its switch turns it off (the clip as it was) and back on.
 */
function AiEffectRows({ trackId, element, steps }: { trackId: string; element: Extract<VisualElement, { type: "video" | "image" }>; steps: ReturnType<typeof aiStepsOf> }) {
	if (steps.length === 0) return null;
	const off = element.aiOff !== undefined;
	return (
		<>
			{steps
				.slice()
				.reverse()
				.map((step, index) => {
					const last = index === 0;
					const name = step.neural?.label ?? step.name;
					const family = step.neural ? neuralEffect(step.neural.effect)?.family : undefined;
					const home = family ? AI_STEP_HOME[family] : undefined;
					return (
						<InspectorGroup
							key={step.id}
							id={`ai-step.${step.id}`}
							title={
								<span className="flex min-w-0 items-center gap-1.5">
									<span className="truncate">{name}</span>
									<span className="bg-primary/15 text-primary shrink-0 rounded px-1 text-[10px] font-semibold">AI</span>
								</span>
							}
							muted={last && off}
							sectionProps={{ "data-ai-effect": step.neural?.effect ?? "" }}
							trailing={
								home ? (
									<button
										type="button"
										className="text-primary px-1 text-[11px] hover:underline"
										data-ai-step-open={home}
										title={name}
										onClick={() => revealInspectorSection(home, { trackId, elementId: element.id })}
									>
										Open
									</button>
								) : (
									<ItemButton icon={Cancel01Icon} label={`Remove ${name}`} title="Remove" onClick={() => removeAiStep(trackId, element.id, step.id)} />
								)
							}
						/>
					);
				})}
		</>
	);
}
