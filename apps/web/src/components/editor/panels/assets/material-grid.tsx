"use client";

import { t } from "@/i18n";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/ui/icon";
import type { CSSProperties } from "react";
import { cn } from "@/utils/ui";
import { stopTileDoubleClick } from "./tile-activation";

/**
 * CapCut's material tile: a 76 pt square, the same in every tab (media, stickers, effects, text, captions, filters…).
 * A wider panel fits more tiles in a row; it never zooms them or stretches them into rectangles. Measured on CapCut
 * 9.5: columns 15 pt apart, rows 11 pt — taken to the 4-point grid (DESIGN.md G1, des2 D5): 16 and 12.
 */
export const MATERIAL_TILE = 76;

/** The grid of material tiles; `tile` is only for the 9:16 template covers. */
export function materialGrid(tile = MATERIAL_TILE): CSSProperties {
	return { display: "grid", gridTemplateColumns: `repeat(auto-fill, ${tile}px)`, columnGap: 16, rowGap: 12 };
}

/** A tile's square thumbnail (inside a `group` tile) and the name under it. */
export const TILE_THUMB =
	"aspect-square w-full overflow-hidden rounded-md border-2 border-transparent transition-colors group-hover:border-foreground/30";
// two lines, never one cut in half («Вращение с исчез…»); the name wraps inside the 76 px tile
// hyphens: a long Russian word breaks at a syllable with a hyphen, not anywhere (polish3, 11.11)
export const TILE_LABEL = "text-muted-foreground w-full line-clamp-2 break-words hyphens-auto text-left text-[11px] leading-tight";

/**
 * CapCut's «+» at the thumbnail's bottom-right corner, shown on hover: adds the material at the playhead, as a
 * double-click, ↵ or a drag onto the timeline do — one way to add in every tab. `at="tile"`: placed in the tile's
 * `group relative` box next to (not inside) the tile's own button, the square thumbnail at the box's top;
 * `at="thumb"`: inside the thumbnail itself.
 */
export function TileAddButton({
	onAdd,
	label = "Add at the playhead",
	at = "tile",
	thumbHeight = MATERIAL_TILE,
}: {
	onAdd: () => void;
	label?: string;
	at?: "tile" | "thumb";
	/** The thumbnail's height when it is not the 76 px square (the 9:16 template covers). */
	thumbHeight?: number;
}) {
	return (
		<button
			type="button"
			data-tile-add
			aria-label={t(label)}
			title={t(label)}
			onClick={(event) => {
				event.preventDefault();
				event.stopPropagation();
				onAdd();
			}}
			onDoubleClick={stopTileDoubleClick}
			style={at === "tile" ? { top: thumbHeight - 22 } : undefined}
			className={cn(
				"bg-primary text-primary-foreground pointer-events-none absolute right-1 z-10 grid size-[18px] place-items-center rounded-[4px] opacity-0 shadow transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100",
				at === "thumb" && "bottom-1",
			)}
		>
			<HugeiconsIcon icon={Add01Icon} className="size-3" strokeWidth={3} />
		</button>
	);
}
