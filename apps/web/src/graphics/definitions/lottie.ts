// Lottie graphics (Graphics section of the Stickers tab). The animation JSON travels inside the
// element params (`lottie.json`), so projects stay self-contained and render the same offline.
import { drawLottieFrame, type LottieTiming } from "../lottie/player";
import type { GraphicDefinition } from "../types";

export const LOTTIE_GRAPHIC_ID = "lottie";

export const lottieGraphicDefinition: GraphicDefinition = {
	id: LOTTIE_GRAPHIC_ID,
	name: "Graphic",
	keywords: ["lottie", "graphic", "animation", "sticker"],
	animated: true,
	params: [
		// Set when the sticker is added: its words can't be changed (never shown itself).
		{ key: "lottie.fixedText", label: "Fixed text", type: "boolean", default: false, dependencies: [{ param: "lottie.fixedText", equals: "never" }] },
		{ key: "text", label: "Text", type: "text", default: "", dependencies: [{ param: "lottie.fixedText", equals: false }] },
		{ key: "text2", label: "Text 2", type: "text", default: "", dependencies: [{ param: "lottie.fixedText", equals: false }] },
		{
			key: "timing",
			label: "Timing",
			type: "select",
			default: "loop",
			options: [
				{ value: "fit", label: "Fit the clip" },
				{ value: "once", label: "Play once" },
				{ value: "loop", label: "Loop" },
			],
		},
		{ key: "speed", label: "Speed", type: "number", default: 1, min: 0.25, max: 4, step: 0.05 },
		{ key: "tint.enabled", label: "Recolor", type: "boolean", default: false },
		{
			key: "tint.color",
			label: "Color",
			type: "color",
			default: "#ffd60a",
			dependencies: [{ param: "tint.enabled", equals: true }],
		},
	],
	render({ ctx, params, width, height, time = 0, duration = 0 }) {
		const json = typeof params["lottie.json"] === "string" ? params["lottie.json"] : "";
		if (!json) {
			ctx.clearRect(0, 0, width, height);
			return;
		}
		const timing = (["fit", "once", "loop"].includes(String(params.timing)) ? params.timing : "loop") as LottieTiming;
		drawLottieFrame({
			ctx,
			width,
			height,
			json,
			texts: [String(params.text ?? ""), String(params.text2 ?? "")],
			time,
			clipDuration: duration,
			timing,
			speed: Number(params.speed) || 1,
			tint: params["tint.enabled"] === true ? String(params["tint.color"] ?? "#ffd60a") : null,
		});
	},
};
