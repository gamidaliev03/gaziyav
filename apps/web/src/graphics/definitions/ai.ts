// Remotion AI Compositions and their AI layers as graphic definitions:
// - ai.Composition — the compound clip on the parent timeline (opens its own inner timeline);
// - ai.<Kind> — AI layers inside a composition (Remotion components from the motion kit or DeepSeek's own code).
// The compositor never draws them (compositions are flattened, layers go to the Remotion layer); render() only
// paints the badge tile used for timeline thumbnails.
import { AI_PREFIX, MONTAGE_KINDS } from "@/montage/catalog";
import { isMographKind } from "@/montage/mograph";
import type { GraphicDefinition, GraphicRenderContext } from "../types";

function tile({ ctx, width, height }: GraphicRenderContext, label: string, colors: [string, string], badge = "AI") {
	ctx.clearRect(0, 0, width, height);
	const g = ctx.createLinearGradient(0, 0, width, height);
	g.addColorStop(0, colors[0]);
	g.addColorStop(1, colors[1]);
	ctx.fillStyle = g;
	ctx.beginPath();
	ctx.roundRect(0, 0, width, height, width * 0.12);
	ctx.fill();
	ctx.fillStyle = "#fff";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.font = `800 ${Math.round(height * 0.3)}px system-ui, sans-serif`;
	ctx.fillText(badge, width / 2, height * 0.42);
	ctx.font = `600 ${Math.round(height * 0.11)}px system-ui, sans-serif`;
	ctx.fillText(label, width / 2, height * 0.72, width * 0.9);
}

export const aiGraphicDefinitions: GraphicDefinition[] = [
	{
		id: `${AI_PREFIX}Composition`,
		name: "AI Composition",
		keywords: ["ai", "remotion", "composition", "compound"],
		params: [{ key: "alpha", label: "With alpha", type: "boolean", default: true }],
		render: (c) => tile(c, "Composition", ["#c98a1e", "#2563EB"]),
	},
	...MONTAGE_KINDS.map((k): GraphicDefinition => {
		// Ready-made motion graphics are our own code, not AI: named and badged as motion.
		const motion = isMographKind(k.kind);
		return {
			id: `${AI_PREFIX}${k.kind}`,
			name: motion ? `Motion · ${k.label}` : `AI · ${k.label}`,
			keywords: [motion ? "motion" : "ai", k.kind.toLowerCase(), k.label.toLowerCase()],
			params: k.fields,
			render: (c) => (motion ? tile(c, k.label, ["#0EA5E9", "#c98a1e"], "MG") : tile(c, k.label, ["#DB2777", "#c98a1e"])),
		};
	}),
];
