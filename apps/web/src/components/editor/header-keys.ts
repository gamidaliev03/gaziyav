/**
 * Keyboard in the editor header. Tab moves between the editor's panels (the header is the first of them), so
 * inside the header ←/→ move between its buttons, like a macOS toolbar.
 */

const FOCUSABLE = 'button:not([disabled]), a[href], [role="button"]:not([aria-disabled="true"])';

/** The header's controls in visual order, skipping hidden and disabled ones. */
export function headerControls(header: HTMLElement): HTMLElement[] {
	return [...header.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => {
		const rect = element.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	});
}

/** The control an arrow key moves to: the neighbour, wrapping around; from outside the list → the first / last. */
export function stepControl<T>(items: readonly T[], current: T | null, direction: 1 | -1): T | null {
	if (items.length === 0) return null;
	const at = current === null ? -1 : items.indexOf(current);
	if (at < 0) return items[direction === 1 ? 0 : items.length - 1] ?? null;
	return items[(at + direction + items.length) % items.length] ?? null;
}
