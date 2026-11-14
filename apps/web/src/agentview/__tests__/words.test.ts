// «Claude at work»: every call the connector answers reads as a sentence, in English and in Russian — never a tool
// name, an id or «[rev 41]». The lists are the real ones: surface.ts (the tools Claude sees, the steps of `edit`, the
// names that still answer) and the tool tables of the agent, read from their sources.
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { RU_AGENT_WORDS } from "@/i18n/ru-agentview";
import { EDIT_OPS, opTool, READ_ONLY, SURFACE, UNLISTED } from "@/mcp/surface";
import { chargedIn, doneFor, firstSentence, isRead, ownAnswer, type Phrase, pluralForm, readsRow, reasonOf, sayPhrase, wordsFor } from "../words";

const SRC = path.join(import.meta.dir, "..", "..");
const read = (file: string) => fs.readFileSync(path.join(SRC, file), "utf8");
/** Tool names as their tables declare them (`name: "split"`). */
const namesIn = (file: string) => [...read(file).matchAll(/\bname: "([a-z_]+)"/g)].map((m) => m[1]);

const AGENT_TOOLS = [...namesIn("agent/tools.ts"), ...namesIn("agent/hear-tools.ts"), ...namesIn("agent/produce-tools.ts")];
const OLDER = [...namesIn("mcp/project-tools.ts"), ...namesIn("mcp/content-tools.ts"), ...namesIn("mcp/edit-tools.ts")];
const EVERY_TOOL = [...new Set([...SURFACE.map((t) => t.name), ...AGENT_TOOLS, ...OLDER, ...UNLISTED, ...READ_ONLY, ...EDIT_OPS.map(opTool), "editing_guide", "status"])];

const en = (p: Phrase) => sayPhrase(p, "en", RU_AGENT_WORDS);
const ru = (p: Phrase) => sayPhrase(p, "ru", RU_AGENT_WORDS);
/** What must never be on screen: a tool name, a placeholder left in, an id, a revision. */
const RAW = /[a-z]+_[a-z]+|\{|\}|\[rev|\b[0-9a-f]{8}\b/;

function sayable(p: Phrase, what: string) {
	expect([what, RU_AGENT_WORDS[p.k] !== undefined || p.k === "{text}"]).toEqual([what, true]);
	for (const part of p.then ?? []) sayable(part, what);
	const [e, r] = [en(p), ru(p)];
	expect([what, e, RAW.test(e)]).toEqual([what, e, false]);
	expect([what, r, RAW.test(r)]).toEqual([what, r, false]);
	if (p.k !== "{text}") expect([what, r, /[а-яё]/i.test(r)]).toEqual([what, r, true]);
}

/** Every value a listed tool's own schema names for an argument («kind»: image | video | …). */
function enumCalls(): Array<[string, Record<string, unknown>]> {
	const out: Array<[string, Record<string, unknown>]> = [];
	for (const t of SURFACE) {
		const props = (t.parameters as { properties: Record<string, { enum?: string[] }> }).properties;
		for (const [key, spec] of Object.entries(props)) for (const value of spec.enum ?? []) out.push([t.name, { [key]: value }]);
	}
	return out;
}

describe("a call in plain words", () => {
	test("the lists are the real ones", () => {
		expect(AGENT_TOOLS.length).toBeGreaterThan(50);
		expect(EVERY_TOOL).toContain("place");
		expect(EVERY_TOOL).toContain("fit_music");
		expect(EVERY_TOOL).toContain("create_project");
		expect(EVERY_TOOL.length).toBeGreaterThan(80);
	});

	test("no tool is left as a raw name: each has its own words, in both languages", () => {
		const unknown = EVERY_TOOL.filter((name) => wordsFor(name, {}).unknown);
		expect(unknown).toEqual([]);
		for (const name of EVERY_TOOL) sayable(wordsFor(name, {}).now, name);
	});

	test("…and its row when done", () => {
		for (const name of EVERY_TOOL) {
			const d = doneFor(name, {}, { ok: true, content: "" });
			expect([name, d.done.k === "Done" || d.done.k === "{text}"]).toEqual([name, false]);
			if (wordsFor(name, {}).read && !wordsFor(name, {}).own) expect([name, /^(Read|Looked|Heard|Searched|Priced|Checked)/.test(d.done.k)]).toEqual([name, true]);
			sayable(d.done, name);
		}
	});

	test("every value of every argument the listed tools name (kind, what, action, platform…)", () => {
		const calls = enumCalls();
		expect(calls.length).toBeGreaterThan(40);
		for (const [name, args] of calls) {
			const w = wordsFor(name, args);
			expect([name, args, w.unknown ?? false]).toEqual([name, args, false]);
			sayable(w.now, `${name} ${JSON.stringify(args)}`);
			sayable(doneFor(name, args, { ok: true, content: "" }).done, `${name} ${JSON.stringify(args)} done`);
		}
	});

	test("every step of edit, alone and mixed", () => {
		for (const op of EDIT_OPS) {
			const args = { ops: [{ op, id: "clip 2", ids: ["a", "b"], ranges: [{ from: 1, to: 3.5 }], text: "Hello" }] };
			const w = wordsFor("edit", args);
			if (op !== "playhead") expect([op, w.now.k === "editing"]).toEqual([op, false]);
			sayable(w.now, `edit ${op}`);
			sayable(doneFor("edit", args, { ok: true, content: "1 x ✓ done" }).done, `edit ${op} done`);
		}
		const mixed = { ops: [{ op: "cut_out", ranges: [{ from: 0, to: 30 }, { from: 40, to: 82 }] }, { op: "add_text", text: "Свой бренд с нуля" }, { op: "add_sound", sound: "calm-04" }, { op: "captions" }] };
		expect(ru(wordsFor("edit", mixed).now)).toBe("монтирует, 4 шага");
		expect(en(wordsFor("edit", mixed).now)).toBe("editing, 4 steps");
		expect(ru(doneFor("edit", mixed, { ok: true, content: "" }).done)).toBe("Вырезал 2 фрагмента (−1:12) · Титр «Свой бренд с нуля» · и ещё 2");
		expect(en(doneFor("edit", mixed, { ok: true, content: "" }).done)).toBe("Cut out 2 pieces (−1:12) · Title «Свой бренд с нуля» · and 2 more");
	});

	test("the examples of the brief", () => {
		expect(ru(wordsFor("place", { items: Array.from({ length: 12 }, (_, i) => ({ media: `m${i}` })) }).now)).toBe("кладёт 12 клипов");
		expect(ru(wordsFor("place", { items: [{ media: "a" }, { media: "b" }, { media: "c" }] }).now)).toBe("кладёт 3 клипа");
		expect(en(wordsFor("place", { items: [{ media: "a" }, { media: "b" }, { media: "c" }] }).now)).toBe("placing 3 clips");
		expect(ru(wordsFor("edit", { ops: [{ op: "cut_out", ranges: [{ from: 1, to: 2 }] }] }).now)).toBe("режет по словам");
		expect(ru(wordsFor("generate", { kind: "video", prompt: "a sunrise" }).now)).toBe("генерирует видео");
		expect(ru(wordsFor("export", { platform: "youtube" }).now)).toBe("экспортирует для YouTube");
		expect(en(wordsFor("export", { platform: "youtube" }).now)).toBe("exporting for YouTube");
		expect(ru(wordsFor("look", { what: "frames", at: [1, 2] }).now)).toBe("смотрит кадры");
		expect(ru(wordsFor("import_media", { paths: ["/a.mp4", "/b.mp4"] }).now)).toBe("добавляет 2 файла");
		expect(en(wordsFor("import_media", { paths: ["/a.mp4"] }).now)).toBe("adding 1 file");
	});

	test("rows carry the numbers of the call and of its answer", () => {
		expect(ru(doneFor("import_media", { paths: ["/a", "/b", "/c", "/d", "/e", "/f"] }, { ok: true, content: "a: media 1a2b3c4d" }).done)).toBe("Добавил 6 файлов");
		expect(ru(doneFor("place", { items: Array.from({ length: 14 }, () => ({ media: "x" })) }, { ok: true, content: "" }).done)).toBe("Положил 14 клипов");
		expect(ru(doneFor("place", { item: "text:hook-bold", text: "3 ОШИБКИ", at: 0 }, { ok: true, content: "" }).done)).toBe("Титр «3 ОШИБКИ»");
		expect(ru(doneFor("review", {}, { ok: true, content: "Score 86/100. Two cuts land mid-word." }).done)).toBe("Проверка: 86 из 100");
		expect(en(doneFor("export", { platform: "reels" }, { ok: true, content: "Exported /Users/x/Movies/Gaziyav/Podcast 12.mp4 · 1080×1920 30 fps · 4.2 MB · 9 s to render [rev 9]" }).done)).toBe("Export «Podcast 12.mp4»");
		expect(ru(doneFor("export", {}, { ok: true, content: "Exported /Users/x/Movies/Gaziyav/reel.mov" }).done)).toBe("Экспорт «reel.mov»");
		expect(ru(doneFor("export", {}, { ok: true, content: "Rendered." }).done)).toBe("Экспортировал");
		expect(ru(doneFor("project", { action: "create", name: "Рилс про кофе" }, { ok: true, content: "Created project 1a2b3c4d" }).done)).toBe("Создал проект «Рилс про кофе»");
		expect(ru(doneFor("undo", { steps: 2 }, { ok: true, content: "Undid your last 2 calls." }).done)).toBe("Отменил 2 своих шага");
		expect(ru(doneFor("post", { confirm: true, platforms: ["instagram", "tiktok"] }, { ok: true, content: "" }).done)).toBe("Опубликовано: Reels, TikTok");
		// one of a thing is said without its number, the way a person would
		expect(ru(doneFor("place", { media: "aa" }, { ok: true, content: "" }).done)).toBe("Положил клип");
		expect(en(doneFor("import_media", { paths: ["/a.mp4"] }, { ok: true, content: "" }).done)).toBe("Added a file");
		expect(ru(doneFor("edit", { ops: [{ op: "cut_out", ranges: [{ from: 2.1, to: 4.4 }] }] }, { ok: true, content: "" }).done)).toBe("Вырезал фрагмент (−0:02)");
		expect(ru(doneFor("edit", { ops: [{ op: "delete", ids: ["a", "b", "c", "d", "e"], closeGap: true }] }, { ok: true, content: "" }).done)).toBe("Убрал 5 клипов");
		expect(ru(doneFor("edit", { ops: [{ op: "speed", id: "clip 1", rate: 2 }, { op: "speed", id: "clip 2", rate: 2 }] }, { ok: true, content: "" }).done)).toBe("Изменил скорость 2 клипов");
		expect(ru(doneFor("place", { items: [{ item: "music:calm-04", at: 0 }, { item: "sound:whoosh-1", at: 4 }, { item: "sound:pop-2", at: 6 }] }, { ok: true, content: "" }).done)).toBe("Добавил музыку и 2 звука");
		expect(en(doneFor("place", { items: [{ item: "transition:whip", at: 4.2 }, { item: "sound:whoosh-1", at: 4.1 }] }, { ok: true, content: "" }).done)).toBe("Placed 2 things on the timeline");
	});

	test("a paid step's price is what its answer says was charged", () => {
		const made = JSON.stringify({ media: "6e703a11", name: "Sunrise", costUsd: 0.04, spent: "charged $0.04 on fal.ai · this video: $0.04 spent" });
		const d = doneFor("generate", { kind: "image", prompt: "Рассвет над морем в тумане, кинематографично" }, { ok: true, content: made });
		expect(d.usd).toBe(0.04);
		expect(ru(d.done)).toBe("Картинка «Рассвет над морем в тумане…»");
		expect(chargedIn("Lipsync done; the result replaced the clip. charged $0.2 on fal.ai · this video: $0.24 spent.")).toBe(0.2);
		expect(chargedIn("nothing new charged: made 2 min ago by the same request · this video: $0.04 spent")).toBe(0);
		expect(chargedIn("Stopped (the user pressed Stop in Gaziyav): fal.ai had started it (≈ $0.12 charged); it lands in Media → Generate when ready")).toBe(0.12);
		expect(chargedIn("Stopped before fal.ai started it: nothing charged.")).toBe(0);
		expect(doneFor("edit", { ops: [{ op: "split", time: 3 }] }, { ok: true, content: "1 split ✓" }).usd).toBeUndefined();
	});

	test("a tool with no line of its own: the first sentence of its answer, with no id and no revision", () => {
		const w = wordsFor("brand_new_tool", {});
		expect(w.unknown).toBe(true);
		expect(ru(w.now)).toBe("работает");
		const d = doneFor("brand_new_tool", {}, { ok: true, content: "Moved the logo to the corner (clip 1a2b3c4d). It now sits over every shot. [rev 41]" });
		expect(en(d.done)).toBe("Moved the logo to the corner.");
		expect(firstSentence('{"media":"1a2b3c4d"}')).toBe("");
		expect(firstSentence("1 split ✓ Split at 3 s: two clips 1a2b3c4d and 5e6f7a8b [rev 7]")).toBe("Split at 3 s: two clips and");
		expect(firstSentence("x".repeat(200)).length).toBe(72);
	});

	test("the connector's own lines around an answer are not the tool's answer", () => {
		const content = "The user changed by hand since your last call:\nuser: ~ 1a2b3c4d video 0–3.2 (was 0–4)\nuser: − 5e6f7a8b text\n… 2 more (get_project {since:4})\nError: No clip with that id. [rev 9]";
		expect(ownAnswer(content)).toBe("Error: No clip with that id.");
		expect(ru(reasonOf(content))).toBe("Он указал на клип, которого уже нет");
		expect(ownAnswer("Note: the open project is now «B» (1a2b3c4d), not «A» you worked on.\nDone. [rev 2]")).toBe("Done.");
		expect(ownAnswer("The user brought your step «place ×2» back in Gaziyav: what it made is in the project again.\nThe user went back in Gaziyav: they took back your step «edit (2 steps)».\nDone.")).toBe("Done.");
	});

	test("why a step failed, in words", () => {
		expect(ru(reasonOf("Error: Not run: a picture with FLUX costs $0.03 on fal.ai, more than this video's budget has left ($0.01 of $1.00). Nothing was spent."))).toBe("Не укладывается в бюджет этого видео");
		expect(ru(reasonOf("Error: Not run: there is no fal.ai key. Use kie instead."))).toBe("Нет ключа fal.ai: добавьте его в Настройках → ИИ");
		expect(en(reasonOf("Error: The open project is now «B», not «A» you worked on: nothing was changed."))).toBe("Another project is open now");
		expect(en(reasonOf("Error: the render crashed on frame 12."))).toBe("the render crashed on frame 12.");
		expect(ru(reasonOf(""))).toBe("Не получилось");
		for (const k of ["It would go over this video's budget", "Not enough money on the AI account", "The service did not answer in time", "Claude asked for something this step does not take"]) expect(RU_AGENT_WORDS[k].length).toBeLessThanOrEqual(72);
	});

	test("what only looks never waits for «Continue» and makes no step", () => {
		for (const [tool, args] of [["get_project", {}], ["look", { what: "frames" }], ["analyze", { what: "words" }], ["find_content", { kind: "music" }], ["price_plan", {}], ["sounds_like", { query: "applause" }], ["taste_profile", {}], ["memory", {}], ["generate", { kind: "video", quote: true }], ["post", {}], ["project", { action: "list" }], ["review", {}], ["analyze_material", {}]] as Array<[string, Record<string, unknown>]>) {
			expect([tool, isRead(tool, args), wordsFor(tool, args).read]).toEqual([tool, true, true]);
		}
		for (const [tool, args] of [["edit", { ops: [] }], ["place", {}], ["generate", { kind: "image" }], ["export", {}], ["post", { confirm: true }], ["import_media", {}], ["undo", {}], ["project", { action: "open" }], ["analyze", { what: "beats" }], ["taste_profile", { set: { budget: 2 } }], ["motion_layer", {}], ["fit_music", {}], ["apply_plan", {}]] as Array<[string, Record<string, unknown>]>) {
			expect([tool, isRead(tool, args), wordsFor(tool, args).read]).toEqual([tool, false, false]);
		}
	});

	test("a run of reads is one quiet row", () => {
		expect(ru(readsRow(["project", "frames", "footage", "project"]))).toBe("Смотрел проект");
		expect(ru(readsRow(["frames", "frames"]))).toBe("Смотрел кадры");
		expect(en(readsRow(["library"]))).toBe("Searched the library");
	});
});

describe("the Russian lines", () => {
	const source = read("agentview/words.ts");
	const keys = [...new Set([...source.matchAll(/\bP\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]))];

	test("every phrase of words.ts has one", () => {
		expect(keys.length).toBeGreaterThan(150);
		expect(keys.filter((k) => k !== "{text}" && RU_AGENT_WORDS[k] === undefined)).toEqual([]);
		// (the names of what was generated sit in a table, not in P())
		for (const k of ["Picture «{name}»", "A picture", "Video «{name}»", "A video", "Voice-over «{name}»", "A voice-over", "Lipsync «{name}»", "Lipsync", "New voice «{name}»", "A new voice for the clip", "Dubbing", "Face swap", "Graphics «{name}»", "Graphics"]) expect([k, RU_AGENT_WORDS[k] !== undefined]).toEqual([k, true]);
	});

	test("each keeps the values of its English line, and three forms for a counted word", () => {
		for (const [k, v] of Object.entries(RU_AGENT_WORDS)) {
			const vars = (s: string) => [...s.matchAll(/\{(\w+)(?:\|[^}]*)?\}/g)].map((m) => m[1]).sort();
			expect([k, vars(v)]).toEqual([k, vars(k)]);
			for (const m of v.matchAll(/\{\w+\|([^}]*)\}/g)) expect([k, m[1].split("|").length]).toEqual([k, 3]);
			for (const m of k.matchAll(/\{\w+\|([^}]*)\}/g)) expect([k, m[1].split("|").length]).toEqual([k, 2]);
		}
	});

	test("the right form for a number", () => {
		const forms = ["клип", "клипа", "клипов"];
		expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111, 112].map((n) => pluralForm(n, forms, "ru"))).toEqual(["клип", "клипа", "клипа", "клипов", "клипов", "клипов", "клипов", "клип", "клипа", "клипов", "клип", "клипов", "клипов"]);
		expect([1, 2, 0].map((n) => pluralForm(n, ["clip", "clips"], "en"))).toEqual(["clip", "clips", "clips"]);
	});

	test("nothing longer than a notice (72 characters) among the lines that are notices", () => {
		for (const k of ["Stopped. Claude is waiting.", "Paused. Claude's changes wait for you.", "The window was reloaded: the steps above can't be undone here", "Everything is undone. ⌘⇧Z brings it back.", "≈ {price} was already charged; the result lands in Media"]) expect([k, RU_AGENT_WORDS[k].length <= 72]).toEqual([k, true]);
	});
});
