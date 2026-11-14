"use client";

// The building blocks of the Properties panel: a collapsible group, a row (label left, control right,
// reset + keyframe on the far right), a compact slider and a segmented switch. Every row has the same
// three columns, so labels, fields and keyframe diamonds line up down the whole panel at any width.
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type HTMLAttributes, type ReactNode } from "react";
import { Slider } from "@/components/ui/slider";
import { fold, HugeiconsIcon } from "@/components/ui/icon";
import { ArrowDown01Icon, ArrowLeft01Icon, ArrowRight01Icon, ArrowTurnBackwardIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/utils/ui";
import { KeyframeToggle } from "./keyframe-toggle";
import { type RowValueClipboard, RowValueMenu } from "./row-value-menu";

const GROUPS_KEY = "inspector-groups";
let groupOpen: Map<string, boolean> | null = null;
/** Bumped whenever a group is opened or closed (the preview reads whether the Mask section is open). */
let groupsVersion = 0;
const groupListeners = new Set<() => void>();

/**
 * The one list's default per group id (sections/layout.ts): a section the list keeps folded until the user opens it
 * (a tool, Shadow…) although its own component says open. What the user chose always wins.
 */
export const GroupDefaultsContext = createContext<Readonly<Record<string, boolean>> | null>(null);
/** How deep a group sits inside another (Color's own groups inside Color): drawn a level quieter. */
const GroupDepthContext = createContext(0);

/** Whether a group is open as the user left it (or its default): for code outside the panel. */
export function isInspectorGroupOpen(id: string, fallback = false): boolean {
	return openGroups().get(id) ?? fallback;
}

/** The same, as a hook that follows the user opening or closing it. */
export function useInspectorGroupOpen(id: string, fallback = false): boolean {
	useSyncExternalStore(
		(listener) => {
			groupListeners.add(listener);
			return () => groupListeners.delete(listener);
		},
		() => groupsVersion,
		() => 0,
	);
	return isInspectorGroupOpen(id, fallback);
}

/** Groups the user opened or closed, by id: kept across restarts (they all came back open after one). */
function openGroups(): Map<string, boolean> {
	if (groupOpen) return groupOpen;
	try {
		const saved: unknown = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? "{}");
		groupOpen = new Map(
			Object.entries(saved && typeof saved === "object" ? saved : {}).filter(
				(entry): entry is [string, boolean] => typeof entry[1] === "boolean",
			),
		);
	} catch {
		groupOpen = new Map();
	}
	return groupOpen;
}

function rememberGroup(id: string, open: boolean) {
	const groups = openGroups();
	groups.set(id, open);
	try {
		localStorage.setItem(GROUPS_KEY, JSON.stringify(Object.fromEntries(groups)));
	} catch {}
	groupsVersion++;
	for (const listener of groupListeners) listener();
}

const openRequests = new Set<(ids: ReadonlySet<string>) => void>();

/**
 * Opens these groups wherever they are shown, and remembers them open for when they mount: a tool that just changed
 * some settings (Auto color → the Color groups it touched) shows its result instead of a closed header.
 */
export function openInspectorGroups(ids: readonly string[]) {
	for (const id of ids) rememberGroup(id, true);
	const set = new Set(ids);
	for (const listener of openRequests) listener(set);
}

export function InspectorGroup({
	id,
	title,
	defaultOpen = true,
	leading,
	trailing,
	children,
	className,
	flush = false,
	sectionProps,
	headerProps,
	muted = false,
}: {
	id: string;
	title: ReactNode;
	defaultOpen?: boolean;
	/** Shown before the name (an effect's fx switch). */
	leading?: ReactNode;
	/** Shown on the right of the header (a switch that turns the group on, a menu…). */
	trailing?: ReactNode;
	children?: ReactNode;
	className?: string;
	/** The body without side padding: its children are groups of their own (Color's groups). */
	flush?: boolean;
	/** Extra attributes on the section (an effect's drop target). */
	sectionProps?: HTMLAttributes<HTMLElement> & Record<`data-${string}`, string | undefined>;
	/** Extra attributes on the header row (an effect is dragged by it). */
	headerProps?: HTMLAttributes<HTMLDivElement>;
	/** Drawn quieter (an effect switched off). */
	muted?: boolean;
}) {
	const defaults = useContext(GroupDefaultsContext);
	const depth = useContext(GroupDepthContext);
	// "*": every top group of this part of the list (the tools start folded); a group inside one keeps its own default
	const [open, setOpen] = useState(() => openGroups().get(id) ?? defaults?.[id] ?? (depth === 0 ? defaults?.["*"] : undefined) ?? defaultOpen);
	// The body stays mounted while open or closing and unmounts once the collapse has run: a closed group costs nothing.
	const [mounted, setMounted] = useState(open);
	// Only an open by the user runs from 0fr (@starting-style). Every open group that showed again after display: none
	// ran it too — the clip panel is kept hidden while nothing is selected, so each ⌘Z or ⌫ that brought a clip back
	// animated ~50 groups at once (10 tracks: 128 ms to the next frame, most of it style and layerize).
	const [animateOpen, setAnimateOpen] = useState(false);
	const hasBody = Boolean(children) && !(Array.isArray(children) && children.every((c) => !c));
	useEffect(() => {
		const listener = (ids: ReadonlySet<string>) => {
			if (!ids.has(id)) return;
			setMounted(true);
			setAnimateOpen(true);
			setOpen(true);
		};
		openRequests.add(listener);
		return () => {
			openRequests.delete(listener);
		};
	}, [id]);
	const toggle = () => {
		if (!hasBody) return;
		rememberGroup(id, !open);
		if (!open) {
			setMounted(true);
			setAnimateOpen(true);
		}
		setOpen(!open);
	};
	const label = typeof title === "string" ? title : id;
	return (
		<section
			data-inspector-group={id}
			{...sectionProps}
			className={cn(
				depth > 0 ? "border-t border-white/[.05] first:border-t-0" : "border-b border-white/[.07] last:border-b-0",
				className,
				sectionProps?.className,
			)}
		>
			<div {...headerProps} className={cn("flex items-center gap-2 pr-2", depth > 0 ? "h-8 pl-6" : "h-9 pl-4", headerProps?.className)}>
				{leading && <div className="flex shrink-0 items-center">{leading}</div>}
				<button
					type="button"
					tabIndex={-1}
					onClick={toggle}
					className={cn(
						// peer: the fold arrow lights up while the pointer is on the name too (the whole head folds the section)
						"peer/title min-w-0 flex-1 truncate text-left",
						depth > 0 ? "text-xs" : "text-[13px]",
						hasBody && "cursor-pointer",
						muted
							? "text-muted-foreground font-semibold"
							: open || !hasBody
								? "text-foreground font-semibold"
								: "text-muted-foreground hover:text-foreground font-semibold",
					)}
				>
					{title}
				</button>
				{trailing && (
					<div className="flex shrink-0 items-center" onClick={(event) => event.stopPropagation()}>
						{trailing}
					</div>
				)}
				{/* nothing inside (an empty Effects list): a plain header, no fold */}
				{hasBody ? (
					<button
						type="button"
						aria-expanded={open}
						aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
						onClick={toggle}
						className="hover:bg-foreground/[0.07] peer-hover/title:bg-foreground/[0.07] focus-visible:ring-ring flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-sm outline-none focus-visible:ring-1"
					>
						<HugeiconsIcon
							icon={ArrowDown01Icon}
							className={cn(
								"size-3.5",
								fold(open),
								open ? "text-foreground" : "text-muted-foreground",
							)}
						/>
					</button>
				) : (
					<span className="size-7 shrink-0" aria-hidden />
				)}
			</div>
			{mounted && hasBody && (
				// Eased open/close (grid rows 0fr ↔ 1fr, 180 ms; opacity 140 ms); @starting-style runs the user's open from 0fr.
				<div
					data-inspector-group-body
					className={cn(
						"grid [transition:grid-template-rows_180ms_cubic-bezier(.2,0,0,1),opacity_140ms_cubic-bezier(.2,0,0,1)] motion-reduce:[transition:opacity_80ms]",
						open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
						open && animateOpen && "starting:grid-rows-[0fr] starting:opacity-0",
					)}
					onTransitionEnd={(event) => {
						if (event.target !== event.currentTarget) return;
						if (open) setAnimateOpen(false);
						else setMounted(false);
					}}
				>
					<div className="min-h-0 overflow-hidden">
						<GroupDepthContext.Provider value={depth + 1}>
							<div className={cn("flex flex-col", flush ? "pb-1" : cn("gap-2 pt-0.5 pb-3", depth > 0 ? "pr-4 pl-6" : "px-4"))}>{children}</div>
						</GroupDepthContext.Provider>
					</div>
				</div>
			)}
		</section>
	);
}

/**
 * The advanced part of a section (CapCut and Premiere keep them out of sight too): one quiet «More» line that unfolds
 * the rows under it. Its state is kept like a group's.
 */
export function InspectorMore({ id, children }: { id: string; children: ReactNode }) {
	const [open, setOpen] = useState(() => openGroups().get(id) ?? false);
	const hasBody = Boolean(children) && !(Array.isArray(children) && children.every((c) => !c));
	if (!hasBody) return null;
	return (
		<div data-inspector-more={id} className="flex flex-col gap-2">
			<button
				type="button"
				aria-expanded={open}
				data-inspector-more-toggle={id}
				onClick={() => {
					rememberGroup(id, !open);
					setOpen(!open);
				}}
				className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -ml-1 flex h-6 w-fit cursor-pointer items-center gap-1 rounded-sm px-1 text-xs outline-none focus-visible:ring-1"
			>
				{open ? "Less" : "More"}
				<HugeiconsIcon icon={ArrowDown01Icon} className={cn("size-3", fold(open))} />
			</button>
			{open && children}
		</div>
	);
}

/**
 * A heading of the one list (Premiere's «Video» / «Audio»): a quiet line above the sections of one part of the clip.
 * `collapsible`: the whole part folds (the tools), remembered like a group.
 */
export function InspectorBlock({
	id,
	title,
	trailing,
	collapsible = false,
	defaultOpen = true,
	children,
}: {
	id: string;
	title: string;
	trailing?: ReactNode;
	collapsible?: boolean;
	defaultOpen?: boolean;
	children: ReactNode;
}) {
	const defaults = useContext(GroupDefaultsContext);
	const [open, setOpen] = useState(() => (collapsible ? (openGroups().get(id) ?? defaults?.[id] ?? defaultOpen) : true));
	useEffect(() => {
		if (!collapsible) return;
		const listener = (ids: ReadonlySet<string>) => {
			if (ids.has(id)) setOpen(true);
		};
		openRequests.add(listener);
		return () => {
			openRequests.delete(listener);
		};
	}, [id, collapsible]);
	const toggle = () => {
		if (!collapsible) return;
		rememberGroup(id, !open);
		setOpen(!open);
	};
	return (
		<div data-inspector-block={id} data-open={open ? "true" : "false"} className="border-b border-white/[.07] last:border-b-0">
			<div className="flex h-8 items-center gap-1 pt-1 pr-2 pl-4">
				{collapsible ? (
					<button
						type="button"
						aria-expanded={open}
						onClick={toggle}
						data-inspector-block-toggle={id}
						className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex min-w-0 flex-1 cursor-pointer items-center gap-1 truncate rounded-sm text-left text-xs font-semibold outline-none focus-visible:ring-1"
					>
						{title}
						<HugeiconsIcon icon={ArrowDown01Icon} className={cn("size-3 shrink-0", fold(open))} />
					</button>
				) : (
					<span className="text-muted-foreground min-w-0 flex-1 truncate text-xs font-semibold">{title}</span>
				)}
				{trailing && <div className="flex shrink-0 items-center">{trailing}</div>}
			</div>
			{open && <div className="[&>section:last-child]:border-b-0">{children}</div>}
		</div>
	);
}

export interface RowKeyframe {
	isActive: boolean;
	isAnimated?: boolean;
	isDisabled: boolean;
	onToggle: () => void;
	/** ↺ of an animated row: removes the parameter's keys and puts its default back (one ⌘Z). */
	onReset?: () => void;
	/** ‹ and › of an animated row (Premiere): the playhead to this parameter's previous / next key; absent, there is none. */
	onPrev?: () => void;
	onNext?: () => void;
}

/** ‹ or › beside the ◆ of an animated row: off when there is no key that way. */
function KeyStep({ dir, onStep }: { dir: "prev" | "next"; onStep?: () => void }) {
	const label = dir === "prev" ? "Previous keyframe" : "Next keyframe";
	return (
		<button
			type="button"
			tabIndex={-1}
			aria-label={label}
			title={label}
			disabled={!onStep}
			onClick={onStep}
			data-keyframe-step={dir}
			className="text-muted-foreground hover:text-foreground flex h-5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-sm disabled:cursor-default disabled:opacity-30 disabled:hover:text-muted-foreground"
		>
			<HugeiconsIcon icon={dir === "prev" ? ArrowLeft01Icon : ArrowRight01Icon} className="size-3" />
		</button>
	);
}

/**
 * One property: label | control | reset + keyframe. `stacked` puts the control under the label (long
 * text). `inline`: a small control (a switch) sits at the right end and the label takes the rest of the row, so
 * «Duck under voice», «Voice isolation» stay on one line. `split` lays two controls side by side in equal
 * columns (X | Y, slider | field).
 */
export function InspectorRow({
	label,
	hint,
	children,
	onReset,
	isDefault = true,
	keyframe,
	stacked = false,
	inline = false,
	stackWhenNarrow = false,
	onLabelPointerDown,
	rowId,
	className,
	valueClipboard,
}: {
	label: ReactNode;
	hint?: string;
	children: ReactNode;
	onReset?: () => void;
	isDefault?: boolean;
	keyframe?: RowKeyframe;
	stacked?: boolean;
	inline?: boolean;
	/** A wide control (three or four segments): in a narrow panel it goes under the label instead of beside it. */
	stackWhenNarrow?: boolean;
	/** The label is the value's scrub zone (hooks/use-label-scrub.ts): drag it sideways; double-click resets. */
	onLabelPointerDown?: (event: React.PointerEvent<HTMLElement>) => void;
	rowId?: string;
	className?: string;
	/** How the row's right-click «Copy value» / «Paste value» works (default: the selected clips' params of `rowId`). */
	valueClipboard?: RowValueClipboard;
}) {
	const menuLabel = hint ?? (typeof label === "string" ? label : (rowId ?? ""));
	// An animated parameter can be reset even when its value at the playhead is the default: ↺ takes its keys away.
	const canReset = Boolean(onReset) && (!isDefault || Boolean(keyframe?.isAnimated));
	// ‹ › stay while the property has keys (off when there is none that way), so the row does not jump as the playhead moves
	const stepping = Boolean(keyframe?.isAnimated && ("onPrev" in keyframe || "onNext" in keyframe));
	const actions = (
		<div className={cn("flex shrink-0 items-center justify-end", stepping ? "w-[4.25rem]" : "w-10", stackWhenNarrow && "@max-[17.5rem]/insp:[grid-area:actions]")}>
			{canReset ? (
				<button
					type="button"
					tabIndex={-1}
					aria-label="Reset to default"
					title="Reset to default"
					onClick={onReset}
					className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-5 cursor-pointer items-center justify-center rounded-sm"
				>
					<HugeiconsIcon icon={ArrowTurnBackwardIcon} className="size-3.5" />
				</button>
			) : (
				<span className="size-5" aria-hidden />
			)}
			{stepping && <KeyStep dir="prev" onStep={keyframe?.onPrev} />}
			{keyframe ? (
				<KeyframeToggle
					isActive={keyframe.isActive}
					isAnimated={keyframe.isAnimated}
					isDisabled={keyframe.isDisabled}
					title={
						keyframe.isDisabled
							? "Move the playhead over this clip to add a keyframe"
							: keyframe.isActive
								? "Remove keyframe"
								: "Add keyframe"
					}
					onToggle={keyframe.onToggle}
				/>
			) : (
				<span className="size-5" aria-hidden />
			)}
			{stepping && <KeyStep dir="next" onStep={keyframe?.onNext} />}
		</div>
	);
	const labelNode = (
		// biome-ignore lint/a11y/noStaticElementInteractions: a pointer-only scrub zone; the field beside it is the keyboard control (type, ↑/↓)
		<span
			className={cn(
				// hyphens: a long Russian word in the narrow label column breaks at a syllable with a hyphen
				// («Непрозрач-ность»), not anywhere without one («Непрозрач|ность», «Нарастани|е») — polish3, 11.11; feel B7 the same
				"text-muted-foreground line-clamp-2 min-w-0 text-xs leading-tight break-words hyphens-auto",
				onLabelPointerDown && "hover:text-foreground cursor-ew-resize touch-none select-none",
				stackWhenNarrow && "@max-[17.5rem]/insp:[grid-area:label]",
			)}
			title={hint ?? (typeof label === "string" ? label : undefined)}
			data-scrub-label={onLabelPointerDown ? "" : undefined}
			onPointerDown={onLabelPointerDown}
			onDoubleClick={onLabelPointerDown && canReset ? onReset : undefined}
		>
			{label}
		</span>
	);

	if (stacked) {
		return (
			<RowValueMenu rowId={rowId} label={menuLabel} clipboard={valueClipboard}>
				<div data-inspector-row={rowId} className={cn("flex flex-col gap-1.5", className)}>
					<div className="flex min-h-5 items-center gap-2">
						<div className="min-w-0 flex-1">{labelNode}</div>
						{actions}
					</div>
					<div className="min-w-0">{children}</div>
				</div>
			</RowValueMenu>
		);
	}

	return (
		<RowValueMenu rowId={rowId} label={menuLabel} clipboard={valueClipboard}>
			<div
				data-inspector-row={rowId}
				className={cn(
					"grid min-h-7 items-center gap-x-2",
					inline ? "grid-cols-[minmax(0,1fr)_auto_auto]" : "grid-cols-[var(--insp-label)_minmax(0,1fr)_auto]",
					// narrow: «label ↺◆» on the first line, the control on its own full-width line
					stackWhenNarrow && "@max-[17.5rem]/insp:gap-y-1 @max-[17.5rem]/insp:grid-cols-[minmax(0,1fr)_auto] @max-[17.5rem]/insp:[grid-template-areas:'label_actions'_'control_control']",
					className,
				)}
			>
				{labelNode}
				<div className={cn("min-w-0", stackWhenNarrow && "@max-[17.5rem]/insp:[grid-area:control]")}>{children}</div>
				{actions}
			</div>
		</RowValueMenu>
	);
}

/**
 * Two controls inside a row's control cell: equal columns (X | Y), or `slider` = slider | field, where
 * the field keeps its width and the slider steps aside when the panel is very narrow. `stackWhenNarrow`:
 * two number fields go one under the other when the panel is very narrow (at the smallest window each
 * Position field kept 12 px for its digits, so −150 read "−1").
 */
export function Split({
	children,
	className,
	slider = false,
	stackWhenNarrow = false,
}: {
	children: ReactNode;
	className?: string;
	slider?: boolean;
	stackWhenNarrow?: boolean;
}) {
	if (slider) {
		// The split's own width decides too: one too narrow for a usable slider puts the field under it (a 46 px slider in
		// the AI tools' rows, inside their card, in Russian at 1440×900: panels-walk 09.11).
		return (
			<div className="@container/split min-w-0">
				<div className={cn("grid grid-cols-[minmax(0,1fr)_4.75rem] gap-1.5 @max-[17.5rem]/insp:grid-cols-1 @max-[9.5rem]/split:grid-cols-1", className)}>
					{children}
				</div>
			</div>
		);
	}
	return <div className={cn("grid grid-cols-2 gap-1.5", stackWhenNarrow && "@max-[17.5rem]/insp:grid-cols-1", className)}>{children}</div>;
}

/** A slider that Tab skips (Tab goes field to field; arrow keys still work after a click). */
export function InspectorSlider({
	value,
	min,
	max,
	step,
	label,
	onChange,
	onCommit,
	disabled,
	detents,
}: {
	value: number;
	min: number;
	max: number;
	step: number;
	label: string;
	onChange: (value: number) => void;
	onCommit: () => void;
	disabled?: boolean;
	/** Values a drag taps the trackpad at (haptics), e.g. the slider value of 1×. */
	detents?: number[];
}) {
	// Our own slider, not Radix's: Radix's handle measured itself (offsetWidth) in a layout effect each time the clip's
	// panel came back, which forced a style and layout pass of the page into the frame — 60 ms of a ⌘Z (perf-tracks10).
	return (
		<Slider
			detents={detents}
			aria-label={label}
			min={min}
			max={max}
			step={step}
			disabled={disabled}
			value={[Math.min(max, Math.max(min, value))]}
			onValueChange={([next]) => onChange(next)}
			// a keyboard step reports its value and its commit together: commit after the value is in (a microtask), for
			// keys and for the end of a drag alike, so ⌘Z takes back the edit itself
			onValueCommit={() => queueMicrotask(onCommit)}
			thumbSize={12}
			thumbTabIndex={-1}
			className="h-7 min-w-0 data-[disabled]:opacity-50 @max-[17.5rem]/insp:hidden"
			// 3 px track at 1.5:1 on the panel (--track; .10 was 1.29:1), a solid white 12 px thumb (the hollow one read as a radio button)
			trackClassName="h-[3px] rounded-full bg-[var(--track,rgba(255,255,255,.16))]"
			rangeClassName="bg-primary"
			thumbClassName="size-3 border-0 cursor-grab rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.55),0_0_0_.5px_rgba(0,0,0,.3)] outline-none transition-transform duration-120 ease-[cubic-bezier(.2,0,0,1)] hover:scale-115 focus-visible:ring-2 active:scale-96 active:cursor-grabbing motion-reduce:transition-none"
		/>
	);
}

/** Two to four short options as one control (Left | Center | Right). */
export function Segmented<T extends string>({
	value,
	options,
	onChange,
	label,
}: {
	value: T;
	options: Array<{ value: T; label: ReactNode; title?: string }>;
	onChange: (value: T) => void;
	label: string;
}) {
	return (
		<div role="radiogroup" aria-label={label} className="bg-accent border-border flex h-7 w-full items-center gap-0.5 rounded-md border p-0.5">
			{options.map((option) => {
				const selected = option.value === value;
				return (
					<button
						key={option.value}
						type="button"
						role="radio"
						aria-checked={selected}
						title={option.title}
						// The chosen option again changes nothing (Canvas › Fill "Color" re-clicked added an empty undo step).
						onClick={() => {
							if (!selected) onChange(option.value);
						}}
						className={cn(
							"focus-visible:ring-ring flex h-full min-w-0 flex-auto cursor-pointer items-center justify-center truncate rounded-[5px] px-1.5 text-xs outline-none focus-visible:ring-1 @max-[17.5rem]/insp:px-0.5 @max-[17.5rem]/insp:text-[11px]",
							selected
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);
}
