import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// canvas-renderer pulls in the compositor bindings: loaded after the wasm shim.
let previewDecodeScale: typeof import("../canvas-renderer").previewDecodeScale;
let capFrameSize: typeof import("@/services/video-cache/service").capFrameSize;
beforeAll(async () => {
	await installOpenCutWasm();
	({ previewDecodeScale } = await import("../canvas-renderer"));
	({ capFrameSize } = await import("@/services/video-cache/service"));
});

const HEADROOM = 1.25;

/** Frame size of a source in the preview: panel picture width (CSS px), preview zoom, screen density. */
function frameFor({ source, canvas, pictureWidth, zoom = 1, dpr = 2 }: {
	source: { width: number; height: number };
	canvas: { width: number; height: number };
	pictureWidth: number;
	zoom?: number;
	dpr?: number;
}) {
	const scale = previewDecodeScale({ sceneWidth: pictureWidth * zoom, canvasWidth: canvas.width, devicePixelRatio: dpr, headroom: HEADROOM });
	return capFrameSize({ ...source, max: { width: Math.round(canvas.width * scale), height: Math.round(canvas.height * scale) } });
}

const K4 = { width: 2160, height: 3840 };
const HD = { width: 1080, height: 1920 };

describe("preview decode size", () => {
	test("4K in a ~460 px tall Fit panel on a Retina screen: 810×1440 instead of 2160×3840", () => {
		expect(frameFor({ source: K4, canvas: K4, pictureWidth: 258 })).toEqual({ width: 810, height: 1440 });
	});

	test("preview zoom 200% doubles the sharpness, 400% reaches full size", () => {
		expect(frameFor({ source: K4, canvas: K4, pictureWidth: 258, zoom: 2 })).toEqual({ width: 1350, height: 2400 });
		expect(frameFor({ source: K4, canvas: K4, pictureWidth: 258, zoom: 4 })).toEqual(K4);
	});

	test("a bigger panel or a denser screen asks for more pixels", () => {
		const small = frameFor({ source: K4, canvas: K4, pictureWidth: 258 });
		const big = frameFor({ source: K4, canvas: K4, pictureWidth: 520 });
		expect(big.width).toBeGreaterThan(small.width);
		expect(frameFor({ source: K4, canvas: K4, pictureWidth: 258, dpr: 1 }).width).toBeLessThan(small.width);
	});

	test("never sharper than the source, never below the screen", () => {
		for (const pictureWidth of [120, 258, 400, 700, 1200]) {
			for (const dpr of [1, 2]) {
				const frame = frameFor({ source: K4, canvas: K4, pictureWidth, dpr });
				expect(frame.width).toBeLessThanOrEqual(K4.width);
				expect(frame.width).toBeGreaterThanOrEqual(Math.min(K4.width, pictureWidth * dpr) - 2);
			}
		}
	});

	test("a 1080p clip in a 1080p project on a big screen stays full size", () => {
		expect(frameFor({ source: HD, canvas: HD, pictureWidth: 600 })).toEqual(HD);
	});

	test("a landscape 4K clip filling a portrait frame keeps its height (cover)", () => {
		const frame = frameFor({ source: { width: 3840, height: 2160 }, canvas: HD, pictureWidth: 258 });
		expect(frame.height).toBeGreaterThanOrEqual(Math.round(HD.height * 0.625) - 2);
	});

	test("steps of 1/8: a small resize keeps the size", () => {
		expect(frameFor({ source: K4, canvas: K4, pictureWidth: 250 })).toEqual(frameFor({ source: K4, canvas: K4, pictureWidth: 258 }));
	});
});
