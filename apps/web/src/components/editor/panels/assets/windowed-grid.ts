"use client";

// Only the rows of a fixed-tile grid (materialGrid) that the scroll shows are mounted, plus a screen above and below;
// the rest is the grid's own padding. Stickers → Animated put 502 tiles in the page at once (tab-open counted them),
// 3D emoji 320 in one group: every one a button, an observer and a lazy picture.
import {
	type CSSProperties,
	type RefObject,
	useLayoutEffect,
	useState,
} from "react";
import { MATERIAL_TILE } from "./material-grid";

export const GRID_COLUMN_GAP = 15;
export const GRID_ROW_GAP = 11;
/** A tile's label line under the square (text-[11px] leading-tight + the gap-1 of the tile). */
const LABEL_HEIGHT = 18;
const OVERSCAN = 480;

export type GridWindow = {
	from: number;
	to: number;
	padTop: number;
	padBottom: number;
};

/** The rows between `scrollTop - overscan` and `scrollTop + viewHeight + overscan`, as a slice of the items and the paddings that stand in for the rows outside it. */
export function gridWindow(o: {
	count: number;
	cols: number;
	rowHeight: number;
	gridTop: number;
	scrollTop: number;
	viewHeight: number;
	overscan?: number;
}): GridWindow {
	const cols = Math.max(1, o.cols);
	const rows = Math.ceil(o.count / cols);
	if (rows === 0 || o.rowHeight <= 0)
		return { from: 0, to: o.count, padTop: 0, padBottom: 0 };
	const overscan = o.overscan ?? OVERSCAN;
	const start = o.scrollTop - o.gridTop - overscan;
	const end = o.scrollTop - o.gridTop + o.viewHeight + overscan;
	const first = Math.min(
		rows - 1,
		Math.max(0, Math.floor(start / o.rowHeight)),
	);
	const last = Math.min(
		rows - 1,
		Math.max(first, Math.floor(end / o.rowHeight)),
	);
	return {
		from: first * cols,
		to: Math.min(o.count, (last + 1) * cols),
		padTop: first * o.rowHeight,
		padBottom: (rows - 1 - last) * o.rowHeight,
	};
}

const scrollParent = (node: HTMLElement): HTMLElement | null => {
	for (let el = node.parentElement; el; el = el.parentElement) {
		const y = getComputedStyle(el).overflowY;
		if (y === "auto" || y === "scroll") return el;
	}
	return null;
};

/**
 * The window of `count` tiles for the grid at `grid` (a materialGrid: `tile` px squares, 15 / 11 px gaps): render
 * `items.slice(from, to)` and spread `style` over the grid. Measured before paint and on every scroll and resize.
 */
export function useWindowedGrid(
	grid: RefObject<HTMLElement | null>,
	count: number,
	tile = MATERIAL_TILE,
): GridWindow & { style: CSSProperties } {
	// before the first measure: the first rows, enough for a tall panel
	const [win, setWin] = useState<GridWindow>(() => ({
		from: 0,
		to: Math.min(count, 80),
		padTop: 0,
		padBottom: 0,
	}));

	useLayoutEffect(() => {
		const node = grid.current;
		if (!node) return;
		const parent = scrollParent(node);
		if (!parent) {
			setWin({ from: 0, to: count, padTop: 0, padBottom: 0 });
			return;
		}
		let frame = 0;
		let rowHeight = tile + LABEL_HEIGHT + GRID_ROW_GAP;
		const measure = () => {
			frame = 0;
			const child = node.firstElementChild as HTMLElement | null;
			if (child?.offsetHeight) rowHeight = child.offsetHeight + GRID_ROW_GAP;
			const cols = Math.max(
				1,
				Math.floor(
					(node.clientWidth + GRID_COLUMN_GAP) / (tile + GRID_COLUMN_GAP),
				),
			);
			const gridTop =
				node.getBoundingClientRect().top -
				parent.getBoundingClientRect().top +
				parent.scrollTop;
			const next = gridWindow({
				count,
				cols,
				rowHeight,
				gridTop,
				scrollTop: parent.scrollTop,
				viewHeight: parent.clientHeight,
			});
			setWin((w) =>
				w.from === next.from &&
				w.to === next.to &&
				w.padTop === next.padTop &&
				w.padBottom === next.padBottom
					? w
					: next,
			);
		};
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(measure);
		};
		measure();
		parent.addEventListener("scroll", schedule, { passive: true });
		const ro = new ResizeObserver(schedule);
		ro.observe(node);
		ro.observe(parent);
		return () => {
			parent.removeEventListener("scroll", schedule);
			ro.disconnect();
			if (frame) cancelAnimationFrame(frame);
		};
	}, [grid, count, tile]);

	return {
		...win,
		style: { paddingTop: win.padTop, paddingBottom: win.padBottom },
	};
}
