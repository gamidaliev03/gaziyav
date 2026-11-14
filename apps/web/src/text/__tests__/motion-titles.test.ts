import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { MeasuredTextLayout } from "@/text/primitives";

// The animation and design modules import the wasm bindings (ticks): loaded after the shim.
let K: typeof import("@/animation/anim-kinds");
let A: typeof import("@/animation/presets");
let F: typeof import("@/fonts/bundled");
let D: typeof import("@/text/design");
let G: typeof import("@/text/glyph-anim");
let I: typeof import("@/text/insert-preset");
let P: typeof import("@/text/presets");
let TPS = 0;
beforeAll(async () => {
	await installOpenCutWasm();
	K = await import("@/animation/anim-kinds");
	A = await import("@/animation/presets");
	F = await import("@/fonts/bundled");
	D = await import("@/text/design");
	G = await import("@/text/glyph-anim");
	I = await import("@/text/insert-preset");
	P = await import("@/text/presets");
	TPS = (await import("@/wasm")).TICKS_PER_SECOND;
});

const ticks = (s: number) => Math.round(s * TPS);

describe("per-letter animation", () => {
	test("the first letter starts at 0, the last one ends at 1, in order", () => {
		expect(G.staggered(0, 0, 10, 0.3)).toBe(0);
		expect(G.staggered(1, 9, 10, 0.3)).toBe(1);
		expect(G.staggered(0.5, 0, 10, 0.3)).toBeGreaterThan(G.staggered(0.5, 9, 10, 0.3));
	});
	test("a settled text is drawn exactly where it is", () => {
		const m = G.glyphMotion({ state: { inKind: "scatter", inP: 1, outKind: "lettersOut", outQ: 0, loopKind: "none", t: 2 }, i: 3, n: 8, x: 0.4, lineEm: 1.2, unit: "char" });
		expect(m).toEqual({ dx: 0, dy: 0, rotate: 0, scale: 1, scaleY: 1, alpha: 1, masked: false });
	});
	test("the In waits for its delay and the Out is glued to the clip end", () => {
		const params = { "anim.in": "letters", "anim.inDuration": 0.5, "anim.inDelay": 0.2, "anim.out": "maskSink", "anim.outDuration": 0.4 };
		const at = (s: number) => A.resolveGlyphState({ params, duration: ticks(3), localTime: ticks(s) });
		expect(at(0.1)?.inP).toBe(0);
		expect(at(0.45)?.inP).toBeCloseTo(0.5, 5);
		expect(at(1)?.inP).toBe(1);
		expect(at(2.8)?.outQ).toBeCloseTo(0.5, 5);
		expect(G.glyphsActive(at(1.5))).toBe(false);
		expect(A.resolveGlyphState({ params: { "anim.in": "fade" }, duration: ticks(3), localTime: 0 })).toBeNull();
	});
	test("mask kinds rise from below their line and are clipped", () => {
		const m = G.glyphMotion({ state: { inKind: "maskRise", inP: 0, outKind: "none", outQ: 0, loopKind: "none", t: 0 }, i: 0, n: 1, x: 0.5, lineEm: 1.2, unit: "line" });
		expect(m.masked).toBe(true);
		expect(m.dy).toBeGreaterThan(1.2);
	});
});

describe("motion titles", () => {
	test("numbers count up and keep their grouping", () => {
		expect(D.countUp("1 000 000", 0.5)).toBe("500 000");
		expect(D.countUp("1 000 000", 0)).toBe("0");
		expect(D.countUp("−50%", 0.5)).toBe("−25%");
		expect(D.countUp("1 990 ₽", 1)).toBe("1 990 ₽");
	});
	test("a clip without a design is plain text; the design's pace follows the In duration", () => {
		expect(D.resolveDesignState({ element: { params: {}, duration: ticks(3) as never }, localTime: 0, textColor: "#fff" })).toBeNull();
		const state = D.resolveDesignState({ element: { params: { "design.id": "lt-bar", "anim.inDuration": 1.4, "anim.out": "fade" }, duration: ticks(4) as never }, localTime: ticks(3.8), textColor: "#fff" });
		expect(state?.k).toBeCloseTo(2, 5);
		expect(state?.outQ).toBeCloseTo(0.5, 5);
	});
	test("a lower third: the job title sits under the name, the bar and plate are inside the selection box", () => {
		const ctx = {
			font: "",
			letterSpacing: "0px",
			save() {},
			restore() {},
			measureText: (text: string) => ({ width: text.length * 10 }),
		} as unknown as CanvasRenderingContext2D;
		const layout = { scaledFontSize: 40, textAlign: "left", lineHeightPx: 48, block: { maxWidth: 200, height: 48, visualCenterOffset: 0, alignWidth: 600 } } as unknown as MeasuredTextLayout;
		const state = D.resolveDesignState({ element: { params: { "design.id": "lt-bar", "design.sub": "Product expert" }, duration: ticks(4) as never }, localTime: ticks(2), textColor: "#fff" });
		if (!state) throw new Error("no design");
		const geometry = D.layoutDesign({ ctx, layout, state });
		expect(geometry.main.left).toBe(-300);
		expect(geometry.sub?.left).toBe(-300);
		expect(geometry.sub?.top).toBeGreaterThan(geometry.main.top + geometry.main.height);
		const extent = D.designExtent(geometry, state);
		expect(extent.left).toBeLessThan(geometry.main.left - 40 * 0.6);
		expect(extent.top + extent.height).toBeGreaterThan((geometry.sub?.top ?? 0) + (geometry.sub?.height ?? 0));
	});
});

describe("text presets", () => {
	test("40+ presets in every group, ids unique, the ones templates and AI titles use are kept", () => {
		const ids = P.TEXT_PRESETS.map((p) => p.id);
		expect(P.TEXT_PRESETS.length).toBeGreaterThanOrEqual(140);
		expect(new Set(ids).size).toBe(ids.length);
		for (const group of P.TEXT_PRESET_GROUPS) expect(P.TEXT_PRESETS.filter((p) => p.group === group).length).toBeGreaterThanOrEqual(4);
		for (const id of ["hook", "cta", "price", "ad-label", "caption", "plain", "bold-pop", "neon", "cinematic", "typewriter", "bounce-plate", "wave-gradient", "glitch", "kinetic-zoom", "retro-gradient", "lower-third", "callout", "quote", "sticker-note"]) {
			expect(ids).toContain(id);
		}
	});
	test("every font is bundled, every design, icon and animation exists", () => {
		const kinds = (list: readonly { value: string }[]) => new Set(list.map((k) => k.value));
		const [inKinds, outKinds, loopKinds] = [kinds(K.TEXT_ANIM_IN), kinds(K.TEXT_ANIM_OUT), kinds(K.TEXT_ANIM_LOOP)];
		for (const preset of P.TEXT_PRESETS) {
			const p = preset.params;
			expect({ id: preset.id, bundled: F.isBundledFont(String(p.fontFamily)) }).toEqual({ id: preset.id, bundled: true });
			if (p["design.id"]) expect(D.getDesign(p["design.id"])).toBeDefined();
			if (p["design.icon"]) expect(D.ICONS[String(p["design.icon"])]).toBeDefined();
			if (p["anim.in"]) expect(inKinds.has(String(p["anim.in"]))).toBe(true);
			if (p["anim.out"]) expect(outKinds.has(String(p["anim.out"]))).toBe(true);
			if (p["anim.loop"]) expect(loopKinds.has(String(p["anim.loop"]))).toBe(true);
			expect(I.settleSeconds(preset)).toBeLessThan(preset.duration);
		}
		for (const design of D.DESIGNS) for (const layer of design.layers) if (layer.kind === "icon" && layer.icon) expect(D.ICONS[layer.icon]).toBeDefined();
	});
	test("every preset has its own theme, and its tile's scene has a photo in the app", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const S = await import("@/text/theme-scenes");
		const themes = new Set<string>(S.THEMES.map((item) => item.id));
		for (const preset of P.TEXT_PRESETS) {
			expect({ id: preset.id, themed: themes.has(P.presetTheme(preset)) }).toEqual({ id: preset.id, themed: true });
			const file = path.join(import.meta.dir, "../../../public/text-scenes", `${P.presetScene(preset)}.jpg`);
			expect({ id: preset.id, photo: fs.existsSync(file) }).toEqual({ id: preset.id, photo: true });
		}
		for (const scene of S.SCENE_IDS) expect(fs.existsSync(path.join(import.meta.dir, "../../../public/text-scenes", `${scene}.jpg`))).toBe(true);
	});
});

describe("caption looks", () => {
	test("fifty motion looks: unique ids, bundled fonts, every one moves word by word, has a theme and a scene photo", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const L = await import("@/subtitles/motion-looks");
		const S = await import("@/subtitles/styles");
		const G = await import("@/subtitles/template-groups");
		const ids = new Set(S.CAPTION_STYLES.map((style) => style.id));
		expect(L.MOTION_LOOKS.length).toBeGreaterThanOrEqual(40);
		expect(ids.size).toBe(S.CAPTION_STYLES.length);
		const grouped = new Set(G.TEMPLATE_GROUPS.flatMap((group) => [...group.ids] as string[]));
		const wordModes = new Set(["color", "karaoke", "box", "reveal", "pop", "jump", "rise", "slide", "glow", "underline"]);
		const kinds = new Set([...K.TEXT_ANIM_IN.map((k) => k.value as string)]);
		for (const look of L.MOTION_LOOKS) {
			const p = look.params;
			expect({ id: look.id, font: F.isBundledFont(String(p.fontFamily)) }).toEqual({ id: look.id, font: true });
			const moves = wordModes.has(String(p["highlight.mode"])) || ["wordsUp", "letters", "lettersPop", "typewriter", "glitch", "flip"].includes(String(p["anim.in"]));
			expect({ id: look.id, moves }).toEqual({ id: look.id, moves: true });
			expect(kinds.has(String(p["anim.in"]))).toBe(true);
			expect({ id: look.id, grouped: grouped.has(look.id) }).toEqual({ id: look.id, grouped: true });
			expect(fs.existsSync(path.join(import.meta.dir, "../../../public/text-scenes", `${L.captionScene(look.id)}.jpg`))).toBe(true);
		}
	});
	test("a look without emoji turns the accents off (caption params merge)", async () => {
		const S = await import("@/subtitles/styles");
		expect(S.CAPTION_BASE["caption.emoji"]).toBe(false);
		for (const style of S.CAPTION_STYLES) expect(typeof style.params["caption.emoji"]).toBe("boolean");
	});
	test("emoji accents stick to keywords without adding words", async () => {
		const E = await import("@/text/emoji-accents");
		expect(E.addEmojiAccents("Это просто огонь")).toBe("Это просто огонь🔥");
		expect(E.addEmojiAccents("make money fast").split(" ").length).toBe(3);
		expect(E.addEmojiAccents("деньги деньги деньги")).toBe("деньги💰 деньги деньги");
		expect(E.addEmojiAccents("just words")).toBe("just words");
	});
});

describe("review fixes", () => {
	test("a design without an In rewinds on the same Out window as its letters (the whole clip may hold it)", () => {
		const state = D.resolveDesignState({ element: { params: { "design.id": "lt-bar", "anim.in": "none", "anim.out": "fade", "anim.outDuration": 2 }, duration: ticks(3) as never }, localTime: ticks(2), textColor: "#fff" });
		expect(state?.outQ).toBeCloseTo(0.5, 5);
		const withIn = D.resolveDesignState({ element: { params: { "design.id": "lt-bar", "anim.in": "fade", "anim.out": "fade", "anim.outDuration": 2 }, duration: ticks(3) as never }, localTime: ticks(2), textColor: "#fff" });
		expect(withIn?.outQ).toBeCloseTo(1 - 1 / 1.2, 5);
	});
	test("a tile with no size yet waits for one; the canvas is at most 2× its CSS size", async () => {
		const T = await import("@/text/components/preset-thumb");
		expect(T.tileCanvasSize(0, 120, 2)).toBeNull();
		expect(T.tileCanvasSize(110, 110, 2)).toEqual({ width: 220, height: 220 });
		expect(T.tileCanvasSize(110, 110, 3)).toEqual({ width: 220, height: 220 });
	});
	test("the press ripple leaves the canvas alpha as it found it", async () => {
		const R = await import("@/text/design-draw");
		const stack: number[] = [];
		const seen: number[] = [];
		const ctx = {
			globalAlpha: 0.8,
			fillStyle: "",
			save() {
				stack.push(this.globalAlpha);
			},
			restore() {
				this.globalAlpha = stack.pop() ?? this.globalAlpha;
			},
			beginPath() {},
			arc() {},
			fill() {
				seen.push(this.globalAlpha);
			},
		};
		R.drawRipple(ctx as never, 10, 10, 40, 0.49);
		expect(ctx.globalAlpha).toBe(0.8);
		expect(seen[0]).toBeGreaterThan(0);
		expect(seen[0]).toBeLessThan(0.05);
	});
	test("letter offsets are measured once per word and font", async () => {
		const Pr = await import("@/text/primitives");
		let calls = 0;
		const ctx = { font: "700 40px Inter", letterSpacing: "0px", measureText: (t: string) => { calls++; return { width: t.length * 10 }; } };
		const a = Pr.charOffsets(ctx as never, "привет");
		expect(a.x).toEqual([0, 10, 20, 30, 40, 50]);
		const first = calls;
		Pr.charOffsets(ctx as never, "привет");
		expect(calls).toBe(first);
		ctx.font = "700 60px Inter";
		Pr.charOffsets(ctx as never, "привет");
		expect(calls).toBeGreaterThan(first);
	});
});

