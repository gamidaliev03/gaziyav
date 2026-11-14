import { expect, test } from "bun:test";
import { withValidFps } from "@/core/managers/project-manager";
import type { TProject } from "@/project/types";

const project = (fps: unknown) => ({ settings: { fps } }) as unknown as TProject;

test("a damaged frame rate opens as 30 fps; a good one is kept", () => {
	for (const bad of [{ numerator: 0, denominator: 1 }, { numerator: 30, denominator: 0 }, { numerator: Number.NaN, denominator: 1 }, { numerator: -24, denominator: 1 }, null]) {
		expect(withValidFps(project(bad)).settings.fps).toEqual({ numerator: 30, denominator: 1 });
	}
	const ntsc = project({ numerator: 30000, denominator: 1001 });
	expect(withValidFps(ntsc)).toBe(ntsc);
});
