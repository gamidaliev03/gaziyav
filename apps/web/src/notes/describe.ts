// code — its test id and other data-* ids, role, aria-label, visible text, a short CSS path and its place on screen.
// Pure: it reads only the few element members below, so a bun test can hand it plain objects.

/** The members of a DOM element this reads (a real Element has them all). */
export interface ElementLike {
	tagName: string;
	id?: string;
	className?: unknown;
	attributes?: ArrayLike<{ name: string; value: string }>;
	getAttribute(name: string): string | null;
	parentElement: ElementLike | null;
	innerText?: string;
	textContent?: string | null;
	getBoundingClientRect?: () => { x: number; y: number; width: number; height: number };
}

export interface ElementInfo {
	tag: string;
	testid: string | null;
	/** Every other short data-* attribute (name without «data-» → value), at most 12. */
	data: Record<string, string>;
	role: string | null;
	ariaLabel: string | null;
	/** Visible text, whitespace folded, at most 120 characters. */
	text: string;
	/** A short CSS path from the nearest ancestor with an id or a test id (at most 4 steps). */
	path: string;
	rect: { x: number; y: number; w: number; h: number } | null;
}

const MAX_TEXT = 120;
const MAX_DATA = 12;
const MAX_STEPS = 4;

const fold = (s: string) => s.replace(/\s+/g, " ").trim();

function classes(el: ElementLike): string[] {
	const raw = typeof el.className === "string" ? el.className : "";
	// utility classes with «:», «[», «/» or «.» say nothing about which element it is
	return raw.split(/\s+/).filter((c) => c && /^[A-Za-z_-][\w-]*$/.test(c)).slice(0, 2);
}

function step(el: ElementLike): { text: string; anchor: boolean } {
	const tag = el.tagName.toLowerCase();
	const testid = el.getAttribute("data-testid");
	if (testid) return { text: `${tag}[data-testid="${testid}"]`, anchor: true };
	if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return { text: `${tag}#${el.id}`, anchor: true };
	let text = tag + classes(el).map((c) => `.${c}`).join("");
	const parent = el.parentElement as (ElementLike & { children?: ArrayLike<ElementLike> }) | null;
	const kids = parent?.children;
	if (kids && kids.length > 1) {
		const same = Array.from(kids).filter((k) => k.tagName === el.tagName);
		if (same.length > 1) text += `:nth-of-type(${same.indexOf(el) + 1})`;
	}
	return { text, anchor: false };
}

/** A short CSS path: from the element up to its nearest ancestor with a test id or an id, at most 4 steps. */
export function cssPath(el: ElementLike): string {
	const steps: string[] = [];
	for (let e: ElementLike | null = el; e && steps.length < MAX_STEPS; e = e.parentElement) {
		const tag = e.tagName.toLowerCase();
		if (tag === "html" || tag === "body") break;
		const s = step(e);
		steps.unshift(s.text);
		if (s.anchor) break;
	}
	return steps.join(" > ");
}

export function describeElement(el: ElementLike): ElementInfo {
	const data: Record<string, string> = {};
	for (const a of Array.from(el.attributes ?? [])) {
		if (Object.keys(data).length >= MAX_DATA) break;
		if (!a.name.startsWith("data-") || a.name === "data-testid") continue;
		if (a.value.length > 60) continue;
		data[a.name.slice(5)] = a.value;
	}
	const r = el.getBoundingClientRect?.();
	const text = fold(el.innerText ?? el.textContent ?? "");
	return {
		tag: el.tagName.toLowerCase(),
		testid: el.getAttribute("data-testid"),
		data,
		role: el.getAttribute("role"),
		ariaLabel: el.getAttribute("aria-label"),
		text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text,
		path: cssPath(el),
		rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
	};
}

/** Up to 3 ancestors (nearest first) that carry a data-testid, described the same way. */
export function describeAncestors(el: ElementLike, max = 3): ElementInfo[] {
	const out: ElementInfo[] = [];
	for (let e = el.parentElement; e && out.length < max; e = e.parentElement) {
		if (e.getAttribute("data-testid")) out.push(describeElement(e));
	}
	return out;
}
