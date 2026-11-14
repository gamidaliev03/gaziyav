import { describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

await installOpenCutWasm();
const { getTextVisualRect } = await import("../layout");
const { drawMeasuredTextLayout, measureTextLayout } = await import("../primitives");

// Left / Right move the lines inside the wrap box and the box stays centred on the anchor (as in CapCut); text without
// a box keeps aligning at the anchor (subtitles are positioned for that).
const background = { enabled: false, color: "transparent" } as Parameters<typeof getTextVisualRect>[0]["background"];
const rect = (textAlign: "left" | "center" | "right", alignWidth?: number) =>
	getTextVisualRect({ textAlign, background, block: { visualCenterOffset: 0, height: 20, maxWidth: 40, alignWidth } });

describe("text alignment", () => {
	test("in a wrap box the block stays inside the box", () => {
		expect(rect("left", 100).left).toBe(-50);
		expect(rect("center", 100).left).toBe(-20);
		expect(rect("right", 100).left + rect("right", 100).width).toBe(50);
	});

	test("without a box Left / Right align at the anchor as before", () => {
		expect(rect("left").left).toBe(0);
		expect(rect("right").left).toBe(-40);
		expect(rect("center").left).toBe(-20);
	});
});

// The lines as they are drawn (a canvas that records fillText): Left starts every line at the box's left edge, Right
// ends it at the box's right edge.
describe("text alignment when drawn", () => {
	const fakeCanvas = () => {
		const drawn: Array<{ text: string; x: number }> = [];
		const store: Record<string | symbol, unknown> = {
			measureText: (text: string) => ({ width: text.length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, fontBoundingBoxAscent: 9, fontBoundingBoxDescent: 3, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * 10 }),
			fillText: (text: string, x: number) => drawn.push({ text, x }),
		};
		const ctx = new Proxy(store, {
			get: (target, key) => (key in target ? target[key] : () => {}),
			set: (target, key, value) => {
				target[key] = value;
				return true;
			},
		});
		return { ctx, drawn };
	};
	const draw = (textAlign: "left" | "right") => {
		const { ctx, drawn } = fakeCanvas();
		const layout = measureTextLayout({
			text: { content: "aa bbbb cc dddddd", fontSize: 5, fontFamily: "Inter", fontWeight: "normal", fontStyle: "normal", textAlign, boxWidth: 120 },
			canvasHeight: 1000,
			ctx: ctx as never,
		});
		drawMeasuredTextLayout({ ctx: ctx as never, layout, textColor: "#fff" });
		return drawn.filter((d) => d.text.trim());
	};

	test("Left: every line starts at the box's left edge", () => {
		const lines = draw("left");
		expect(lines.length).toBeGreaterThan(1);
		for (const line of lines) expect(line.x).toBe(-60);
	});

	test("Right: every line ends at the box's right edge", () => {
		const lines = draw("right");
		expect(lines.length).toBeGreaterThan(1);
		for (const line of lines) expect(line.x + line.text.length * 10).toBe(60);
	});
});
