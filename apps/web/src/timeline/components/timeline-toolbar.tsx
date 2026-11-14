import { memo, useSyncExternalStore } from "react";
import { useEditor } from "@/editor/use-editor";
import { useElementSelection } from "@/timeline/hooks/element/use-element-selection";
import {
	TooltipProvider,
	Tooltip,
	TooltipTrigger,
	TooltipContent,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { TIMELINE_ZOOM_BUTTON_FACTOR } from "./interaction";
import { TIMELINE_ZOOM_MAX } from "@/timeline/scale";
import { sliderToZoom, zoomToSlider } from "@/timeline/zoom-utils";
import { type TActionWithOptionalArgs, invokeAction } from "@/actions";
import {
	getActionShortcutLabel,
	useKeybindingsStore,
} from "@/actions/keybindings-store";
import {
	canToggleSourceAudio,
	getSourceAudioActionLabel,
	isSourceAudioSeparated,
} from "@/timeline/audio-separation";
import { getElementsAtTime, hasMediaId } from "@/timeline";
import { cn } from "@/utils/ui";
import { NestedTimelineBar } from "./nested-timeline-bar";
import { useTimelineStore } from "@/timeline/timeline-store";
import { TrimToolIcon } from "@/timeline/trim/components/trim-icon";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	ArrowDown01Icon,
	BackwardIcon,
	CropIcon,
	Bookmark02Icon,
	Cursor01Icon,
	CursorInWindowIcon,
	Delete02Icon,
	FitToScreenIcon,
	FlipHorizontalIcon,
	Link02Icon,
	Mic01Icon,
	RedoIcon,
	RotateClockwiseIcon,
	SnowIcon,
	ScissorIcon,
	StopIcon,
	MagnetIcon,
	SearchAddIcon,
	SearchMinusIcon,
	AlignLeftIcon,
	AlignRightIcon,
	Chart03Icon,
	UndoIcon,
	Unlink02Icon,
} from "@hugeicons/core-free-icons";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LINKAGE_KINDS, type PreviewAxisMode } from "@/timeline/timeline-store";
import { useVoiceoverRecorder } from "@/voiceover/recorder";
import { toast } from "sonner";
import { CropDialog, openCropForSelection } from "./crop-dialog";
import { HugeiconsIcon } from "@/components/ui/icon";
import { OcRippleIcon } from "@/components/icons";
import { GraphEditorPopover } from "./graph-editor/popover";
import { PopoverTrigger } from "@/components/ui/popover";
import { useGraphEditorController } from "./graph-editor/use-controller";
import { TimelineMoreMenu } from "./toolbar-more";
import { actionName } from "@/actions/names";
import { useT } from "@/i18n";
import { whyNot } from "@/actions/preconditions";
import { useSelectedCut } from "@/transitions/commands";
import { MixerToolbarButton } from "@/sound/mixer/toolbar-button";


export const TimelineToolbar = memo(function TimelineToolbar({
	zoomLevel,
	minZoom,
	setZoomLevel,
}: {
	zoomLevel: number;
	minZoom: number;
	setZoomLevel: ({ zoom }: { zoom: number }) => void;
}) {
	const handleZoom = ({ direction }: { direction: "in" | "out" }) => {
		const newZoomLevel =
			direction === "in"
				? Math.min(TIMELINE_ZOOM_MAX, zoomLevel * TIMELINE_ZOOM_BUTTON_FACTOR)
				: Math.max(minZoom, zoomLevel / TIMELINE_ZOOM_BUTTON_FACTOR);
		setZoomLevel({ zoom: newZoomLevel });
	};

	// A narrow timeline (a 1024–1260 px window, a clip selected) has no room for every button: the zoom slider and
	// Delete left / right step aside there (@container below; their keys still work),
	// so the zoom buttons at the right end are never cut off.
	return (
		<div className="@container">
		<ScrollArea className="scrollbar-hidden">
			<MemoNestedBar />
			{/* CapCut's sizes: a 32 px row, buttons every 36 px, 14 px line icons. */}
			<div
				data-timeline-toolbar=""
				className="flex h-8 items-center justify-between border-b px-2 [&_button_svg]:size-3.5"
			>
				<ToolbarLeftSection />

				<ToolbarRightSection
					zoomLevel={zoomLevel}
					minZoom={minZoom}
					onZoomChange={(zoom) => setZoomLevel({ zoom })}
					onZoom={handleZoom}
				/>
			</div>
		</ScrollArea>
		</div>
	);
});

/** Steps aside on a narrow timeline toolbar (see TimelineToolbar). */
export const NARROW_HIDE = "@max-[1260px]:hidden";

function handleToolbarAction({
	action,
	event,
}: {
	action: TActionWithOptionalArgs;
	event: React.MouseEvent;
}) {
	event.stopPropagation();
	invokeAction(action);
}

/**
 * CapCut's left side: Tool ▾ (Select A / Split B), Undo, Redo, Split, Delete left (Q), Delete right (W), Delete, Marker,
 * then the tools for the selected clip (Freeze, Reverse, Mirror, Rotate, Extract audio). The buttons act on the
 * selection when clicked, so they don't watch it: only the selection tools (their own component) re-render on it.
 */
const ToolbarLeftSection = memo(function ToolbarLeftSection() {
	const editor = useEditor();
	// Grey when there is nothing to do (CapCut): no step to take back or redo; no clip under the playhead to split
	// (a selection elsewhere splits nothing).
	const canUndo = useSyncExternalStore(
		(listener) => editor.command.subscribeHistory(listener),
		() => editor.command.canUndo(),
	);
	const canRedo = useSyncExternalStore(
		(listener) => editor.command.subscribeHistory(listener),
		() => editor.command.canRedo(),
	);
	// CapCut shows a clip's own tools (Freeze, Reverse, Crop…) only while a clip is selected.
	const hasSelection = useEditor((e) => e.selection.getSelectedElements().length > 0, ["selection"]);
	// ⌫'s own precondition (actions/preconditions.ts): greyed with its reason, like Split, never a button that does nothing
	const clickedCut = useSelectedCut((s) => s.cut);
	const deleteWhy = useEditor(() => (clickedCut ? null : whyNot("delete-selected")), ["selection", "scenes", "timeline"]);
	// The split action's own rule (use-editor-actions «split»): the selected clips under the playhead, or every clip
	// under it when none is selected. Nothing there = greyed out, as in CapCut, not a button that does nothing.
	const canSplit = useEditor(
		(e) => {
			const tracks = e.scenes.getActiveSceneOrNull()?.tracks;
			if (!tracks) return false;
			const under = getElementsAtTime({ tracks, time: e.playback.getCurrentTime() });
			const selected = e.selection.getSelectedElements();
			return selected.length > 0
				? selected.some((ref) => under.some((at) => at.trackId === ref.trackId && at.elementId === ref.elementId))
				: under.length > 0;
		},
		["playback", "scenes", "timeline", "selection"],
	);

	return (
		<div className="flex items-center gap-1">
			{/* One project, one timeline (the owner, 12.11): no Text / Scenes switch and no «+ Add timeline» here — a
			    part of the film goes into a compound clip (⌥G). An older project's extra timelines keep their tabs. */}
			<TooltipProvider delayDuration={200} skipDelayDuration={400} disableHoverableContent>
				<ToolSelector />

				<div className="bg-border mx-1 h-6 w-px" />

				<ToolbarButton
					icon={<HugeiconsIcon icon={UndoIcon} />}
					tooltip="Undo"
					shortcutAction="undo"
					disabled={!canUndo}
					onClick={({ event }) => handleToolbarAction({ action: "undo", event })}
				/>
				<ToolbarButton
					icon={<HugeiconsIcon icon={RedoIcon} />}
					tooltip="Redo"
					shortcutAction="redo"
					disabled={!canRedo}
					onClick={({ event }) => handleToolbarAction({ action: "redo", event })}
				/>

				<div className="bg-border mx-1 h-6 w-px" />

				<ToolbarButton
					icon={<HugeiconsIcon icon={ScissorIcon} />}
					tooltip="Split"
					shortcutAction="split"
					disabled={!canSplit}
					onClick={({ event }) => handleToolbarAction({ action: "split", event })}
				/>

				<ToolbarButton
					icon={<HugeiconsIcon icon={Delete02Icon} />}
					tooltip={deleteWhy ?? "Delete"}
					label="Delete"
					shortcutAction="delete-selected"
					disabled={!!deleteWhy}
					onClick={({ event }) =>
						handleToolbarAction({ action: "delete-selected", event })
					}
				/>

				{/* Final Cut's bar (the owner, 12.11): the rest — Q / W, the marker, the clip's tools, assist, voice-over,
				    preview axis, linkage kinds — is in this one «⋯», the clip's right-click menu and the shortcuts. */}
				<TimelineMoreMenu />
				{hasSelection && <GraphEditorButton />}
			</TooltipProvider>
		</div>
	);
});

/** Select (A) or Split (B): with Split, a click on a clip cuts it there (CapCut's blade). */
function ToolSelector() {
	useT();
	const tool = useTimelineStore((s) => s.tool);
	useKeybindingsStore((state) => state.keybindings);
	const label = (action: TActionWithOptionalArgs) => getActionShortcutLabel({ action });
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="text"
					size="sm"
					className="h-8 gap-0.5 rounded-sm px-1.5"
					aria-label={tool === "trim" ? "Trim tool" : tool === "split" ? "Split tool" : "Select tool"}
					title={tool === "trim" ? "Trim tool: drag a cut to roll it, an edge to ripple it, a clip to slip it (⌥: slide)" : tool === "split" ? "Split tool: click a clip to cut it" : "Select tool"}
					data-timeline-tool={tool}
				>
					{tool === "trim" ? <TrimToolIcon /> : <HugeiconsIcon icon={tool === "split" ? ScissorIcon : Cursor01Icon} />}
					<HugeiconsIcon icon={ArrowDown01Icon} className="size-3 opacity-70" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				<DropdownMenuRadioGroup value={tool} onValueChange={(value) => useTimelineStore.getState().setTool(value as "select" | "split" | "trim")}>
					<DropdownMenuRadioItem value="select" data-tool-option="select">
						{actionName("tool-select")} <span className="text-muted-foreground ml-auto pl-4 text-xs">{label("tool-select")}</span>
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="split" data-tool-option="split">
						{actionName("tool-split")} <span className="text-muted-foreground ml-auto pl-4 text-xs">{label("tool-split")}</span>
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="trim" data-tool-option="trim">
						{actionName("tool-trim")} <span className="text-muted-foreground ml-auto pl-4 text-xs">{label("tool-trim")}</span>
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}



function GraphEditorButton() {
	const graphEditor = useGraphEditorController();
	// only when the selection has a keyframe curve to edit (progressive disclosure, 12.11)
	if (!graphEditor.canOpen && !graphEditor.open) return null;
	return (
		<GraphEditorPopover
			open={graphEditor.open}
			onOpenChange={graphEditor.onOpenChange}
			value={
				graphEditor.state.status === "ready"
					? graphEditor.state.cubicBezier
					: null
			}
			message={graphEditor.state.message}
			componentOptions={graphEditor.state.componentOptions}
			activeComponentKey={graphEditor.state.activeComponentKey}
			onActiveComponentKeyChange={graphEditor.onActiveComponentKeyChange}
			onPreviewValue={graphEditor.onPreviewValue}
			onCommitValue={graphEditor.onCommitValue}
			onCancelPreview={graphEditor.onCancelPreview}
		>
			<ToolbarButton
				icon={<HugeiconsIcon icon={Chart03Icon} />}
				label="Keyframe curve"
				tooltip={graphEditor.tooltip}
				disabled={!graphEditor.canOpen}
				buttonWrapper={(button) =>
					graphEditor.canOpen ? (
						<PopoverTrigger asChild>{button}</PopoverTrigger>
					) : (
						button
					)
				}
			/>
		</GraphEditorPopover>
	);
}

// The toolbar re-renders on every zoom step (the zoom slider); its other parts have no props and
// watch their own state, so they are memoized and skip those renders.
const MemoNestedBar = memo(NestedTimelineBar);

/**
 * CapCut's right side: 🎙 Record voiceover, Main track magnet (P), Auto snapping (N), Linkage (`) ▾, Preview axis (S) ▾,
 * Zoom to fit (⇧Z), −, slider, +.
 */
function ToolbarRightSection({
	zoomLevel,
	minZoom,
	onZoomChange,
	onZoom,
}: {
	zoomLevel: number;
	minZoom: number;
	onZoomChange: (zoom: number) => void;
	onZoom: (options: { direction: "in" | "out" }) => void;
}) {
	return (
		<div className="flex items-center gap-1">
			<ToolbarModes />

			<div className="bg-border mx-1 h-6 w-px" />

			<ZoomControls zoomLevel={zoomLevel} minZoom={minZoom} onZoomChange={onZoomChange} onZoom={onZoom} />
		</div>
	);
}

/**
 * Record voiceover, magnet, snapping, linkage, preview axis: nothing here follows the zoom. A zoom step re-rendered
 * them all, tooltips and menus included (~0.6 ms of every step with 180 clips); only the zoom controls do now.
 */
const ToolbarModes = memo(function ToolbarModes() {
	const snappingEnabled = useTimelineStore((s) => s.snappingEnabled);
	const rippleEditingEnabled = useTimelineStore((s) => s.rippleEditingEnabled);
	const linkageEnabled = useTimelineStore((s) => s.linkageEnabled);
	const recording = useVoiceoverRecorder((s) => s.recording);

	return (
		<TooltipProvider delayDuration={200} skipDelayDuration={400} disableHoverableContent>
			{/* recording: its stop stays in reach here (the start is in «⋯» and its shortcut) */}
			{recording && (
				<ToolbarButton
					icon={<HugeiconsIcon icon={StopIcon} className="text-red-500" />}
					isActive
					tooltip="Stop recording"
					shortcutAction="record-voiceover"
					onClick={({ event }) => handleToolbarAction({ action: "record-voiceover", event })}
				/>
			)}

			<ToolbarButton
				icon={<OcRippleIcon size={24} className="scale-110" />}
				isActive={rippleEditingEnabled}
				tooltip="Main track magnet"
				shortcutAction="toggle-ripple-editing"
				dataId="magnet"
				onClick={({ event }) => handleToolbarAction({ action: "toggle-ripple-editing", event })}
			/>

			<ToolbarButton
				icon={<HugeiconsIcon icon={MagnetIcon} />}
				isActive={snappingEnabled}
				tooltip="Auto snapping (hold ⌘ to drag freely)"
				label="Auto snapping"
				shortcutAction="toggle-snapping"
				dataId="snapping"
				onClick={({ event }) => handleToolbarAction({ action: "toggle-snapping", event })}
			/>

			<ToolbarButton
				icon={<HugeiconsIcon icon={Link02Icon} />}
				isActive={linkageEnabled}
				tooltip="Linkage"
				shortcutAction="toggle-linkage"
				dataId="linkage"
				onClick={({ event }) => handleToolbarAction({ action: "toggle-linkage", event })}
			/>

			{/* the mixer (src/sound/mixer): docks at the right of the timeline */}
			<MixerToolbarButton />
		</TooltipProvider>
	);
});

/** Zoom to fit, −, the slider, +: the part of the toolbar that follows the zoom. */
function ZoomControls({
	zoomLevel,
	minZoom,
	onZoomChange,
	onZoom,
}: {
	zoomLevel: number;
	minZoom: number;
	onZoomChange: (zoom: number) => void;
	onZoom: (options: { direction: "in" | "out" }) => void;
}) {
	return (
		<div className="flex items-center gap-1">
			<Button
				variant="text"
				size="icon"
				aria-label="Zoom to fit"
				data-testid="timeline-zoom-fit"
				title={`Zoom to fit${shortcutSuffix("timeline-zoom-fit")}`}
				onClick={(event) => handleToolbarAction({ action: "timeline-zoom-fit", event })}
			>
				<HugeiconsIcon icon={FitToScreenIcon} />
			</Button>
			<Button
				variant="text"
				size="icon"
				aria-label="Zoom out"
				title={`Zoom out${shortcutSuffix("timeline-zoom-out")}`}
				onClick={() => onZoom({ direction: "out" })}
			>
				<HugeiconsIcon icon={SearchMinusIcon} />
			</Button>
			<Slider
				aria-label="Zoom"
				className={cn("w-28", NARROW_HIDE)}
				value={[zoomToSlider({ zoomLevel, minZoom })]}
				onValueChange={(values) =>
					onZoomChange(sliderToZoom({ sliderPosition: values[0], minZoom }))
				}
				min={0}
				max={1}
				step={0.005}
			/>
			<Button
				variant="text"
				size="icon"
				aria-label="Zoom in"
				title={`Zoom in${shortcutSuffix("timeline-zoom-in")}`}
				onClick={() => onZoom({ direction: "in" })}
			>
				<HugeiconsIcon icon={SearchAddIcon} />
			</Button>
		</div>
	);
}



function shortcutSuffix(action: TActionWithOptionalArgs): string {
	const shortcut = getActionShortcutLabel({ action });
	return shortcut ? ` (${shortcut})` : "";
}

function ToolbarButton({
	icon,
	tooltip,
	onClick,
	disabled,
	isActive,
	buttonWrapper,
	shortcutAction,
	label,
	dataId,
	className,
}: {
	className?: string;
	icon: React.ReactNode;
	tooltip: string;
	/** data-toolbar-button, for tests and the shortcuts window. */
	dataId?: string;
	/** Short accessible name when the tooltip is a sentence (default: the tooltip). */
	label?: string;
	/** Shows the action's current shortcut next to the tooltip («Split ⌘B»). */
	shortcutAction?: TActionWithOptionalArgs;
	onClick?: ({ event }: { event: React.MouseEvent }) => void;
	disabled?: boolean;
	isActive?: boolean;
	buttonWrapper?: (button: React.ReactElement) => React.ReactElement;
}) {
	// Re-render when the keymap changes (preset switch, rebinding).
	useKeybindingsStore((state) => state.keybindings);
	const shortcut = shortcutAction
		? getActionShortcutLabel({ action: shortcutAction })
		: "";
	const button = (
		<Button
			variant={isActive ? "secondary" : "text"}
			size="icon"
			aria-label={label ?? tooltip}
			aria-pressed={isActive}
			data-toolbar-button={dataId}
			disabled={disabled}
			onClick={onClick ? (event) => onClick({ event }) : undefined}
			className={cn(
				"h-7 w-8 rounded-sm",
				disabled ? "cursor-not-allowed opacity-40" : "",
				!disabled && className,
			)}
		>
			{icon}
		</Button>
	);
	const trigger = disabled ? (
		<span className={cn("inline-flex", className)}>{button}</span>
	) : buttonWrapper ? (
		buttonWrapper(button)
	) : (
		button
	);

	return (
		<Tooltip delayDuration={200}>
			<TooltipTrigger asChild>{trigger}</TooltipTrigger>
			<TooltipContent>
				<span className="flex items-center gap-2">
					{tooltip}
					{shortcut && <kbd className="font-sans opacity-60">{shortcut}</kbd>}
				</span>
			</TooltipContent>
		</Tooltip>
	);
}
