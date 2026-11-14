"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { bootLanguage } from "@/i18n";
import { appPrefs } from "./app-prefs";

// Mounted once for the whole app (projects and editor); the dialog's code is its own chunk, fetched while the app is
// idle after the first paint, so the first ⌘, draws the window at once instead of waiting for the chunk.
const loadDialog = () => import("./settings-dialog");
const SettingsDialog = dynamic(() => loadDialog().then((m) => m.SettingsDialog), { ssr: false });

type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };

export function SettingsHost() {
	// The UI language (stored, else the system's) is applied right after the first render: server and first client
	// render are English, so hydration matches.
	useEffect(() => bootLanguage(), []);
	// The Settings chunk, fetched in the idle time after the first paint (a 2 s timer where there is no idle callback).
	useEffect(() => {
		const w = window as IdleWindow;
		if (w.requestIdleCallback) {
			const id = w.requestIdleCallback(() => void loadDialog(), { timeout: 4000 });
			return () => w.cancelIdleCallback?.(id);
		}
		const timer = window.setTimeout(() => void loadDialog(), 2000);
		return () => window.clearTimeout(timer);
	}, []);
	// Settings → Projects → Cache: «Auto delete cache from N days ago», once a launch.
	useEffect(() => {
		const days = appPrefs().cacheDays;
		if (!days) return;
		void fetch("/api/settings/storage", {
			method: "POST",
			headers: { "content-type": "application/json", "x-studio": "1" },
			body: JSON.stringify({ olderThanDays: days }),
		}).catch(() => {});
	}, []);
	return <SettingsDialog />;
}
