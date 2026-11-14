// The connector's pure parts: the tool list Claude gets (valid schemas, few tools, the guide out of the instructions),
// the compact answers, the step references, the composition sandbox (the skill's patterns compile, escapes are refused
// with the line and the fix), the budget and the memory files.
import { beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { briefOf, callLabel, compactElement, compactProject, idOf, mediaList, oneLine, type ProjectJson, withRefs } from "../compact";
import { EDIT_OPS, SURFACE } from "../surface";

const SKILL = path.join(import.meta.dir, "..", "..", "..", "mcp", "skill", "gaziyav-editing");

/** What every Claude client takes: object schemas, arrays with items, required keys that exist, names it accepts. */
function schemaProblems(name: string, s: Record<string, unknown>, at = ""): string[] {
	const out: string[] = [];
	if (s.type === "array" && !s.items) out.push(`${name}${at}: array without items`);
	if (s.type === "object" || s.properties) {
		const props = (s.properties ?? {}) as Record<string, Record<string, unknown>>;
		for (const k of Object.keys(props)) {
			if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(k)) out.push(`${name}${at}: bad property name ${k}`);
			out.push(...schemaProblems(name, props[k], `${at}.${k}`));
		}
		for (const r of (s.required as string[] | undefined) ?? []) if (!(r in props)) out.push(`${name}${at}: required ${r} isn't a property`);
	}
	if (s.items && typeof s.items === "object") out.push(...schemaProblems(name, s.items as Record<string, unknown>, `${at}[]`));
	return out;
}

describe("tools/list", () => {
	test("few tools, valid names and schemas, short enough", () => {
		expect(SURFACE.length).toBeLessThanOrEqual(18);
		const problems: string[] = [];
		for (const t of SURFACE) {
			if (!/^[a-zA-Z0-9_-]{1,64}$/.test(t.name)) problems.push(`bad name ${t.name}`);
			if ((t.parameters as { type: string }).type !== "object") problems.push(`${t.name}: top is not an object`);
			problems.push(...schemaProblems(t.name, t.parameters as Record<string, unknown>));
			if (t.description.length > 3200) problems.push(`${t.name}: description ${t.description.length} chars`);
		}
		expect(problems).toEqual([]);
		expect(new Set(SURFACE.map((t) => t.name)).size).toBe(SURFACE.length);
		// the whole listed surface stays small (the old one was ~62 tools)
		const bytes = JSON.stringify(SURFACE).length;
		expect(bytes).toBeLessThan(26500); // 26000 → 26500 at the night merge: scenes (+1253) and hear (+400) together, each inside 26000 alone
	});

	test("edit's op list names only real operations and every listed op is documented", () => {
		const edit = SURFACE.find((t) => t.name === "edit");
		expect(edit).toBeDefined();
		for (const op of ["place", "split", "trim", "set", "keyframes", "camera", "captions", "cut_out", "ai_effect"]) expect(EDIT_OPS as readonly string[]).toContain(op);
		for (const op of ["place", "split", "trim", "set", "camera", "captions", "cut_out", "ai_effect", "make_vertical"]) expect(edit?.description).toContain(op);
	});

	test("the instructions carry the essentials, not the whole guide", () => {
		const server = fs.readFileSync(path.join(import.meta.dir, "..", "..", "..", "mcp", "server.mjs"), "utf8");
		const block = /const INSTRUCTIONS = `([\s\S]*?)`;/.exec(server)?.[1] ?? "";
		expect(block.length).toBeGreaterThan(400);
		expect(block.length).toBeLessThan(2600);
		expect(block).toMatch(/never read, search or change Gaziyav's code/);
		expect(block).toMatch(/budget/);
		expect(block).toMatch(/post/);
	});
});

describe("the skill", () => {
	test("SKILL.md is short, written for Sonnet, with the top rule; every topic file exists", () => {
		const skill = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
		expect(skill.split("\n").length).toBeLessThan(120);
		expect(skill).toMatch(/^---\nname: gaziyav-editing\ndescription: /);
		expect(skill).toMatch(/Sonnet/);
		expect(skill).toMatch(/never read, search or change Gaziyav's code/i);
		for (const f of ["workflows", "sound", "motion", "captions", "graphics", "export-post", "ai", "tools"]) expect(fs.existsSync(path.join(SKILL, "references", `${f}.md`))).toBe(true);
	});

	test("it prints the brief table, the recipes and the camera words as the code has them (Claude and apply_plan read a brief the same way)", async () => {
		const { BRIEF_TABLE } = await import("@/production/brief-words");
		const { RECIPES } = await import("@/production/recipes");
		const { CAMERA_MOVES } = await import("@/production/shots");
		const workflows = fs.readFileSync(path.join(SKILL, "references", "workflows.md"), "utf8");
		const ai = fs.readFileSync(path.join(SKILL, "references", "ai.md"), "utf8");
		const missing = [
			...BRIEF_TABLE.map((r) => `| ${r.join(" | ")} |`).filter((row) => !workflows.includes(row)),
			...RECIPES.filter((r) => !workflows.includes(`- \`${r.id}\` — `)).map((r) => `recipe ${r.id}`),
			...Object.entries(CAMERA_MOVES).filter(([k, v]) => !ai.includes(`| ${k} | ${v.words.generic} |`)).map(([k]) => `camera ${k}`),
		];
		// When this fails, regenerate the tables in references/workflows.md and ai.md from the code.
		expect(missing).toEqual([]);
		expect(RECIPES.length).toBe(15);
	});

	test("the hearing rule: questions to the sound in English; the measured-only answer is expected", () => {
		const skill = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
		const sound = fs.readFileSync(path.join(SKILL, "references", "sound.md"), "utf8");
		for (const text of [skill, sound]) {
			expect(text).toMatch(/sounds_like/);
			expect(text).toMatch(/in English/i);
			expect(text).toMatch(/Measured, not heard/);
		}
	});
});

const project: ProjectJson = {
	project: { name: "Reel", width: 1080, height: 1920, fps: 30, duration: 28.4, playhead: 0 },
	selected: [],
	tracks: [
		{ id: "t1aaaaaa", role: "overlay 1 (top=1)", type: "text", elements: Array.from({ length: 30 }, (_, i) => ({ id: `c${i}xxxxxx`.slice(0, 8), type: "text", name: `Caption ${i + 1}`, text: `word ${i}`, start: i, end: i + 0.9 })) },
		{ id: "m1aaaaaa", role: "main video", type: "video", elements: [{ id: "v1aaaaaa", type: "video", name: "talk.mp4", start: 0, end: 12.3, sourceFrom: 0 }, { id: "v2aaaaaa", type: "video", name: "broll.mp4", start: 12.3, end: 20, sourceFrom: 2, effects: ["Color"], transitionIn: "whip" }] },
		{ id: "a1aaaaaa", role: "audio 1", type: "audio", elements: [{ id: "s1aaaaaa", type: "audio", name: "Upbeat", start: 0, end: 28.4, volumeDb: -16 }] },
	],
	media: [{ id: "md1aaaaa", name: "talk.mp4", type: "video", duration: 12.3, size: "720x1280", onTimeline: true }],
};

describe("compact answers", () => {
	test("the project in lines: captions folded, ids and times first", () => {
		const text = compactProject(project);
		expect(text).toMatch(/1080×1920 \(9:16\) 30 fps · 28.4 s/);
		expect(text).toMatch(/30 text clips \(captions\?\)/);
		expect(text).toMatch(/v2aaaaaa video broll.mp4 12.3–20 src\+2 fx:Color ⇤whip/);
		expect(text).toMatch(/s1aaaaaa audio Upbeat 0–28.4 -16 dB/);
		expect(text.length).toBeLessThan(JSON.stringify(project).length / 2);
		expect(compactProject(project, { track: "t1" })).toMatch(/c29xxxxx/);
	});

	test("an element's settings as key=value with ranges", () => {
		const json = JSON.stringify({ id: "v1aaaaaa", type: "video", name: "talk.mp4", start: 0, end: 5, track: "m1aaaaaa", params: [{ key: "volume", type: "number", value: -3, min: -60, max: 12 }, { key: "blendMode", type: "select", value: "normal", options: ["normal", "screen"] }], effects: [] });
		expect(compactElement(json)).toMatch(/volume=-3 \[-60\.\.12\] · blendMode="normal" \[normal\|screen\]/);
	});

	test("$N refers to an earlier step's new id", () => {
		const results = [JSON.stringify({ id: "a1b2c3d4", type: "text" }), "Placed Counter id 9f8e7d6c on track x"];
		expect(withRefs({ id: "$1", ids: ["$2"], n: 3 }, results)).toEqual({ id: "a1b2c3d4", ids: ["9f8e7d6c"], n: 3 });
		expect(() => withRefs({ id: "$3" }, results)).toThrow(/step 3/);
		expect(idOf(JSON.stringify({ media: "m1" }))).toBe("m1");
		expect(oneLine(JSON.stringify({ id: "x", start: 3 }))).toBe("id x · start 3");
	});

	// 10.11: positional $n refs were off by one in a 40-step edit and put camera moves on the wrong clips.
	test("$prev and named refs (a step with as:\"s18\" is \"$s18\" later); a $word nobody named stays text", () => {
		const results = [JSON.stringify({ id: "a1b2c3d4" }), JSON.stringify({ id: "e5f6a7b8" })];
		const names = new Map([["s18", 1]]);
		expect(withRefs({ id: "$prev", other: "$s18", text: "$PRICE" }, results, names)).toEqual({ id: "e5f6a7b8", other: "a1b2c3d4", text: "$PRICE" });
	});

	// 10.11: get_project {id} printed ≈ 1.5 K of transform/shadow settings; fontSize's unit was nowhere (Claude set 56).
	test("one clip in one line; its settings only with detail, fontSize with its unit", () => {
		const json = JSON.stringify({ id: "t1aaaaaa", type: "text", text: "HOOK", start: 0, end: 2, media: undefined, track: "o1aaaaaa", effects: [{ id: "f1", type: "studio.color", enabled: true, params: {} }], params: [{ key: "fontSize", type: "number", value: 5, min: 1.5, max: 12 }] });
		expect(compactElement(json, false)).toBe('t1aaaaaa text "HOOK" 0–2 fx:color on track o1aaaaaa (detail:true lists every setting edit set takes)');
		expect(compactElement(json, true)).toContain("fontSize=5 [1.5..12] (frame-height units: 3 small, 5 title, 8 big, 12 max)");
	});

	// 10.11: answers over 12 000 characters were cut raw (JSON.parse failed, the raw cut text went out), media came last.
	test("a big project folds until it fits, never cut raw; media newest first, helper pictures not listed", () => {
		const many = { ...project, tracks: Array.from({ length: 12 }, (_, t) => ({ id: `t${t}aaaaaa`, role: `overlay ${t + 1}`, type: "video", elements: Array.from({ length: 13 }, (_, i) => ({ id: `e${t}${i}aaaaa`, type: "video", name: `AI Nano Banana 2 shot ${i} of the long video name.mp4`, start: i * 2, end: i * 2 + 2, media: `m${i}aaaaaa`, sourceFrom: 1.5, effects: ["Color", "Zoom"] })) })), media: [...Array.from({ length: 80 }, (_, i) => ({ id: `m${String(i).padStart(2, "0")}aaaaa`, name: `shot ${i}.mp4`, type: "video", duration: 5, onTimeline: i < 10, made: true })), { id: "lf000000", name: "shot 79 · last frame.png", type: "image" }] } as ProjectJson;
		const text = compactProject(many);
		expect(text.length).toBeLessThanOrEqual(11_000);
		expect(text).toContain('Media (80, 10 on the timeline, newest first; 1 helper picture(s) not listed): m79aaaaa video "shot 79.mp4"');
		expect(text).not.toContain("last frame");
		expect(mediaList(many, { max: 3 })).toMatch(/m79aaaaa .* · m77aaaaa .*· … 77 older/);
	});

	// 10.11: a paid result that finished unheard had no trace; now it is one line with the next answer.
	test("a finished call in one line: what it was, the media, where, what it cost; a failure with its time", () => {
		const content = `{"media":"6e703a11","name":"x.mp4","model":"Kling Avatar [fal-ai/kling] on fal.ai","costUsd":0.17,"placedAt":145.1} [rev 9]`;
		expect(briefOf("generate", { kind: "video", mode: "avatar", start: 145.1 }, { ok: true, content }, Date.now())).toBe("✓ generate avatar @145.1 → media 6e703a11 placed @145.1 ($0.17 fal.ai)");
		expect(briefOf("generate", { kind: "video", mode: "avatar", start: 145.1 }, { ok: false, content: "Error: fal refused picture 24e2fc1d" }, new Date(2026, 10, 10, 12, 22).getTime())).toBe("✗ generate avatar @145.1 failed 12:22: fal refused picture 24e2fc1d");
		expect(callLabel("edit", { ops: [{}, {}] })).toBe("edit (2 steps)");
		// (the result as generate writes it now: placed {clip, start, end, track}, a cent's fraction kept)
		const now = `{"media":"5af64851","model":"FLUX.1 schnell [fal-ai/flux/schnell] on fal.ai","costUsd":0.003,"placed":{"clip":"9cf7ab54","start":1,"end":6,"track":"85ce9f83 (overlay)"}}`;
		expect(briefOf("generate", { kind: "image", prompt: "a stage with red lights" }, { ok: true, content: now }, Date.now())).toBe("✓ generate image «a stage with red…» → media 5af64851 placed @1 (clip 9cf7ab54) ($0.003 fal.ai)");
	});
});

describe("the composition sandbox", () => {
	let compile: (code: string, name: string) => { js: string } | { error: string };
	beforeAll(async () => {
		compile = (await import("../server/compose")).compileForClaude;
	});

	test("the skill's four patterns compile", () => {
		const motion = fs.readFileSync(path.join(SKILL, "references", "motion.md"), "utf8");
		const blocks = [...motion.matchAll(/```tsx\n([\s\S]*?)```/g)].map((m) => m[1]);
		expect(blocks.length).toBe(4);
		for (const code of blocks) {
			const name = /export const ([A-Z]\w*)/.exec(code)?.[1] ?? "";
			const r = compile(code, name);
			expect("error" in r ? r.error : "ok").toBe("ok");
		}
	});

	test("escapes are refused with the line and what to do", () => {
		const base = (body: string) => `import React from "react";\nexport const Bad = () => {\n${body}\n\treturn null;\n};`;
		const cases: Array<[string, RegExp]> = [
			['\tfetch("https://x.y");', /line 3: "fetch" is not allowed — no network/],
			["\tconst f = (() => 0).constructor;", /line 3: "constructor" is not allowed/],
			["\tsetTimeout(() => 0, 5);", /useCurrentFrame/],
			["\tconst x = Math.random();", /random\('a seed'\)/],
			["\tself.postMessage(1);", /global objects are not available|not available/],
		];
		for (const [body, want] of cases) {
			const r = compile(base(body), "Bad");
			expect("error" in r ? r.error : "compiled").toMatch(want);
		}
		const imp = compile('import fs from "node:fs";\nexport const Bad = () => null;', "Bad");
		expect("error" in imp ? imp.error : "").toMatch(/import only from react, remotion/);
		expect("error" in compile("export const Other = () => null;", "Bad") ? "refused" : "ok").toBe("refused");
	});
});

describe("budget and memory on disk", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gz-connect-"));
	beforeAll(() => {
		process.env.STUDIO_SUPPORT_DIR = dir;
		process.env.STUDIO_DATA_DIR = path.join(dir, "Studio");
	});

	test("a video's budget: the default, the user's own, what was spent per provider", async () => {
		const b = await import("../server/budget");
		const first = b.budgetView("p1");
		expect(first.budget).toBe(1);
		expect(first.left).toBe(1);
		b.setProjectBudget("p1", 5);
		b.recordSpend("p1", { what: "a picture", usd: 0.03, api: "fal" });
		const v = b.recordSpend("p1", { what: "a clip", usd: 0.2419, api: "kie" });
		expect(v.budget).toBe(5);
		expect(v.spent).toBeCloseTo(0.2719, 6);
		expect(v.left).toBeCloseTo(4.7281, 6);
		expect(v.byApi).toEqual({ fal: 0.03, kie: 0.2419 });
		expect(b.budgetView("p2").spent).toBe(0);
	});

	test("the memory text names the cast and stays short", async () => {
		const m = await import("../server/memory");
		const file = m.keepPicture("Anna", Buffer.from([1, 2, 3, 4]), "png");
		m.saveCharacter({ name: "Anna", description: "red hair, 25", voice: "vivian", files: [file] });
		m.noteTaste("kept", [{ cat: "captions", value: "hormozi" }]);
		m.noteTaste("undone", [{ cat: "transition", value: "glitch" }]);
		const text = m.memoryText();
		expect(text).toMatch(/Anna — red hair, 25 \(voice vivian\), 1 picture/);
		expect(text).toMatch(/captions: keeps hormozi/);
		expect(text).toMatch(/undid glitch/);
		expect(text.length).toBeLessThan(6000);
		expect(fs.existsSync(m.pictureFile(file))).toBe(true);
		expect(() => m.pictureFile("../../budget.json")).toThrow();
	});
});
