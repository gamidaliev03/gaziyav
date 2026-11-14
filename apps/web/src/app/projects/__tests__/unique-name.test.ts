import { describe, expect, test } from "bun:test";
import { uniqueProjectName } from "../new-project";

describe("new project names", () => {
	test("a name already there gets (2), then (3) — as CapCut", () => {
		expect(uniqueProjectName("Video Oct 31, 19:51", [])).toBe("Video Oct 31, 19:51");
		expect(uniqueProjectName("Video Oct 31, 19:51", ["Video Oct 31, 19:51"])).toBe("Video Oct 31, 19:51 (2)");
		expect(uniqueProjectName("Video Oct 31, 19:51", ["Video Oct 31, 19:51", "Video Oct 31, 19:51 (2)"])).toBe("Video Oct 31, 19:51 (3)");
	});
});
