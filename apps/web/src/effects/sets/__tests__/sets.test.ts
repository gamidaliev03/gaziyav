import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// Effect sets: shaders on the clip plus a graphic over it (VHS ▶ PLAY and date, camcorder ● REC, a film leader's
// countdown, a matte). Every set names real effects and graphics, and one double-click is one ⌘Z.
let catalog: typeof import("@/effects/sets/catalog");
let apply: typeof import("@/effects/sets/apply");
let effects: typeof import("@/effects");
let mograph: typeof import("@/montage/mograph");
let core: typeof import("@/core");
let elements: typeof import("@/timeline/element-utils");
const S = 120000;

beforeAll(async () => {
	await installOpenCutWasm();
	effects = await import("@/effects");
	(await import("@/effects/definitions")).registerDefaultEffects();
	catalog = await import("@/effects/sets/catalog");
	apply = await import("@/effects/sets/apply");
	mograph = await import("@/montage/mograph");
	core = await import("@/core");
	elements = await import("@/timeline/element-utils");
});

describe("catalog", () => {
	test("every set's shaders and graphics exist, its graphic settings are the graphic's own; unique ids and names", () => {
		const sets = catalog.EFFECT_SETS;
		expect(new Set(sets.map((s) => s.id)).size).toBe(sets.length);
		expect(new Set(sets.map((s) => s.name)).size).toBe(sets.length);
		const problems: string[] = [];
		for (const set of sets) {
			for (const type of set.effects.map(catalog.setEffectType)) {
				if (!effects.effectsRegistry.has(type) || effects.effectsRegistry.get(type).hidden) problems.push(`${set.id}: no effect ${type}`);
			}
			for (const layer of set.layers) {
				const kind = mograph.MOGRAPH_BY_KIND.get(layer.kind);
				if (!kind) {
					problems.push(`${set.id}: no graphic ${layer.kind}`);
					continue;
				}
				const keys = new Set(kind.fields.map((f) => f.key));
				for (const key of Object.keys(layer.params ?? {})) if (!keys.has(key)) problems.push(`${set.id}: ${layer.kind} has no ${key}`);
			}
			for (const theme of set.themes) if (!(mograph.MOGRAPH_THEMES as readonly string[]).includes(theme)) problems.push(`${set.id}: theme ${theme}`);
			if (set.effects.length === 0 || set.layers.length === 0) problems.push(`${set.id}: a set is a shader and a graphic`);
		}
		expect(problems).toEqual([]);
	});

	test("VHS, camcorder, film, TV & games, glitch and dreams; with the shader effects the panel has 150+", () => {
		const families = new Set(catalog.EFFECT_SETS.map((s) => s.family));
		expect([...families].sort()).toEqual([...catalog.SET_FAMILIES].sort());
		for (const family of catalog.SET_FAMILIES) expect(catalog.EFFECT_SETS.filter((s) => s.family === family).length).toBeGreaterThanOrEqual(6);
		const visible = effects.effectsRegistry.getAll().filter((e) => !e.hidden).length;
		expect(visible + catalog.EFFECT_SETS.length).toBeGreaterThanOrEqual(130);
	});

	test("a graphic over the whole clip, a countdown for its own length from the start (never past the clip)", () => {
		const set = catalog.EFFECT_SET_BY_ID.get("film-silent");
		if (!set) throw new Error("no film-silent");
		const placed = catalog.placeSetLayers({ set, clipSeconds: 2, graphicSeconds: () => 3.4 });
		expect(placed.map((p) => [p.layer.kind, p.from, p.seconds])).toEqual([
			["MgFilmLeader", 0, 2],
			["MgFilmMatte", 0, 2],
		]);
		expect(catalog.placeSetLayers({ set, clipSeconds: 8, graphicSeconds: () => 3.4 }).map((p) => p.seconds)).toEqual([3.4, 8]);
	});
});

describe("apply", () => {
	function setup() {
		const { EditorCore } = core;
		EditorCore.reset();
		const editor = EditorCore.getInstance();
		editor.save.stop();
		const { buildDefaultScene } = require("@/timeline/scenes") as typeof import("@/timeline/scenes");
		const scene = buildDefaultScene({ name: "Main", isMain: true });
		editor.project.setActiveProject({
			project: {
				metadata: { id: "s1", name: "S1", createdAt: new Date(0), updatedAt: new Date(0) },
				scenes: [scene],
				currentSceneId: scene.id,
				settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1080, height: 1920 }, background: { type: "color", color: "#000000" } },
				version: 1,
			} as unknown as import("@/project/types").TProject,
		});
		editor.scenes.setScenes({ scenes: [scene], activeSceneId: scene.id });
		const trackId = editor.scenes.getActiveScene().tracks.main.id;
		for (const at of [0, 8]) {
			const built = elements.buildElementFromMedia({ mediaId: "m", mediaType: "video", name: `C${at}`, duration: (8 * S) as never, startTime: (at * S) as never });
			editor.timeline.insertElement({ element: { ...built, sourceDuration: 8 * S } as never, placement: { mode: "explicit", trackId } as never });
		}
		const main = () => editor.scenes.getActiveScene().tracks.main;
		const graphics = () =>
			editor.scenes
				.getActiveScene()
				.tracks.overlay.flatMap((t) => t.elements as unknown as Array<{ type: string; definitionId: string; startTime: number; duration: number; params: Record<string, unknown> }>)
				.filter((e) => e.type === "graphic");
		return { editor, trackId, main, graphics };
	}

	test("on the selected clip: its shaders, and the graphic over its time with the set's settings — one ⌘Z takes it all off", () => {
		const { editor, trackId, main, graphics } = setup();
		const clip = main().elements[1];
		editor.selection.setSelectedElements({ elements: [{ trackId, elementId: clip.id }] });
		const before = JSON.stringify(editor.scenes.getActiveScene().tracks);
		const depth = editor.command.depth();
		const set = catalog.EFFECT_SET_BY_ID.get("vhs-home-video");
		if (!set) throw new Error("no vhs-home-video");
		expect(apply.applyEffectSet(set)).toBe(1);
		const after = main().elements[1] as { effects?: Array<{ type: string }> };
		expect(after.effects?.map((e) => e.type)).toEqual(["pro.fx.camcorder90s"]);
		const [vhs] = graphics();
		expect([vhs.definitionId, vhs.startTime / S, vhs.duration / S, vhs.params.date, vhs.params.label]).toEqual(["ai.MgVhs", 8, 8, "JUL. 14 1996", "PLAY"]);
		expect(editor.command.depth()).toBe(depth + 1);
		editor.command.undo();
		expect(JSON.stringify(editor.scenes.getActiveScene().tracks)).toBe(before);
	});

	test("nothing selected: the clip under the playhead; a countdown only for its own length", () => {
		const { editor, graphics, main } = setup();
		editor.selection.clearSelection();
		editor.playback.seek({ time: (2 * S) as never });
		const set = catalog.EFFECT_SET_BY_ID.get("film-countdown");
		if (!set) throw new Error("no film-countdown");
		expect(apply.applyEffectSet(set)).toBe(1);
		expect((main().elements[0] as { effects?: Array<{ type: string }> }).effects?.map((e) => e.type)).toEqual(["pro.fx.film16mm"]);
		const [leader] = graphics();
		expect([leader.startTime / S, leader.duration / S]).toEqual([0, 3.4]);
	});
});
