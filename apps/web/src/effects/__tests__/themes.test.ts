import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// Effects, transitions and filters by theme (gaming, wedding, food…): every tile has one to three themes, each theme
// shows a full panel (not one tile), and a tile is previewed over its theme's photo.
let themes: typeof import("@/effects/themes");
let effects: Array<{ name: string; category: string; keywords?: string[] }>;
let transitions: Array<{ name: string; category: string }>;
let looks: Array<{ name: string; category: string }>;
const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

beforeAll(async () => {
	await installOpenCutWasm();
	themes = await import("@/effects/themes");
	const { effectsRegistry } = await import("@/effects");
	(await import("@/effects/definitions")).registerDefaultEffects();
	effects = effectsRegistry
		.getAll()
		.filter((e) => !e.hidden)
		.map((e) => ({ name: e.name, category: e.category ?? "Style", keywords: e.keywords }));
	const { LIBRARY_TRANSITIONS } = await import("@/transitions/definitions");
	transitions = LIBRARY_TRANSITIONS.map((d) => ({ name: d.name, category: d.category }));
	const { LOOKS } = await import("@/effects/luts/looks");
	looks = LOOKS.map((l) => ({ name: l.name, category: (l as { category?: string }).category ?? "Life" }));
});

test("every effect, transition and filter has one to three real themes", () => {
	const bad: string[] = [];
	for (const item of [...effects, ...transitions, ...looks]) {
		const list = themes.themesOf(item);
		if (list.length < 1 || list.length > 3 || list.some((t) => !themes.THEMES.includes(t))) bad.push(`${item.name}: ${list.join(",")}`);
	}
	expect(bad).toEqual([]);
});

test("each theme fills the panels: 5+ effects, 5+ transitions, 3+ filters", () => {
	const short: string[] = [];
	for (const theme of themes.THEMES) {
		const count = (list: Array<{ name: string; category: string }>) => list.filter((item) => themes.themesOf(item).includes(theme)).length;
		const counts = [count(effects), count(transitions), count(looks)];
		if (counts[0] < 5 || counts[1] < 5 || counts[2] < 3) short.push(`${theme}: ${counts.join("/")}`);
	}
	expect(short).toEqual([]);
});

test("a name says more than its category: a heart is a wedding, pixels are gaming; every theme photo ships", () => {
	expect(themes.themesOf({ name: "Heart Wipe", category: "Shape" })[0]).toBe("wedding");
	expect(themes.themesOf({ name: "Pixel Art", category: "Retro" })[0]).toBe("gaming");
	expect(themes.previewPhotoFor(["food"], null)).toBe("/mograph/themes/food.jpg");
	expect(themes.previewPhotoFor(["food"], "sports")).toBe("/mograph/themes/sports.jpg");
	for (const theme of themes.THEMES) expect(fs.existsSync(path.join(import.meta.dir, "../../../public/mograph/themes", `${theme}.jpg`))).toBe(true);
});
