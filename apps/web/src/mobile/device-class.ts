// The ONE place that decides the editor's layout: «phone», «tablet» or «desktop» (mobile, 14.11). From what the device
// says it can do — the primary pointer (coarse = a finger) and the screen's short side — never from the user-agent
// string. The visitor can override it (Settings → General → Layout; `?layout=phone|tablet|desktop` for tests), and the
// choice is remembered on this device.
//
// Why these inputs: an iPad with a trackpad still has a coarse primary pointer in Safari, and wants the touch layout
// until the visitor says otherwise; a touch-screen laptop has a fine primary pointer and stays «desktop»; a phone in
// landscape keeps «phone» (the short side decides, not the width), so turning it never swaps the whole editor.
import { useSyncExternalStore } from "react";

export type DeviceClass = "phone" | "tablet" | "desktop";
export type LayoutChoice = DeviceClass | "auto";

export interface DeviceSignals {
	/** matchMedia("(pointer: coarse)") — the primary pointer is a finger. */
	coarse: boolean;
	/** matchMedia("(any-hover: hover)") — some pointer can hover (a mouse or a trackpad is there too). */
	anyHover: boolean;
	/** The viewport's short and long sides in CSS px. */
	shortSide: number;
	longSide: number;
}

/** Under this short side (CSS px) a touch device is a phone: every phone in portrait (≤ 440), no iPad (mini: 744). */
export const PHONE_MAX_SHORT_SIDE = 600;
/** The desktop layout needs at least this; a coarse device bigger than a tablet (a touch TV, a 27″ kiosk) still gets it. */
export const DESKTOP_MIN_SHORT_SIDE = 1100;

/** Pure (tested): the signals and the visitor's choice → the class. */
export function classify(s: DeviceSignals, choice: LayoutChoice = "auto"): DeviceClass {
	if (choice !== "auto") return choice;
	if (!s.coarse) return "desktop";
	if (s.shortSide < PHONE_MAX_SHORT_SIDE) return "phone";
	if (s.shortSide >= DESKTOP_MIN_SHORT_SIDE) return "desktop";
	return "tablet";
}

const KEY = "gaziyav.layout";

export function readChoice(search: string = typeof location === "undefined" ? "" : location.search): LayoutChoice {
	const fromUrl = new URLSearchParams(search).get("layout");
	if (fromUrl === "phone" || fromUrl === "tablet" || fromUrl === "desktop" || fromUrl === "auto") return fromUrl;
	try {
		const stored = localStorage.getItem(KEY);
		if (stored === "phone" || stored === "tablet" || stored === "desktop") return stored;
	} catch {}
	return "auto";
}

export function saveChoice(choice: LayoutChoice): void {
	try {
		if (choice === "auto") localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, choice);
	} catch {}
	notify();
}

export function readSignals(): DeviceSignals {
	if (typeof window === "undefined") return { coarse: false, anyHover: true, shortSide: 1440, longSide: 900 };
	const w = window.visualViewport?.width ?? window.innerWidth;
	const h = window.visualViewport?.height ?? window.innerHeight;
	// screen.* is the device, not the window: a phone's keyboard or a split-view iPad shrinks the window, never the class
	const sw = window.screen?.width || w;
	const sh = window.screen?.height || h;
	return {
		coarse: window.matchMedia?.("(pointer: coarse)").matches ?? false,
		anyHover: window.matchMedia?.("(any-hover: hover)").matches ?? true,
		// the screen's short side, or the viewport's WIDTH when that is narrower (an iPad in split view; a browser whose
		// `screen` is not the device's — the touch walk's headless one said 800 × 600 for a 390-px phone). Never the
		// viewport's height: the on-screen keyboard shrinks it, and a tablet must not turn into a phone while typing.
		shortSide: Math.min(sw, sh, w),
		longSide: Math.max(sw, sh),
	};
}

const listeners = new Set<() => void>();
let cached: DeviceClass | null = null;
function notify() {
	cached = null;
	for (const fn of listeners) fn();
}

export function deviceClass(): DeviceClass {
	if (cached === null) cached = classify(readSignals(), readChoice());
	return cached;
}

function subscribe(fn: () => void): () => void {
	listeners.add(fn);
	if (listeners.size === 1 && typeof window !== "undefined") {
		window.addEventListener("resize", notify);
		window.matchMedia?.("(pointer: coarse)").addEventListener?.("change", notify);
	}
	return () => {
		listeners.delete(fn);
		if (listeners.size === 0 && typeof window !== "undefined") {
			window.removeEventListener("resize", notify);
			window.matchMedia?.("(pointer: coarse)").removeEventListener?.("change", notify);
		}
	};
}

/** The class for React; the server render (and the desktop app) is always «desktop». */
export function useDeviceClass(): DeviceClass {
	return useSyncExternalStore(subscribe, deviceClass, () => "desktop");
}
