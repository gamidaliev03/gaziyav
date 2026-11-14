// ⌘K entries of the colour department (listed by components/editor/tool-search/tools.ts).
import type { Tool } from "@/components/editor/tool-search/tools";
import { toggleScopes } from "./scopes/store";

export const COLOUR_TOOLS: Tool[] = [
	{
		id: "colour-scopes",
		title: "Scopes",
		where: "Player · under the picture",
		words: ["scopes", "waveform", "vectorscope", "parade", "rgb parade", "histogram", "video scopes", "скопы", "осциллограмма", "осциллограф", "вектороскоп", "парад", "гистограмма", "измерители", "приборы"],
		target: { kind: "run", run: toggleScopes },
	},
];
