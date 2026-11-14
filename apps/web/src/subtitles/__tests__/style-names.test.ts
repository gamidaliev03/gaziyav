import { expect, test } from "bun:test";
import { captionStylesFor } from "@/subtitles/styles";

test("no two caption styles share a name (each tile reads as its own look)", () => {
	for (const lang of ["ru", "en"] as const) {
		const names = captionStylesFor(lang).map((style) => style.name.toLowerCase());
		expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([]);
		expect(names.length).toBeGreaterThanOrEqual(90);
	}
});
