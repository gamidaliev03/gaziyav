// The editor server's outgoing requests go straight out: this build routes nothing through a proxy of its own.
// The functions stay so the callers keep one shape (a desktop build with its own network layer can fill them in).
export type ProxyState = { status?: string; blocked?: boolean };

/** Whether the server's traffic goes through a proxy of the app's own (never in this build). */
export const viaVpn = (): boolean => false;

/** A few words on why a provider is unreachable because of that proxy (none here). */
export function vpnShort(): string | null {
	return null;
}

/** Why a request that got no answer may have failed because of that proxy (none here). */
export function vpnWhy(): string | null {
	return null;
}

/** The proxy the server's traffic goes through now: none. */
export function currentProxy(): string | null {
	return null;
}

export function applyProxy(_url: string | null): void {}

export function installProxy(): void {}
