// Drop shadow of a layer (video, photo, sticker, shape, AI layer): the same `shadow.*` params as a text's shadow
// (enabled, color, blur) plus opacity, distance, angle and spread. It follows the layer's alpha after its effects and
// its mask (a shape's form, a cut-out subject, a plain video's rectangle), is drawn under the layer in the layer's own
// full-canvas texture (so it can reach past the layer's bounds) and moves with its transform, keyframes and
// animations. The GPU passes run only for layers whose shadow is on; preview and export draw the same passes.
import type { EffectPass } from "@/effects/types";
import { defineShaderSource } from "@/effects/shader-sources";
import { buildGaussianBlurPasses } from "@/effects/definitions/blur";
import type { ParamValues } from "@/params";
import { LAYER_SHADOW_PARAMS } from "./params";

export { LAYER_SHADOW_PARAMS, SHADOW_ELEMENT_TYPES } from "./params";

export const SHADOW_CAST_SHADER = "studio.shadow.cast";
export const SHADOW_COMPOSITE_SHADER = "studio.shadow.composite";

// P0.xy = offset (uv), P1.rgb = colour: the layer's alpha moved by the offset, in the shadow's colour.
defineShaderSource({
	id: SHADOW_CAST_SHADER,
	wgsl: /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let a = src_bounded(uv - P0().xy).a;
    return vec4f(P1().rgb, a);
}`,
});
// P0.x = opacity, P0.y = spread (0..0.9), P1.rgb = colour: the layer (orig) over its blurred shadow (src), straight alpha.
defineShaderSource({
	id: SHADOW_COMPOSITE_SHADER,
	wgsl: /* wgsl */ `
fn effect(uv: vec2f) -> vec4f {
    let layer = orig(uv);
    let sa = min(1.0, src(uv).a / max(0.1, 1.0 - P0().y)) * P0().x;
    let out_a = layer.a + sa * (1.0 - layer.a);
    if (out_a <= 0.0001) { return vec4f(0.0); }
    let rgb = (layer.rgb * layer.a + P1().rgb * sa * (1.0 - layer.a)) / out_a;
    return vec4f(rgb, out_a);
}`,
});

export interface LayerShadow {
	/** sRGB 0..1. */
	color: [number, number, number];
	/** 0..1. */
	opacity: number;
	/** Fractions of the layer's shorter side. */
	blur: number;
	distance: number;
	/** Degrees, 0 = right, 90 = down. */
	angle: number;
	/** 0..0.9. */
	spread: number;
}

const DEFAULTS = Object.fromEntries(LAYER_SHADOW_PARAMS.map((p) => [p.key, p.default])) as Record<string, number | string | boolean>;

const num = (params: ParamValues, key: string) => {
	const value = params[key];
	return typeof value === "number" && Number.isFinite(value) ? value : (DEFAULTS[key] as number);
};

export function parseHexColor(value: unknown): [number, number, number] {
	const hex = typeof value === "string" ? value.trim().replace(/^#/, "") : "";
	const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex.slice(0, 6);
	if (!/^[0-9a-f]{6}$/i.test(full)) return [0, 0, 0];
	return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** The layer's shadow from its params, or null when it is off (or would not show). */
export function readLayerShadow(params: ParamValues | undefined): LayerShadow | null {
	if (!params || params["shadow.enabled"] !== true) return null;
	const opacity = Math.min(1, Math.max(0, num(params, "shadow.opacity") / 100));
	if (opacity <= 0) return null;
	return {
		color: parseHexColor(params["shadow.color"] ?? DEFAULTS["shadow.color"]),
		opacity,
		blur: Math.max(0, num(params, "shadow.blur") / 100),
		distance: Math.max(0, num(params, "shadow.distance") / 100),
		angle: num(params, "shadow.angle"),
		spread: Math.min(0.9, Math.max(0, num(params, "shadow.spread") / 100)),
	};
}

/** Offset (canvas px) and blur sigma (px) of a shadow for a layer drawn `width` × `height` px on the canvas. */
export function shadowGeometry(shadow: LayerShadow, layer: { width: number; height: number }) {
	const side = Math.max(1, Math.min(Math.abs(layer.width), Math.abs(layer.height)));
	const distance = shadow.distance * side;
	const radians = (shadow.angle * Math.PI) / 180;
	return {
		dx: Math.cos(radians) * distance,
		dy: Math.sin(radians) * distance,
		// the blur's reach is about two sigmas
		sigma: (shadow.blur * side) / 2,
	};
}

/** The passes (one group, run after the layer's mask) that put the shadow under the layer on a `canvas`-sized texture. */
export function shadowPassGroups({
	shadow,
	layer,
	canvas,
}: {
	shadow: LayerShadow;
	layer: { width: number; height: number };
	canvas: { width: number; height: number };
}): EffectPass[][] {
	const { dx, dy, sigma } = shadowGeometry(shadow, layer);
	const [r, g, b] = shadow.color;
	return [
		[
			{ shader: SHADOW_CAST_SHADER, uniforms: { u_params: [dx / canvas.width, dy / canvas.height, 0, 0, r, g, b, 0] } },
			...buildGaussianBlurPasses({ sigmaX: sigma, sigmaY: sigma }),
			{ shader: SHADOW_COMPOSITE_SHADER, uniforms: { u_params: [shadow.opacity, shadow.spread, 0, 0, r, g, b, 0] } },
		],
	];
}
