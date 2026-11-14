import { describe, expect, test } from "bun:test";
import type { MediaAsset } from "@/media/types";
import { unusedToolCopies } from "../unused-copies";

const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 10, 14);
const file = (ageDays: number) => new File(["x"], "f.mp4", { lastModified: NOW - ageDays * DAY });
const asset = (id: string, ageDays: number, neural?: Partial<NonNullable<MediaAsset["neural"]>>): MediaAsset =>
	({
		id,
		name: id,
		type: "video",
		file: file(ageDays),
		...(neural ? { neural: { effect: "ai.enhance", key: id, label: "Enhance", params: {}, sourceId: "own", originalId: "own", offset: 0, ...neural } } : {}),
	}) as MediaAsset;
const project = (ids: Array<{ mediaId: string; aiOff?: string }>) => ({ scenes: [{ tracks: { main: { elements: ids }, overlay: [], audio: [] } }] });
const names = (list: MediaAsset[]) => list.map((a) => a.id).sort();

describe("copies of on-device tools that no clip uses go when the project opens", () => {
	test("an old copy no clip names goes; the user's own files never do", () => {
		const assets = [asset("own", 40), asset("copy", 10, {})];
		expect(names(unusedToolCopies({ project: project([{ mediaId: "own" }]), assets, now: NOW }))).toEqual(["copy"]);
		expect(unusedToolCopies({ project: project([]), assets: [asset("own", 40)], now: NOW })).toEqual([]);
	});
	test("a copy a clip shows stays, and so does what it was made from and its export copy", () => {
		const assets = [asset("own", 40), asset("step1", 10, { sourceId: "own" }), asset("step2", 10, { sourceId: "step1", exportId: "fine" }), asset("fine", 10, { sourceId: "step1" })];
		expect(unusedToolCopies({ project: project([{ mediaId: "step2" }]), assets, now: NOW })).toEqual([]);
	});
	test("a tool switched off keeps its copy (the clip names it as aiOff)", () => {
		const assets = [asset("own", 40), asset("copy", 10, {})];
		expect(unusedToolCopies({ project: project([{ mediaId: "own", aiOff: "copy" }]), assets, now: NOW })).toEqual([]);
	});
	test("a copy made in the last three days stays (its session may still be recovered)", () => {
		const assets = [asset("own", 40), asset("fresh", 1, {}), asset("old", 5, {})];
		expect(names(unusedToolCopies({ project: project([{ mediaId: "own" }]), assets, now: NOW }))).toEqual(["old"]);
	});
	test("paid results and the parts of a song are never touched", () => {
		const assets = [asset("swap", 40, { effect: "ai.faceSwap" }), asset("vocals", 40, { effect: "ai.separate" }), asset("part", 40, { effect: "ai.parts" })];
		expect(unusedToolCopies({ project: project([]), assets, now: NOW })).toEqual([]);
	});
	test("a project that can't be read deletes nothing", () => {
		const loop: Record<string, unknown> = {};
		loop.self = loop;
		expect(unusedToolCopies({ project: loop, assets: [asset("copy", 10, {})], now: NOW })).toEqual([]);
	});
});
