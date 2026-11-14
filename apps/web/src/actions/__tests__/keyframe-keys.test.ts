import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { ElementAnimations } from "@/animation/types";
import type { MediaTime } from "@/wasm";

// Keyframes had no shortcuts at all: no add at the playhead, no previous / next keyframe, no ease. ⌥K, ⌥; / ⌥',
// F9 (Easy Ease), ⇧F9, ⇧⌘F9, ⌥F9 and ⌃⌥H now work in every preset, and saved keymaps get them too.
let presets: typeof import("@/actions/keybindings/presets");
let migrations: typeof import("@/actions/keybindings/migrations");
let animation: typeof import("@/animation");
let ease: typeof import("@/animation/keyframe-ease");
let params: typeof import("@/params");

beforeAll(async () => {
	await installOpenCutWasm();
	presets = await import("@/actions/keybindings/presets");
	migrations = await import("@/actions/keybindings/migrations");
	animation = await import("@/animation");
	ease = await import("@/animation/keyframe-ease");
	params = await import("@/params");
});

const TPS = 120_000;
const t = (seconds: number) => Math.round(seconds * TPS) as MediaTime;
const OPACITY = { key: "opacity", label: "Opacity", type: "number", default: 1, min: 0, max: 1, step: 0.01 } as const;

function keyed(values: Array<[number, number]>): ElementAnimations | undefined {
	let animations: ElementAnimations | undefined;
	for (const [seconds, value] of values) {
		animations = animation.upsertPathKeyframe({
			animations,
			propertyPath: "opacity",
			time: t(seconds),
			value,
			channelLayout: params.getParamChannelLayout({ param: OPACITY }),
			coerceValue: ({ value: v }) => v,
		});
	}
	return animations;
}
const ids = (animations: ElementAnimations | undefined) =>
	((animations?.opacity as { keys: Array<{ id: string }> }).keys ?? []).map((k) => k.id);
const at = (animations: ElementAnimations | undefined, seconds: number) =>
	animation.resolveAnimationPathValueAtTime({ animations, propertyPath: "opacity", localTime: t(seconds), fallbackValue: 1 });

describe("keyframe shortcuts", () => {
	test("every preset has them on every key the preset does not use itself", () => {
		for (const id of presets.KEYMAP_PRESET_IDS) {
			const own = new Map(presets.KEYMAP_PRESETS[id].table.flatMap(([action, keys]) => keys.map((key) => [key, action] as const)));
			const bindings = presets.getPresetBindings({ preset: id });
			for (const [action, keys] of presets.KEYFRAME_KEYS) {
				for (const key of keys) expect(bindings.get(key)).toBe(own.get(key) ?? action);
			}
		}
		// CapCut: ⌥K is the keyframe panel and ⌥⇧K adds a keyframe.
		const capcut = presets.getPresetBindings({ preset: "capcut" });
		expect(capcut.get("alt+k")).toBe("toggle-keyframe-panel");
		expect(capcut.get("alt+shift+k")).toBe("toggle-keyframe");
	});

	test("a saved keymap gets them; a key the user took for something else stays theirs", () => {
		const state = { keybindings: { "alt+k": "split", space: "toggle-play" }, isCustomized: true, preset: "kadr" };
		const next = migrations.runMigrations({ state, fromVersion: 9 }) as { keybindings: Record<string, string> };
		expect(next.keybindings["alt+k"]).toBe("split");
		expect(next.keybindings["alt+;"]).toBe("previous-keyframe");
		expect(next.keybindings.f9).toBe("keyframe-ease");
		expect(next.keybindings.space).toBe("toggle-play");
	});
});

describe("ease of a keyframe", () => {
	test("Easy Ease: slow out of the key and into the next, the middle unchanged", () => {
		const animations = keyed([[0, 0], [4, 1]]);
		const eased = ease.applyKeyframeEase({ animations, propertyPath: "opacity", keyframeIds: ids(animations), ease: "ease" });
		expect(at(animations, 0.4)).toBeCloseTo(0.1, 6);
		expect(at(eased, 0.4)).toBeLessThan(0.05);
		expect(at(eased, 3.6)).toBeGreaterThan(0.95);
		expect(at(eased, 2)).toBeCloseTo(0.5, 2);
	});

	test("Ease Out on the first key only: slow start, straight arrival", () => {
		const animations = keyed([[0, 0], [4, 1]]);
		const [first] = ids(animations);
		const eased = ease.applyKeyframeEase({ animations, propertyPath: "opacity", keyframeIds: [first], ease: "ease-out" });
		expect(at(eased, 0.4)).toBeLessThan(0.06);
		expect(1 - at(eased, 3.6)).toBeGreaterThan(0.06);
	});

	test("Ease In on the second key after a linear segment eases only the arrival", () => {
		const animations = keyed([[0, 0], [4, 1]]);
		const [, second] = ids(animations);
		const eased = ease.applyKeyframeEase({ animations, propertyPath: "opacity", keyframeIds: [second], ease: "ease-in" });
		expect(at(eased, 3.6)).toBeGreaterThan(0.97);
		expect(at(eased, 0.4)).toBeGreaterThan(0.06);
	});

	test("Hold jumps at the next key; Linear puts the straight line back", () => {
		const animations = keyed([[0, 0], [4, 1]]);
		const all = ids(animations);
		const held = ease.applyKeyframeEase({ animations, propertyPath: "opacity", keyframeIds: all, ease: "hold" });
		expect(at(held, 3.9)).toBe(0);
		expect(at(held, 4)).toBe(1);
		const eased = ease.applyKeyframeEase({ animations, propertyPath: "opacity", keyframeIds: all, ease: "ease" });
		const linear = ease.applyKeyframeEase({ animations: eased, propertyPath: "opacity", keyframeIds: all, ease: "linear" });
		for (const seconds of [0.4, 1, 2, 3.6]) expect(at(linear, seconds)).toBeCloseTo(at(animations, seconds), 6);
	});
});
