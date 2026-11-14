import { beforeAll, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import { cropFillScale, croppedSize, cropForRatio, readCrop, withCrop } from "@/timeline/crop";

let dragCrop: typeof import("@/timeline/components/crop-dialog").dragCrop;
beforeAll(async () => {
	await installOpenCutWasm();
	({ dragCrop } = await import("@/timeline/components/crop-dialog"));
});

// CapCut Crop: the kept part of the frame, stored as fractions in the clip's params.
test("no crop params, or the whole frame, read as no crop; a crop round-trips through the params", () => {
	expect(readCrop({})).toBeNull();
	expect(readCrop(withCrop({ opacity: 1 }, { x: 0, y: 0, width: 1, height: 1 }))).toBeNull();
	const params = withCrop({ opacity: 1 }, { x: 0.25, y: 0.1, width: 0.5, height: 0.8 });
	expect(params.opacity).toBe(1);
	expect(readCrop(params)).toEqual({ x: 0.25, y: 0.1, width: 0.5, height: 0.8 });
	expect(readCrop(withCrop(params, null))).toBeNull();
});

test("a ratio crop is the biggest of that shape, centred", () => {
	// 1280 × 720 → 1:1 keeps 720 × 720 in the middle.
	const square = cropForRatio({ ratio: 1, sourceWidth: 1280, sourceHeight: 720 });
	expect(square.height).toBe(1);
	expect(square.width).toBeCloseTo(720 / 1280, 6);
	expect(square.x).toBeCloseTo((1 - 720 / 1280) / 2, 6);
	const size = croppedSize(1280, 720, square);
	expect(Math.round(size.width)).toBe(720);
	expect(Math.round(size.height)).toBe(720);
});

test("dragging: move stays inside the frame, a corner of a locked shape keeps it", () => {
	const start = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };
	const moved = dragCrop({ start, handle: "move", dx: 0.9, dy: -0.9, lockedRatio: null, sourceRatio: 16 / 9 });
	expect(moved.x).toBeCloseTo(0.6, 6);
	expect(moved.y).toBe(0);
	const square = cropForRatio({ ratio: 1, sourceWidth: 1600, sourceHeight: 900, around: { x: 0.3, y: 0.3, width: 0.3, height: 0.3 } });
	const grown = dragCrop({ start: square, handle: "se", dx: -0.1, dy: 0, lockedRatio: 1, sourceRatio: 16 / 9 });
	expect((grown.width * 1600) / (grown.height * 900)).toBeCloseTo(1, 4);
	const free = dragCrop({ start, handle: "e", dx: 0.1, dy: 0, lockedRatio: null, sourceRatio: 16 / 9 });
	expect(free.width).toBeCloseTo(0.5, 6);
	expect(free.height).toBeCloseTo(0.4, 6);
});

test("Rotate: a straightened whole frame is still a crop; the angle round-trips and stops at ±45°", () => {
	const turned = readCrop(withCrop({}, { x: 0, y: 0, width: 1, height: 1, rotation: 10 }));
	expect(turned).toEqual({ x: 0, y: 0, width: 1, height: 1, rotation: 10 });
	expect(readCrop(withCrop({}, { x: 0, y: 0, width: 1, height: 1, rotation: 0 }))).toBeNull();
	expect(readCrop(withCrop({}, { x: 0.1, y: 0.1, width: 0.5, height: 0.5, rotation: -80 }))?.rotation).toBe(-45);
	// Turning back to 0 removes the key.
	expect(withCrop(withCrop({}, { x: 0.1, y: 0, width: 0.5, height: 1, rotation: 12 }), { x: 0.1, y: 0, width: 0.5, height: 1 })["crop.rotation"]).toBeUndefined();
});

test("Rotate: the picture is enlarged just enough that the upright frame has no empty corner", () => {
	expect(cropFillScale({ rotation: 0, sourceWidth: 1920, sourceHeight: 1080 })).toBe(1);
	expect(cropFillScale({ rotation: 45, sourceWidth: 500, sourceHeight: 500 })).toBeCloseTo(Math.SQRT2, 6);
	for (const [w, h] of [[1920, 1080], [1080, 1920], [800, 800]]) {
		for (const rotation of [-45, -17, 3, 30, 45]) {
			const fill = cropFillScale({ rotation, sourceWidth: w, sourceHeight: h });
			const a = (rotation * Math.PI) / 180;
			let touches = false;
			// Each corner of the frame, taken back into the turned and enlarged picture, lies inside it.
			for (const [cx, cy] of [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]) {
				const px = (cx * Math.cos(-a) - cy * Math.sin(-a)) / fill;
				const py = (cx * Math.sin(-a) + cy * Math.cos(-a)) / fill;
				expect(Math.abs(px)).toBeLessThanOrEqual(w / 2 + 1e-6);
				expect(Math.abs(py)).toBeLessThanOrEqual(h / 2 + 1e-6);
				if (Math.abs(Math.abs(px) - w / 2) < 1e-6 || Math.abs(Math.abs(py) - h / 2) < 1e-6) touches = true;
			}
			// …and not more than needed: some corner touches the picture's edge.
			expect(touches).toBe(true);
		}
	}
});
