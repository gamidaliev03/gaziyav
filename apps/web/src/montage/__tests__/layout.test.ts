import { describe, expect, test } from "bun:test";
import { maskSwears } from "../profanity";
import { pinOf, resolveLayout } from "../server/layout";
import type { PlannedLayer } from "../server/plan";

const face = { x: 0.3, y: 0.24, w: 0.5, h: 0.28 };
const run = () => {
	const layers: PlannedLayer[] = [
		{ kind: "HookTitle", from: 0, to: 2.5, props: { text: "ХВАТИТ ЭТИХ\n*ИНФО-ЦЫГАН*", kicker: "честно", y: 0.24 } },
		{ kind: "LowerThird", from: 2.9, to: 6, props: { name: "ТОП-5", x: 0.06, y: 0.17 } },
		{ kind: "Captions", from: 0.2, to: 7.2, props: { y: 0.62 } },
		{ kind: "CTA", from: 5.2, to: 7.2, props: { text: "ЗАБИРАЙ", y: 0.56 } },
	];
	const notes = resolveLayout(layers, face, 608 / 1080);
	return { layers, notes };
};

describe("AI layer layout guard", () => {
	test("hook, CTA and lower third leave the face; captions give way", () => {
		const { layers, notes } = run();
		const [hook, lower, captions, cta] = layers;
		const faceBottom = face.y + face.h;
		// Hook goes below the face, captions start after it.
		expect(Number(hook.props.y)).toBeGreaterThan(faceBottom);
		expect(captions.from).toBeGreaterThanOrEqual(hook.to);
		// CTA off the face and the captions end before it.
		expect(Number(cta.props.y)).toBeGreaterThan(faceBottom);
		expect(captions.to).toBeLessThanOrEqual(cta.from);
		// Lower third (top-left, y 0.17–0.24) already clear of the face's top.
		expect(Number(lower.props.y)).toBeLessThanOrEqual(0.24);
		expect(notes.length).toBeGreaterThan(0);
	});
});

describe("plan defaults", () => {
	test("a lower third without y still blocks the CTA spot", () => {
		const layers: PlannedLayer[] = [
			{ kind: "LowerThird", from: 2.9, to: 5.9, props: { name: "ТОП-5", x: 0.06, y: 0.17 } },
			{ kind: "Captions", from: 0.2, to: 7.2, props: { y: 0.62 } },
			{ kind: "CTA", from: 4.9, to: 7.2, props: { text: "ЗАБИРАЙ", y: 0.2 } },
		];
		resolveLayout(layers, { x: 0.3, y: 0.236, w: 0.5, h: 0.28 }, 608 / 1080);
		const [, captions, cta] = layers;
		const top = Number(cta.props.y) - 0.0325;
		// Not on the lower third (0.17–0.245) while both are on screen.
		expect(top >= 0.245 || top + 0.065 <= 0.17).toBe(true);
		expect(captions.to).toBeLessThanOrEqual(4.9);
	});
});

describe("positions the user asked for", () => {
	test("a hook asked at the top stays above the face and shrinks to fit", () => {
		const layers: PlannedLayer[] = [{ kind: "HookTitle", from: 0, to: 2.5, props: { text: "Хватит этих\n*инфоцыган* с промтами", kicker: "честно", y: 0.24 } }];
		resolveLayout(layers, { x: 0.25, y: 0.24, w: 0.5, h: 0.28 }, 608 / 1080, pinOf("hook сверху"));
		expect(Number(layers[0].props.y)).toBeLessThan(0.24);
		expect(Number(layers[0].props.size)).toBeLessThan(104);
	});
	test("pins are read from the request", () => {
		expect(pinOf("хук снизу")).toBe("bottom");
		expect(pinOf("Hook at the top")).toBe("top");
		expect(pinOf("сделай анимацию карты")).toBe(null);
	});
});

describe("swear words", () => {
	test("are masked, ordinary words are not", () => {
		expect(maskSwears("всех *заебали* уже")).toBe("всех *за••••и* уже");
		expect(maskSwears("небо хлеб учеба обед сукно")).toBe("небо хлеб учеба обед сукно");
	});
});
