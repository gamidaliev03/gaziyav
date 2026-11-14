"use client";

// The chosen look, applied at once and remembered (localStorage «gz-theme», read again before the next start's first
// paint by ./boot.ts). Nothing to save: every change is on screen the moment it is made.
import { create } from "zustand";
import { STORAGE_KEY } from "./boot";
import { DEFAULT_STATE, ENGINE_VERSION, makeRecord, normalizeState, type ThemeRecord, type ThemeState } from "./engine";

function readRecord(): ThemeRecord | null {
	if (typeof window === "undefined") return null;
	if (window.__gzTheme?.record) return window.__gzTheme.record;
	try {
		const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
		return s && typeof s === "object" && s.state ? (s as ThemeRecord) : null;
	} catch {
		return null;
	}
}

/** Puts a record on screen and stores it (the boot script's own `apply` when it ran; the same steps otherwise). */
export function applyRecord(record: ThemeRecord) {
	if (typeof window === "undefined") return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
	} catch {}
	if (window.__gzTheme) {
		window.__gzTheme.apply(record);
		return;
	}
	const d = document.documentElement;
	let s = document.getElementById("gz-theme");
	if (!s) {
		s = document.createElement("style");
		s.id = "gz-theme";
		document.head.appendChild(s);
	}
	s.textContent = record.css;
	const mode = d.classList.contains("dark") ? "dark" : "light";
	if (record.css && record.modes.includes(mode)) {
		d.setAttribute("data-gz-theme", record.state.family);
		d.setAttribute("data-gz-material", record.material);
		if (record.skin) d.setAttribute("data-gz-skin", "");
		else d.removeAttribute("data-gz-skin");
	} else {
		d.removeAttribute("data-gz-theme");
		d.removeAttribute("data-gz-material");
		d.removeAttribute("data-gz-skin");
	}
}

interface ThemeStore {
	state: ThemeState;
	set: (patch: Partial<ThemeState>) => void;
	/** Everything back to the default: «Минимал», its own accent, no tint, the middle of each slider. */
	reset: () => void;
	/** The record was changed elsewhere (another window, the engine's new version): take it. */
	refresh: () => void;
}

export const useThemeStore = create<ThemeStore>()((set, get) => ({
	state: normalizeState(readRecord()?.state ?? DEFAULT_STATE),
	set: (patch) => {
		const state = normalizeState({ ...get().state, ...patch });
		applyRecord(makeRecord(state));
		set({ state });
	},
	reset: () => {
		applyRecord(makeRecord(DEFAULT_STATE));
		set({ state: { ...DEFAULT_STATE } });
	},
	refresh: () => {
		const record = readRecord();
		const state = normalizeState(record?.state ?? DEFAULT_STATE);
		// a record from another version of the engine is made again with this one
		if (!record || record.ev !== ENGINE_VERSION) applyRecord(makeRecord(state));
		set({ state });
	},
}));
