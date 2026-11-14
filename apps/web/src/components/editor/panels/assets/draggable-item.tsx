"use client";

import { dragOutPath, prepareDragOut, startDragOut } from "@/media/drag-out";
import { type ReactNode, useRef } from "react";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { useEditor } from "@/editor/use-editor";
import type { TimelineDragData } from "@/timeline/drag";
import { cn } from "@/utils/ui";
import type { MediaTime } from "@/wasm";
import { TileAddButton } from "./material-grid";
import { tileActivation } from "./tile-activation";
import { useSourceStore } from "@/components/editor/panels/assets/source/source-store";

let emptyDragImage: HTMLImageElement | null = null;
function getEmptyDragImage(): HTMLImageElement {
	if (!emptyDragImage) {
		emptyDragImage = new window.Image();
		emptyDragImage.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=";
	}
	return emptyDragImage;
}

export interface DraggableItemProps {
	name: string;
	preview: ReactNode;
	dragData: TimelineDragData;
	onDragStart?: ({ e }: { e: React.DragEvent }) => void;
	onAddToTimeline?: ({ currentTime }: { currentTime: MediaTime }) => void;
	aspectRatio?: number;
	className?: string;
	containerClassName?: string;
	shouldShowPlusOnDrag?: boolean;
	shouldShowLabel?: boolean;
	isRounded?: boolean;
	variant?: "card" | "compact";
	isDraggable?: boolean;
	/** Several selected tiles dragged together: the preview is a stack with this count. */
	stackCount?: number;
	/** A Media item's own file: dragged out of the window it lands in Finder / a chat as that file (media/drag-out.ts). */
	dragOut?: { id: string; name: string; file: File };
}

export function DraggableItem({
	name,
	preview,
	dragData,
	onDragStart,
	onAddToTimeline,
	aspectRatio = 16 / 9,
	className = "",
	containerClassName,
	shouldShowPlusOnDrag: _shouldShowPlusOnDrag = true,
	shouldShowLabel = true,
	isRounded = true,
	variant = "card",
	isDraggable = true,
	stackCount = 1,
	dragOut,
}: DraggableItemProps) {
	const dragRef = useRef<HTMLDivElement>(null);
	const editor = useEditor();

	const handleAddToTimeline = () => {
		onAddToTimeline?.({ currentTime: editor.playback.getCurrentTime() });
	};

	// One click selects the tile, a double-click adds / applies it (never a stray single click).
	const activation = onAddToTimeline ? tileActivation(handleAddToTimeline) : { "data-asset-tile": "" };
	// the name only: double-click / drag is how every tile works, it is not said on each one (the owner, 12.11)
	const tileTitle = name;
	// The name under the thumbnail is the same tile: the same hand cursor and the same double-click.
	const nameActivation = onAddToTimeline
		? { onDoubleClick: tileActivation(handleAddToTimeline).onDoubleClick, style: { cursor: "pointer" } }
		: {};

	const handleDragStart = (event: React.DragEvent) => {
		event.dataTransfer.setDragImage(getEmptyDragImage(), 0, 0);

		editor.timeline.dragSource.begin({
			dataTransfer: event.dataTransfer,
			dragData,
		});


		onDragStart?.({ e: event });
		// The item's file is on disk for a drag out: the drag becomes the Mac's own (Finder and chats take the file;
		// the timeline and Media still take the item through dragSource above).
		const file = dragOut && stackCount <= 1 ? dragOutPath(dragOut) : null;
		if (file) startDragOut(file, event, handleDragEnd);
	};
	// The copy for a drag out starts on the first move with the button held (a drag), never on a click: a click used to
	// write the whole file (up to 2 GB) to disk for nothing.
	const prepare = dragOut
		? (event: React.PointerEvent) => {
				if (event.buttons & 1) prepareDragOut(dragOut);
			}
		: undefined;

	const handleDragEnd = () => {
		editor.timeline.dragSource.end();
	};

	return (
		<>
			{variant === "card" ? (
				<div
					ref={dragRef}
					className={cn("group relative", containerClassName ?? "w-28")}
				>
					<div
						className={cn(
							"relative flex h-auto w-full cursor-default flex-col gap-1",
							className,
						)}
					>
						<AspectRatio
							ratio={aspectRatio}
							className={cn(
								"bg-accent relative overflow-hidden",
								isRounded && "rounded-sm",
								isDraggable && "[&::-webkit-drag-ghost]:opacity-0",
							)}
							draggable={isDraggable}
							onDragStart={isDraggable ? handleDragStart : undefined}
							onDragEnd={isDraggable ? handleDragEnd : undefined}
							onPointerMoveCapture={isDraggable ? prepare : undefined}
							{...activation}
							aria-label={name}
							title={tileTitle}
							style={onAddToTimeline ? { cursor: "pointer" } : undefined}
						>
							{preview}
							{onAddToTimeline && <TileAddButton onAdd={handleAddToTimeline} at="thumb" />}
						</AspectRatio>
						{shouldShowLabel && (
							<span
								// Two lines before anything is cut: «Remove Background» and «Long whoosh 2» read whole at
								// the narrowest tile. Very long file names keep their start and extension.
								className="text-muted-foreground line-clamp-2 w-full text-left text-[11px] leading-tight break-words"
								title={name}
								{...nameActivation}
							>
								<span className="sr-only">{name}</span>
								<span aria-hidden="true">
									{name.length > 40
										? `${name.slice(0, 30)}…${name.slice(-7)}`
										: name}
								</span>
							</span>
						)}
					</div>
				</div>
			) : (
				<div
					ref={dragRef}
					className={cn("group relative w-full", containerClassName)}
				>
					<button
						type="button"
						className={cn(
							"flex h-8 w-full cursor-default items-center gap-3 px-1 outline-none",
							isDraggable && "[&::-webkit-drag-ghost]:opacity-0",
							className,
						)}
						draggable={isDraggable}
						onDragStart={isDraggable ? handleDragStart : undefined}
						onDragEnd={isDraggable ? handleDragEnd : undefined}
						onPointerMoveCapture={isDraggable ? prepare : undefined}
						{...activation}
						aria-label={name}
						title={tileTitle}
					>
						<div className="size-6 shrink-0 overflow-hidden rounded-sm">
							{preview}
						</div>
						<span className="w-full flex-1 truncate text-sm text-left">
							{name}
						</span>
					</button>
				</div>
			)}

			{/* the picture in the hand is the one drag chip for every tile (components/editor/drag-ghost.ts, rule F) */}
		</>
	);
}
