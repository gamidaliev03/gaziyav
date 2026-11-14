import { describe, expect, test } from "bun:test";
import { isDamagedProjectRecord } from "../runner";

// A damaged save is not an old format: the runner must leave it for loadProjectOrBackup (03.11: migrated as «v0, no
// scenes yet», it came back as an empty project and the user's work looked gone although ten ⌘S copies were there).
describe("isDamagedProjectRecord", () => {
	test("no scenes yet is a new project, not damage", () => {
		expect(isDamagedProjectRecord({ project: { id: "a", metadata: { id: "a", name: "new" } } })).toBe(false);
		expect(isDamagedProjectRecord({ project: { id: "a", metadata: { id: "a" }, scenes: null } })).toBe(false);
	});

	test("a legacy v0 record without scenes migrates as before", () => {
		expect(isDamagedProjectRecord({ project: { id: "a", name: "old", tracks: [] } })).toBe(false);
	});

	test("scenes that are not a list, or a scene without an object of tracks, are damage", () => {
		expect(isDamagedProjectRecord({ project: { id: "a", metadata: { id: "a" }, scenes: "not scenes" } })).toBe(true);
		expect(isDamagedProjectRecord({ project: { id: "a", metadata: { id: "a" }, scenes: [null] } })).toBe(true);
		expect(isDamagedProjectRecord({ project: { id: "a", metadata: { id: "a" }, scenes: [{ id: "s", tracks: 5 }] } })).toBe(true);
	});

	test("whole scenes pass", () => {
		expect(isDamagedProjectRecord({ project: { id: "a", metadata: { id: "a" }, scenes: [{ id: "s", tracks: { main: { elements: [] }, overlay: [], audio: [] } }] } })).toBe(false);
	});
});
