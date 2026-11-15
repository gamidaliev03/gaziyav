// The few pieces every browser AI adapter answers with: JSON as the Mac app's server sends it, the request's JSON body,
// and a failure as { error: <one sentence>, errorKey } (status 400, the server's own shape for a refused request).
import { keyOf, type Lang, say } from "./lipsync/sentences";

export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export async function jsonBody<T>(init: RequestInit | undefined): Promise<T> {
	const b = init?.body;
	try {
		return (typeof b === "string" ? JSON.parse(b) : b instanceof Blob ? JSON.parse(await b.text()) : {}) as T;
	} catch {
		return {} as T;
	}
}

export function failure(error: unknown, lang: Lang, status = 400): Response {
	const key = keyOf(error);
	return json({ error: say(key, lang), errorKey: key }, status);
}

/** The page's language for the sentences (the editor sets <html lang>). */
export const pageLang = (): Lang => (typeof document !== "undefined" && /^en/i.test(document.documentElement.lang) ? "en" : "ru");

export type Route = [method: string, path: RegExp];
export const matches = (routes: readonly Route[], path: string, method: string) => routes.some(([m, re]) => m === method.toUpperCase() && re.test(path.split("?")[0]));
