import { beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import { KIND_BY_ID, MONTAGE_KINDS } from "../catalog";
import {
	MOGRAPH_BY_KIND,
	MOGRAPH_CATEGORIES,
	MOGRAPH_EMOJI,
	MOGRAPH_FONTS,
	MOGRAPH_KINDS,
	MOGRAPH_THEMES,
	mographDefaults,
} from "../mograph";
import { MOGRAPH } from "../remotion/mograph";

// The clip builder and the inspector's length limit use the editor's wasm timebase.
let aiGraphicDefinitions: typeof import("@/graphics/definitions/ai").aiGraphicDefinitions;
let maxSeconds: typeof import("../components/mograph-fields").maxSeconds;
let mographElement: typeof import("../mograph-insert").mographElement;
beforeAll(async () => {
	await installOpenCutWasm();
	({ aiGraphicDefinitions } = await import("@/graphics/definitions/ai"));
	({ maxSeconds } = await import("../components/mograph-fields"));
	({ mographElement } = await import("../mograph-insert"));
});

const TICKS = 120000;

describe("ready-made motion graphics", () => {
	test("100+ graphics in every category the library promises, each drawn by a Remotion component", () => {
		expect(MOGRAPH_KINDS.length).toBeGreaterThanOrEqual(100);
		for (const c of MOGRAPH_CATEGORIES)
			expect(
				MOGRAPH_KINDS.filter((k) => k.category === c).length,
			).toBeGreaterThanOrEqual(2);
		expect(new Set(MOGRAPH_KINDS.map((k) => k.kind)).size).toBe(
			MOGRAPH_KINDS.length,
		);
		expect(Object.keys(MOGRAPH).sort()).toEqual(
			MOGRAPH_KINDS.map((k) => k.kind).sort(),
		);
		for (const k of MOGRAPH_KINDS)
			expect(typeof MOGRAPH[k.kind]).toBe("function");
	});

	test("each is a timeline clip with its fields in the inspector, never offered to DeepSeek, not called AI", () => {
		for (const k of MOGRAPH_KINDS) {
			const kind = KIND_BY_ID.get(k.kind);
			expect(kind?.fields).toBe(k.fields);
			expect(kind?.doc).toBe("");
			const def = aiGraphicDefinitions.find((d) => d.id === `ai.${k.kind}`);
			expect(def?.name).toBe(`Motion · ${k.label}`);
			expect(def?.params).toBe(k.fields);
		}
		expect(
			MONTAGE_KINDS.filter((k) => k.doc).every((k) => !k.kind.startsWith("Mg")),
		).toBe(true);
	});

	test("every graphic has fields, a colour, themes, an OFL font from the kit; pictures where it shows one", () => {
		for (const k of MOGRAPH_KINDS) {
			const keys = k.fields.map((f) => f.key);
			expect(keys.some((key) => key === "accent" || key === "ink")).toBe(true);
			expect(k.themes.length).toBeGreaterThanOrEqual(2);
			for (const t of k.themes) expect(MOGRAPH_THEMES as readonly string[]).toContain(t);
			const font = k.fields.find((f) => f.key === "font") as { type: string; options: { value: string }[] } | undefined;
			if (font) {
				expect(font.type).toBe("select");
				for (const o of font.options) expect(MOGRAPH_FONTS as readonly string[]).toContain(o.value);
			}
			expect(k.fields.some((f) => f.type === "text" || f.type === "number")).toBe(true);
			expect(k.dur).toBeGreaterThanOrEqual(1.5);
		}
		expect(MOGRAPH_KINDS.filter((k) => k.images?.length).map((k) => k.kind)).toEqual(
			expect.arrayContaining(["MgLogoReveal", "MgEndScreen", "MgProductShowcase", "MgTestimonial", "MgSplitScreen", "MgPip"]),
		);
		// Every theme of the filter has graphics to show.
		for (const t of MOGRAPH_THEMES) expect(MOGRAPH_KINDS.filter((k) => k.themes.includes(t)).length).toBeGreaterThanOrEqual(5);
	});

	test("every ready-made Lottie ships its file and names where it came from", () => {
		const dir = path.join(import.meta.dir, "../../../public/mograph/lottie");
		const sources = JSON.parse(fs.readFileSync(path.join(dir, "sources.json"), "utf8")) as Record<string, { source: string; author: string }>;
		const lottie = MOGRAPH_KINDS.filter((k) => k.lottie);
		expect(lottie.length).toBeGreaterThanOrEqual(25);
		const files = new Set([...lottie.map((k) => k.lottie?.file ?? ""), ...MOGRAPH_EMOJI.map(([file]) => file)]);
		for (const k of lottie) {
			expect(k.lottie?.source).toMatch(/^https:\/\//);
			expect(k.lottie?.author).toBeTruthy();
		}
		for (const file of files) {
			const json = JSON.parse(fs.readFileSync(path.join(dir, `${file}.json`), "utf8")) as { w: number; h: number; layers: unknown[] };
			expect(json.w).toBeGreaterThan(0);
			expect(json.layers.length).toBeGreaterThan(0);
			expect(sources[`${file}.json`]?.source).toMatch(/^https:\/\//);
		}
		// Every emoji tile offers all the emoji, its own first by default.
		for (const k of MOGRAPH_KINDS.filter((x) => x.lottie?.file.startsWith("emoji-"))) {
			const field = k.fields.find((f) => f.key === "emoji") as { default: string; options: { value: string }[] } | undefined;
			expect(field?.default).toBe(k.lottie?.file);
			expect(field?.options.length).toBe(MOGRAPH_EMOJI.length);
		}
	});

	test("every tile has its prebuilt still (scripts/mograph-tiles.mjs), so the list scrolls over pictures", () => {
		const dir = path.join(import.meta.dir, "../../../public/mograph/tiles");
		for (const k of MOGRAPH_KINDS) expect(fs.statSync(path.join(dir, `${k.kind}.webp`)).size).toBeGreaterThan(200);
	});

	test("every tile and cover still was made from the catalog as it is now (else: node scripts/mograph-tiles.mjs <ids>)", async () => {
		const { tileInputs, jobKey } = await import("../../../scripts/mograph-tiles-input");
		const { createHash } = await import("node:crypto");
		const manifest = JSON.parse(fs.readFileSync(path.join(import.meta.dir, "../../../public/mograph/tiles/manifest.json"), "utf8")) as Record<string, string>;
		const hash = (key: string) => createHash("sha1").update(key).digest("hex").slice(0, 12);
		const { kinds, templates } = tileInputs();
		const stale = [...kinds.map((j) => [j.id, jobKey(j)]), ...templates.map((j) => [`cover:${j.id}`, jobKey(j)])].filter(([id, key]) => manifest[id] !== hash(key)).map(([id]) => id);
		expect(stale).toEqual([]);
	});

	test("colours: short hex is spelled out, so an alpha suffix stays a valid colour", async () => {
		const { col } = await import("../remotion/mograph/base");
		const { tintLottie } = await import("../remotion/assets");
		expect(col("#fff", "#000000")).toBe("#ffffff");
		expect(col("#f80a", "#000000")).toBe("#ff8800aa");
		expect(col("#12345", "#000000")).toBe("#000000");
		const json = { layers: [{ shapes: [{ ty: "fl", c: { a: 0, k: [0, 0, 0, 1] } }, { ty: "st", c: { a: 0, k: [1, 1, 1, 1] } }] }] };
		const tinted = tintLottie(json, "#fff") as typeof json;
		// the lightest colour of the file takes the tint as it is: white, not the blue «#fff» read as 0x000fff
		expect(tinted.layers[0].shapes[1].c.k.slice(0, 3)).toEqual([1, 1, 1]);
		expect(json.layers[0].shapes[0].c.k).toEqual([0, 0, 0, 1]);
	});

	test("a new clip starts with every field at its default and the graphic's own length", () => {
		const kind = MOGRAPH_BY_KIND.get("MgPriceTag");
		if (!kind) throw new Error("MgPriceTag is missing");
		const el = mographElement(kind, 2.5);
		expect(el.definitionId).toBe("ai.MgPriceTag");
		expect(Number(el.startTime)).toBe(2.5 * TICKS);
		expect(Number(el.duration)).toBe(4 * TICKS);
		expect(el.params).toEqual(mographDefaults(kind));
		expect(el.params.price).toBe("49");
		expect(el.params.font).toBe("Unbounded");
		expect(Number(mographElement(kind, -1).startTime)).toBe(0);
	});

	test("the length can grow only up to the next clip on the track", () => {
		const me = { id: "a", startTime: 2 * TICKS };
		expect(
			maxSeconds(me, [
				me,
				{ id: "b", startTime: 5 * TICKS },
				{ id: "c", startTime: 1 * TICKS },
			]),
		).toBe(3);
		expect(maxSeconds(me, [me])).toBe(60);
	});
});

describe("hidden kinds", () => {
	test("the Animated emoji repeat Stickers → Animated: not offered in Templates → Motion, still layers of the templates", async () => {
		const { TEMPLATES } = await import("@/templates/catalog");
		const hidden = MOGRAPH_KINDS.filter((k) => k.hidden);
		expect(hidden.length).toBe(12);
		for (const k of hidden) expect(k.category).toBe("Animated emoji");
		expect(MOGRAPH_KINDS.filter((k) => !k.hidden && k.category === "Animated emoji")).toEqual([]);
		const used = new Set(TEMPLATES.flatMap((tp) => tp.parts.flatMap((p) => ("mg" in p ? [p.mg] : []))));
		expect(hidden.some((k) => used.has(k.kind))).toBe(true);
	});
});
