import { expect, test } from "bun:test";
import { byTime, isOpenableProject, MAX_BACKUPS_PER_PROJECT } from "@/services/storage/recovery";

test("the backup ring keeps the last 10, in time order (not text order)", () => {
	expect(MAX_BACKUPS_PER_PROJECT).toBe(10);
	const keys = ["p:999999999999", "p:1700000000000", "p:1700000000001"].sort(byTime);
	expect(keys[0]).toBe("p:999999999999");
	expect(keys.at(-1)).toBe("p:1700000000001");
});

test("a damaged save is not openable; a whole one and a new empty one are", () => {
	const scene = { id: "s", tracks: { main: { elements: [] }, overlay: [], audio: [] } };
	expect(isOpenableProject({ metadata: { id: "p" }, scenes: [scene] })).toBe(true);
	expect(isOpenableProject({ metadata: { id: "p" } })).toBe(true);
	for (const bad of [null, "x", {}, { metadata: { id: "p" }, scenes: "x" }, { metadata: { id: "p" }, scenes: [{ id: "s" }] }, { metadata: { id: "p" }, scenes: [{ tracks: { main: {}, overlay: [], audio: [] } }] }]) {
		expect(isOpenableProject(bad)).toBe(false);
	}
});
