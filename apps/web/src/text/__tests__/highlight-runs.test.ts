import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

let buildRuns: typeof import("../primitives").buildRuns;
beforeAll(async () => {
	await installOpenCutWasm();
	({ buildRuns } = await import("../primitives"));
});

// «ECOSYSTEM OR» on one line: word boxes as measureTextLayout gives them (a 20 px space between).
const layout = {
	words: [
		{ line: 0, x: 0, width: 300, text: "ECOSYSTEM", start: 0 },
		{ line: 0, x: 320, width: 60, text: "OR", start: 10 },
		{ line: 1, x: 0, width: 100, text: "NEXT", start: 0 },
	],
	lines: ["ECOSYSTEM OR", "NEXT"],
	lineWidths: [380, 100],
	textAlign: "left",
	block: { alignWidth: 0 },
	charCount: 16,
} as never;

const runs = (scale: number) =>
	buildRuns({ layout, style: { highlight: { mode: "color", color: "#ffd60a", scale, index: 0 } } as never, baseFill: "#fff" });

describe("highlighted word growth", () => {
	test("a 1.1× word pushes its neighbours out instead of eating the space (Hormozi «ECOSYSTEMOR»)", () => {
		const [ecosystem, or, next] = runs(1.1);
		expect(ecosystem.scale).toBe(1.1);
		const drawnRight = ecosystem.x + ecosystem.width / 2 + (ecosystem.width * 1.1) / 2;
		expect(or.x - drawnRight).toBeCloseTo(20, 5);
		expect(next.x).toBe(0);
	});

	test("no growth, no shift", () => {
		expect(runs(1).map((run) => run.x)).toEqual([0, 320, 0]);
	});
});

describe("every caption style keeps «ecosystem or» apart", () => {
	test("the highlighted word never closes the space, whatever the style's mode and scale", async () => {
		const { CAPTION_STYLES } = await import("@/subtitles/styles");
		for (const style of CAPTION_STYLES) {
			const mode = String(style.params["highlight.mode"] ?? "none");
			const scale = Number(style.params["highlight.scale"] ?? 1);
			if (mode === "none" || mode === "karaoke") continue;
			const [ecosystem, or] = buildRuns({ layout, style: { highlight: { mode, color: "#ffd60a", scale, index: 0 } } as never, baseFill: "#fff" });
			if (!or) continue; // pop / reveal hide the words after the active one
			const drawnRight = ecosystem.x + ecosystem.width / 2 + (ecosystem.width * ecosystem.scale) / 2;
			expect({ style: style.id, gap: Math.round(or.x - drawnRight) }).toEqual({ style: style.id, gap: 20 });
		}
	});
});
