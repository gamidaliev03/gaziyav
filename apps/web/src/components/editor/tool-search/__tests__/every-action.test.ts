// ⌘K finds every command (register C1): each listed action of definitions.ts, typed by its Russian name (the ⌘/
// table's, without its note in brackets) or its English one, is among the hits — from the generated index.
import { beforeAll, describe, expect, test } from "bun:test";
import { ACTIONS } from "@/actions/definitions";
import { withoutNote } from "@/actions/names";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import { ru } from "@/i18n/ru";

let COMMANDS: typeof import("../tools").COMMANDS;
let findTools: typeof import("../tools").findTools;
beforeAll(async () => {
	await installOpenCutWasm();
	({ COMMANDS, findTools } = await import("../tools"));
});

const listed = (Object.keys(ACTIONS) as Array<keyof typeof ACTIONS>).filter((a) => !(ACTIONS[a] as { hidden?: boolean }).hidden);
const hits = (q: string, action: string) => findTools(q, 12).some((t) => t.target.kind === "action" && t.target.action === action);

describe("⌘K: every action", () => {
	test("each listed action is a command once", () => {
		const ids = COMMANDS.flatMap((t) => (t.target.kind === "action" ? [t.target.action] : []));
		for (const a of listed) expect(ids.filter((x) => x === a).length).toBe(1);
	});
	test("found by its Russian and its English name", () => {
		const missing: string[] = [];
		for (const a of listed) {
			const name = ACTIONS[a].description;
			if (!hits(withoutNote(ru(name)), a)) missing.push(`ru «${withoutNote(ru(name))}» → ${a}`);
			if (!hits(withoutNote(name), a)) missing.push(`en «${withoutNote(name)}» → ${a}`);
		}
		expect(missing).toEqual([]);
	}, 60_000);
	test("the words people type: разделить, удалить, экспорт, отменить, магнит, маркер, дублировать, обрезка, заморозить, сочетания", () => {
		const want: Array<[string, string]> = [["разделить", "split"], ["удалить", "delete-selected"], ["экспорт", "export-project"], ["отменить", "undo"], ["магнит", "toggle-ripple-editing"], ["маркер", "toggle-bookmark"], ["дублировать", "duplicate-selected"], ["обрезка", "trim-end-earlier"], ["заморозить", "freeze-frame"], ["сочетания", "show-shortcuts"]];
		expect(want.filter(([q, a]) => !hits(q, a))).toEqual([]);
	});
});
