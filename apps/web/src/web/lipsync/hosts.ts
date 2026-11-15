// The provider's hosts the page talks to (and nobody else). The key goes ONLY to KEY_HOSTS, in the Authorization
// header; storage (the signed upload link and the result files) is reached without it, as the desktop does.

/**
 * The queue (submit, status, answer, cancel), the storage's ticket desk, the agent's model (OpenRouter through fal:
 * fal.run) and the account (the balance: api.fal.ai) — these carry «Authorization: Key …».
 */
export const KEY_HOSTS = ["queue.fal.run", "rest.fal.ai", "fal.run", "api.fal.ai"] as const;

/** Where uploads are PUT and results are fetched from (fal's CDN; the ticket names the exact host). */
export const STORAGE_HOSTS = ["v3.fal.media", "v3b.fal.media", "fal.media"] as const;

/** For the page's Content-Security-Policy `connect-src` (and pubdemo's connect-hosts.json): exact hosts, https only. */
export const CONNECT_HOSTS: readonly string[] = [...KEY_HOSTS, ...STORAGE_HOSTS];

/** Whether a URL may receive the key: https and one of KEY_HOSTS, nothing else ever. */
export function mayCarryKey(url: string): boolean {
	try {
		const u = new URL(url);
		return u.protocol === "https:" && (KEY_HOSTS as readonly string[]).includes(u.hostname);
	} catch {
		return false;
	}
}

/** Whether a provider link (an answer's file, an upload ticket) is one of the provider's own hosts. */
export function isProviderUrl(url: string): boolean {
	try {
		const u = new URL(url);
		return u.protocol === "https:" && CONNECT_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
	} catch {
		return false;
	}
}
