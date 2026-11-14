// project/join-on-open.ts with a slow fake store (round B, F1): the 8 s limit never lets a late write put the snapshot
// read at open over later edits, and a write already begun is waited for and shown.
import { describe, expect, test } from "bun:test";
import { type JoinDeps, joinTimelinesOnOpen } from "@/project/join-on-open";
import type { SerializedProject } from "@/services/storage/types";
import type { TProject } from "@/project/types";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sc = (id: string, isMain: boolean, n: number) => ({
	id,
	name: isMain ? "Main scene" : "Timeline 02",
	isMain,
	tracks: { overlay: [], main: { id: `${id}-m`, elements: Array.from({ length: n }, (_, i) => ({ id: `${id}-${i}`, type: "video", mediaId: "m", startTime: i * 10, duration: 10 })) }, audio: [] },
	bookmarks: [],
});
const oldDoc = () => ({ id: "p", metadata: { id: "p", name: "Old" }, scenes: [sc("a", true, 2), sc("b", false, 3)], currentSceneId: "a", version: 31 });
const shown = (doc: unknown) => ({ ...(doc as object), shown: true }) as unknown as TProject;

function fake(slow: { version?: number; save?: number }) {
	const log: string[] = [];
	let stored: unknown = oldDoc();
	const writes: string[] = [];
	const deps: JoinDeps = {
		read: async () => structuredClone(stored),
		hasJoinVersion: async () => false,
		addJoinVersion: async () => {
			await wait(slow.version ?? 0);
			writes.push("version");
		},
		save: async (doc: SerializedProject) => {
			writes.push("save-begin");
			await wait(slow.save ?? 0);
			stored = doc;
			writes.push("save-end");
		},
		deserialize: (doc) => shown(doc),
		log: (line) => log.push(line),
	};
	return { deps, log, writes, stored: () => stored as { timelineModel?: number } };
}
const asOpened = oldDoc() as unknown as TProject;

describe("join on open: the limit", () => {
	test("fast: the converted project is shown, the version first, then one save", async () => {
		const f = fake({});
		const out = (await joinTimelinesOnOpen("p", asOpened, f.deps, 200)) as unknown as { timelineModel?: number; shown?: boolean };
		expect(out.shown).toBe(true);
		expect(out.timelineModel).toBe(1);
		expect(f.writes).toEqual(["version", "save-begin", "save-end"]);
	});

	test("(a) the limit fires during the version: the old project opens and NO project write ever happens", async () => {
		const f = fake({ version: 150 });
		const out = await joinTimelinesOnOpen("p", asOpened, f.deps, 40);
		expect(out).toBe(asOpened);
		await wait(400); // long after the version would have been written
		expect(f.writes).toEqual(["version"]);
		expect(f.stored().timelineModel).toBeUndefined();
		expect(f.log).toHaveLength(1);
	});

	test("(b) the limit fires during the save: the open waits and shows the converted project", async () => {
		const f = fake({ save: 150 });
		const t0 = Date.now();
		const out = (await joinTimelinesOnOpen("p", asOpened, f.deps, 40)) as unknown as { timelineModel?: number; shown?: boolean };
		expect(Date.now() - t0).toBeGreaterThanOrEqual(140);
		expect(out.shown).toBe(true);
		expect(out.timelineModel).toBe(1);
		expect(f.writes).toEqual(["version", "save-begin", "save-end"]);
		expect(f.log).toHaveLength(0);
	});

	test("a failing save opens the old project with one line", async () => {
		const f = fake({});
		f.deps.save = async () => {
			throw new Error("quota");
		};
		const out = await joinTimelinesOnOpen("p", asOpened, f.deps, 200);
		expect(out).toBe(asOpened);
		expect(f.log).toEqual(["quota"]);
	});

	test("a version already there is not made again (a run killed before the save, a restored old version)", async () => {
		const f = fake({});
		f.deps.hasJoinVersion = async () => true;
		await joinTimelinesOnOpen("p", asOpened, f.deps, 200);
		expect(f.writes).toEqual(["save-begin", "save-end"]);
	});

	test("a marked project with two free-standing timelines: not converted, one line", async () => {
		const f = fake({});
		const marked = { ...oldDoc(), timelineModel: 1 } as unknown as TProject;
		const out = await joinTimelinesOnOpen("p", marked, f.deps, 200);
		expect(out).toBe(marked);
		expect(f.writes).toEqual([]);
		expect(f.log).toHaveLength(1);
	});
});
