import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { MOGRAPH_BY_KIND, MOGRAPH_THEMES, themePhoto } from "@/montage/mograph";
import { TEXT_PRESETS } from "@/text/presets";
import { EDITION, KEPT_TEMPLATE_PACKS } from "@/edition/cuts";
import { ALL_TEMPLATES as TEMPLATES, layerParams, placeTemplate, TEMPLATE_CATEGORIES, TEMPLATES as OFFERED, templateSeconds } from "../catalog";

describe("the owner's own edition (src/edition/cuts.ts)", () => {
	test("offers the text-motion packs and the ones his projects use; every kept id exists", () => {
		for (const id of KEPT_TEMPLATE_PACKS) expect(TEMPLATES.find((tp) => tp.id === id)).toBeDefined();
		if (EDITION.templatePacks) expect(OFFERED.length).toBe(TEMPLATES.length);
		else {
			expect(OFFERED.map((tp) => tp.id).sort()).toEqual([...KEPT_TEMPLATE_PACKS].sort());
			expect(OFFERED.every((tp) => ["Titles", "Talking head"].includes(tp.category) || ["flash-sale", "product-launch"].includes(tp.id))).toBe(true);
		}
	});
});

const multiLayer = TEMPLATES.filter((tp) => tp.parts.length >= 2 && tp.parts.some((p) => "mg" in p));

describe("templates", () => {
	test("20+ multi-layer templates built from the motion graphics and the text presets, every layer real", () => {
		expect(multiLayer.length).toBeGreaterThanOrEqual(20);
		expect(new Set(TEMPLATES.map((tp) => tp.id)).size).toBe(TEMPLATES.length);
		for (const tp of TEMPLATES) {
			expect(TEMPLATE_CATEGORIES).toContain(tp.category);
			expect(tp.themes.length).toBeGreaterThanOrEqual(1);
			for (const th of tp.themes) expect(MOGRAPH_THEMES as readonly string[]).toContain(th);
			for (const part of tp.parts) {
				if ("mg" in part) {
					const kind = MOGRAPH_BY_KIND.get(part.mg);
					expect(kind).toBeDefined();
					// A template only sets fields the graphic has.
					for (const key of Object.keys(part.params ?? {})) expect(kind?.fields.map((f) => f.key)).toContain(key);
				} else {
					expect(TEXT_PRESETS.map((p) => p.id)).toContain(part.text);
				}
			}
		}
		// The requested kinds of pack are all there.
		for (const id of ["flash-sale", "product-launch", "review", "story-promo", "podcast", "travel-vlog", "wedding", "fitness-intro", "gaming", "real-estate"]) {
			expect(TEMPLATES.find((tp) => tp.id === id)).toBeDefined();
		}
		// Every theme of the filter finds templates.
		for (const th of MOGRAPH_THEMES) expect(TEMPLATES.filter((tp) => tp.themes.includes(th)).length).toBeGreaterThanOrEqual(1);
	});

	test("layers land at their moment: intro at 0, outro ending with the video, overlays across it", () => {
		const tour = TEMPLATES.find((tp) => tp.id === "real-estate");
		if (!tour) throw new Error("no real-estate template");
		const placed = placeTemplate(tour, 30);
		const by = (kind: string) => placed.find((l) => "mg" in l.part && l.part.mg === kind);
		expect(by("MgLogoReveal")?.start).toBe(0);
		expect(by("MgPriceTag")?.start).toBe(3.6);
		const outro = by("MgLogoOutro");
		expect((outro?.start ?? 0) + (outro?.dur ?? 0)).toBeCloseTo(30);

		const vlog = TEMPLATES.find((tp) => tp.id === "travel-vlog");
		if (!vlog) throw new Error("no travel-vlog template");
		// An empty or short timeline gets the template's own length.
		const span = templateSeconds(vlog);
		const rec = placeTemplate(vlog, 0).find((l) => "mg" in l.part && l.part.mg === "MgViewfinder");
		expect(rec).toMatchObject({ start: 0, dur: span });
		expect(span).toBeGreaterThanOrEqual(10);
		// A text part without a moment is placed by its preset.
		const ugc = TEMPLATES.find((tp) => tp.id === "ugc-ad");
		expect(ugc && placeTemplate(ugc, 20).filter((l) => "text" in l.part).every((l) => l.start === null)).toBe(true);
	});
});

describe("packs", () => {
	test("every template is a pack: 3+ layers with graphics, its own colours and words, on its theme's photo", () => {
		for (const tp of TEMPLATES) {
			expect(tp.parts.length).toBeGreaterThanOrEqual(3);
			expect(tp.parts.some((p) => "mg" in p)).toBe(true);
			expect(tp.palette?.accent).toMatch(/^#[0-9A-F]{6}$/i);
			expect(tp.cover).toBe(themePhoto(tp.themes[0]));
			// Text layers say something for this template (the bare captions preset follows the speech).
			for (const p of tp.parts) if ("text" in p && p.text !== "caption") expect(p.content).toBeTruthy();
		}
		// The new graphics are used across the packs.
		const used = new Set(TEMPLATES.flatMap((tp) => tp.parts.flatMap((p) => ("mg" in p ? [p.mg] : []))));
		for (const kind of ["MgGeotag", "MgWeather", "MgLightLeak", "MgGlitch", "MgPolaroid", "MgLineChart", "MgPoll", "MgCommentReply", "MgFireworks", "MgEmojiFire"]) expect(used.has(kind)).toBe(true);
	});

	test("a pack's colours go to the brand-coloured graphics only; a layer's own params win", () => {
		const sale = TEMPLATES.find((tp) => tp.id === "flash-sale");
		const film = TEMPLATES.find((tp) => tp.id === "travel-film");
		if (!sale || !film) throw new Error("missing templates");
		const part = (tp: typeof sale, kind: string) => {
			const p = tp.parts.find((x) => "mg" in x && x.mg === kind);
			if (!p || !("mg" in p)) throw new Error(kind);
			return p;
		};
		expect(layerParams(sale, part(sale, "MgSaleBurst")).accent).toBe(sale.palette?.accent ?? "");
		expect(layerParams(sale, part(sale, "MgSaleBurst")).discount).toBe("-60%");
		// The film matte stays black and the light leak warm whatever the pack's colours.
		expect(layerParams(film, part(film, "MgFilmMatte")).accent).toBe("#000000");
		expect(layerParams(film, part(film, "MgLightLeak")).accent).toBe("#FF6A1A");
		// Every field a template sets exists on its graphic, and every graphic keeps all its fields.
		for (const tp of TEMPLATES)
			for (const p of tp.parts)
				if ("mg" in p) {
					const keys = MOGRAPH_BY_KIND.get(p.mg)?.fields.map((f) => f.key) ?? [];
					expect(Object.keys(layerParams(tp, p)).sort()).toEqual([...keys].sort());
				}
	});
});

describe("template covers", () => {
	test("every template with graphics has its prebuilt cover still (scripts/mograph-tiles.mjs)", () => {
		const dir = path.join(import.meta.dir, "../../../public/mograph/covers");
		for (const tp of TEMPLATES.filter((x) => x.parts.some((p) => "mg" in p))) expect(fs.statSync(path.join(dir, `${tp.id}.webp`)).size).toBeGreaterThan(200);
	});

	test("a cover shows the template over its photo: past a full-frame intro, at the first overlay", async () => {
		const { coverMoment } = await import("../catalog");
		const get = (id: string) => {
			const tp = TEMPLATES.find((x) => x.id === id);
			if (!tp) throw new Error(id);
			return tp;
		};
		// Real-estate: the logo intro fills the frame, so the cover is the price tag (3.6 s + its entrance).
		expect(coverMoment(get("real-estate"))).toBeGreaterThan(3.6);
		// Fitness: the kinetic words play over the workout from the start.
		expect(coverMoment(get("fitness-intro"))).toBeLessThan(3);
		// Wedding: past the leader, on the light leak over the passe-partout (3.4 s + its entrance).
		expect(coverMoment(get("wedding"))).toBeCloseTo(5.6);
	});
});

describe("the card", () => {
	test("coverData: a template's layers are worked out once — text spots and CSS, the motion flag, the length in seconds", async () => {
		const { coverData } = await import("../cover");
		const sale = TEMPLATES.find((tp) => tp.id === "flash-sale");
		const expert = TEMPLATES.find((tp) => tp.id === "expert");
		if (!sale || !expert) throw new Error("missing templates");
		const a = coverData(expert);
		expect(a).toBe(coverData(expert));
		expect(a.texts.length).toBeGreaterThanOrEqual(1);
		for (const text of a.texts) {
			expect(text.content).toBeTruthy();
			expect(text.top).toMatch(/%$/);
			expect(text.style.fontFamily).toBeTruthy();
		}
		expect(coverData(sale).motion).toBe(true);
		expect(coverData(sale).seconds).toBeGreaterThanOrEqual(5);
	});
});
