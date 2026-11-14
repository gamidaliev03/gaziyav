// His edition has no sticker packs since 12.11 (src/edition/cuts.ts): Claude is not offered them anywhere in tools/list —
// (or NEXT_PUBLIC_GAZIYAV_KEEP=stickers) keeps all of it.
import { describe, expect, test } from "bun:test";
import { EDITION } from "@/edition/cuts";
import { EDIT_OPS, NO_STICKERS, STICKERS, SURFACE } from "../surface";

describe("the connector in this edition: stickers", () => {
	const tool = (name: string) => SURFACE.find((t) => t.name === name) as unknown as { parameters: { properties: Record<string, { enum?: string[]; items?: { properties: { op: { enum: string[] } } } }> } };
	test("follows EDITION.stickers", () => expect(STICKERS).toBe(EDITION.stickers));
	test("find_content's kinds, edit's steps and the words", () => {
		const kinds = tool("find_content").parameters.properties.kind.enum ?? [];
		const ops = tool("edit").parameters.properties.ops.items?.properties.op.enum ?? [];
		expect(EDIT_OPS).toContain("add_graphic"); // the step itself stays for old calls: refused in his edition (run.ts)
		if (STICKERS) {
			expect(kinds).toContain("sticker");
			expect(ops).toContain("add_graphic");
			return;
		}
		expect(kinds).not.toContain("sticker");
		expect(ops).not.toContain("add_graphic");
		expect(JSON.stringify(SURFACE)).not.toMatch(/sticker/i);
		expect(NO_STICKERS).toMatch(/motion/);
	});
});
