function randomUUID(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}

	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);

	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;

	const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0"));

	return (
		hex.slice(0, 4).join("") +
		"-" +
		hex.slice(4, 6).join("") +
		"-" +
		hex.slice(6, 8).join("") +
		"-" +
		hex.slice(8, 10).join("") +
		"-" +
		hex.slice(10, 16).join("")
	);
}

interface StableIdScope {
	ids: string[];
	cursor: number;
}

let activeScope: StableIdScope | null = null;

export function generateUUID(): string {
	const scope = activeScope;
	if (!scope) {
		return randomUUID();
	}
	if (scope.cursor < scope.ids.length) {
		const replayed = scope.ids[scope.cursor];
		scope.cursor += 1;
		return replayed;
	}
	const id = randomUUID();
	scope.ids.push(id);
	scope.cursor += 1;
	return id;
}

/**
 * Runs `fn` so that every `generateUUID()` call inside it is recorded into
 * `ids` (first run) or replayed from `ids` in the same order (later runs).
 *
 * The command history uses this so that redo re-creates exactly the same
 * element/track/keyframe ids as the original execute. Without it, a redo of
 * split/duplicate/paste mints fresh ids and every later command in the redo
 * stack that references the old ids fails ("Source track or element not found").
 *
 * Nested calls join the outer scope, so a batch records one ordered id list.
 */
export function withStableIds<T>({
	ids,
	fn,
}: {
	ids: string[];
	fn: () => T;
}): T {
	if (activeScope) {
		return fn();
	}
	activeScope = { ids, cursor: 0 };
	try {
		return fn();
	} finally {
		activeScope = null;
	}
}
