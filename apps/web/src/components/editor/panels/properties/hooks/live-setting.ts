/**
 * A setting shown live while a control moves (no undo step per move) and saved once at the end. The saved
 * step has to start from the value before the gesture: the live changes had already overwritten it, so ⌘Z
 * "restored" the last value shown and the colour stayed. A commit that changes nothing (the colour field
 * commits again when it loses focus) adds no step.
 */
export function createLiveSetting<T>({
	read,
	write,
	isSame,
}: {
	read: () => T;
	write: (args: { value: T; pushHistory: boolean }) => void;
	isSame: (args: { a: T; b: T }) => boolean;
}) {
	let start: { value: T } | null = null;
	return {
		preview(value: T) {
			if (!start) start = { value: read() };
			write({ value, pushHistory: false });
		},
		commit(value: T) {
			const from = start ? start.value : read();
			start = null;
			if (!isSame({ a: read(), b: from })) write({ value: from, pushHistory: false });
			if (!isSame({ a: from, b: value })) write({ value, pushHistory: true });
		},
	};
}
