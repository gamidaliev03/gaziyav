import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

let geo: typeof import("../markup-geometry");
let zones: typeof import("../markup-zones");
let store: typeof import("../markup-store");
let live: typeof import("../markup-live");
let snap: typeof import("@/preview/preview-snap");
beforeAll(async () => {
	await installOpenCutWasm();
	geo = await import("../markup-geometry");
	zones = await import("../markup-zones");
	store = await import("../markup-store");
	live = await import("../markup-live");
	snap = await import("@/preview/preview-snap");
});

const ALL = ["social", "broadcast", "text", "thirds"] as const;
const byId = (list: ReturnType<typeof geo.markupGuides>, id: string) => list.find((g) => g.id === id)!.rect;

describe("markup zones", () => {
	test("the 9:16 union is the largest band of every platform per side", () => {
		const u = geo.VERTICAL_UNION;
		expect([u.top, u.bottom, u.left, u.right]).toEqual([0.15, 0.35, 0.06, 0.18]);
		for (const p of zones.VERTICAL_PLATFORMS) {
			expect(u.top).toBeGreaterThanOrEqual(p.top);
			expect(u.bottom).toBeGreaterThanOrEqual(p.bottom);
			expect(u.left).toBeGreaterThanOrEqual(p.left);
			expect(u.right).toBeGreaterThanOrEqual(p.right);
		}
	});

	test("9:16 1080×1920: union bands and TikTok's safe rectangle in px", () => {
		const c = { width: 1080, height: 1920 };
		const g = geo.markupGuides({ aspect: "9:16", canvas: c, layers: ["social"] });
		expect(byId(g, "social-top")).toEqual({ x: 0, y: 0, w: 1080, h: 288 });
		expect(byId(g, "social-bottom")).toEqual({ x: 0, y: 1248, w: 1080, h: 672 });
		expect(byId(g, "social-right").x).toBeCloseTo(885.6, 6);
		expect(byId(g, "social-safe").w).toBeCloseTo(1080 * (1 - 0.06 - 0.18), 6);
		const t = geo.socialSafeRect("9:16", c, "tiktok")!;
		expect([Math.round(t.left), Math.round(t.top), Math.round(t.right), Math.round(t.bottom)]).toEqual([60, 221, 940, 1440]);
	});

	test("16:9: YouTube's title row and controls, the end screen", () => {
		const c = { width: 1920, height: 1080 };
		const g = geo.markupGuides({ aspect: "16:9", canvas: c, layers: ["social"] });
		expect(byId(g, "social-top").h).toBeCloseTo(129.6, 6);
		expect(byId(g, "social-bottom").y).toBeCloseTo(1080 - 129.6, 6);
		expect(g.some((x) => x.id === "social-left" || x.id === "social-right")).toBe(false);
		const e = byId(g, "social-endscreen");
		expect([e.x, e.y]).toEqual([1920 * 0.06, 1080 * 0.22]);
	});

	test("1:1 and 4:5: the 3:4 grid crop and the feed's icons", () => {
		const sq = geo.markupGuides({ aspect: "1:1", canvas: { width: 1080, height: 1080 }, layers: ["social"] });
		expect(byId(sq, "social-left").w).toBeCloseTo(135, 6); // (1 − 0.75) / 2 of 1080
		expect(byId(sq, "social-safe").w).toBeCloseTo(810, 6); // 3:4 of the height
		const p = geo.markupGuides({ aspect: "4:5", canvas: { width: 1080, height: 1350 }, layers: ["social"] });
		expect(byId(p, "social-safe").w / 1350).toBeCloseTo(0.75, 9);
		expect(byId(p, "social-bottom").h).toBeCloseTo(135, 6);
	});

	test("TV safe: action 93 %, title 90 %, centred; the cross at the centre", () => {
		const c = { width: 1920, height: 1080 };
		const g = geo.markupGuides({ aspect: "16:9", canvas: c, layers: ["broadcast"] });
		const a = byId(g, "broadcast-action");
		expect(a.x).toBeCloseTo(67.2, 6);
		expect(a.w).toBeCloseTo(1785.6, 6);
		expect(a.h).toBeCloseTo(1004.4, 6);
		const t = byId(g, "broadcast-title");
		expect([t.x, t.y, t.w, t.h]).toEqual([96, 54, 1728, 972]);
		const x = byId(g, "broadcast-cross");
		expect(x.x + x.w / 2).toBe(960);
		expect(x.y + x.h / 2).toBe(540);
	});

	test("subtitles sit where captions land: 0.59 H tall, 0.82 H wide", () => {
		const tall = live.subtitlePlacement({ width: 1080, height: 1920 }, "en");
		expect(960 + tall.centerY).toBe(Math.round(0.59 * 1920));
		const wide = live.subtitlePlacement({ width: 1920, height: 1080 }, "ru");
		expect(540 + wide.centerY).toBe(Math.round(0.82 * 1080));
		const g = geo.markupGuides({ aspect: "9:16", canvas: { width: 1080, height: 1920 }, layers: ["text"], subtitle: tall });
		const s = byId(g, "text-subtitles");
		expect(s.y + s.h / 2).toBe(Math.round(0.59 * 1920));
		expect(byId(g, "text-lower-third").y).toBe(1280);
	});

	test("thirds and centre lines", () => {
		const g = geo.markupGuides({ aspect: "1:1", canvas: { width: 1080, height: 1080 }, layers: ["thirds"] });
		expect(g.filter((x) => x.kind === "line").map((x) => (x.rect.w === 0 ? x.rect.x : x.rect.y)).sort((a, b) => a - b)).toEqual([360, 360, 540, 540, 720, 720]);
	});

	test("a custom shape has no social frame", () => {
		expect(geo.markupGuides({ aspect: "custom", canvas: { width: 1440, height: 1080 }, layers: ALL }).some((g) => g.layer === "social")).toBe(false);
	});
});

describe("markup snapping", () => {
	test("the targets are the visible guides' edges and centres, frame edges left out", () => {
		const c = { width: 1920, height: 1080 };
		const t = geo.guideSnapTargets(geo.markupGuides({ aspect: "16:9", canvas: c, layers: ["broadcast"] }), c);
		expect(t.x).toContain(96 - 960);
		expect(t.x).toContain(1824 - 960);
		expect(t.y).toContain(54 - 540);
		expect(t.x).not.toContain(0);
	});

	test("a dragged box snaps its edge onto title safe", () => {
		const c = { width: 1920, height: 1080 };
		const extraTargets = geo.guideSnapTargets(geo.markupGuides({ aspect: "16:9", canvas: c, layers: ["broadcast"] }), c);
		// a 200 px wide box whose left edge is 3 px right of title safe's left (x = 96 → −864 from the centre)
		const proposed = { x: -864 + 100 + 3, y: 100 };
		const r = snap.snapPosition({ proposedPosition: proposed, canvasSize: c, elementSize: { width: 200, height: 100 }, snapThreshold: { x: 8, y: 8 }, extraTargets });
		expect(r.snappedPosition.x).toBe(-764);
		const none = snap.snapPosition({ proposedPosition: proposed, canvasSize: c, elementSize: { width: 200, height: 100 }, snapThreshold: { x: 8, y: 8 } });
		expect(none.snappedPosition.x).toBe(proposed.x);
	});
});

describe("markup memory", () => {
	test("per aspect, through storage, and the old 9:16 choice carries over", () => {
		const mem = new Map<string, string>();
		const storage = { getItem: (k: string) => mem.get(k) ?? null };
		expect(store.readSavedMarkup(storage)).toEqual({});
		mem.set("gaziyav.preview.safeZones", JSON.stringify({ zone: "tiktok", warn: true }));
		expect(store.readSavedMarkup(storage)["9:16"]).toEqual({ on: true, layers: ["social"], platform: "tiktok", labels: true });
		mem.set(store.MARKUP_STORE_KEY, JSON.stringify({ "16:9": { on: true, layers: ["thirds", "broadcast", "junk"], platform: "x", labels: false } }));
		expect(store.readSavedMarkup(storage)).toEqual({ "16:9": { on: true, layers: ["broadcast", "thirds"], platform: "all", labels: false } });
	});

	test("the key flips this aspect only; a layer picked turns the guides on", () => {
		store.useMarkup.setState({ byAspect: {} });
		store.toggleMarkup("9:16");
		expect(store.markupFor("9:16")).toMatchObject({ on: true, layers: ["social"] });
		expect(store.markupFor("16:9").on).toBe(false);
		store.toggleMarkupLayer("16:9", "thirds");
		expect(store.markupFor("16:9")).toMatchObject({ on: true, layers: ["social", "thirds"] });
		store.toggleMarkup("9:16");
		expect(store.markupFor("9:16")).toMatchObject({ on: false, layers: ["social"] });
		expect(live.liveMarkupGuides({ width: 1080, height: 1920 }, "en")).toEqual([]);
	});
});

describe("markup key", () => {
	test("⇧⌘; is free in every preset and lands on toggle-markup", async () => {
		const presets = await import("@/actions/keybindings/presets");
		for (const id of presets.KEYMAP_PRESET_IDS) {
			expect(presets.KEYMAP_PRESETS[id].table.some(([, keys]) => keys.includes("shift+cmd+;"))).toBe(false);
			expect(presets.getPresetBindings({ preset: id }).get("shift+cmd+;")).toBe("toggle-markup");
		}
	});
});
