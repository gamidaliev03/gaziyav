// Exports that passed the look before «Saved» (verify.ts) in this run of the server: the only files the window may
// play back through /api/export/proven (the premiere of a finished film).
const proven = new Map<string, number>();
const KEEP = 64;

export function noteProven(file: string): void {
	proven.delete(file);
	proven.set(file, Date.now());
	while (proven.size > KEEP) proven.delete(proven.keys().next().value as string);
}

export const isProven = (file: string): boolean => proven.has(file);
