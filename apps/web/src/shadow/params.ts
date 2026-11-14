// The drop shadow's params on a layer (shadow/layer-shadow.ts); pure data, imported by the params registry.
import type { ParamDefinition } from "@/params";

/** The element types that take a drop shadow (text has its own, drawn with the letters). */
export const SHADOW_ELEMENT_TYPES = ["video", "image", "sticker", "graphic"] as const;

const on = [{ param: "shadow.enabled", equals: true }];

/**
 * The shadow's params on a layer. Sizes are % of the layer's shorter side on the canvas (a text's shadow is in % of its
 * font size), so a scaled layer keeps the look. The angle is where the shadow falls: 0° right, 90° down.
 */
export const LAYER_SHADOW_PARAMS: ParamDefinition[] = [
	{ key: "shadow.enabled", label: "Shadow", type: "boolean", default: false, keyframable: false },
	{ key: "shadow.color", label: "Shadow color", type: "color", default: "#000000", keyframable: false, dependencies: on },
	{ key: "shadow.opacity", label: "Shadow opacity, %", type: "number", default: 60, min: 0, max: 100, step: 1, keyframable: false, dependencies: on },
	{ key: "shadow.blur", label: "Shadow blur, % of size", type: "number", default: 6, min: 0, max: 50, step: 0.5, keyframable: false, dependencies: on },
	{ key: "shadow.distance", label: "Shadow distance, % of size", type: "number", default: 4, min: 0, max: 50, step: 0.5, keyframable: false, dependencies: on },
	{ key: "shadow.angle", label: "Shadow angle, °", type: "number", default: 45, min: -180, max: 180, step: 1, keyframable: false, dependencies: on },
	{ key: "shadow.spread", label: "Shadow spread, %", type: "number", default: 0, min: 0, max: 90, step: 1, keyframable: false, dependencies: on },
];

