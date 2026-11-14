/**
 * Keyboard navigation outside the timeline (Kadr/FCP style), DOM-level so every panel
 * gets it without its own code:
 *
 * - Panels: Tab / ⇧Tab cycle the editor panels (Media…, Preview, Properties, Timeline).
 * - Asset tiles: once a tile is clicked or a panel is entered, ←/→/↑/↓ move between tiles,
 *   Enter applies / adds the tile (like a double-click), Esc leaves the tiles. Space is never
 *   taken by a tile: it always plays / pauses the timeline and leaves the tiles.
 * - ⌘F focuses the search field of the current panel.
 * - Dialogs: Enter presses the confirm button (Esc already closes them).
 */

const TILE_SELECTOR = '[data-asset-tile], [draggable="true"], .grid > button';
const FOCUS_OUTLINE = "2px solid var(--primary)";

let currentTile: HTMLElement | null = null;

/** Leaf editor panels (react-resizable-panels) in screen order. */
export function getEditorPanels(): HTMLElement[] {
	return [...document.querySelectorAll<HTMLElement>("[data-panel]")].filter(
		(panel) => !panel.querySelector("[data-panel]") && panel.getBoundingClientRect().width > 0,
	);
}

function isVisible(element: HTMLElement): boolean {
	const rect = element.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0;
}

function getAssetsPanel(): HTMLElement | null {
	return document.querySelector<HTMLElement>("[data-assets-panel]") ?? getEditorPanels()[0] ?? null;
}

export function getTiles(container: HTMLElement | null = getAssetsPanel()): HTMLElement[] {
	if (!container) return [];
	return [...container.querySelectorAll<HTMLElement>(TILE_SELECTOR)].filter(isVisible);
}

function markFocus(element: HTMLElement) {
	// Inside the element's own edge (it follows its corners): a ring outside was cut by the scrolling list and sat
	// off the row it marked.
	element.style.outline = FOCUS_OUTLINE;
	element.style.outlineOffset = "-2px";
	const clear = () => {
		element.style.outline = "";
		element.style.outlineOffset = "";
		element.removeEventListener("blur", clear);
	};
	element.addEventListener("blur", clear);
}

function focusElement(element: HTMLElement) {
	if (!element.hasAttribute("tabindex")) element.tabIndex = -1;
	element.focus({ preventScroll: true });
	element.scrollIntoView({ block: "nearest", inline: "nearest" });
	markFocus(element);
}

export function setCurrentTile(tile: HTMLElement | null) {
	currentTile = tile;
	if (tile) focusElement(tile);
}

export function getCurrentTile(): HTMLElement | null {
	if (!currentTile || !currentTile.isConnected) return null;
	return document.activeElement === currentTile ? currentTile : null;
}

/** Next tile in a direction, by screen position (rows for ↑/↓, reading order for ←/→). */
export function findNextTile({
	tiles,
	from,
	direction,
}: {
	tiles: Array<{ rect: { left: number; top: number; width: number; height: number } }>;
	from: number;
	direction: "left" | "right" | "up" | "down";
}): number {
	if (tiles.length === 0) return -1;
	if (from < 0) return 0;
	if (direction === "left") return Math.max(0, from - 1);
	if (direction === "right") return Math.min(tiles.length - 1, from + 1);
	const origin = tiles[from].rect;
	const cx = origin.left + origin.width / 2;
	const cy = origin.top + origin.height / 2;
	let best = from;
	let bestScore = Number.POSITIVE_INFINITY;
	tiles.forEach(({ rect }, index) => {
		const y = rect.top + rect.height / 2;
		const dy = direction === "down" ? y - cy : cy - y;
		if (dy <= Math.min(rect.height, origin.height) / 2) return;
		const dx = Math.abs(rect.left + rect.width / 2 - cx);
		const score = dy * 4 + dx;
		if (score < bestScore) {
			bestScore = score;
			best = index;
		}
	});
	return best;
}

function findTileButton(tile: HTMLElement, pattern: RegExp, exclude?: RegExp): HTMLElement | null {
	const scopes = [tile, tile.closest<HTMLElement>(".group")].filter(Boolean) as HTMLElement[];
	for (const scope of scopes) {
		const buttons = [...scope.querySelectorAll<HTMLElement>("button, [role=button]")];
		const match = buttons.find((button) => {
			const label = `${button.getAttribute("aria-label") ?? ""} ${button.getAttribute("title") ?? ""}`;
			return pattern.test(label) && !(exclude?.test(label) ?? false);
		});
		if (match) return match;
	}
	return null;
}

/** True only while ↵ on a tile runs the tile's add: Media's ↵ adds the whole selection, its «+» / double-click one tile. */
let enterOnTile = false;
export const isTileEnter = (): boolean => enterOnTile;

/** Enter on a tile: same as a double-click on it (apply / add), else its «+» / «Add» button. */
function addTile(tile: HTMLElement) {
	const target = tile.matches("[data-asset-tile]") ? tile : tile.querySelector<HTMLElement>("[data-asset-tile]") ?? tile.closest<HTMLElement>("[data-asset-tile]");
	if (target) {
		enterOnTile = true;
		try {
			target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }));
		} finally {
			enterOnTile = false;
		}
		return;
	}
	const add =
		findTileButton(tile, /\badd\b|at the playhead/i, /favou?rite/i) ??
		(tile.closest(".group")?.querySelector<HTMLElement>("button:has(svg.lucide-plus)") ?? null);
	if (add) {
		add.click();
		return;
	}
	tile.click();
}

/** Leaves the asset tiles: no tile keeps the keyboard (Space, arrows go back to the timeline). */
export function leaveTiles(): void {
	const tile = currentTile;
	currentTile = null;
	const active = document.activeElement;
	if (tile && active === tile) tile.blur();
	// A clicked tile, card or button in the left panel must not keep the focus either.
	const panel = getAssetsPanel();
	if (active instanceof HTMLElement && active !== document.body && panel?.contains(active)) active.blur();
}

/** Handles arrows / Enter / Esc while an asset tile has focus. True when handled. */
export function handleTileKey(ev: KeyboardEvent): boolean {
	const tile = getCurrentTile();
	if (!tile || ev.metaKey || ev.ctrlKey || ev.altKey) return false;
	const directions: Record<string, "left" | "right" | "up" | "down"> = {
		ArrowLeft: "left",
		ArrowRight: "right",
		ArrowUp: "up",
		ArrowDown: "down",
	};
	const direction = directions[ev.key];
	if (direction) {
		const panel = tile.closest<HTMLElement>("[data-panel]");
		const tiles = getTiles(panel);
		const index = tiles.indexOf(tile);
		const next = findNextTile({
			tiles: tiles.map((t) => ({ rect: t.getBoundingClientRect() })),
			from: index,
			direction,
		});
		const nextTile = tiles[next];
		if (nextTile && nextTile !== tile) setCurrentTile(nextTile);
		ev.preventDefault();
		return true;
	}
	if (ev.key === "Enter") {
		ev.preventDefault();
		addTile(tile);
		return true;
	}
	if (ev.key === "Escape") {
		// Leaves the tile and goes on to the editor's Esc, which empties the selection (CapCut: Esc deselects).
		currentTile = null;
		tile.blur();
		return false;
	}
	return false;
}

/** Tab / ⇧Tab: focus the next / previous editor panel (the first tile in an asset panel). */
export function focusPanel(step: 1 | -1) {
	const panels = getEditorPanels();
	if (panels.length === 0) return;
	const active = document.activeElement;
	const current = panels.findIndex((panel) => active instanceof Node && panel.contains(active));
	const next = panels[(current + step + panels.length) % panels.length];
	const tiles = getTiles(next);
	if (tiles.length > 0) {
		setCurrentTile(tiles[0]);
		return;
	}
	currentTile = null;
	focusElement(next);
}

/** ⌘F: the search field of the focused panel, else of the asset panel. */
export function focusPanelSearch(): boolean {
	const active = document.activeElement;
	const panels = getEditorPanels();
	const current =
		panels.find((panel) => active instanceof Node && panel.contains(active)) ?? getAssetsPanel();
	const scopes = [current, getAssetsPanel()].filter(Boolean) as HTMLElement[];
	for (const scope of scopes) {
		const input = [
			...scope.querySelectorAll<HTMLInputElement>(
				'input[type="search"], input[placeholder*="earch" i], input[aria-label*="earch" i]',
			),
		].find(isVisible);
		if (input) {
			input.focus();
			input.select();
			return true;
		}
	}
	return false;
}

const CANCEL_LABEL = /^(cancel|close|not now|back|no|keep)\b/i;

/** Enter in an open dialog presses its confirm button. True when handled. */
export function handleDialogEnter(ev: KeyboardEvent): boolean {
	if (ev.key !== "Enter" || ev.shiftKey || ev.altKey || ev.metaKey || ev.ctrlKey || ev.isComposing) {
		return false;
	}
	const dialogs = [
		...document.querySelectorAll<HTMLElement>('[role="alertdialog"][data-state="open"], [role="dialog"][data-state="open"]'),
	].filter((dialog) => dialog.querySelector("[data-dialog-footer], [data-dialog-confirm]"));
	const dialog = dialogs[dialogs.length - 1];
	if (!dialog) return false;
	const active = document.activeElement as HTMLElement | null;
	if (active && dialog.contains(active)) {
		const tag = active.tagName;
		// Buttons, links, multi-line text and pickers keep their own Enter, and so do fields that apply their value on
		// Enter (data-keep-enter: a time in the YouTube dialog started the download with the other time not typed yet).
		if (tag === "BUTTON" || tag === "A" || tag === "TEXTAREA" || active.isContentEditable || active.closest("[data-keep-enter]")) return false;
		if (active.getAttribute("role") && active.getAttribute("role") !== "dialog" && active.getAttribute("role") !== "alertdialog") {
			return false;
		}
	}
	const explicit = dialog.querySelector<HTMLElement>("[data-dialog-confirm]:not([disabled])");
	const footerButtons = [
		...dialog.querySelectorAll<HTMLButtonElement>("[data-dialog-footer] button:not([disabled])"),
	].filter((button) => !CANCEL_LABEL.test(button.innerText.trim()));
	const confirm = explicit ?? footerButtons[footerButtons.length - 1];
	if (!confirm) return false;
	ev.preventDefault();
	confirm.click();
	return true;
}

const OPEN_OVERLAYS =
	'[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"]';
let openOverlaysNow: HTMLElement[] | null = null;

/**
 * The open overlays, looked up once per task: a key press asks two or three times (source keys, Space, then every
 * other key) and each lookup walked the whole document (~0.3 ms with 180 clips on the timeline, on every key).
 */
function openOverlays(): HTMLElement[] {
	if (!openOverlaysNow) {
		openOverlaysNow = [...document.querySelectorAll<HTMLElement>(OPEN_OVERLAYS)];
		queueMicrotask(() => {
			openOverlaysNow = null;
		});
	}
	return openOverlaysNow;
}

/** Open overlays that own the keyboard (dialogs, popovers, menus, dropdown lists). */
export function isKeyboardOverlayOpen(): boolean {
	return openOverlays().length > 0;
}

/**
 * Overlays that keep Space for themselves: modal dialogs (they have their own players and
 * buttons), open menus and dropdown lists. Popovers (inside a popper wrapper) do not:
 * Space still plays / pauses the timeline while one is open.
 */
export function isModalOverlayOpen(): boolean {
	for (const element of openOverlays()) {
		const role = element.getAttribute("role");
		if (role === "dialog" && element.closest("[data-radix-popper-content-wrapper]")) continue;
		return true;
	}
	return false;
}

const TEXT_INPUT_TYPES = new Set(["", "text", "search", "email", "url", "tel", "password", "number", "date", "time", "datetime-local", "month", "week"]);

/** Typing in a text field (Space types a space there). Checkboxes, sliders, buttons are not. */
export function isTextEntryElement(element: Element | null): boolean {
	if (!(element instanceof HTMLElement)) return false;
	if (element.isContentEditable) return true;
	if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
	if (element instanceof HTMLInputElement) {
		return !element.disabled && !element.readOnly && TEXT_INPUT_TYPES.has((element.getAttribute("type") ?? "").toLowerCase());
	}
	return false;
}

/**
 * Pointer-down on an asset tile makes it the keyboard tile. Pointer-down anywhere else takes the keyboard back:
 * from the left panel (a media tile or the source preview kept it, so Space went on playing the source), and — on
 * the timeline or the preview — from a text field (their own mousedown handlers keep the browser from moving the
 * focus). Space then plays the timeline at once, without closing or deselecting anything by hand.
 */
export function installTilePointerTracking(): () => void {
	const onPointerDown = (event: PointerEvent) => {
		noteFocusInput({ byTab: false });
		const target = event.target as HTMLElement | null;
		const tile = target?.closest<HTMLElement>(TILE_SELECTOR);
		const panel = getAssetsPanel();
		// Only the asset panel (Media, Audio, Text, Effects…), never the timeline or properties.
		if (!tile || !panel?.contains(tile)) {
			if (!target || panel?.contains(target)) return;
			if (target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]')) return;
			const active = document.activeElement;
			if (!(active instanceof HTMLElement) || active === document.body || active.contains(target)) return;
			if (panel?.contains(active)) leaveTiles();
			else if (isTextEntryElement(active) && target.closest('section[aria-label="Timeline"], canvas, video')) active.blur();
			return;
		}
		requestAnimationFrame(() => {
			if (!tile.isConnected) return;
			currentTile = tile;
			// A press that opened a popover with a field (the «+ Create with AI» tile's description box) has already put the
			// focus in it by this frame: taking it back left the box unfocused, and the first typed words went nowhere (B4).
			const active = document.activeElement;
			if (active instanceof HTMLElement && active !== tile && !tile.contains(active) && (isTextEntryElement(active) || active.closest('[role="dialog"], [data-radix-popper-content-wrapper]'))) return;
			if (!tile.hasAttribute("tabindex")) tile.tabIndex = -1;
			tile.focus({ preventScroll: true });
			markFocus(tile);
		});
	};
	document.addEventListener("pointerdown", onPointerDown, { capture: true });
	return () => document.removeEventListener("pointerdown", onPointerDown, { capture: true });
}

/** Whether the focus last moved by Tab (true) or by a pointer press (false). :focus-visible can not tell: Chrome keeps it after a click that follows a key. */
let focusMovedByTab = false;
export function noteFocusInput({ byTab }: { byTab: boolean }): void {
	focusMovedByTab = byTab;
}
export function isFocusFromTab(): boolean {
	return focusMovedByTab;
}

/**
 * A ◆ reached with Tab: Space presses it. A ◆ clicked with the mouse keeps Space = play the timeline, as after
 * clicking any other button.
 */
export function spacePressesFocused({
	element,
	reachedWithTab,
}: {
	element: { matches(selector: string): boolean } | null;
	reachedWithTab: boolean;
}): boolean {
	return reachedWithTab && !!element && element.matches("[data-keyframe-toggle]");
}

/** Whether Tab / ⇧Tab from `index` still lands on a control of the same list (else it leaves it). */
export function tabStaysInList({ index, count, backwards }: { index: number; count: number; backwards: boolean }): boolean {
	if (index < 0) return false;
	return backwards ? index > 0 : index < count - 1;
}

const FOCUSABLE = 'input, button, select, textarea, a[href], [tabindex]';

/**
 * Tab in the inspector walks its controls (fields, ◆, switches, buttons) the browser's way; only from the last one
 * (⇧Tab: the first) it jumps to the next panel. The global Tab = next panel made the ◆ unreachable.
 */
export function tabStaysInInspector(ev: KeyboardEvent): boolean {
	const active = document.activeElement;
	if (!(active instanceof HTMLElement)) return false;
	const inspector = active.closest<HTMLElement>("[data-inspector-tab]");
	if (!inspector) return false;
	const controls = [...inspector.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
		(control) => control.tabIndex >= 0 && !control.hasAttribute("disabled") && isVisible(control),
	);
	return tabStaysInList({ index: controls.indexOf(active), count: controls.length, backwards: ev.shiftKey });
}
