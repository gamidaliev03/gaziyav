"use client";

// Keeps the look in step outside Settings: a record made by an older engine is made again on start, and a look chosen in
// another window of the app shows here too. Renders nothing.
//
// from before has no look stored, so the boot script already paints «Минимал»; here, once, that default is written down
// with a flag — from then on only the owner's own choice changes it (a later default never overrides a stored look).
import { useEffect } from "react";
import { STORAGE_KEY } from "./boot";
import { DEFAULT_STATE, makeRecord } from "./engine";
import { applyRecord, useThemeStore } from "./store";

export const MIGRATED_KEY = "gz-theme-migrated";

export function ThemeHost() {
	useEffect(() => {
		try {
			if (!localStorage.getItem(STORAGE_KEY) && !localStorage.getItem(MIGRATED_KEY)) {
				applyRecord(makeRecord(DEFAULT_STATE));
				localStorage.setItem(MIGRATED_KEY, `${DEFAULT_STATE.family}-1`);
			}
		} catch {}
		useThemeStore.getState().refresh();
		const onStorage = (e: StorageEvent) => {
			if (e.key !== STORAGE_KEY || !e.newValue) return;
			try {
				const record = JSON.parse(e.newValue);
				if (record?.state && typeof record.css === "string") {
					window.__gzTheme?.apply(record);
					useThemeStore.getState().refresh();
				}
			} catch {}
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);
	return null;
}
