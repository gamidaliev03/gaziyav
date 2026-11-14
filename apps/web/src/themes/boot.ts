// The theme before the first paint: a few lines inlined into <head> (app/layout.tsx) that read the chosen look from
// localStorage «gz-theme» (a ThemeRecord: the state and the CSS the engine made of it), put it on <html> and keep it
// right when the light/dark class changes (next-themes sets it a moment later; View → Appearance changes it any time).
// A look without the current mode — «Песок» has no dark one — shows «Как было» in that mode and comes back with its mode.
// The page calls `window.__gzTheme.apply(record)` to change it at once (./store.ts).
import { DEFAULT_STATE, makeRecord, type ThemeRecord } from "./engine";

export const STORAGE_KEY = "gz-theme";

declare global {
	interface Window {
		__gzTheme?: { record: ThemeRecord; apply: (record: ThemeRecord) => void };
	}
}

/**
 * Runs in the page as it is written here (stringified): no imports, no outer names. `d` is <html>, `D` the default
 * record, `K` the storage key.
 */
function boot(d: HTMLElement, D: ThemeRecord, K: string) {
	let r: ThemeRecord = D;
	try {
		const s = JSON.parse(localStorage.getItem(K) || "null");
		if (s && typeof s === "object" && typeof s.css === "string" && s.state && Array.isArray(s.modes)) r = s;
	} catch {}
	const sync = () => {
		const mode = d.classList.contains("dark") ? "dark" : "light";
		if (r.css && r.modes.indexOf(mode) >= 0) {
			if (d.getAttribute("data-gz-theme") !== r.state.family) d.setAttribute("data-gz-theme", r.state.family);
			if (d.getAttribute("data-gz-material") !== r.material) d.setAttribute("data-gz-material", r.material);
			if (r.skin) {
				if (!d.hasAttribute("data-gz-skin")) d.setAttribute("data-gz-skin", "");
			} else d.removeAttribute("data-gz-skin");
		} else {
			d.removeAttribute("data-gz-theme");
			d.removeAttribute("data-gz-material");
			d.removeAttribute("data-gz-skin");
		}
	};
	const apply = (next: ThemeRecord) => {
		r = next;
		if (window.__gzTheme) window.__gzTheme.record = next;
		let s = document.getElementById("gz-theme");
		if (!s) {
			s = document.createElement("style");
			s.id = "gz-theme";
			document.head.appendChild(s);
		}
		if (s.textContent !== next.css) s.textContent = next.css;
		sync();
	};
	window.__gzTheme = { record: r, apply };
	apply(r);
	new MutationObserver(sync).observe(d, { attributes: true, attributeFilter: ["class"] });
}

/** The inline script for <head>: the default look («Минимал») is baked in, so a first start is already themed. */
export function themeBootScript(): string {
	const D = makeRecord(DEFAULT_STATE);
	return `try{(${boot.toString()})(document.documentElement,${JSON.stringify(D)},${JSON.stringify(STORAGE_KEY)})}catch(e){}`;
}
