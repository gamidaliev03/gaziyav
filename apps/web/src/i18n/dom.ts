// The interface language for the whole window, not only the strings wrapped in t(): while the language is not
// English, every text node and every title / aria-label / placeholder whose text is a dictionary key (or matches one
// of the pattern strings) is shown in that language — or in Russian, then English, where it has no line (./lookup.ts).
// Only the node's text changes (never the node), so React keeps updating it; when it writes the English again, the
// observer translates it again. Text the user typed (inputs, editable text) is never touched, nor anything inside
// [data-no-translate] (project and clip names, file names).
import { translateText } from "./lookup";

const ATTRS = ["title", "aria-label", "placeholder", "alt"] as const;
const SKIP = "input, textarea, select, script, style, code, pre, [contenteditable=''], [contenteditable='true'], [data-no-translate]";

/** What each changed node said in English and what we wrote, to put the English back (or retranslate) later. */
let originals: Array<{ node: WeakRef<Text>; text: string; wrote: string } | { el: WeakRef<Element>; attr: string; text: string; wrote: string }> = [];
/** The English behind a text node we translated (the correction card reads it: ./suggest.tsx). */
export const englishOf = new WeakMap<Text, string>();
let observer: MutationObserver | null = null;

/** Kept for older callers: the translation of a text in the current language, or null. */
export const translateRu = translateText;

function remember(o: (typeof originals)[number]) {
	originals.push(o);
	// nodes React threw away are dropped now and then, so the list stays small
	if (originals.length > 4000) originals = originals.filter((x) => ("node" in x ? x.node.deref() : x.el.deref()) !== undefined);
}

function skipped(el: Element | null): boolean {
	return !el || !!el.closest(SKIP);
}

function textNode(node: Text) {
	if (skipped(node.parentElement)) return;
	const out = translateText(node.data);
	if (out === null || out === node.data) return;
	remember({ node: new WeakRef(node), text: node.data, wrote: out });
	englishOf.set(node, node.data);
	node.data = out;
}

function attributes(el: Element) {
	if (el.closest("[data-no-translate]")) return;
	for (const attr of ATTRS) {
		const value = el.getAttribute(attr);
		if (!value) continue;
		const out = translateText(value);
		if (out === null || out === value) continue;
		remember({ el: new WeakRef(el), attr, text: value, wrote: out });
		el.setAttribute(attr, out);
	}
}

function walk(root: Node) {
	if (root.nodeType === Node.TEXT_NODE) {
		textNode(root as Text);
		return;
	}
	if (root.nodeType !== Node.ELEMENT_NODE) return;
	const el = root as Element;
	if (el.closest(SKIP)) return;
	attributes(el);
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		if (n.nodeType === Node.TEXT_NODE) textNode(n as Text);
		else attributes(n as Element);
	}
}

export function startDomTranslation() {
	if (observer || typeof document === "undefined") return;
	walk(document.body);
	observer = new MutationObserver((records) => {
		for (const r of records) {
			if (r.type === "characterData") textNode(r.target as Text);
			else if (r.type === "attributes") attributes(r.target as Element);
			else for (const n of r.addedNodes) walk(n);
		}
	});
	observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
}

export function stopDomTranslation() {
	observer?.disconnect();
	observer = null;
	// back to the English the page had (a node React rewrote since keeps React's text)
	for (const o of originals.reverse()) {
		if ("node" in o) {
			const node = o.node.deref();
			if (node && node.data === o.wrote) node.data = o.text;
		} else {
			const el = o.el.deref();
			if (el && el.getAttribute(o.attr) === o.wrote) el.setAttribute(o.attr, o.text);
		}
	}
	originals = [];
}

/** Another language (or a saved correction): the English back, then the window translated again. */
export function restartDomTranslation(on: boolean) {
	stopDomTranslation();
	if (on) startDomTranslation();
}
