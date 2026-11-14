// The visitor's own provider key: ONE place (this browser's localStorage under KEY_SLOT), never logged, never in a URL,
// sent only in the Authorization header to KEY_HOSTS (provider.ts). «Forget» removes it from this browser.

export const KEY_SLOT = "gz-web-lipsync-key";

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function store(): KV | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

export function readKey(kv: KV | null = store()): string | null {
	try {
		const k = kv?.getItem(KEY_SLOT)?.trim();
		return k ? k : null;
	} catch {
		return null;
	}
}

/** Saves a pasted key (trimmed; empty = forget). Returns whether one is kept now. */
export function saveKey(key: string, kv: KV | null = store()): boolean {
	const k = key.trim();
	if (!k) return forgetKey(kv), false;
	try {
		kv?.setItem(KEY_SLOT, k);
		return true;
	} catch {
		return false;
	}
}

export function forgetKey(kv: KV | null = store()): void {
	try {
		kv?.removeItem(KEY_SLOT);
	} catch {}
}

/** «…ab12» for the panel: the only part of the key ever shown. */
export const keyHint = (k: string | null): string | null => (k ? `…${k.slice(-4)}` : null);
