"use client";

import { type ReactNode, useState, useEffect } from "react";
import { useEditor } from "@/editor/use-editor";
import { formatFrameTimecode } from "@/fps/timecode";
import { invokeAction } from "@/actions";
import { getActionShortcutLabel } from "@/actions/keybindings-store";
import { EditableTimecode } from "@/components/editable-timecode";
import { Button } from "@/components/ui/button";
import {
	AspectRatioIcon,
	DashboardSpeed01Icon,
	FullScreenIcon,
	PauseIcon,
	PlayIcon,
	RepeatIcon,
	ZoomInAreaIcon,
} from "@hugeicons/core-free-icons";
import { useLoopStore } from "@/preview/loop-store";
import { HugeiconsIcon } from "@/components/ui/icon";
import { Separator } from "@/components/ui/separator";
import {
	Select,
	SelectTrigger,
	SelectContent,
	SelectItem,
	SelectSeparator,
} from "@/components/ui/select";
import { PREVIEW_ZOOM_PRESETS } from "@/preview/zoom";
import { usePreviewViewport } from "./preview-viewport";
import type { MediaTime } from "@/wasm";
import { CANVAS_FORMATS, formatOf, sizeInFormat } from "@/preview/canvas-format";
import { dimensionToAspectRatio } from "@/utils/geometry";
import { cn } from "@/utils/ui";
import { useShellStore } from "@/components/editor/shell-store";
import { MarkupButton } from "./markup";
import { effectiveQuality, type PlaybackQuality, usePlaybackQuality } from "@/preview/playback-quality";
import { useT } from "@/i18n";

/**
 * CapCut's player bar buttons: plain text or an icon, no box and no ▾ — «Full», 🔍, «Ratio» and ⛶ fit a narrow player
 * (at 1440 × 900 the player is ~400 px wide and the boxed menus pushed ⛶ out of it).
 */
const BAR_TRIGGER =
	"h-7 gap-0 border-transparent bg-transparent px-1.5 text-xs text-foreground/85 hover:bg-accent hover:text-foreground [&>svg:last-child]:hidden";

export function PreviewToolbar({
	isFullscreen = false,
	onToggleFullscreen,
	menu,
}: {
	isFullscreen?: boolean;
	onToggleFullscreen: () => void;
	/** The timelines menu (≡): at the end of the bar, the player has no title row of its own. */
	menu?: ReactNode;
}) {
	return (
		<div className="@container/ptb grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-1 @max-[31rem]/ptb:px-2 @max-[24rem]/ptb:grid-cols-[auto_1fr_auto] @max-[24rem]/ptb:gap-1 @max-[24rem]/ptb:px-1" data-player-bar>
			<TimecodeDisplay />
			{/* One cell: three columns, so a fourth child dropped the right side to a second line and took the picture's height (user, 07.11). */}
			<div className="flex items-center justify-self-center gap-0.5">
				<PlayPauseButton />
				<span className="contents @max-[24rem]/ptb:hidden">
					<LoopButton />
				</span>
			</div>
			{/* As in CapCut: playback resolution · player zoom · Ratio · (safe zones) · full screen */}
			<div className="justify-self-end flex items-center gap-1 @max-[24rem]/ptb:gap-0">
				<QualitySelect />
				<ZoomSelect />
				<FormatSelect />
				<Separator orientation="vertical" className="h-4 @max-[31rem]/ptb:hidden" />
				{/* v0.4.0 */}
				{/* <GridPopover>
					<Button
						variant={activeGuideDefinition ? "secondary" : "text"}
						size="icon"
					>
						{activeGuideDefinition ? (
							activeGuideDefinition.renderTriggerIcon()
						) : (
							<HugeiconsIcon icon={GridTableIcon} />
						)}
					</Button>
				</GridPopover> */}
				{/* «Разметка» (not in CapCut's bar): kept down to a 320 px bar (a 9:16 player beside an open panel is ~380 px
				    at 1440 × 900); below that it gives way first (⛶ must stay reachable; ⇧⌘; still works). */}
				<span className="contents @max-[20rem]/ptb:hidden">
					<MarkupButton />
				</span>
				<Button
					variant="text"
					className="size-7 justify-center rounded-md"
					onClick={onToggleFullscreen}
					title={isFullscreen ? "Exit full screen (Esc)" : "Preview full screen (Esc to exit)"}
					aria-label="Preview full screen"
					aria-pressed={isFullscreen}
				>
					<HugeiconsIcon icon={FullScreenIcon} />
				</Button>
				{menu && <span className="contents @max-[24rem]/ptb:hidden">{menu}</span>}
			</div>
		</div>
	);
}

function TimecodeDisplay() {
	const editor = useEditor();
	const totalDuration = useEditor((e) => e.timeline.getTotalDuration());
	const fps = useEditor((e) => e.project.getActive().settings.fps);
	const [currentTime, setCurrentTime] = useState<MediaTime>(() =>
		editor.playback.getCurrentTime(),
	);
	// while the time is typed, «/ total» fades (opacity only: its box stays) and the dimmed timecode uses its room
	const [editingTime, setEditingTime] = useState(false);

	useEffect(() => {
		const unsubscribeUpdate = editor.playback.onUpdate(setCurrentTime);
		const unsubscribeSeek = editor.playback.onSeek(setCurrentTime);
		return () => {
			unsubscribeUpdate();
			unsubscribeSeek();
		};
	}, [editor.playback]);

	return (
		<div className="flex items-center">
			<EditableTimecode
				time={currentTime}
				duration={totalDuration}
				format="HH:MM:SS:FF"
				fps={fps}
				onTimeChange={({ time }) => {
					// a typed time stops the playback first (a seek only moves the playhead; nothing is marked dirty)
					editor.playback.pause();
					editor.playback.seek({ time });
				}}
				className="text-center"
				onEditingChange={setEditingTime}
			/>
			{/* A narrow preview keeps the playhead time only; the total is on the timeline ruler. */}
			{/* The playhead time's hover box reaches 4 px under the slash: the slash lets those clicks through. */}
			<span className={cn("text-muted-foreground pointer-events-none px-2 font-mono text-xs @max-[31rem]/ptb:hidden", editingTime && "opacity-0")}>/</span>
			<span className={cn("text-muted-foreground font-mono text-xs tabular-nums @max-[31rem]/ptb:hidden", editingTime && "opacity-0")}>
				{formatFrameTimecode({ time: totalDuration, fps })}
			</span>
		</div>
	);
}

const QUALITY_LABEL: Record<PlaybackQuality, string> = { full: "Full", high: "High", low: "Low" };

/** Playback resolution (CapCut: Full / High / Low): a lighter player on a slow Mac; the export is not affected. */
function QualitySelect() {
	const t = useT();
	const quality = usePlaybackQuality(effectiveQuality);
	const setQuality = usePlaybackQuality((s) => s.setQuality);
	return (
		<Select value={quality} onValueChange={(value) => setQuality(value as PlaybackQuality)}>
			<SelectTrigger
				className={BAR_TRIGGER}
				// both words through t(): a composed English tooltip stayed English in Russian (check-edit RU, 13.11)
				title={`${t("Playback resolution")}: ${t(QUALITY_LABEL[quality])}`}
				aria-label="Playback resolution"
				data-quality-select
				data-quality-value={quality}
			>
				<HugeiconsIcon icon={DashboardSpeed01Icon} className={cn("size-4", quality !== "full" && "text-primary")} />
			</SelectTrigger>
			<SelectContent>
				{(Object.keys(QUALITY_LABEL) as PlaybackQuality[]).map((q) => (
					<SelectItem key={q} value={q} data-quality={q}>
						{QUALITY_LABEL[q]}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function ZoomSelect() {
	const { isAtFit, zoomPercent, fitToScreen, setViewportPercent } =
		usePreviewViewport();

	const displayLabel = isAtFit ? "Fit" : `${zoomPercent}%`;
	const zoomInKey = getActionShortcutLabel({ action: "player-zoom-in" });

	const onValueChange = (value: string) => {
		if (value === "fit") {
			fitToScreen();
		} else {
			setViewportPercent({ percent: Number(value) });
		}
	};

	return (
		<Select
			value={isAtFit ? "fit" : String(zoomPercent)}
			onValueChange={onValueChange}
		>
			<SelectTrigger
				className={BAR_TRIGGER}
				title={`Zoom: ${displayLabel}${zoomInKey ? ` · zoom in ${zoomInKey}` : ""}`}
				aria-label={`Zoom: ${displayLabel}`}
				data-zoom-select
			>
				<HugeiconsIcon icon={ZoomInAreaIcon} className="size-4" />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="fit">Fit</SelectItem>
				<SelectSeparator />
				{PREVIEW_ZOOM_PRESETS.map((preset) => (
					<SelectItem key={preset} value={String(preset)}>
						{preset}%
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/**
 * The video's shape, right under it: switching a vertical cut to 16:9 or 1:1 was three clicks deep in the project
 * menu. The short side (the quality) stays; «More sizes…» opens Project settings for 4:3 and custom sizes. Undoable.
 */
function FormatSelect() {
	const t = useT();
	const editor = useEditor();
	const canvasSize = useEditor((e) => e.project.getActive().settings.canvasSize);
	const current = formatOf(canvasSize);
	const label = current ?? dimensionToAspectRatio(canvasSize);

	const onValueChange = (value: string) => {
		if (value === "more") {
			useShellStore.getState().setDialog("settings");
			return;
		}
		const format = CANVAS_FORMATS.find((f) => f.id === value);
		if (!format || format.id === current) return;
		editor.project.updateSettings({
			settings: { canvasSize: sizeInFormat(canvasSize, format.id), canvasSizeMode: "preset" },
		});
	};

	return (
		<Select value={current ?? "custom"} onValueChange={onValueChange}>
			<SelectTrigger className={BAR_TRIGGER} title={`Ratio: ${label}`} aria-label={`Video format: ${label}`} data-format-select>
				<HugeiconsIcon icon={AspectRatioIcon} className="size-4" />
			</SelectTrigger>
			<SelectContent>
				{CANVAS_FORMATS.map((format) => (
					<SelectItem key={format.id} value={format.id}>
						<span className="tabular-nums">{format.id}</span>
						<span className="text-muted-foreground ml-2 text-xs">
							{format.label} · {format.hint}
						</span>
					</SelectItem>
				))}
				{!current && (
					<SelectItem value="custom" disabled>
						{t("{label} · custom", { label })}
					</SelectItem>
				)}
				<SelectSeparator />
				<SelectItem value="more">More sizes…</SelectItem>
			</SelectContent>
		</Select>
	);
}

/** Loop playback (⌘L): the In–Out range, or the whole edit, plays round and round. Lit while on. */
function LoopButton() {
	const t = useT();
	const loop = useLoopStore((s) => s.loop);
	return (
		<Button
			variant="text"
			size="icon"
			aria-pressed={loop}
			data-loop-toggle
			className={loop ? "text-primary" : undefined}
			onClick={() => invokeAction("toggle-loop")}
			aria-label={t("Loop playback")}
			title={t("Loop playback (⌘L)")}
		>
			<HugeiconsIcon icon={RepeatIcon} />
		</Button>
	);
}

function PlayPauseButton() {
	const isPlaying = useEditor((e) => e.playback.getIsPlaying());
	// An empty timeline has nothing to play: greyed out, as in CapCut (not a button that does nothing).
	const empty = useEditor((e) => e.timeline.getTotalDuration() <= 0);

	return (
		<Button
			variant="text"
			size="icon"
			disabled={empty && !isPlaying}
			onClick={() => invokeAction("toggle-play")}
			aria-label={isPlaying ? "Pause" : "Play"}
			title={isPlaying ? "Pause (Space)" : "Play (Space)"}
		>
			<HugeiconsIcon icon={isPlaying ? PauseIcon : PlayIcon} />
		</Button>
	);
}
