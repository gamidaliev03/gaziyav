import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { TimelineElement } from "@/timeline";

// The params registry loads the wasm bindings: imported after the shim.
let getElementParam: typeof import("@/params/registry").getElementParam;
let M: typeof import("../layer-shadow");
beforeAll(async () => {
	await installOpenCutWasm();
	({ getElementParam } = await import("@/params/registry"));
	M = await import("../layer-shadow");
});

const on = (extra: Record<string, unknown> = {}) => ({ "shadow.enabled": true, ...extra }) as Record<string, number | string | boolean>;

describe("layer drop shadow: params → shadow", () => {
	test("off (or fully transparent) draws nothing", () => {
		expect(M.readLayerShadow({})).toBeNull();
		expect(M.readLayerShadow({ "shadow.enabled": false, "shadow.opacity": 80 })).toBeNull();
		expect(M.readLayerShadow(on({ "shadow.opacity": 0 }))).toBeNull();
	});

	test("on: the defaults, in fractions", () => {
		expect(M.readLayerShadow(on())).toEqual({ color: [0, 0, 0], opacity: 0.6, blur: 0.06, distance: 0.04, angle: 45, spread: 0 });
		const custom = M.readLayerShadow(on({ "shadow.color": "#ff8000", "shadow.opacity": 100, "shadow.blur": 10, "shadow.distance": 20, "shadow.angle": 90, "shadow.spread": 95 }));
		expect(custom?.color[0]).toBe(1);
		expect(custom?.color[1]).toBeCloseTo(128 / 255);
		expect(custom).toMatchObject({ opacity: 1, blur: 0.1, distance: 0.2, angle: 90, spread: 0.9 });
		expect(M.parseHexColor("#fff")).toEqual([1, 1, 1]);
		expect(M.parseHexColor("rgba(1,2,3)")).toEqual([0, 0, 0]);
	});

	test("distance and blur follow the layer's shorter side; the angle is where the shadow falls", () => {
		const shadow = M.readLayerShadow(on({ "shadow.distance": 10, "shadow.blur": 20, "shadow.angle": 0 }));
		if (!shadow) throw new Error("no shadow");
		expect(M.shadowGeometry(shadow, { width: 800, height: 400 })).toMatchObject({ dx: 40, sigma: 40 });
		expect(M.shadowGeometry(shadow, { width: 800, height: 400 }).dy).toBeCloseTo(0);
		const down = M.shadowGeometry({ ...shadow, angle: 90 }, { width: 400, height: 400 });
		expect(down.dx).toBeCloseTo(0);
		expect(down.dy).toBeCloseTo(40);
		const upLeft = M.shadowGeometry({ ...shadow, angle: -135 }, { width: 400, height: 400 });
		expect(upLeft.dx).toBeLessThan(0);
		expect(upLeft.dy).toBeLessThan(0);
	});

	test("one pass group: cast (offset in uv), blur, then the layer over its shadow", () => {
		const shadow = M.readLayerShadow(on({ "shadow.distance": 10, "shadow.angle": 0, "shadow.opacity": 50 }));
		if (!shadow) throw new Error("no shadow");
		const groups = M.shadowPassGroups({ shadow, layer: { width: 1000, height: 500 }, canvas: { width: 1920, height: 1080 } });
		expect(groups).toHaveLength(1);
		const [cast, ...rest] = groups[0];
		const composite = rest.at(-1);
		expect(cast.shader).toBe(M.SHADOW_CAST_SHADER);
		expect((cast.uniforms.u_params as number[])[0]).toBeCloseTo(50 / 1920);
		expect(composite?.shader).toBe(M.SHADOW_COMPOSITE_SHADER);
		expect((composite?.uniforms.u_params as number[])[0]).toBe(0.5);
		expect(rest.length).toBeGreaterThan(1); // blurred
		const sharp = M.shadowPassGroups({ shadow: { ...shadow, blur: 0 }, layer: { width: 1000, height: 500 }, canvas: { width: 1920, height: 1080 } });
		expect(sharp[0]).toHaveLength(2);
	});

	test("the layers have the params; a text keeps its own shadow", () => {
		for (const type of ["video", "image", "sticker", "graphic"]) {
			const element = { type, params: {} } as unknown as TimelineElement;
			for (const param of M.LAYER_SHADOW_PARAMS) expect(getElementParam({ element, key: param.key })?.key).toBe(param.key);
		}
		const text = { type: "text", params: {} } as unknown as TimelineElement;
		expect(getElementParam({ element: text, key: "shadow.blur" })?.label).toBe("Shadow blur, % of size");
		expect(getElementParam({ element: text, key: "shadow.distance" })).toBeNull();
		expect(getElementParam({ element: { type: "audio", params: {} } as unknown as TimelineElement, key: "shadow.enabled" })).toBeNull();
	});
});
