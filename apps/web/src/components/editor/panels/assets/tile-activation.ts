import type { MouseEvent } from "react";

/**
 * Left-panel tiles (effects, transitions, stickers, text presets, looks, graphics, sounds, media):
 * one click only selects the tile (it gets the keyboard ring; hover / ▶ previews it),
 * a DOUBLE-click applies it — so a stray click never changes the project. Enter applies the
 * selected tile too, and dragging keeps working. Spread on the tile element:
 *
 *   <button {...tileActivation(apply)}>…</button>
 */
export function tileActivation(apply: () => void) {
	return {
		"data-asset-tile": "",
		onDoubleClick: (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			apply();
		},
	} as const;
}

// The first click of a double-click can move the tile from under the pointer: in Media it opens the source preview
// above the list and the tiles slide down, so the second click landed on the preview and nothing was added. A second
// click at the spot where a tile was just pressed belongs to that tile: it is kept from whatever slid under the
// pointer, and the double-click goes to the tile.
const DOUBLE_CLICK_MS = 600;
const SAME_SPOT_PX = 6;
let pressed: { tile: HTMLElement; x: number; y: number; at: number } | null = null;

function movedTile(event: MouseEvent | globalThis.MouseEvent): HTMLElement | null {
	const p = pressed;
	if (!p || !p.tile.isConnected || event.timeStamp - p.at > DOUBLE_CLICK_MS) return null;
	if (Math.hypot(event.clientX - p.x, event.clientY - p.y) > SAME_SPOT_PX) return null;
	return p.tile.contains(event.target as Node) ? null : p.tile;
}

function installDoubleClickRescue() {
	const flag = window as unknown as { __tileDoubleClickRescue?: boolean };
	if (flag.__tileDoubleClickRescue) return;
	flag.__tileDoubleClickRescue = true;
	const swallow = (event: globalThis.MouseEvent) => {
		if (!movedTile(event)) return;
		event.preventDefault();
		event.stopPropagation();
	};
	document.addEventListener(
		"pointerdown",
		(event) => {
			if (movedTile(event)) {
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			const tile = (event.target as Element | null)?.closest?.("[data-asset-tile]");
			pressed = tile instanceof HTMLElement ? { tile, x: event.clientX, y: event.clientY, at: event.timeStamp } : null;
		},
		true,
	);
	for (const type of ["mousedown", "pointerup", "mouseup", "click"] as const) document.addEventListener(type, swallow, true);
	// The second click's own handler can replace the node under the pointer (a template card swaps its still for the
	// live preview as it is selected): the browser then sends the dblclick to the detached node and it never reaches
	// the tile; when the swap lands between the press and the release (a look's still resolving under the pointer)
	// there is no click either. A second release on a tile whose dblclick did not arrive by the next task is the tile's
	// double-click.
	let awaiting: HTMLElement | null = null;
	document.addEventListener(
		"mouseup",
		(event) => {
			if (movedTile(event) || event.button !== 0 || event.detail !== 2) return;
			const tile = (event.target as Element | null)?.closest?.("[data-asset-tile]");
			if (!(tile instanceof HTMLElement)) return;
			awaiting = tile;
			const { clientX, clientY } = event;
			window.setTimeout(() => {
				if (awaiting !== tile) return;
				awaiting = null;
				if (tile.isConnected) tile.dispatchEvent(new globalThis.MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX, clientY, detail: 2 }));
			}, 0);
		},
		true,
	);
	document.addEventListener(
		"dblclick",
		(event) => {
			awaiting = null;
			const tile = movedTile(event);
			if (!tile) return;
			event.preventDefault();
			event.stopPropagation();
			pressed = null;
			tile.dispatchEvent(new globalThis.MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY, detail: 2 }));
		},
		true,
	);
}

if (typeof window !== "undefined" && typeof document !== "undefined") installDoubleClickRescue();

/** For buttons inside a tile (▶, ★, +): their double-click must not also apply the tile. */
export function stopTileDoubleClick(event: MouseEvent) {
	event.stopPropagation();
}
