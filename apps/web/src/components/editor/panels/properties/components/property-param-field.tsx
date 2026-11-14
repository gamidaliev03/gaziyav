"use client";

import { useEffect, useRef, useState } from "react";
import type {
	ParamDefinition,
	NumberParamDefinition,
	ParamValue,
} from "@/params";
import {
	formatNumberForDisplay,
	getFractionDigitsForStep,
	snapToStep,
} from "@/utils/math";
import { NumberField } from "@/components/ui/number-field";
import { Switch } from "@/components/ui/switch";
import { ColorPicker } from "@/components/ui/color-picker";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FontPicker } from "@/components/ui/font-picker";
import { EditorCore } from "@/core";
import { HugeiconsIcon } from "@/components/ui/icon";
import { TextAlignCenterIcon, TextAlignLeftIcon, TextAlignRightIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/utils/ui";
import { usePropertyDraft } from "../hooks/use-property-draft";
import { labelScrub } from "../hooks/label-scrub";
import { mixedScrubValue, SCRUB_UNBOUNDED, scrubUnitsPerPixel } from "../hooks/number-input";
import { InspectorRow, InspectorSlider, Segmented, Split, type RowKeyframe } from "./inspector-ui";
import type { RowValueClipboard } from "./row-value-menu";
import { pastableValue } from "@/params/value-clipboard";
import { readParamValues } from "@/actions/apply-to-all";

/** "Fade in, s" → label "Fade in", unit "s". Long units ("% of size") stay in the label. */
export function splitUnit(label: string): { label: string; unit?: string } {
	const match = /^(.*), ([^,]{1,3})$/.exec(label);
	return match ? { label: match[1], unit: match[2] } : { label };
}

const ALIGN_ICONS: Record<string, typeof TextAlignLeftIcon> = {
	left: TextAlignLeftIcon,
	center: TextAlignCenterIcon,
	right: TextAlignRightIcon,
};

/** Sliders only where the range is a real range (opacity, volume, fades), not for positions. */
function hasSliderRange(param: NumberParamDefinition): boolean {
	return (
		param.max !== undefined &&
		Number.isFinite(param.min) &&
		param.max - param.min > 0 &&
		param.max - param.min <= 1000
	);
}

/** Up to three short options draw as segments (Left | Center | Right); longer lists open a dropdown. */
function isShortSelect(options: ReadonlyArray<{ label: string }>): boolean {
	return options.length <= 3 && options.every((option) => option.label.length <= 9);
}

function isDefaultValue(param: ParamDefinition, value: ParamValue): boolean {
	if (param.type === "number") return Math.abs(Number(value) - param.default) < 1e-9;
	if (param.type === "color") return String(value).toLowerCase() === String(param.default).toLowerCase();
	return value === param.default;
}

/**
 * One parameter as an inspector row: label on the left, its control on the right, reset and the
 * keyframe ◆ in the right gutter. Numbers with a range get a slider plus a drag-to-change field.
 */
export function PropertyParamField({
	param,
	value,
	onPreview,
	onCommit,
	keyframe,
	label,
	unit,
	mixed = false,
}: {
	param: ParamDefinition;
	value: ParamValue;
	onPreview: (value: ParamValue) => void;
	onCommit: () => void;
	keyframe?: RowKeyframe;
	/** Shorter label for this place in the panel (the stored label stays the same). */
	label?: string;
	unit?: string;
	/** Several clips with different values. */
	mixed?: boolean;
}) {
	const parsed = splitUnit(label ?? param.label);
	const rowLabel = parsed.label;
	const rowUnit = unit ?? parsed.unit;
	const reset = () => {
		// An animated parameter: its keys go too, with the default value, in one ⌘Z.
		if (keyframe?.isAnimated && keyframe.onReset) {
			keyframe.onReset();
			return;
		}
		onPreview(param.default);
		onCommit();
	};
	const showKeyframe = keyframe && param.keyframable !== false && param.type !== "text" && param.type !== "font";
	const segmented = param.type === "select" && isShortSelect(param.options);
	const textValue = String(value ?? "");
	const stacked =
		param.type === "text" && (param.key === "content" || textValue.length > 32 || textValue.includes("\n"));
	// Numbers: the label is the scrub zone, in the units the field shows (a Mixed row moves from the first clip's value).
	const multiplier = param.type === "number" ? (param.displayMultiplier ?? 1) : 1;
	const scrubLabel = labelScrub({
		enabled: param.type === "number",
		value: Number(value) * multiplier,
		perPixel: param.type === "number" ? (scrubUnitsPerPixel(param) ?? 1) : 1,
		onPreview: (display) => {
			if (param.type !== "number") return;
			const snapped = snapToStep({ value: display, step: param.step });
			onPreview(Math.max(param.min, param.max !== undefined ? Math.min(param.max, snapped) : snapped) / multiplier);
		},
		onCommit,
	});

	// Right-click «Copy value» / «Paste value»: this param's value, typed (effect params and text style too).
	const valueClipboard: RowValueClipboard = {
		// Several clips with different values: the first selected clip's value.
		copy: () => {
			if (!mixed) return { values: { [param.key]: value }, type: param.type, label: rowLabel };
			const editor = EditorCore.getInstance();
			const [first] = editor.timeline.getElementsWithTracks({ elements: editor.selection.getSelectedElements() });
			const values = first ? readParamValues(first.element, [param.key]) : null;
			return values ? { values, type: param.type, label: rowLabel } : null;
		},
		canPaste: (copied) => pastableValue(param, copied) !== null,
		paste: (copied) => {
			const next = pastableValue(param, copied);
			if (next === null) return;
			onPreview(next);
			onCommit();
		},
	};

	return (
		<InspectorRow
			rowId={param.key}
			valueClipboard={valueClipboard}
			label={rowLabel}
			hint={param.label}
			stacked={stacked}
			inline={param.type === "boolean"}
			stackWhenNarrow={segmented}
			onLabelPointerDown={scrubLabel}
			onReset={param.type === "text" ? undefined : reset}
			isDefault={mixed || isDefaultValue(param, value)}
			keyframe={showKeyframe ? keyframe : undefined}
		>
			<ParamInput
				param={param}
				value={value}
				unit={rowUnit}
				label={rowLabel}
				stacked={stacked}
				mixed={mixed}
				onPreview={onPreview}
				onCommit={onCommit}
				onReset={param.type === "text" ? undefined : reset}
			/>
		</InspectorRow>
	);
}

function ParamInput({
	param,
	value,
	unit,
	label,
	stacked,
	mixed,
	onPreview,
	onCommit,
	onReset,
}: {
	param: ParamDefinition;
	value: ParamValue;
	unit?: string;
	label: string;
	stacked: boolean;
	mixed: boolean;
	onPreview: (value: ParamValue) => void;
	onCommit: () => void;
	onReset?: () => void;
}) {
	if (param.type === "number") {
		const numeric = typeof value === "number" ? value : Number(value);
		const field = (
			<NumberParamField
				param={param}
				value={numeric}
				unit={unit}
				mixed={mixed}
				onPreview={onPreview}
				onCommit={onCommit}
			/>
		);
		if (!hasSliderRange(param)) return field;
		const multiplier = param.displayMultiplier ?? 1;
		const slider = (
			<InspectorSlider
				label={label}
				min={param.min}
				max={param.max as number}
				step={param.step}
				value={numeric * multiplier}
				onChange={(next) => onPreview(next / multiplier)}
				onCommit={onCommit}
			/>
		);
		// A two-sided slider (Pan: left … centre … right): a double-click on it goes back to the middle, as on a mixer.
		const twoSided = param.min < param.default && param.default < (param.max as number);
		return (
			<Split slider>
				{twoSided && onReset ? (
					<div className="contents" data-slider-reset={param.key} onDoubleClick={onReset}>
						{slider}
					</div>
				) : (
					slider
				)}
				{field}
			</Split>
		);
	}

	if (param.type === "boolean") {
		return (
			<div className="flex h-7 items-center gap-2">
				<Switch
					aria-label={label}
					checked={!mixed && Boolean(value)}
					onCheckedChange={(checked) => {
						onPreview(checked);
						onCommit();
					}}
				/>
				{mixed && <span className="text-muted-foreground text-xs">Mixed</span>}
			</div>
		);
	}

	// Several clips that differ: no option is picked and the control reads "Mixed", like a number field.
	// (It used to show the first clip's value, as if every selected clip had it.)
	if (param.type === "select") {
		if (isShortSelect(param.options)) {
			return (
				<Segmented
					label={mixed ? `${label} (mixed)` : label}
					value={mixed ? "" : String(value)}
					options={param.options.map((option) => ({
						value: option.value,
						title: option.label,
						label: ALIGN_ICONS[option.value] && param.key === "textAlign" ? (
							<HugeiconsIcon icon={ALIGN_ICONS[option.value]} className="size-3.5" aria-label={option.label} />
						) : (
							option.label
						),
					}))}
					onChange={(selected) => {
						onPreview(selected);
						onCommit();
					}}
				/>
			);
		}
		return (
			<OptionSelect
				label={label}
				value={mixed ? "" : String(value)}
				placeholder={mixed ? "Mixed" : undefined}
				options={param.options}
				onChange={(selected) => {
					onPreview(selected);
					onCommit();
				}}
			/>
		);
	}

	if (param.type === "color") {
		const picker = (
			<ColorPicker
				className="w-full"
				value={String(value).replace(/^#/, "").toUpperCase()}
				onChange={(color) => onPreview(`#${color}`)}
				onChangeEnd={(color) => {
					onPreview(`#${color}`);
					onCommit();
				}}
			/>
		);
		if (!mixed) return picker;
		return (
			<MixedOverlay textClassName="left-8 right-px" swatchClassName="left-[calc(0.45rem+1px)] size-4.5">
				{picker}
			</MixedOverlay>
		);
	}

	if (param.type === "text") {
		return <TextParamInput value={String(value ?? "")} multiline={stacked} label={label} selectSample={param.key === "content"} onPreview={onPreview} onCommit={onCommit} />;
	}

	if (param.type === "font") {
		// Searchable list: built-in Cyrillic fonts first, each shown in its own face.
		const picker = (
			<FontPicker
				// Mixed: the button reads "Mixed" and no font is ticked in the list.
				defaultValue={mixed ? "Mixed" : String(value)}
				className="h-7 w-full text-xs"
				onValueChange={(family) => {
					onPreview(family);
					onCommit();
				}}
			/>
		);
		if (!mixed) return picker;
		// The button draws its text in the chosen font; "Mixed" isn't one, so it uses the panel's font.
		return <div className="[&_.truncate]:[font-family:inherit]!">{picker}</div>;
	}

	return null;
}

/**
 * "Mixed" over a control that can't say it itself (the colour picker): it covers the shown value and lets
 * every click through to the control. While the hex field is being typed in, it steps aside so the typing
 * is visible.
 */
function MixedOverlay({
	children,
	textClassName,
	swatchClassName,
}: {
	children: React.ReactNode;
	/** Where the value text sits inside the control (left / right insets). */
	textClassName: string;
	/** The colour swatch, covered by a many-colour one. */
	swatchClassName: string;
}) {
	return (
		<div className="group/mixed relative">
			{children}
			<span
				aria-hidden
				className={cn(
					"bg-accent text-muted-foreground pointer-events-none absolute inset-y-px flex items-center text-xs group-focus-within/mixed:hidden",
					textClassName,
				)}
			>
				Mixed
			</span>
			<span
				aria-hidden
				className={cn(
					"pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-sm border",
					swatchClassName,
				)}
				style={{ background: "conic-gradient(#ef4444, #eab308, #22c55e, #3b82f6, #2bb3a6, #ef4444)" }}
			/>
		</div>
	);
}

/** Text: typing previews live, leaving the field (or ⌘Enter / Enter on one line) commits, Esc reverts. */
function TextParamInput({
	value,
	multiline,
	label,
	selectSample = false,
	onPreview,
	onCommit,
}: {
	value: string;
	multiline: boolean;
	label: string;
	/** A text clip's content: its sample («Text») is selected whole on focus, so typing replaces it. */
	selectSample?: boolean;
	onPreview: (value: string) => void;
	onCommit: () => void;
}) {
	const [draft, setDraft] = useState(value);
	const editing = useRef(false);
	const cancelled = useRef(false);
	useEffect(() => {
		if (!editing.current) setDraft(value);
	}, [value]);
	const common = {
		value: draft,
		"aria-label": label,
		onFocus: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
			editing.current = true;
			cancelled.current = false;
			// A text clip's sample («Text») is selected whole on focus, so typing replaces it (CapCut; the product
			// review 04.11 typed «TextMy first Reel»).
			if (selectSample && /^(Text|Default text|Your text|Текст)$/i.test(event.currentTarget.value.trim())) event.currentTarget.select();
		},
		onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
			setDraft(event.currentTarget.value);
			onPreview(event.currentTarget.value);
		},
		onBlur: () => {
			editing.current = false;
			if (cancelled.current) {
				cancelled.current = false;
				setDraft(value);
				return;
			}
			onCommit();
		},
		onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
			event.stopPropagation();
			if (event.key === "Escape") {
				cancelled.current = true;
				EditorCore.getInstance().timeline.discardPreview();
				event.currentTarget.blur();
			} else if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				event.currentTarget.blur();
			}
		},
	};
	return multiline ? (
		<Textarea {...common} rows={2} className="min-h-14 resize-y text-sm" />
	) : (
		<Input {...common} className="h-7 text-xs" />
	);
}

export function NumberParamField({
	param,
	value,
	unit,
	mixed = false,
	icon,
	onPreview,
	onCommit,
}: {
	param: NumberParamDefinition;
	value: number;
	unit?: string;
	mixed?: boolean;
	/** The drag handle inside the field (X, Y, °…). Default: the param's short label, else an empty drag zone (the row's label drags too). */
	icon?: React.ReactNode;
	onPreview: (value: number) => void;
	onCommit: () => void;
}) {
	const { min, max, step, displayMultiplier = 1 } = param;
	const displayValue = value * displayMultiplier;
	const clampDisplayValue = (nextDisplayValue: number) =>
		Math.max(
			min,
			max !== undefined ? Math.min(max, nextDisplayValue) : nextDisplayValue,
		);

	const previewFromDisplay = (displayVal: number) => {
		const clamped = clampDisplayValue(
			snapToStep({ value: displayVal, step }),
		);
		onPreview(clamped / displayMultiplier);
	};

	const maxFractionDigits = getFractionDigitsForStep({ step });
	const format = (nextDisplayValue: number) => formatNumberForDisplay({ value: nextDisplayValue, maxFractionDigits });

	const draft = usePropertyDraft({
		displayValue: mixed ? "Mixed" : format(displayValue),
		parse: (input) => {
			const parsed = Number.parseFloat(input);
			if (Number.isNaN(parsed)) return null;
			return clampDisplayValue(snapToStep({ value: parsed, step }));
		},
		onPreview: previewFromDisplay,
		onCommit,
		numeric: true,
		nudge: { step, format },
	});

	const perPixel = scrubUnitsPerPixel({ min, max, step });
	return (
		<NumberField
			icon={icon ?? param.shortLabel ?? SCRUB_ZONE}
			value={draft.displayValue}
			suffix={unit && /^[a-z]/i.test(unit) ? `\u2009${unit}` : unit}
			suffixClassName="text-muted-foreground text-xs"
			className="h-7 text-xs"
			scrubRanges={mixed || perPixel === null ? undefined : [{ from: min, to: max ?? SCRUB_UNBOUNDED, pixelsPerUnit: 1 / perPixel }]}
			scrubClamp={{ min, max }}
			onFocus={draft.onFocus}
			onChange={draft.onChange}
			onKeyDown={draft.onKeyDown}
			onBlur={draft.onBlur}
			// "Mixed" isn't a number, so the field scrubs from 0 at one unit per pixel: the drag is a change from the first
			// clip's value (it used to set every clip to the distance dragged).
			onScrub={mixed ? (pixels) => previewFromDisplay(mixedScrubValue({ first: displayValue, pixels, perPixel })) : previewFromDisplay}
			onScrubEnd={onCommit}
		/>
	);
}


/**
 * A dropdown whose options exist only while it is open. A closed Radix Select still renders every item
 * (into a detached fragment, to show the picked one's text): Blend's 16 options were mounted again each
 * time a clip got selected. The trigger shows the picked option's label itself.
 */
export function OptionSelect({
	label,
	value,
	placeholder,
	options,
	onChange,
}: {
	label: string;
	/** "" shows the placeholder (Radix). */
	value: string;
	placeholder?: string;
	options: ReadonlyArray<{ value: string; label: string }>;
	onChange: (value: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const picked = options.find((option) => option.value === value);
	// An option may stand for «nothing» with the value "" (a title's Design «None», its Icon «Design's own»). The
	// list's items cannot carry an empty value (the menu refuses to draw and the whole section fell: «Design couldn't
	// be shown», found 15.11), so inside the menu that option goes by a name of its own and comes back as "".
	const wire = (option: string) => (option === "" ? NO_OPTION : option);
	// (the value "" with no such option is «several clips that differ»: the placeholder shows, nothing is picked)
	const shown = picked ? wire(value) : value;
	return (
		<Select value={shown} open={open} onOpenChange={setOpen} onValueChange={(selected) => onChange(selected === NO_OPTION ? "" : selected)}>
			<SelectTrigger className="h-7 w-full text-xs" aria-label={label}>
				<SelectValue placeholder={placeholder}>{picked?.label}</SelectValue>
			</SelectTrigger>
			{open && (
				<SelectContent>
					{options.map((option) => (
						<SelectItem key={option.value} value={wire(option.value)}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			)}
		</Select>
	);
}

/** How the option whose value is "" is named inside the menu (see OptionSelect). */
const NO_OPTION = "__none__";

/**
 * The field's left edge as a drag zone with nothing drawn in it (design I1: the label and the field's first 16 px
 * scrub; the grip glyph read as Pause). Keeping NumberField's handle also keeps its unit after the digits.
 */
const SCRUB_ZONE = <span aria-hidden className="block h-3.5 w-1" />;
