import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

let ROTATION_HANDLE_OFFSET: number;
let ROTATION_HANDLE_RADIUS: number;
let placeRotationHandle: typeof import("@/preview/rotation-handle").placeRotationHandle;

beforeAll(async () => {
	await installOpenCutWasm();
	({ ROTATION_HANDLE_OFFSET } = await import("@/preview/element-bounds"));
	({ placeRotationHandle, ROTATION_HANDLE_RADIUS } = await import("@/preview/rotation-handle"));
});

// A clip that fills the frame in Fit left the rotation handle 24 px above the frame, cut off by the panel's top.
describe("preview: the rotation handle stays where it can be grabbed", () => {
	const frame = (top: number, bottom: number) => ({ up: { x: 100, y: top }, down: { x: 100, y: bottom } });

	test("room above the frame: above the top edge", () => {
		expect(placeRotationHandle({ ...frame(80, 300), angleRad: 0, viewportHeight: 400 })).toEqual({
			x: 100,
			y: 80 - ROTATION_HANDLE_OFFSET,
		});
	});

	test("no room above, room below: under the bottom edge", () => {
		expect(placeRotationHandle({ ...frame(20, 300), angleRad: 0, viewportHeight: 400 })).toEqual({
			x: 100,
			y: 300 + ROTATION_HANDLE_OFFSET,
		});
	});

	test("no room on either side: just inside the top edge", () => {
		const point = placeRotationHandle({ ...frame(20, 440), angleRad: 0, viewportHeight: 459 });
		expect(point).toEqual({ x: 100, y: 20 + ROTATION_HANDLE_OFFSET });
		expect(point.y - ROTATION_HANDLE_RADIUS).toBeGreaterThanOrEqual(0);
	});

	test("a rotated clip keeps the handle on its own up axis", () => {
		const point = placeRotationHandle({ ...frame(200, 300), angleRad: Math.PI / 2, viewportHeight: 600 });
		expect(point.x).toBeCloseTo(100 + ROTATION_HANDLE_OFFSET);
		expect(point.y).toBeCloseTo(200);
	});
});
