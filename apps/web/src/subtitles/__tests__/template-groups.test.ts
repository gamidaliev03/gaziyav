import { describe, expect, test } from "bun:test";
import { TEMPLATE_GROUPS } from "../template-groups";
import { CAPTION_STYLES, getCaptionStyle } from "../styles";

describe("Captions → Templates", () => {
	test("CapCut 9.5's groups, in its order", () => {
		expect(TEMPLATE_GROUPS.map((group) => group.label)).toEqual([
			"Favorites",
			"Trending",
			"Classic",
			"NEW",
			"Hits",
			"Word",
			"Glow",
			"Lyrics",
			"Basic",
			"Aesthetic",
			"Monoline",
			"Multiline",
			"Highlight",
			"B&W",
			"Boxed",
		]);
	});
	test("every group but Favorites has templates, each one a real style", () => {
		for (const group of TEMPLATE_GROUPS) {
			if (group.key === "tpl-favorites") continue;
			expect(group.ids.length).toBeGreaterThanOrEqual(4);
			for (const id of group.ids) expect(getCaptionStyle(id).id).toBe(id);
		}
	});
	test("template ids are unique and every new look sits in a group", () => {
		const ids = CAPTION_STYLES.map((style) => style.id);
		expect(new Set(ids).size).toBe(ids.length);
		const grouped = new Set<string>(TEMPLATE_GROUPS.flatMap((group) => [...group.ids]));
		for (const style of CAPTION_STYLES.filter((s) => s.id.startsWith("cc-"))) expect(grouped.has(style.id)).toBe(true);
	});
});
