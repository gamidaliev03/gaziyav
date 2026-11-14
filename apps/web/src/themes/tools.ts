// ⌘K: «Themes» opens Settings → Themes (the looks, the accent colour).
import type { Tool } from "@/components/editor/tool-search/tools";

export const THEME_TOOLS: Tool[] = [
	{
		id: "appearance",
		title: "Themes",
		where: "Settings · Themes",
		words: ["theme", "themes", "look", "accent", "colour", "color", "glass", "dark", "light", "тема", "темы", "оформление", "цвет", "акцент", "стекло", "тёмная", "светлая", "минимал"],
		target: {
			kind: "run",
			run: () => {
				void import("@/settings/settings-store").then((m) => m.openSettings("appearance"));
				return true;
			},
		},
	},
];
