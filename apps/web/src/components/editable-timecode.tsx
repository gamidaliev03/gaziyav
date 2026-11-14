"use client";

import { useEffect, useRef, useState } from "react";
import type { FrameRate, TimeCodeFormat } from "opencut-wasm";
import { formatEditorTimecode, parseEditorTimecode } from "@/fps/timecode";
import { parseTimeInput } from "@/fps/time-input";
import { cn } from "@/utils/ui";
import { mediaTime, snapSeekMediaTime, TICKS_PER_SECOND, type MediaTime } from "@/wasm";

/** The «Go to Timecode» key (goto-timecode) asks the player's field to open with this window event. */
export const FOCUS_TIMECODE_EVENT = "gaziyav:focus-timecode";

interface EditableTimecodeProps {
	time: MediaTime;
	duration: MediaTime;
	format?: TimeCodeFormat;
	fps: FrameRate;
	onTimeChange?: ({ time }: { time: MediaTime }) => void;
	className?: string;
	disabled?: boolean;
	/** True while the field is open: the row fades what lies after it (opacity only) so the dimmed preview has room. */
	onEditingChange?: (editing: boolean) => void;
}

/**
 * The playhead time under the player. One click opens it with everything selected; what is typed is read by
 * parseTimeInput (5 → 5 s, 130 → 1:30, +5, -12f, 00000501 …) and shown dimmed, as the full timecode, right after the
 * text. ↵ moves the playhead; Esc, a click away, or a text that reads as no time put the old value back, silently.
 * The display button and the input have one box: nothing moves while typing.
 */
export function EditableTimecode({
	time,
	duration,
	format = "HH:MM:SS:FF",
	fps,
	onTimeChange,
	className,
	disabled = false,
	onEditingChange,
}: EditableTimecodeProps) {
	const [isEditing, setIsEditing] = useState(false);
	const [inputValue, setInputValue] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	// SMPTE frames (drop-frame at 29.97 / 59.94), as Premiere and Final Cut show the playhead (fps/timecode.ts).
	const formattedTime = formatEditorTimecode({ time, format, fps });
	const smpte = format === "HH:MM:SS:FF";
	const boxStyle = { width: `calc(${formattedTime.length}ch + 10px)` };

	/** What the typed text names, as a time clamped into the project; null when it reads as none. */
	const read = (text: string, now: number = time): MediaTime | null => {
		if (!smpte) return parseEditorTimecode({ text, format, fps });
		const ticks = parseTimeInput({ text, fps, now, max: duration || undefined, ticksPerSecond: TICKS_PER_SECOND });
		return ticks === null ? null : mediaTime({ ticks });
	};

	const startEditing = () => {
		if (disabled) return;
		setIsEditing(true);
		setInputValue(formattedTime);
	};

	const cancelEditing = () => {
		setIsEditing(false);
		setInputValue("");
	};

	const applyEdit = () => {
		const parsed = read(inputValue);
		if (parsed === null) {
			cancelEditing();
			return;
		}
		const target = duration ? snapSeekMediaTime({ time: parsed, duration, fps }) : parsed;
		onTimeChange?.({ time: target });
		cancelEditing();
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.nativeEvent.isComposing) return;
		if (event.key === "Enter") {
			event.preventDefault();
			event.stopPropagation();
			applyEdit();
		} else if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			cancelEditing();
		} else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && smpte) {
			// a frame (a second with ⇧) from what is typed, or from the playhead when that reads as none
			event.preventDefault();
			event.stopPropagation();
			const from = read(inputValue) ?? time;
			const step = parseTimeInput({
				text: `${event.key === "ArrowUp" ? "+" : "-"}${event.shiftKey ? "1" : "1f"}`,
				fps,
				now: from,
				max: duration || undefined,
				ticksPerSecond: TICKS_PER_SECOND,
			});
			if (step === null) return;
			setInputValue(formatEditorTimecode({ time: mediaTime({ ticks: step }), format, fps }));
			requestAnimationFrame(() => inputRef.current?.select());
		}
	};

	useEffect(() => {
		onEditingChange?.(isEditing);
	}, [isEditing]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		if (isEditing && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [isEditing]);

	// The «Go to Timecode» key.
	const startRef = useRef(startEditing);
	startRef.current = startEditing;
	useEffect(() => {
		const open = () => startRef.current();
		window.addEventListener(FOCUS_TIMECODE_EVENT, open);
		return () => window.removeEventListener(FOCUS_TIMECODE_EVENT, open);
	}, []);

	if (isEditing) {
		const became = read(inputValue);
		const full = became === null ? "" : formatEditorTimecode({ time: became, format, fps });
		return (
			<span className="relative -mx-1 box-border inline-block h-[18px] min-w-0 shrink-0 font-mono text-xs" style={boxStyle} data-editable-timecode="editing">
				<input
					ref={inputRef}
					type="text"
					inputMode="text"
					autoComplete="off"
					autoCorrect="off"
					maxLength={11}
					spellCheck={false}
					value={inputValue}
					onChange={({ target }) => setInputValue(target.value)}
					onKeyDown={handleKeyDown}
					onFocus={(event) => event.currentTarget.select()}
					onBlur={cancelEditing}
					className={cn(
						"box-border block h-[18px] w-full min-w-0 border border-primary bg-background px-1 py-0 text-left font-mono text-xs leading-[16px] outline-none",
						"rounded text-primary tabular-nums",
						className,
						"text-left",
					)}
				/>
				{full !== "" && full !== inputValue.trim() && (
					<span
						aria-hidden
						className="pointer-events-none absolute top-0 left-0 z-20 flex h-[18px] items-center whitespace-pre pl-[5px] font-mono text-xs leading-[16px] tabular-nums"
					>
						<span className="invisible">{inputValue}</span>
						<span className="text-muted-foreground rounded bg-background px-1 opacity-90">{full}</span>
					</span>
				)}
			</span>
		);
	}

	return (
		<button
			type="button"
			onClick={startEditing}
			onKeyDown={(event) => {
				if (disabled) return;
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					startEditing();
				}
			}}
			disabled={disabled}
			data-editable-timecode="display"
			style={boxStyle}
			className={cn(
				// a 24 px target (G4) drawn in the 18 px row: the negative margin keeps the bar's layout
				"text-primary box-border -mx-1 -my-[3px] inline-block shrink-0 h-6 cursor-pointer border border-transparent px-1 py-0 font-mono text-xs leading-[22px] tabular-nums",
				"hover:bg-muted/50 hover:rounded",
				disabled && "cursor-default hover:bg-transparent",
				className,
			)}
			title={disabled ? undefined : "Click to edit time"}
		>
			{formattedTime}
		</button>
	);
}
