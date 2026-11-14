import { afterEach, describe, expect, test } from "bun:test";
import { contrast } from "../color";
import { DEFAULT_STATE, makeRecord, normalizeState, resolve, themeCss, type ThemeState } from "../engine";
import { ACCENT_SWATCHES, DEFAULT_FAMILY, FAMILIES, ORIGINAL_FAMILY } from "../families";
import { STORAGE_KEY, themeBootScript } from "../boot";

// Every look × mode × accent (the swatches and the hardest colours) × tint × the glass sliders' ends: each text pair the
// engine draws reaches WCAG AA (4.5:1 text, 3:1 shapes and the focus ring), over the worst backdrop for glass.
describe("contrast (WCAG AA) of every look", () => {
	const accents: Array<string | null> = [null, ...ACCENT_SWATCHES.map((s) => s.hex), "#000000", "#ffffff", "#808080", "#ffff00", "#0000ff", "#00ff00", "#7f00ff"];
	const tints: Array<string | null> = [null, "#ff0000", "#0a84ff", "#30d158"];
	for (const family of FAMILIES) {
		for (const mode of ["dark", "light"] as const) {
			if (!family[mode]) continue;
			test(`${family.id} · ${mode}`, () => {
				const failures: string[] = [];
				let n = 0;
				for (const accent of accents)
					for (const tint of tints)
						for (const clarity of [0, 50, 100])
							for (const blur of [0, 100]) {
								const state: ThemeState = { ...DEFAULT_STATE, family: family.id, accent, tint, tintAmount: 100, clarity, blur };
								const r = resolve(family, mode, state);
								if (!r) throw new Error("no palette");
								for (const c of r.checks) {
									n++;
									const k = contrast(c.fg, c.bg);
									if (k + 1e-9 < c.min && failures.length < 5) failures.push(`${c.what}: ${c.fg} on ${c.bg} = ${k.toFixed(2)} (accent ${accent}, tint ${tint}, clarity ${clarity})`);
								}
							}
				expect(n).toBeGreaterThan(1000);
				expect(failures).toEqual([]);
				// ~1 000 looks resolved per test: on a Mac busy with builds this takes longer than bun's 5 s
			}, 120_000);
		}
	}
});

describe("the default and «Как было»", () => {
	test("the default look is «Минимал», with both modes", () => {
		expect(DEFAULT_STATE.family).toBe(DEFAULT_FAMILY);
		expect(DEFAULT_FAMILY).toBe("minimal");
		const record = makeRecord(DEFAULT_STATE);
		expect(record.modes).toEqual(["dark", "light"]);
		expect(record.material).toBe("minimal");
		expect(record.css).toContain('html.dark[data-gz-theme="minimal"]{');
		expect(record.css).toContain('html:not(.dark)[data-gz-theme="minimal"]{');
	});
	test("«Как было» makes no CSS at all (today's look, byte for byte)", () => {
		const record = makeRecord({ ...DEFAULT_STATE, family: ORIGINAL_FAMILY, accent: "#ff0000", tint: "#00ff00" });
		expect(record.css).toBe("");
		expect(record.modes).toEqual([]);
		expect(record.material).toBe("");
	});
	test("a look with one mode only makes only that mode", () => {
		expect(makeRecord({ ...DEFAULT_STATE, family: "sand" }).modes).toEqual(["light"]);
		expect(makeRecord({ ...DEFAULT_STATE, family: "midnight" }).modes).toEqual(["dark"]);
		expect(themeCss({ ...DEFAULT_STATE, family: "sand" })).not.toContain("html.dark");
	});
	test("the accent changes the variables; the same state gives the same CSS", () => {
		const a = themeCss({ ...DEFAULT_STATE, accent: "#ff375f" });
		expect(a).not.toBe(themeCss(DEFAULT_STATE));
		expect(a).toBe(themeCss({ ...DEFAULT_STATE, accent: "#ff375f" }));
	});
});

describe("a stored state is made safe", () => {
	test("junk becomes the default", () => {
		expect(normalizeState(null)).toEqual(DEFAULT_STATE);
		expect(normalizeState("x")).toEqual(DEFAULT_STATE);
		expect(normalizeState({ family: "nope", accent: "red", tint: 5, clarity: 900, blur: -4 })).toEqual({ ...DEFAULT_STATE, clarity: 100, blur: 0 });
	});
	test("a good state is kept", () => {
		const s = { v: 1 as const, family: "glass", accent: "#5e5ce6", tint: "#30d158", tintAmount: 20, clarity: 80, blur: 10 };
		expect(normalizeState(s)).toEqual(s);
		expect(normalizeState({ ...s, family: ORIGINAL_FAMILY }).family).toBe(ORIGINAL_FAMILY);
	});
});

// The boot script, run as the page runs it: before the first paint it puts the stored look on <html>, follows the
// light/dark class, and «Как было» or a missing mode take every attribute off.
describe("the boot script", () => {
	// the fakes are put back after each test (redfix, 14.11): a `window = {}` left behind made 41–51 tests of other folders
	// fail in the same bun process («window.setTimeout is not a function»: code that checks `typeof window` first)
	const FAKED = ["window", "document", "localStorage", "MutationObserver"] as const;
	const g0 = globalThis as unknown as Record<string, unknown>;
	const had = Object.fromEntries(FAKED.map((k) => [k, Object.getOwnPropertyDescriptor(g0, k)]));
	afterEach(() => {
		for (const k of FAKED) {
			const d = had[k];
			if (d) Object.defineProperty(g0, k, d);
			else delete g0[k];
		}
	});
	function page(stored: string | null, cls: string[] = []) {
		const attrs = new Map<string, string>();
		const classes = new Set(cls);
		const styles: Array<{ id: string; textContent: string }> = [];
		let observer: (() => void) | null = null;
		const html = {
			classList: { contains: (c: string) => classes.has(c) },
			getAttribute: (k: string) => attrs.get(k) ?? null,
			setAttribute: (k: string, v: string) => attrs.set(k, v),
			removeAttribute: (k: string) => attrs.delete(k),
		};
		const store = new Map<string, string>(stored === null ? [] : [[STORAGE_KEY, stored]]);
		const g = globalThis as unknown as Record<string, unknown>;
		const win: Record<string, unknown> = {};
		g.window = win;
		g.document = {
			documentElement: html,
			head: { appendChild: (el: { id: string; textContent: string }) => styles.push(el) },
			getElementById: (id: string) => styles.find((s) => s.id === id) ?? null,
			createElement: () => ({ id: "", textContent: "" }),
		};
		g.localStorage = { getItem: (k: string) => store.get(k) ?? null };
		g.MutationObserver = class {
			constructor(cb: () => void) {
				observer = cb;
			}
			observe() {}
		};
		// the fakes stay for the test's later calls (apply, the class observer); afterEach puts the real globals back
		new Function(themeBootScript())();
		return {
			attrs,
			css: () => styles.find((s) => s.id === "gz-theme")?.textContent ?? null,
			setClass: (c: string[]) => {
				classes.clear();
				for (const x of c) classes.add(x);
				observer?.();
			},
			api: win.__gzTheme as { apply: (r: unknown) => void },
		};
	}

	test("nothing stored: «Минимал» in either mode", () => {
		const p = page(null, ["dark"]);
		expect(p.attrs.get("data-gz-theme")).toBe("minimal");
		expect(p.attrs.get("data-gz-material")).toBe("minimal");
		expect(p.css()).toBe(makeRecord(DEFAULT_STATE).css);
		p.setClass(["light"]);
		expect(p.attrs.get("data-gz-theme")).toBe("minimal");
	});
	test("a stored look comes back before the first paint", () => {
		const record = makeRecord({ ...DEFAULT_STATE, family: "frost", accent: "#ff375f" });
		const p = page(JSON.stringify(record), ["dark"]);
		expect(p.attrs.get("data-gz-theme")).toBe("frost");
		expect(p.attrs.get("data-gz-material")).toBe("frost");
		expect(p.css()).toBe(record.css);
	});
	test("«Как было» stored: no attribute, an empty style", () => {
		const p = page(JSON.stringify(makeRecord({ ...DEFAULT_STATE, family: ORIGINAL_FAMILY })), ["dark"]);
		expect(p.attrs.has("data-gz-theme")).toBe(false);
		expect(p.attrs.has("data-gz-material")).toBe(false);
		expect(p.css()).toBe("");
	});
	test("a light-only look in the dark mode shows «Как было» and comes back with the light mode", () => {
		const p = page(JSON.stringify(makeRecord({ ...DEFAULT_STATE, family: "sand" })), ["dark"]);
		expect(p.attrs.has("data-gz-theme")).toBe(false);
		p.setClass(["light"]);
		expect(p.attrs.get("data-gz-theme")).toBe("sand");
	});
	test("a broken store falls back to the default", () => {
		const p = page("{not json", ["dark"]);
		expect(p.attrs.get("data-gz-theme")).toBe("minimal");
	});
	test("the page switches at once through apply()", () => {
		const p = page(null, ["dark"]);
		p.api.apply(makeRecord({ ...DEFAULT_STATE, family: "strict" }));
		expect(p.attrs.get("data-gz-theme")).toBe("strict");
		expect(p.attrs.get("data-gz-material")).toBe("strict");
		p.api.apply(makeRecord({ ...DEFAULT_STATE, family: ORIGINAL_FAMILY }));
		expect(p.attrs.has("data-gz-theme")).toBe(false);
	});
});
