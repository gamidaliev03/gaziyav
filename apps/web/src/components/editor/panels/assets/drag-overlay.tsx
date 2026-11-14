import { HugeiconsIcon } from "@/components/ui/icon";
import { Upload04Icon } from "@hugeicons/core-free-icons";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/utils/ui";

interface MediaDragOverlayProps {
	isVisible: boolean;
	isProcessing?: boolean;
	progress?: number;
	/** Files are being dragged over the panel right now. */
	isDragOver?: boolean;
	onClick?: () => void;
}

/**
 * Empty Media, and the drop target while files are dragged in. The whole card opens the file picker; it says so,
 * with a button-looking «Choose files» (a first-time user read the old «Drag and drop…» as the only way in).
 */
export function MediaDragOverlay({
	isVisible,
	isProcessing = false,
	progress = 0,
	isDragOver = false,
	onClick,
}: MediaDragOverlayProps) {
	if (!isVisible) return null;

	const handleClick = ({
		event,
	}: {
		event: React.MouseEvent<HTMLButtonElement>;
	}) => {
		if (isProcessing || !onClick) return;
		event.preventDefault();
		event.stopPropagation();
		onClick();
	};

	return (
		<button
			className={cn(
				"group flex w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center transition-colors",
				isDragOver
					? "border-primary bg-primary/10"
					: "border-border bg-foreground/[0.03] hover:border-foreground/25 hover:bg-foreground/[0.06]",
			)}
			type="button"
			data-media-empty
			disabled={isProcessing || !onClick}
			onClick={(event) => handleClick({ event })}
		>
			{/* One quiet icon and two words (the owner, 12.11): «+» in the header is the way to add; a click here or a
			    drop works too, and ⌘V of a link still imports it. */}
			<HugeiconsIcon icon={Upload04Icon} className={cn("size-6", isDragOver ? "text-primary" : "text-muted-foreground/70")} />

			{isProcessing ? (
				<p className="text-muted-foreground text-xs tabular-nums">{progress}%</p>
			) : (
				<p className={cn("text-xs", isDragOver ? "text-foreground" : "text-muted-foreground")} data-empty-line>
					{isDragOver ? "Drop files" : "Drop files or press ⌘I"}
				</p>
			)}

			{isProcessing && (
				<Progress value={progress} className="w-full max-w-xs" />
			)}
		</button>
	);
}
