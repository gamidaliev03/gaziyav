// THE SEAM for AI in the browser edition (lipsync, voice, generation by the visitor's own key, built elsewhere as a
// self-contained module). Every /api/ request of the app's AI clients goes to ONE adapter object; the default one
// answers «this works in the desktop app» and the AI tab shows the quiet card. A module that can do it in the browser
// calls registerBrowserAi() once at start-up; the hosts it talks to are added to src/demo/connect-hosts.json (the one
// list the page's Content-Security-Policy `connect-src` is built from, by script/web-demo.sh).
import type { ReactNode } from "react";

export interface BrowserAi {
	/** Whether this adapter answers the request (path = «/api/…» without the site's prefix). */
	handles: (path: string, method: string) => boolean;
	/** The answer the app's client expects (the same JSON its desktop server would send). */
	answer: (path: string, init: RequestInit | undefined, url: URL) => Promise<Response>;
	/** What the AI tab shows instead of the «in the desktop app» card (null keeps the card). */
	panel?: () => ReactNode;
}

/** The areas of /api/ that are AI: they reach the adapter, never the generic «not here». */
export const AI_AREAS = ["studio", "fal", "kie", "cloud", "voice-sample", "transcribe", "captions", "audio", "assist", "agent", "point", "faces", "generate", "ondevice", "hear"] as const;

export const isAiPath = (path: string): boolean => (AI_AREAS as readonly string[]).includes(path.split("/")[2] ?? "");

let current: BrowserAi | null = null;
const listeners = new Set<() => void>();

export function registerBrowserAi(adapter: BrowserAi): void {
	current = adapter;
	for (const l of listeners) l();
}

export const browserAi = (): BrowserAi | null => current;
export function onBrowserAi(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
