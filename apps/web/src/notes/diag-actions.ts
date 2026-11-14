// (actions/registry.ts) with the kinds of the selected elements. Names only — never arguments, text, files or ids.
export interface ActionMark {
	a: string;
	k?: string[];
	t: number;
}

const RING = 50;
const ring: ActionMark[] = [];
let fresh = 0;
let kindsOf: (() => string[] | undefined) | null = null;

/** The diagnostics listener tells how to read the selected elements' kinds (only once the editor is loaded). */
export function setKindsReader(fn: (() => string[] | undefined) | null): void {
	kindsOf = fn;
}

export function recordAction(name: string): void {
	let k: string[] | undefined;
	try {
		k = kindsOf?.();
	} catch {}
	ring.push(k?.length ? { a: String(name), k, t: Date.now() } : { a: String(name), t: Date.now() });
	if (ring.length > RING) ring.shift();
	fresh++;
}

/** The actions since the last take (at most the ring), for the next batch. */
export function takeActions(): ActionMark[] {
	const n = Math.min(fresh, ring.length);
	fresh = 0;
	return n ? ring.slice(-n) : [];
}

/** Whether actions came since the last take. */
export const hasFreshActions = (): boolean => fresh > 0;
