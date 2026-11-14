// «Claude at work» on the editor's real history (core/managers/commands.ts): which entries are Claude's steps and which
// the person's, what the card may undo and what it must not, one ⇧⌘Z for a whole undo, and the lines Claude gets.
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { Command } from "@/commands";
import type { TProject } from "@/project/types";

let core: typeof import("@/core");
let scenes: typeof import("@/timeline/scenes");
let feed: typeof import("../feed");
let history: typeof import("../history");
let store: typeof import("../store");

beforeAll(async () => {
	await installOpenCutWasm();
	core = await import("@/core");
	scenes = await import("@/timeline/scenes");
	const storage = await import("@/services/storage/service");
	const service = storage.storageService as unknown as Record<string, unknown>;
	service.saveProject = async () => {};
	feed = await import("../feed");
	history = await import("../history");
	store = await import("../store");
}, 120_000);

/** What the fake steps add up to: a step of 10 adds 10; its undo takes 10 away. */
let film: number[] = [];
const step = (n: number): Command =>
	({
		execute() {
			film.push(n);
			return undefined;
		},
		undo() {
			film.splice(film.lastIndexOf(n), 1);
		},
		redo() {
			film.push(n);
			return undefined;
		},
	}) as unknown as Command;

function project(id: string): TProject {
	const scene = scenes.buildDefaultScene({ name: "Main", isMain: true });
	return {
		metadata: { id, name: id, createdAt: new Date(0), updatedAt: new Date(0) },
		scenes: [scene],
		currentSceneId: scene.id,
		settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: 1080, height: 1920 }, background: { type: "color", color: "#000000" } },
		version: 1,
	} as unknown as TProject;
}

let n = 0;
function open(id = `p${++n}`) {
	const { EditorCore } = core;
	EditorCore.reset();
	history.forgetLine();
	const editor = EditorCore.getInstance();
	editor.save.stop();
	const p = project(id);
	editor.project.setActiveProject({ project: p });
	editor.scenes.setScenes({ scenes: p.scenes, activeSceneId: p.currentSceneId });
	film = [];
	store.useAgent.setState({ sessions: {}, live: [], line: {}, seen: {}, open: false, paused: false, pausedBy: null, held: [] });
	feed.editorOpened(id);
	return { editor, id, cmd: editor.command };
}

const by = (id: string, tool: string, args: Record<string, unknown> = {}) => ({ id, tool, args });
/** A call of Claude's from start to answer; `work` is what it does to the history meanwhile. */
function claude(call: ReturnType<typeof by>, work: () => void, answer: { ok: boolean; content: string } = { ok: true, content: "Done. [rev 1]" }, info: { stopped?: string } = {}) {
	const project = core.EditorCore.getInstance().project.getActiveOrNull()?.metadata.id ?? "";
	feed.agentFeed.started(call, new AbortController(), false);
	work();
	return feed.agentFeed.finished(call, answer, { landed: project ? { id: project } : null, ...info });
}
const rows = (id: string) => store.useAgent.getState().sessions[id]?.rows ?? [];
const kinds = (id: string) => rows(id).map((r) => `${r.kind}:${r.state}`);
const undoOf = (id: string, row: string) => {
	const s = store.useAgent.getState();
	const r = rows(id).find((x) => x.id === row);
	return r ? store.undoKind(r, s.line, s.epoch) : "missing";
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("whose each step of the history is", () => {
	let p: ReturnType<typeof open>;
	beforeEach(() => {
		p = open();
	});

	test("Claude's calls are rows; the person's own edits are not, before or after", () => {
		p.cmd.execute({ command: step(1) }); // the person, before Claude came
		claude(by("c1", "edit", { ops: [{ op: "split", time: 3 }, { op: "trim", id: "clip 2", end: 4 }] }), () => {
			p.cmd.execute({ command: step(10) });
			p.cmd.execute({ command: step(11) });
		});
		p.cmd.execute({ command: step(2) }); // the person, after
		claude(by("c2", "place", { item: "text:hook-bold", text: "Hello", at: 0 }), () => p.cmd.execute({ command: step(20) }));
		expect(kinds(p.id)).toEqual(["step:ok", "step:ok"]);
		expect(history.lineOwners()).toEqual(["", "c1", "c1", "you", "c2"]);
		const { line } = store.useAgent.getState();
		expect(line.c1).toEqual({ on: 2, off: 0, you: true, above: ["c2"] });
		expect(line.c2).toEqual({ on: 1, off: 0, you: false, above: [] });
		expect(rows(p.id).map((r) => r.label)).toEqual(["edit (2 steps)", "place text:hook-bold @0"]);
	});

	test("calls that only look are one quiet row, however many", () => {
		claude(by("r1", "get_project"), () => {});
		claude(by("r2", "look", { what: "frames", at: [1] }), () => {});
		claude(by("r3", "analyze", { what: "words" }), () => {});
		expect(rows(p.id).map((r) => [r.kind, r.state, r.reads])).toEqual([["reads", "ok", ["project", "frames", "footage"]]]);
		claude(by("c1", "edit", { ops: [{ op: "captions" }] }), () => p.cmd.execute({ command: step(10) }));
		claude(by("r4", "look", { what: "frames" }), () => {});
		claude(by("r5", "look", { what: "frames" }), () => {});
		expect(rows(p.id).map((r) => [r.kind, r.reads?.length ?? 0])).toEqual([["reads", 3], ["step", 0], ["reads", 2]]);
		expect(rows(p.id)[2].done).toEqual({ k: "Looked at frames" });
		// a read that failed says nothing; a run of only failed reads leaves no row
		const q = open();
		claude(by("r6", "get_project"), () => {}, { ok: false, content: "Error: No project is open." });
		expect(rows(q.id)).toEqual([]);
	});

	test("a row while it runs, when it fails and when it is stopped", () => {
		const call = by("c1", "generate", { kind: "video", prompt: "a sunrise over the sea" });
		feed.agentFeed.started(call, new AbortController(), true);
		expect(rows(p.id).map((r) => [r.state, r.now?.k])).toEqual([["waiting", "generating a video"]]);
		feed.agentFeed.running("c1");
		expect(rows(p.id)[0].state).toBe("running");
		expect(store.useAgent.getState().live.map((c) => [c.id, c.waiting, c.read, c.background, c.paid])).toEqual([["c1", false, false, true, true]]);
		feed.agentFeed.finished(call, { ok: true, content: "Stopped (the user pressed Stop in Gaziyav): fal.ai had started it (≈ $0.12 charged); it lands in Media → Generate when ready" }, { landed: { id: p.id }, stopped: "the user pressed Stop in Gaziyav" });
		expect(rows(p.id).map((r) => [r.state, r.usd, r.why?.k])).toEqual([["stopped", 0.12, "≈ {price} was already charged; the result lands in Media"]]);
		expect(store.useAgent.getState().live).toEqual([]);
		claude(by("c2", "generate", { kind: "image", prompt: "x" }), () => {}, { ok: false, content: "Error: Not run: a picture costs $0.03 on fal.ai, more than this video's budget has left ($0.01 of $1.00). Nothing was spent." });
		expect(rows(p.id)[1]).toMatchObject({ state: "failed", why: { k: "It would go over this video's budget" } });
		claude(by("c3", "generate", { kind: "image", prompt: "y" }), () => {}, { ok: true, content: "Stopped (x): Stopped before fal.ai started it: nothing charged." }, { stopped: "x" });
		expect(rows(p.id)[2]).toMatchObject({ state: "stopped", why: { k: "Nothing was charged" } });
		expect(rows(p.id)[2].usd).toBeUndefined();
	});

	test("a call made with no project open gets its row in the project it opened", () => {
		core.EditorCore.getInstance().project.closeProject();
		const call = by("c0", "project", { action: "create", name: "Reel" });
		feed.agentFeed.started(call, new AbortController(), false);
		expect(Object.keys(store.useAgent.getState().sessions)).toEqual([]);
		feed.agentFeed.finished(call, { ok: true, content: "Created project abc" }, { landed: { id: "new-1" } });
		expect(rows("new-1").map((r) => [r.state, r.done])).toEqual([["ok", { k: "Created the project «{name}»", v: { name: "Reel" } }]]);
	});
});

describe("undo from the card", () => {
	let p: ReturnType<typeof open>;
	beforeEach(() => {
		p = open();
		claude(by("c1", "place", { items: [{ media: "a" }, { media: "b" }] }), () => {
			p.cmd.execute({ command: step(10) });
			p.cmd.execute({ command: step(11) });
		});
		claude(by("c2", "edit", { ops: [{ op: "add_text", text: "Hi" }] }), () => p.cmd.execute({ command: step(20) }));
		claude(by("c3", "place", { item: "music:calm-04" }), () => p.cmd.execute({ command: step(30) }));
	});

	test("the newest step alone; an earlier one with Claude's steps that stand on it", () => {
		expect([undoOf(p.id, "c1"), undoOf(p.id, "c2"), undoOf(p.id, "c3")]).toEqual(["with", "with", "alone"]);
		const s = store.useAgent.getState();
		expect(store.rowsBackTo(rows(p.id), "c2", s.line, s.epoch).map((r) => r.id)).toEqual(["c2", "c3"]);
		expect(store.rowsBackTo(rows(p.id), "c3", s.line, s.epoch).map((r) => r.id)).toEqual(["c3"]);
		expect(feed.backToRow("c2")).toBe(2);
		expect(film).toEqual([10, 11]);
		expect(p.cmd.depth()).toBe(2);
		const after = store.useAgent.getState();
		expect(rows(p.id).map((r) => [r.id, store.isStruck(r, after.line, after.epoch), r.offBy])).toEqual([["c1", false, undefined], ["c2", true, "you"], ["c3", true, "you"]]);
	});

	test("one ⇧⌘Z brings the whole undo back", async () => {
		expect(feed.backToRow("c1")).toBe(4);
		expect(film).toEqual([]);
		p.cmd.redo(); // the editor's own redo, once
		await tick();
		expect(film).toEqual([10, 11, 20, 30]);
		expect(p.cmd.depth()).toBe(4);
		expect(p.cmd.canRedo()).toBe(false);
		const s = store.useAgent.getState();
		expect(rows(p.id).map((r) => [store.isStruck(r, s.line, s.epoch), r.offBy])).toEqual([[false, undefined], [false, undefined], [false, undefined]]);
		// a plain ⌘Z after that is one step of the line again
		p.cmd.undo();
		expect(film).toEqual([10, 11, 20]);
	});

	test("…and only that undo: what was undone before it stays undone", async () => {
		p.cmd.undo(); // c3, by the person
		expect(feed.backToRow("c2")).toBe(1);
		p.cmd.redo();
		await tick();
		expect(film).toEqual([10, 11, 20]);
		expect(p.cmd.canRedo()).toBe(true);
	});

	test("«Bring back» redoes to the end of the line", () => {
		feed.backToRow("c1");
		expect(feed.bringBackAll()).toBe(4);
		expect(film).toEqual([10, 11, 20, 30]);
	});

	test("never the person's work: a step with their edits above it is not offered", () => {
		p.cmd.execute({ command: step(1) }); // the person edits after Claude
		expect([undoOf(p.id, "c1"), undoOf(p.id, "c2"), undoOf(p.id, "c3")]).toEqual(["yours", "yours", "yours"]);
		expect(feed.backToRow("c3")).toBe(0);
		expect(feed.backToRow("c1")).toBe(0);
		expect(feed.undoAll()).toBe(0);
		expect(film).toEqual([10, 11, 20, 30, 1]);
		expect(p.cmd.depth()).toBe(5);
		// a step made after their edit is free again
		claude(by("c4", "edit", { ops: [{ op: "captions" }] }), () => p.cmd.execute({ command: step(40) }));
		expect([undoOf(p.id, "c3"), undoOf(p.id, "c4")]).toEqual(["yours", "alone"]);
		expect(feed.backToRow("c4")).toBe(1);
		expect(film).toEqual([10, 11, 20, 30, 1]);
	});

	test("«Undo all»: back to before Claude's first step", () => {
		expect(feed.undoAll()).toBe(4);
		expect(film).toEqual([]);
		expect(p.cmd.canRedo()).toBe(true);
	});

	test("a step that made nothing in the history has nothing to undo", () => {
		claude(by("c4", "export", { platform: "reels" }), () => {}, { ok: true, content: "Exported /Users/x/Movies/Gaziyav/reel.mp4 · 4.2 MB" });
		expect(undoOf(p.id, "c4")).toBe("none");
		expect(feed.backToRow("c4")).toBe(0);
		expect(undoOf(p.id, "c3")).toBe("alone");
	});

	test("undone steps leave the list when the history drops them; a paid one stays, struck, with its price", () => {
		claude(by("c4", "generate", { kind: "image", prompt: "Sunrise" }), () => p.cmd.execute({ command: step(40) }), { ok: true, content: '{"media":"aa","spent":"charged $0.04 on fal.ai · this video: $0.04 spent"}' });
		expect(store.spentIn(store.sessionOf(p.id))).toBe(0.04);
		expect(feed.backToRow("c3")).toBe(2);
		p.cmd.execute({ command: step(1) }); // a new edit: what was undone can't come back
		expect(rows(p.id).map((r) => [r.id, r.gone ?? false])).toEqual([["c1", false], ["c2", false], ["c4", true]]);
		const s = store.useAgent.getState();
		expect(store.isStruck(rows(p.id)[2], s.line, s.epoch)).toBe(true);
		expect(store.undoKind(rows(p.id)[2], s.line, s.epoch)).toBe("none");
		expect(store.spentIn(store.sessionOf(p.id))).toBe(0.04);
	});

	test("the history emptied (another project opened): the steps stay in the list, with nothing to undo", () => {
		p.cmd.clear();
		expect(rows(p.id).length).toBe(3);
		expect([undoOf(p.id, "c1"), undoOf(p.id, "c3")]).toEqual(["none", "none"]);
		expect(feed.undoAll()).toBe(0);
	});
});

describe("what Claude is told", () => {
	let p: ReturnType<typeof open>;
	beforeEach(() => {
		p = open();
		claude(by("c1", "place", { items: [{ media: "a" }, { media: "b" }] }), () => p.cmd.execute({ command: step(10) }));
		claude(by("c2", "edit", { ops: [{ op: "add_text", text: "Hi" }] }), () => p.cmd.execute({ command: step(20) }));
	});

	test("nothing, while nothing was undone", () => {
		expect(claude(by("r1", "get_project"), () => {}, { ok: true, content: "Project … [rev 2]" }).content).toBe("Project … [rev 2]");
	});

	test("the steps the person took back in the card, once, with the next answer", () => {
		feed.backToRow("c1");
		const next = claude(by("r1", "get_project"), () => {}, { ok: true, content: "Project … [rev 4]" });
		expect(next.content).toBe(
			"The user went back in Gaziyav: they took back your 2 steps «place ×2», «edit (1 step)». What they made is gone from the project and the ids they created no longer exist. It was on purpose: don't redo them unless they ask. Read the project as it is now (get_project) before your next change.\nProject … [rev 4]",
		);
		expect(claude(by("r2", "get_project"), () => {}, { ok: true, content: "Project … [rev 4]" }).content).toBe("Project … [rev 4]");
	});

	test("…also when the history has dropped them since (the person went on editing)", () => {
		feed.backToRow("c2");
		p.cmd.execute({ command: step(1) });
		expect(rows(p.id).map((r) => r.id)).toEqual(["c1"]);
		const next = claude(by("c3", "edit", { ops: [{ op: "captions" }] }), () => p.cmd.execute({ command: step(30) }), { ok: true, content: "1 captions ✓ [rev 6]" });
		expect(next.content).toStartWith("The user went back in Gaziyav: they took back your step «edit (1 step)». What it made is gone from the project and the ids it created no longer exist. It was on purpose: don't redo it unless they ask.");
		expect(next.content).toEndWith("\n1 captions ✓ [rev 6]");
	});

	test("not what they brought back before Claude's next call", () => {
		feed.backToRow("c1");
		feed.bringBackAll();
		expect(claude(by("r1", "get_project"), () => {}, { ok: true, content: "Project …" }).content).toBe("Project …");
	});

	test("…and what they bring back after Claude was told it was gone", () => {
		feed.backToRow("c2");
		expect(claude(by("r1", "get_project"), () => {}, { ok: true, content: "Project …" }).content).toStartWith("The user went back in Gaziyav: they took back your step «edit (1 step)».");
		feed.bringBackAll();
		expect(claude(by("r2", "get_project"), () => {}, { ok: true, content: "Project …" }).content).toBe("The user brought your step «edit (1 step)» back in Gaziyav: what it made is in the project again, with the same ids.\nProject …");
		expect(claude(by("r3", "get_project"), () => {}, { ok: true, content: "Project …" }).content).toBe("Project …");
		// brought back and taken away again before Claude's next call: only what is true now
		feed.backToRow("c2");
		claude(by("r4", "get_project"), () => {}, { ok: true, content: "Project …" });
		feed.bringBackAll();
		feed.backToRow("c2");
		expect(claude(by("r5", "get_project"), () => {}, { ok: true, content: "Project …" }).content).toStartWith("The user went back in Gaziyav: they took back your step «edit (1 step)».");
	});

	test("a call stopped by the person's own Stop: where things stand and what to do next", () => {
		store.useAgent.setState({ paused: true, pausedBy: "stop" });
		const stopped = claude(by("c3", "export", { platform: "reels" }), () => {}, { ok: false, content: "Stopped: export reels (the user pressed Stop in Gaziyav) after 4 s. What it changed before it stopped stays (undo takes it back)." }, { stopped: "the user pressed Stop in Gaziyav" });
		expect(stopped.content).toBe(
			"Stopped: export reels (the user pressed Stop in Gaziyav) after 4 s. What it changed before it stopped stays (undo takes it back).\nThe user pressed Stop in Gaziyav and editing is paused now. Don't start this again by yourself: tell them in one line what was stopped (and what it had cost, if the line above says), then wait — your next change runs only after they press Continue and tell you to go on.",
		);
		// stopped from Claude's side (its own Stop button): no pause here, nothing to add
		store.useAgent.setState({ paused: false, pausedBy: null });
		expect(claude(by("c4", "export", { platform: "reels" }), () => {}, { ok: false, content: "Stopped: export reels (the user pressed Stop) after 2 s." }, { stopped: "the user pressed Stop" }).content).toBe("Stopped: export reels (the user pressed Stop) after 2 s.");
	});

	test("not Claude's own undo", () => {
		claude(by("u1", "undo", {}), () => p.cmd.undo(), { ok: true, content: "Undid your last call. [rev 3]" });
		expect(rows(p.id).map((r) => [r.id, r.offBy])).toEqual([["c1", undefined], ["c2", "claude"], ["u1", undefined]]);
		expect(claude(by("r1", "get_project"), () => {}, { ok: true, content: "Project …" }).content).toBe("Project …");
	});
});

describe("the header pill", () => {
	const at = 1_000_000;
	const session = (lastAt: number, state: "ok" | "failed" = "ok") => ({ rows: [{ id: "c1", kind: "step" as const, at: lastAt, state }], startedAt: lastAt - 5000, lastAt, undone: [], back: [] });
	const pill = (o: Partial<Parameters<typeof store.pillState>[0]>) => store.pillState({ session: null, live: 0, paused: false, open: false, seenAt: 0, now: at, ...o });

	test("nothing when no agent has touched the project", () => {
		expect(pill({})).toBe("none");
		expect(pill({ session: { rows: [], startedAt: 0, lastAt: 0, undone: [], back: [] } })).toBe("none");
	});

	test("working → thinking (20 s) → done (60 s more, or until the card was looked at) → gone", () => {
		expect(pill({ session: session(at), live: 1 })).toBe("working");
		expect(pill({ session: session(at - 1000) })).toBe("thinking");
		expect(pill({ session: session(at - store.THINKING_MS - 1) })).toBe("done");
		expect(pill({ session: session(at - store.THINKING_MS - 1), seenAt: at })).toBe("none");
		expect(pill({ session: session(at - store.THINKING_MS - 1), seenAt: at, open: true })).toBe("done");
		expect(pill({ session: session(at - store.THINKING_MS - store.DONE_MS - 1) })).toBe("none");
	});

	test("paused wins over everything; an error in the last step shows until it was looked at", () => {
		expect(pill({ paused: true })).toBe("paused");
		expect(pill({ paused: true, session: session(at), live: 2 })).toBe("paused");
		expect(pill({ session: session(at - 1000, "failed") })).toBe("error");
		expect(pill({ session: session(at - 1000, "failed"), live: 1 })).toBe("working");
		expect(pill({ session: session(at - 1000, "failed"), seenAt: at })).toBe("thinking");
	});

	test("money as the card writes it", () => {
		expect([store.money(0.38), store.money(0.004), store.money(1), store.money(0)]).toEqual(["$0.38", "$0.004", "$1.00", "$0"]);
	});
});
