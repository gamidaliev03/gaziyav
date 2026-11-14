"use client";

import type { MaskableElement } from "@/timeline";
import type { Mask, MaskType, TextMask } from "@/masks/types";
import type { NumberParamDefinition, SelectParamDefinition } from "@/params";
import {
	buildDefaultMaskInstance,
	getMaskDefinition,
	getMaskDefinitionsForMenu,
} from "@/masks";
import { useEditor } from "@/editor/use-editor";
import { useElementPreview } from "@/timeline/hooks/use-element-preview";
import { getVisibleElementsWithBounds } from "@/preview/element-bounds";
import { HugeiconsIcon } from "@/components/ui/icon";
import {
	ArrowExpandIcon,
	Cancel01Icon,
	FeatherIcon,
	RotateClockwiseIcon,
	TextFontIcon,
} from "@hugeicons/core-free-icons";
import { useMemo } from "react";
import { ColorPicker } from "@/components/ui/color-picker";
import { FontPicker } from "@/components/ui/font-picker";
import { NumberField } from "@/components/ui/number-field";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
	clamp,
	formatNumberForDisplay,
	getFractionDigitsForStep,
	snapToStep,
} from "@/utils/math";
import { InspectorGroup, InspectorRow, Split } from "@/components/editor/panels/properties/components/inspector-ui";
import { usePropertyDraft } from "@/components/editor/panels/properties/hooks/use-property-draft";
import {
	OcMirrorIcon,
	OcTextHeightIcon,
	OcTextWidthIcon,
} from "@/components/icons";
import { cn } from "@/utils/ui";

type MasksTabProps = {
	element: MaskableElement;
	trackId: string;
};

type MaskItemProps = {
	trackId: string;
	elementId: string;
	mask: Mask;
	previewParam: (key: string) => (value: number | string | boolean) => void;
	onCommit: () => void;
};

type PreviewParamHandler = (
	key: string,
) => (value: number | string | boolean) => void;

type RegisteredMaskDefinition = ReturnType<typeof getMaskDefinition>;

function isTextMask(mask: Mask): mask is TextMask {
	return mask.type === "text";
}

function withPreviewedMaskParam({
	mask,
	key,
	value,
}: {
	mask: Mask;
	key: string;
	value: number | string | boolean;
}): Mask {
	switch (mask.type) {
		case "split":
			return { ...mask, params: { ...mask.params, [key]: value } };
		case "cinematic-bars":
			return { ...mask, params: { ...mask.params, [key]: value } };
		case "rectangle":
			return { ...mask, params: { ...mask.params, [key]: value } };
		case "ellipse":
			return { ...mask, params: { ...mask.params, [key]: value } };
		case "heart":
			return { ...mask, params: { ...mask.params, [key]: value } };
		case "diamond":
			return { ...mask, params: { ...mask.params, [key]: value } };
		case "star":
			return { ...mask, params: { ...mask.params, [key]: value } };
		case "text":
			return { ...mask, params: { ...mask.params, [key]: value } };
		case "freeform":
			return { ...mask, params: { ...mask.params, [key]: value } };
	}
}

export function MasksTab({ element, trackId }: MasksTabProps) {
	const editor = useEditor();
	const { renderElement, previewUpdates, commit } =
		useElementPreview<MaskableElement>({
			trackId,
			elementId: element.id,
			fallback: element,
		});
	const maskDefs = getMaskDefinitionsForMenu();
	const tracks = useEditor(
		(e) => e.timeline.getPreviewTracks() ?? e.scenes.getActiveScene().tracks,
	);
	const currentTime = useEditor((e) => e.playback.getCurrentTime());
	const mediaAssets = useEditor((e) => e.media.getAssets());
	const canvasSize = useEditor(
		(e) => e.project.getActive().settings.canvasSize,
	);
	const masks = element.masks ?? [];
	const renderMasks = renderElement.masks ?? masks;
	const elementBounds = useMemo(() => {
		const clampedTime = Math.min(
			Math.max(currentTime, element.startTime),
			element.startTime + element.duration - 1,
		);

		return (
			getVisibleElementsWithBounds({
				tracks,
				currentTime: clampedTime,
				canvasSize,
				mediaAssets,
			}).find(
				(item) => item.trackId === trackId && item.elementId === element.id,
			)?.bounds ?? null
		);
	}, [
		canvasSize,
		currentTime,
		element.duration,
		element.id,
		element.startTime,
		mediaAssets,
		trackId,
		tracks,
	]);

	const commitMask = ({ maskType }: { maskType: MaskType }) => {
		if (editor.timeline.isPreviewActive()) {
			editor.timeline.commitPreview();
		} else {
			editor.timeline.updateElements({
				updates: [
					{
						trackId,
						elementId: element.id,
						patch: {
							masks: [
								buildDefaultMaskInstance({
									maskType,
									elementSize: elementBounds
										? {
												width: elementBounds.width,
												height: elementBounds.height,
											}
										: undefined,
								}),
							],
						} as Partial<MaskableElement>,
					},
				],
			});
		}
	};

	const previewMaskParam =
		({ index, key }: { index: number; key: string }) =>
		(value: number | string | boolean) => {
			if (!renderMasks[index]) {
				return;
			}

			const updatedMasks = renderMasks.map((existingMask, maskIndex) =>
				maskIndex !== index
					? existingMask
					: withPreviewedMaskParam({ mask: existingMask, key, value }),
			);

			previewUpdates({ masks: updatedMasks });
		};

	return (
		<div className="flex flex-col" data-masks-tab>
			{/* CapCut: the shapes are one row of tiles — None and every mask; a tile replaces the clip's mask (one ⌘Z). */}
			<div className="grid grid-cols-4 gap-1.5 border-b border-white/[.07] px-4 py-3 @max-[17.5rem]/insp:grid-cols-3" data-mask-shapes={renderMasks[0]?.type ?? "none"}>
				{[{ type: "none" as const, name: "None", icon: null }, ...maskDefs].map((definition) => {
					const active = (renderMasks[0]?.type ?? "none") === definition.type;
					return (
						<button
							key={definition.type}
							type="button"
							aria-pressed={active}
							aria-label={`${definition.name} mask`}
							title={definition.name}
							data-mask-shape={definition.type}
							onClick={() => {
								if (active) return;
								if (definition.type === "none") {
									editor.timeline.updateElements({ updates: [{ trackId, elementId: element.id, patch: { masks: [] } as Partial<MaskableElement> }] });
									return;
								}
								commitMask({ maskType: definition.type });
							}}
							className={cn(
								"flex h-14 flex-col items-center justify-center gap-1 rounded-md border text-[10px] transition-colors",
								active ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
							)}
						>
							{definition.icon ? <HugeiconsIcon {...definition.icon} className="size-5" /> : <span className="text-base leading-none">∅</span>}
							<span className="w-full truncate px-0.5">{definition.name}</span>
						</button>
					);
				})}
			</div>
			{masks.map((mask, index) => (
				<MaskItem
					key={mask.id}
					trackId={trackId}
					elementId={element.id}
					mask={renderMasks[index] ?? mask}
					previewParam={(paramKey) => previewMaskParam({ index, key: paramKey })}
					onCommit={commit}
				/>
			))}
		</div>
	);
}

function MaskItem({
	trackId,
	elementId,
	mask,
	previewParam,
	onCommit,
}: MaskItemProps) {
	const editor = useEditor();
	const definition = getMaskDefinition(mask.type);

	const headerButton = "hover:bg-accent focus-visible:ring-ring text-muted-foreground hover:text-foreground flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm outline-none focus-visible:ring-1";
	return (
		<InspectorGroup
			id={`mask.${mask.id}`}
			title={definition.name}
			trailing={
				<div className="flex items-center" data-mask-item={mask.type}>
					<button
						type="button"
						aria-label={`Toggle ${definition.name} mask inversion`}
						aria-pressed={Boolean(mask.params.inverted)}
						title={mask.params.inverted ? "Inverted: the shape hides, the rest shows" : "Invert: hide the shape, show the rest"}
						onClick={() => editor.timeline.toggleMaskInverted({ trackId, elementId, maskId: mask.id })}
						className={cn(headerButton, mask.params.inverted && "text-foreground")}
					>
						<OcMirrorIcon className={cn("size-3.5", mask.params.inverted && "-scale-x-100")} />
					</button>
					<button
						type="button"
						aria-label={`Remove ${definition.name} mask`}
						title="Remove the mask (⌘Z brings it back)"
						onClick={() => editor.timeline.removeMask({ trackId, elementId, maskId: mask.id })}
						className={headerButton}
					>
						<HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
					</button>
				</div>
			}
		>
			<MaskParamsFields mask={mask} definition={definition} previewParam={previewParam} onCommit={onCommit} />
		</InspectorGroup>
	);
}

function MaskParamsFields({
	mask,
	definition,
	previewParam,
	onCommit,
}: {
	mask: Mask;
	definition: RegisteredMaskDefinition;
	previewParam: PreviewParamHandler;
	onCommit: () => void;
}) {
	const featherParam = getNumberParamDefinition({
		definition,
		key: "feather",
	});
	const strokeWidthParam = getNumberParamDefinition({
		definition,
		key: "strokeWidth",
	});
	const previewNumberParam = (key: string) => (value: number) =>
		previewParam(key)(value);
	const previewStrokeColor = previewParam("strokeColor");
	const strokeAlignParam = definition.params.find(
		(param): param is SelectParamDefinition<string> =>
			param.key === "strokeAlign" && param.type === "select",
	);

	return (
		<>
			{isTextMask(mask) ? (
				<TextMaskFields
					mask={mask}
					previewParam={previewParam}
					onCommit={onCommit}
					fontSizeParam={getNumberParamDefinition({
						definition,
						key: "fontSize",
					})}
				/>
			) : null}
			{definition.features.hasPosition &&
				"centerX" in mask.params &&
				"centerY" in mask.params && (
					<InspectorRow rowId="mask.position" label="Position">
						<Split stackWhenNarrow>
							<MaskNumberField
								icon="X"
								param={getNumberParamDefinition({
									definition,
									key: "centerX",
								})}
								value={getMaskNumber({
									params: mask.params,
									key: "centerX",
								})}
								onPreview={previewNumberParam("centerX")}
								onCommit={onCommit}
							/>
							<MaskNumberField
								icon="Y"
								param={getNumberParamDefinition({
									definition,
									key: "centerY",
								})}
								value={getMaskNumber({
									params: mask.params,
									key: "centerY",
								})}
								onPreview={previewNumberParam("centerY")}
								onCommit={onCommit}
							/>
						</Split>
					</InspectorRow>
				)}

			{definition.features.sizeMode === "width-height" &&
				"width" in mask.params &&
				"height" in mask.params && (
					<InspectorRow rowId="mask.size" label="Size">
						<Split stackWhenNarrow>
							<MaskNumberField
								icon="W"
								param={getNumberParamDefinition({
									definition,
									key: "width",
								})}
								value={getMaskNumber({
									params: mask.params,
									key: "width",
								})}
								onPreview={previewNumberParam("width")}
								onCommit={onCommit}
							/>
							<MaskNumberField
								icon="H"
								param={getNumberParamDefinition({
									definition,
									key: "height",
								})}
								value={getMaskNumber({
									params: mask.params,
									key: "height",
								})}
								onPreview={previewNumberParam("height")}
								onCommit={onCommit}
							/>
						</Split>
					</InspectorRow>
				)}

			{definition.features.sizeMode === "height-only" &&
				"height" in mask.params && (
					<InspectorRow rowId="mask.height" label="Height">
						<MaskNumberField
							icon="H"
							param={getNumberParamDefinition({
								definition,
								key: "height",
							})}
							value={getMaskNumber({
								params: mask.params,
								key: "height",
							})}
							onPreview={previewNumberParam("height")}
							onCommit={onCommit}
						/>
					</InspectorRow>
				)}

			{definition.features.sizeMode === "width-only" &&
				"width" in mask.params && (
					<InspectorRow rowId="mask.width" label="Width">
						<MaskNumberField
							icon="W"
							param={getNumberParamDefinition({
								definition,
								key: "width",
							})}
							value={getMaskNumber({
								params: mask.params,
								key: "width",
							})}
							onPreview={previewNumberParam("width")}
							onCommit={onCommit}
						/>
					</InspectorRow>
				)}

			{definition.features.sizeMode === "uniform" && "scale" in mask.params && (
				<InspectorRow rowId="mask.scale" label="Scale">
					<MaskNumberField
						icon={
							isTextMask(mask) ? <HugeiconsIcon icon={ArrowExpandIcon} /> : "S"
						}
						param={getNumberParamDefinition({
							definition,
							key: "scale",
						})}
						value={getMaskNumber({
							params: mask.params,
							key: "scale",
						})}
						onPreview={previewNumberParam("scale")}
						onCommit={onCommit}
					/>
				</InspectorRow>
			)}

			{definition.features.hasRotation && "rotation" in mask.params && (
				<InspectorRow rowId="mask.rotation" label="Rotation">
					<MaskNumberField
						icon={<HugeiconsIcon icon={RotateClockwiseIcon} />}
						param={getNumberParamDefinition({
							definition,
							key: "rotation",
						})}
						value={getMaskNumber({
							params: mask.params,
							key: "rotation",
						})}
						onPreview={previewNumberParam("rotation")}
						onCommit={onCommit}
					/>
				</InspectorRow>
			)}

			<InspectorRow rowId="mask.feather" label="Feather">
				<MaskNumberField
					icon={<HugeiconsIcon icon={FeatherIcon} />}
					param={featherParam}
					value={getMaskNumber({
						params: mask.params,
						key: "feather",
					})}
					onPreview={previewNumberParam("feather")}
					onCommit={onCommit}
				/>
			</InspectorRow>

			<InspectorRow rowId="mask.stroke" label="Stroke">
				<div className="flex flex-col gap-2">
					<Split stackWhenNarrow>
						<MaskNumberField
							icon="W"
							param={strokeWidthParam}
							value={getMaskNumber({
								params: mask.params,
								key: "strokeWidth",
							})}
							onPreview={previewNumberParam("strokeWidth")}
							onCommit={onCommit}
						/>
						<ColorPicker
							className="w-full"
							value={mask.params.strokeColor.replace(/^#/, "").toUpperCase()}
							onChange={(color) => previewStrokeColor(`#${color}`)}
							onChangeEnd={(color) => {
								previewStrokeColor(`#${color}`);
								onCommit();
							}}
						/>
					</Split>
					{strokeAlignParam ? (
						<Select
							value={mask.params.strokeAlign}
							onValueChange={(value) => {
								previewParam("strokeAlign")(value);
								onCommit();
							}}
						>
							<SelectTrigger className="h-7 w-full text-xs" aria-label="Stroke position">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{strokeAlignParam.options.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : null}
				</div>
			</InspectorRow>
		</>
	);
}

const LETTER_SPACING_PARAM: NumberParamDefinition = {
	key: "letterSpacing",
	label: "Letter spacing",
	type: "number",
	default: 0,
	min: -100,
	max: 500,
	step: 1,
};

const LINE_HEIGHT_PARAM: NumberParamDefinition = {
	key: "lineHeight",
	label: "Line height",
	type: "number",
	default: 1.2,
	min: 0.1,
	max: 10,
	step: 0.1,
};

function TextMaskFields({
	mask,
	previewParam,
	onCommit,
	fontSizeParam,
}: {
	mask: TextMask;
	previewParam: PreviewParamHandler;
	onCommit: () => void;
	fontSizeParam: NumberParamDefinition;
}) {
	const content = usePropertyDraft({
		displayValue: mask.params.content,
		parse: (input) => input,
		onPreview: (value) => previewParam("content")(value),
		onCommit,
	});

	const previewNumberParam = (key: string) => (value: number) =>
		previewParam(key)(value);

	return (
		<>
			<InspectorRow rowId="mask.content" label="Text" stacked>
				<Textarea
					value={content.displayValue}
					aria-label="Mask text"
					className="min-h-14 resize-y text-sm"
					onFocus={content.onFocus}
					onChange={content.onChange}
					onBlur={content.onBlur}
				/>
			</InspectorRow>
			<InspectorRow rowId="mask.font" label="Font">
				<FontPicker
					defaultValue={mask.params.fontFamily}
					className="h-7 w-full text-xs"
					onValueChange={(value) => {
						previewParam("fontFamily")(value);
						onCommit();
					}}
				/>
			</InspectorRow>
			<InspectorRow rowId="mask.fontSize" label="Size">
				<MaskNumberField
					icon={<HugeiconsIcon icon={TextFontIcon} />}
					param={fontSizeParam}
					value={mask.params.fontSize}
					onPreview={previewNumberParam("fontSize")}
					onCommit={onCommit}
				/>
			</InspectorRow>
			<InspectorRow rowId="mask.spacing" label="Spacing">
				<Split stackWhenNarrow>
					<MaskNumberField
						icon={<OcTextWidthIcon size={14} />}
						param={LETTER_SPACING_PARAM}
						value={mask.params.letterSpacing ?? 0}
						onPreview={previewNumberParam("letterSpacing")}
						onCommit={onCommit}
					/>
					<MaskNumberField
						icon={<OcTextHeightIcon size={14} />}
						param={LINE_HEIGHT_PARAM}
						value={mask.params.lineHeight ?? 1.2}
						onPreview={previewNumberParam("lineHeight")}
						onCommit={onCommit}
					/>
				</Split>
			</InspectorRow>
		</>
	);
}

function getNumberParamDefinition({
	definition,
	key,
}: {
	definition: RegisteredMaskDefinition;
	key: string;
}): NumberParamDefinition {
	const param = definition.params.find((candidate) => candidate.key === key);

	if (!param || param.type !== "number") {
		throw new Error(`Missing number param definition for mask key "${key}"`);
	}

	return param;
}

function getMaskNumber<
	TParams extends Mask["params"],
	TKey extends keyof TParams & string,
>({ params, key }: { params: TParams; key: TKey }): number {
	const value = params[key];

	if (typeof value !== "number") {
		throw new Error(`Expected numeric mask param for "${key}"`);
	}

	return value;
}

function MaskNumberField({
	param,
	value,
	onPreview,
	onCommit,
	icon,
	className,
}: {
	param: NumberParamDefinition;
	value: number;
	onPreview: (value: number) => void;
	onCommit: () => void;
	icon?: React.ReactNode;
	className?: string;
}) {
	const isPercent = param.unit === "percent";
	const percentMax = param.max ?? 100;
	const displayMultiplier = isPercent
		? 100 / percentMax
		: (param.displayMultiplier ?? 1);
	const min = isPercent ? 0 : param.min;
	const max = isPercent ? 100 : param.max;
	const step = isPercent ? 1 : param.step;
	const displayValue = value * displayMultiplier;
	const maxFractionDigits = getFractionDigitsForStep({ step });

	const clampDisplay = (nextDisplayValue: number) =>
		max !== undefined
			? clamp({ value: nextDisplayValue, min, max })
			: Math.max(min, nextDisplayValue);

	const previewFromDisplay = (nextDisplayValue: number) => {
		onPreview(
			clampDisplay(snapToStep({ value: nextDisplayValue, step })) /
				displayMultiplier,
		);
	};

	const draft = usePropertyDraft({
		displayValue: formatNumberForDisplay({
			value: displayValue,
			maxFractionDigits,
		}),
		parse: (input) => {
			const parsed = parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return (
				clampDisplay(snapToStep({ value: parsed, step })) / displayMultiplier
			);
		},
		onPreview,
		onCommit,
	});

	return (
		<NumberField
			className={cn("h-7 text-xs", className)}
			icon={icon}
			value={draft.displayValue}
			dragSensitivity="slow"
			onFocus={draft.onFocus}
			onChange={draft.onChange}
			onBlur={draft.onBlur}
			// Esc cancels the typed value (without it Esc became a blur and applied it).
			onKeyDown={draft.onKeyDown}
			onScrub={previewFromDisplay}
			onScrubEnd={onCommit}
		/>
	);
}

