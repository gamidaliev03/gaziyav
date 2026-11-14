import { useEffect, useRef } from "react";
import { HugeiconsIcon } from "@/components/ui/icon";
import { KeyframeIcon } from "@hugeicons/core-free-icons";
import { formatShortcut } from "@/actions/keybinding";
import { useKeybindingsStore } from "@/actions/keybindings-store";
import { cn } from "@/utils/ui";

/** The key that keys every animated parameter at the playhead (⌥K by default), for the tooltip. */
function useToggleKeyframeShortcut(): string | null {
	const keybindings = useKeybindingsStore((state) => state.keybindings);
	for (const [key, action] of keybindings) {
		if (action === "toggle-keyframe") return formatShortcut({ shortcut: key });
	}
	return null;
}

/**
 * The ◆ beside a property (DESIGN.md I1). Muted outline: no keyframes. Violet outline, a bit heavier: the property
 * is animated, the playhead is between keys. Filled violet with a short pop: a key sits under the playhead.
 * 24×24 to hit, 12 px to see; it takes 20 px in the row like the empty slot of rows without a ◆.
 */
export function KeyframeToggle({
	isActive,
	isAnimated = false,
	isDisabled = false,
	title,
	onToggle,
}: {
	isActive: boolean;
	isAnimated?: boolean;
	isDisabled?: boolean;
	title: string;
	onToggle: () => void;
}) {
	const iconRef = useRef<HTMLSpanElement>(null);
	const wasActive = useRef(isActive);
	const shortcut = useToggleKeyframeShortcut();

	// Pop (1 → 1.2 → 1, 180 ms) when a key lands under the playhead — not on mount, not with reduced motion.
	useEffect(() => {
		const becameActive = isActive && !wasActive.current;
		wasActive.current = isActive;
		if (!becameActive || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
		iconRef.current?.animate?.(
			[{ transform: "scale(1)" }, { transform: "scale(1.2)" }, { transform: "scale(1)" }],
			{ duration: 180, easing: "cubic-bezier(.2,0,0,1)" },
		);
	}, [isActive]);

	const tooltip = !isDisabled && shortcut ? `${title} (${shortcut})` : title;
	return (
		<button
			type="button"
			aria-pressed={isActive}
			aria-label={title}
			disabled={isDisabled}
			title={tooltip}
			onClick={onToggle}
			data-keyframe-toggle
			className={cn(
				"-m-0.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[8px] outline-none",
				"hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
				"disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent",
				isActive || isAnimated
					? "text-primary"
					: "text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground",
			)}
		>
			<span ref={iconRef} className="flex">
				<HugeiconsIcon
					icon={KeyframeIcon}
					strokeWidth={isActive || isAnimated ? 1.5 : 1.25}
					className={cn("size-3", isActive && "fill-primary")}
				/>
			</span>
		</button>
	);
}
