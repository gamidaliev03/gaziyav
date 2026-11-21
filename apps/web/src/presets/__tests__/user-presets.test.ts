import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// The user's presets: what the profile holds, made by Gaziyav AI or saved from the timeline, and put back on it.
let store: typeof import("@/presets/user-presets");
let actions: typeof import("@/presets/actions");
let style: typeof import("@/subtitles/user-style");

beforeAll(async () => {
	await installOpenCutWasm();
	store = await import("@/presets/user-presets");
	actions = await import("@/presets/actions");
	style = await import("@/subtitles/user-style");
});

const accent = { id: "clean", accent: "#5B8CFF" };

describe("stored presets", () => {
	test("unreadable entries are left out, the rest is kept", () => {
		const raw = JSON.stringify({
			text: [
				{ id: "user-1", name: "Neon", type: "layers", layers: [{ kind: "Plate", from: 0, to: 3, props: { text: "Hi" } }], duration: 3 },
				{ id: "user-2", name: "Broken", type: "layers", layers: "nope" },
				{ id: "user-3", name: "Title", type: "text", content: "Hey", params: { color: "#fff" }, x: 0, y: 0, canvasHeight: 1920, duration: 3 },
			],
			captions: [{ id: "hormozi", name: "Not mine", params: {}, limits: {} }, { id: "user-4", name: "Yellow", params: {}, limits: { maxWords: 3, maxChars: 18 } }],
		});
		const lists = store.parseStoredPresets(raw);
		expect(lists.text.map((p) => p.id)).toEqual(["user-1", "user-3"]);
		expect(lists.captions.map((s) => s.id)).toEqual(["user-4"]);
		expect(store.parseStoredPresets("{not json")).toEqual({ text: [], captions: [] });
	});

	test("newest first; a deleted one comes back where it was", () => {
		const s = store.useUserPresets.getState();
		for (const id of ["user-a", "user-b", "user-c"]) {
			s.addText({ id, name: id, type: "layers", layers: [], duration: 1, createdAt: 0 });
		}
		expect(store.useUserPresets.getState().text.slice(0, 3).map((p) => p.id)).toEqual(["user-c", "user-b", "user-a"]);
		const removed = store.useUserPresets.getState().remove("text", "user-b");
		expect(removed?.index).toBe(1);
		expect(store.useUserPresets.getState().text.some((p) => p.id === "user-b")).toBe(false);
		if (removed) store.useUserPresets.getState().restore("text", removed.item, removed.index);
		expect(store.useUserPresets.getState().text.slice(0, 3).map((p) => p.id)).toEqual(["user-c", "user-b", "user-a"]);
	});
});

describe("a preset Gaziyav AI designed", () => {
	test("its layers start at 0, captions and speech words are not kept, the style comes along", () => {
		const preset = actions.presetFromPlan({
			layers: [
				{ kind: "Captions", from: 1, to: 5, props: { maxWords: 3 } },
				{ kind: "Plate", from: 1.5, to: 4.5, props: { text: "Big *sale*", words: "[]" } },
				{ kind: "Badge", from: 2, to: 4, props: { text: "-50%" } },
			],
			description: "a sale plate",
			style: accent,
			id: "user-x",
			now: 7,
		});
		expect(preset?.layers.map((l) => [l.kind, l.from, l.to])).toEqual([
			["Plate", 0, 3],
			["Badge", 0.5, 2.5],
		]);
		expect(preset?.layers[0].props).toEqual({ accent: "#5B8CFF", style: "clean", text: "Big *sale*" });
		expect(preset?.duration).toBe(3);
		expect(preset?.name).toBe("Big sale");
	});

	test("nothing to keep → null; no text → the description names it", () => {
		expect(actions.presetFromPlan({ layers: [{ kind: "Captions", from: 0, to: 3, props: {} }], description: "x", style: accent })).toBeNull();
		expect(actions.presetName({ layers: [{ kind: "Custom", from: 0, to: 1, props: { component: "Glow", js: "…" } }], description: "neon glowing lower third please" })).toBe("neon glowing lower");
	});

	test("on the timeline its layers keep their offsets from the playhead", () => {
		const preset = actions.presetFromPlan({
			layers: [
				{ kind: "Plate", from: 0, to: 3, props: { text: "Hi" } },
				{ kind: "Badge", from: 0.5, to: 2.5, props: { text: "1" } },
			],
			description: "",
			style: accent,
		});
		const clips = preset ? actions.layerClips(preset, 10) : [];
		expect(clips.map((c) => [c.definitionId, c.startTime / 120000, c.duration / 120000])).toEqual([
			["ai.Plate", 10, 3],
			["ai.Badge", 10.5, 2],
		]);
		// The kit's layout defaults (position, size) are filled in under the preset's own props.
		expect(clips[0].params.text).toBe("Hi");
		expect(typeof clips[0].params.y).toBe("number");
	});
});

describe("a preset saved from the timeline", () => {
	const ai = (id: string, kind: string, start: number, dur: number, params: Record<string, unknown>) =>
		({ id, type: "graphic", name: `${kind} · x`, definitionId: `ai.${kind}`, startTime: start * 120000, duration: dur * 120000, trimStart: 0, trimEnd: 0, params }) as never;

	test("AI layers keep their relative times, not the clip's transform or words", () => {
		const preset = actions.presetFromClips({
			elements: [ai("a", "Plate", 4, 3, { text: "Offer", "transform.positionX": 50, words: "[]" }), ai("b", "Sticker", 5, 2, { emoji: "🔥" })],
			canvas: { width: 1080, height: 1920 },
			id: "user-t",
		});
		expect(preset?.type).toBe("layers");
		if (preset?.type !== "layers") return;
		expect(preset.layers.map((l) => [l.kind, l.from, l.to])).toEqual([
			["Plate", 0, 3],
			["Sticker", 1, 3],
		]);
		expect(preset.layers[0].props).toEqual({ text: "Offer" });
	});

	test("a title keeps its look and its place on the frame, as shares", () => {
		const text = {
			id: "t",
			type: "text",
			name: "Title",
			startTime: 0,
			duration: 3 * 120000,
			trimStart: 0,
			trimEnd: 0,
			params: { content: "Hello\nworld", color: "#ff0000", "transform.positionX": 108, "transform.positionY": -384, "background.paddingX": 40 },
		} as never;
		const preset = actions.presetFromClips({ elements: [text], canvas: { width: 1080, height: 1920 }, id: "user-s" });
		expect(preset?.type).toBe("text");
		if (preset?.type !== "text") return;
		expect([preset.x, preset.y, preset.duration, preset.content]).toEqual([0.1, -0.2, 3, "Hello\nworld"]);
		expect(preset.params).toEqual({ color: "#ff0000", "background.paddingX": 40 });
		// On a frame half as tall the plate padding (canvas pixels) halves.
		expect(actions.textPresetOf(preset, 960).params["background.paddingX"]).toBe(20);
	});
});

describe("a caption style Gaziyav AI designed", () => {
	test("only known keys, within range, with a bundled font", () => {
		const made = style.captionStyleFromAnswer({
			answer: {
				name: "Жёлтый поп",
				maxWords: 12,
				fontFamily: "Comic Sans",
				fontWeight: 950,
				fontSize: 40,
				color: "yellow",
				stroke: { color: "#000", width: 99 },
				highlight: { mode: "pop", color: "#22ff88", scale: 3 },
				animIn: "explode",
				evil: "<script>",
			},
			id: "user-c1",
			description: "yellow pop",
			now: 1,
		});
		expect(made.limits.maxWords).toBe(7);
		expect(made.params.fontFamily).toBe("Montserrat");
		expect(made.params.fontWeight).toBe("800");
		expect(made.params.fontSize).toBe(6.5);
		expect(made.params.color).toBe("#ffffff");
		expect(made.params["stroke.width"]).toBe(5);
		expect(made.params["highlight.mode"]).toBe("pop");
		expect(made.params["highlight.scale"]).toBe(1.25);
		expect(made.params["anim.in"]).toBe("none");
		expect("evil" in made.params).toBe(false);
		expect(made.name).toBe("Жёлтый поп");
	});

	test("captions find a user style by its id; a deleted one falls back to the first built-in", async () => {
		const styles = await import("@/subtitles/styles");
		const made = style.captionStyleFromAnswer({ answer: { name: "Mine", fontFamily: "Rubik" }, id: "user-cap", description: "x" });
		store.useUserPresets.getState().addCaption(made);
		expect(styles.getCaptionStyle("user-cap").name).toBe("Mine");
		expect(styles.getCaptionStyle("user-cap").params.fontFamily).toBe("Rubik");
		store.useUserPresets.getState().remove("captions", "user-cap");
		expect(styles.getCaptionStyle("user-cap").id).toBe("hormozi");
	});

	test("an answer wrapped in prose still reads; garbage says so", () => {
		expect(style.parseModelJson('Here you go:\n```json\n{"name":"A"}\n```')).toEqual({ name: "A" });
		expect(() => style.parseModelJson("no json at all")).toThrow("nothing was changed");
	});
});
