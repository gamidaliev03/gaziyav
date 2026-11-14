import { beforeAll, describe, expect, test } from "bun:test";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";
import type { SceneTracks, TimelineElement } from "@/timeline/types";

// Where a press is a trim and which one (zones.ts), the numbers an editor types (format.ts), the edge the keys pick
// (keys.ts) and the keys themselves in both presets.
let zones: typeof import("../zones");
let format: typeof import("../format");
let keys: typeof import("../keys");
let presets: typeof import("@/actions/keybindings/presets");
let migrations: typeof import("@/actions/keybindings/migrations");
let definitions: typeof import("@/actions/definitions");

beforeAll(async () => {
	await installOpenCutWasm();
	zones = await import("../zones");
	format = await import("../format");
	keys = await import("../keys");
	presets = await import("@/actions/keybindings/presets");
	migrations = await import("@/actions/keybindings/migrations");
	definitions = await import("@/actions/definitions");
}, 120_000);

const S = 120000;
/** Three clips at 100 px a second: a 0–2 s, b 2–4 s (they touch), a gap, c 5–6 s. */
const clips = [
	{ id: "a", start: 0, end: 2 * S },
	{ id: "b", start: 2 * S, end: 4 * S },
	{ id: "c", start: 5 * S, end: 6 * S },
];
const none = { alt: false, meta: false, shift: false };

describe("pointer zones", () => {
	/** The zone at x pixels. */
	const at = (x: number, tool: "select" | "trim") => zones.zoneAt({ clips, time: (x / 100) * S, pps: 100, tool });
	const press = (x: number, tool: "select" | "trim", held: Partial<typeof none> = {}) => {
		const target = zones.trimForPress({ zone: at(x, tool), tool, keys: { ...none, ...held }, trackId: "t" });
		if (!target) return null;
		return target.kind === "roll" ? `roll ${target.leftId}|${target.rightId}` : target.kind === "ripple" ? `ripple ${target.elementId} ${target.side}` : `${target.kind} ${target.elementId}`;
	};

	test("Select tool never rolls: on a cut the cut is the boundary — left of it a's tail, right of it b's head", () => {
		// the cut a|b is at 200 px: no roll anywhere, and the plain press is the old trim handles' (nothing of ours)
		expect([press(198, "select"), press(199.9, "select"), press(200, "select"), press(202, "select")]).toEqual([null, null, null, null]);
		const edge = (x: number) => {
			const z = at(x, "select");
			return z?.at === "edge" ? `${z.clip.id} ${z.side}` : (z?.at ?? null);
		};
		// on the cut each edge is all inside its clip (in + out = 12 px on a wide clip); a free edge keeps 2.5 px outside
		expect([edge(188), edge(199.9), edge(200), edge(211.9), edge(213)]).toEqual(["a right", "a right", "b left", "b left", "body"]);
		expect([edge(402), edge(403), edge(497.6), edge(497)]).toEqual(["b right", null, "c left", null]);
		// a clip's body, a free edge and a gap: nothing of ours for a plain press
		expect([press(100, "select"), press(399, "select"), press(450, "select"), press(503, "select")]).toEqual([null, null, null, null]);
	});

	test("Select tool with keys: ⌥ on an edge ripples it, ⌥⌘ in a clip slips it, ⇧⌥⌘ slides it", () => {
		expect([press(195, "select", { alt: true }), press(205, "select", { alt: true }), press(397, "select", { alt: true }), press(503, "select", { alt: true })]).toEqual([
			"ripple a right",
			"ripple b left",
			"ripple b right",
			"ripple c left",
		]);
		// ⌥ exactly on the cut: the edge on the pointer's side
		expect([press(199, "select", { alt: true }), press(201, "select", { alt: true })]).toEqual(["ripple a right", "ripple b left"]);
		expect([press(100, "select", { alt: true, meta: true }), press(100, "select", { alt: true, meta: true, shift: true })]).toEqual(["slip a", "slide a"]);
		// ⌥ alone in a clip is the duplicate drag; ⌘ or ⇧ alone the move without snapping
		expect([press(100, "select", { alt: true }), press(100, "select", { meta: true }), press(100, "select", { shift: true })]).toEqual([null, null, null]);
	});

	test("Trim tool: the zones are explicit and wider — a cut rolls, an edge ripples, a body slips (⌥: slides)", () => {
		expect([press(196, "trim"), press(200, "trim"), press(204, "trim")]).toEqual(["roll a|b", "roll a|b", "roll a|b"]);
		expect([press(190, "trim"), press(195, "trim"), press(205, "trim"), press(212, "trim")]).toEqual(["ripple a right", "ripple a right", "ripple b left", "ripple b left"]);
		// free edges: a's head, b's tail (2.5 px outside too), c's both
		expect([press(5, "trim"), press(390, "trim"), press(402, "trim"), press(498, "trim"), press(595, "trim")]).toEqual(["ripple a left", "ripple b right", "ripple b right", "ripple c left", "ripple c right"]);
		expect([press(100, "trim"), press(100, "trim", { alt: true }), press(300, "trim"), press(550, "trim")]).toEqual(["slip a", "slide a", "slip b", "slip c"]);
		expect(press(450, "trim")).toBeNull();
	});

	test("clips a few pixels wide: no roll with the Select tool, and an edge strip never takes more than 40 % of a clip", () => {
		const narrow = [
			{ id: "a", start: 0, end: 0.2 * S },
			{ id: "b", start: 0.2 * S, end: 0.4 * S },
		];
		const zone = (x: number, tool: "select" | "trim") => zones.zoneAt({ clips: narrow, time: (x / 100) * S, pps: 100, tool });
		// both are 20 px wide: the cut at 20 px has no roll strip with the Select tool, a narrow one with the Trim tool
		expect([zone(20, "select")?.at, zone(21, "trim")?.at, zone(23, "trim")?.at]).toEqual(["edge", "cut", "edge"]);
		// Select tool, 20 px clips on the cut at 20 px: each edge 40 % of its clip inside it (8 px), the middle the body
		expect([zone(12.5, "select")?.at, zone(19, "select")?.at, zone(27.5, "select")?.at, zone(30, "select")?.at]).toEqual(["edge", "edge", "edge", "body"]);
		// 40 % of 20 px = 8 px of edge strip, the middle stays the body
		expect([zone(10, "trim")?.at, zone(7, "trim")?.at, zone(13, "trim")?.at]).toEqual(["body", "edge", "edge"]);
	});
});

describe("typed numbers", () => {
	const fps25 = { numerator: 25, denominator: 1 };
	const ntsc = { numerator: 30000, denominator: 1001 };
	const film = { numerator: 24000, denominator: 1001 };

	test("«+12» is frames, «-1:05» a second and five frames back; a second is the rate's timecode second", () => {
		const read = (text: string, fps = fps25) => format.parseTypedFrames(text, fps);
		expect([read("+12"), read("12"), read("-12"), read("−12"), read(" + 7 ")]).toEqual([12, 12, -12, -12, 7]);
		expect([read("-1:05"), read("+1:00"), read("1:00:00"), read("1.05"), read("1;05")]).toEqual([-30, 25, 1500, 30, 30]);
		expect([read("+1:05", ntsc), read("+1:05", film), read("2:00", film)]).toEqual([35, 29, 48]);
		expect([read(""), read("+"), read("abc"), read("1:2:3:4:5"), read("--3")]).toEqual([null, null, null, null, null]);
	});

	test("the readout: frames with their sign, the change as a short timecode", () => {
		expect([format.formatFrames(12 * 4800, 4800), format.formatFrames(-7 * 4800, 4800), format.formatFrames(0, 4800), format.formatFrames(12000, 4800)]).toEqual(["+12", "−7", "0", "+2.5"]);
		expect([format.formatDeltaTimecode(12 * 4800, 4800, fps25), format.formatDeltaTimecode(-30 * 4800, 4800, fps25), format.formatDeltaTimecode(1600 * 4800, 4800, fps25), format.formatDeltaTimecode(0, 4800, fps25)]).toEqual([
			"+00:12",
			"−01:05",
			"+01:04:00",
			"00:00",
		]);
		// drop-frame rates keep their «;»
		expect(format.formatDeltaTimecode(45 * 4004, 4004, ntsc)).toBe("+01;15");
	});
});

describe("the edge nearest the playhead", () => {
	const el = (id: string, start: number, length: number) => ({ id, name: id, type: "video", startTime: start * S, duration: length * S, trimStart: 0, trimEnd: 0, params: {} }) as unknown as TimelineElement;
	const tracks = {
		overlay: [{ id: "o", name: "O", type: "video", elements: [el("p", 1, 2)], muted: false, hidden: false }],
		main: { id: "main", name: "Main", type: "video", elements: [el("b", 2, 2), el("a", 0, 2), el("c", 4, 3)], muted: false, hidden: false },
		audio: [],
	} as unknown as SceneTracks;
	const pick = (time: number, which: "out" | "in" | "roll", trackId = "main") => {
		const found = keys.nearestEdit({ tracks, trackId, time: time * S, pick: which });
		if (!found) return null;
		return found.kind === "roll" ? `${found.leftId}|${found.rightId}` : `${found.elementId} ${found.side}`;
	};

	test("[ takes the end of the clip before the nearest cut, ] the start of the one after it, \\ both", () => {
		expect([pick(2.2, "out"), pick(2.2, "in"), pick(2.2, "roll")]).toEqual(["a right", "b left", "a|b"]);
		expect([pick(3.6, "out"), pick(3.6, "in"), pick(3.6, "roll")]).toEqual(["b right", "c left", "b|c"]);
		// at the very end: the last clip's end; its start is nearer than any cut's right side
		expect([pick(7, "out"), pick(7, "roll")]).toEqual(["c right", "b|c"]);
		// a track with one clip has edges but no cut
		expect([pick(0, "out", "o"), pick(0, "in", "o"), pick(0, "roll", "o")]).toEqual(["p right", "p left", null]);
	});

	test("a picked edge knows where it is now, and when its clips are gone", () => {
		expect(keys.editTime(tracks, { kind: "roll", trackId: "main", leftId: "a", rightId: "b" })).toBe(2 * S);
		expect(keys.editTime(tracks, { kind: "ripple", trackId: "main", elementId: "c", side: "right" })).toBe(7 * S);
		expect(keys.editTime(tracks, { kind: "roll", trackId: "main", leftId: "a", rightId: "c" })).toBeNull();
		expect(keys.editTime(tracks, { kind: "ripple", trackId: "main", elementId: "gone", side: "left" })).toBeNull();
	});
});

describe("the trim keys", () => {
	test("both presets carry them: T, «,» «.» (⇧: many), ⌥, ⌥. slip, + − a number; the edge keys are Final Cut's [ ] \\ there, ⇧[ ⇧] \\ in CapCut", () => {
		for (const preset of ["capcut", "finalcut"] as const) {
			const bound = presets.getPresetBindings({ preset });
			const key = (shortcut: string) => bound.get(shortcut as never);
			expect([preset, key("t"), key(","), key("."), key("shift+,"), key("shift+.")]).toEqual([preset, "tool-trim", "nudge-left", "nudge-right", "nudge-left-large", "nudge-right-large"]);
			expect([preset, key("alt+,"), key("alt+."), key("alt+shift+,"), key("alt+shift+.")]).toEqual([preset, "slip-left", "slip-right", "slip-left-large", "slip-right-large"]);
			expect([preset, key("="), key("shift+="), key("-"), key("alt+="), key("alt+-")]).toEqual([preset, "trim-type-plus", "trim-type-plus", "trim-type-minus", "slip-type-plus", "slip-type-minus"]);
			expect([preset, key("\\")]).toEqual([preset, "trim-select-roll"]);
		}
		const capcut = presets.getPresetBindings({ preset: "capcut" });
		const finalcut = presets.getPresetBindings({ preset: "finalcut" });
		expect([capcut.get("shift+[" as never), capcut.get("shift+]" as never), capcut.get("[" as never), capcut.get("]" as never)]).toEqual(["trim-select-out", "trim-select-in", "select-backward", "select-forward"]);
		expect([finalcut.get("[" as never), finalcut.get("]" as never)]).toEqual(["trim-select-out", "trim-select-in"]);
		// CapCut's own keys are all still CapCut's (⌥⇧+ / ⌥⇧− zoom the player); the volume left ⌘, (the Mac's Settings) for ⌥⌘, / ⌥⌘.
		expect([capcut.get("alt+shift+=" as never), capcut.get("alt+shift+-" as never), capcut.get("alt+cmd+," as never), capcut.get("alt+cmd+." as never)]).toEqual(["player-zoom-in", "player-zoom-out", "volume-down", "volume-up"]);
	});

	test("every trim command is a real, listed command", () => {
		const listed = new Set(definitions.getListedActions() as string[]);
		for (const action of ["tool-trim", "trim-select-out", "trim-select-in", "trim-select-roll", "slip-left", "slip-right", "slip-left-large", "slip-right-large", "trim-type-plus", "trim-type-minus", "slip-type-plus", "slip-type-minus"]) {
			expect([action, listed.has(action)]).toEqual([action, true]);
		}
	});

	test("a saved keymap: unchanged follows its preset; customized keeps its keys and gets the trim keys that are free", () => {
		const run = (state: object) => migrations.runMigrations({ state, fromVersion: 16 }) as { preset: string; keybindings: Record<string, string> };
		expect(run({ keybindings: { q: "split-left" }, isCustomized: false, preset: "finalcut" }).keybindings["["]).toBe("trim-select-out");
		const custom = run({ keybindings: { t: "add-title", "cmd+b": "split" }, isCustomized: true, preset: "capcut" });
		expect([custom.keybindings.t, custom.keybindings["cmd+b"], custom.keybindings[","], custom.keybindings["\\"], custom.keybindings["shift+["], custom.keybindings["="]]).toEqual(["add-title", "split", "nudge-left", "trim-select-roll", "trim-select-out", "trim-type-plus"]);
	});
});
