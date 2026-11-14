import { describe, expect, test } from "bun:test";
import { parseCube, sampleCube } from "../cube";

function cube3d(lines: string[]): string {
	const values: string[] = [];
	for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) values.push(`${r} ${g} ${b}`);
	return ["LUT_3D_SIZE 2", ...lines, ...values].join("\n");
}

describe(".cube DOMAIN_MIN / DOMAIN_MAX", () => {
	test("3D: the domain maps the input, so 0.5 of a 0..2 LUT is the grid's quarter, not its middle", () => {
		const cube = parseCube(cube3d(["DOMAIN_MIN 0 0 0", "DOMAIN_MAX 2 2 2"]));
		expect(sampleCube(cube, 0.5, 0.5, 0.5)).toEqual([0.25, 0.25, 0.25]);
		expect(sampleCube(cube, 1, 1, 1)).toEqual([0.5, 0.5, 0.5]);
	});

	test("3D without a domain is read as 0..1", () => {
		const cube = parseCube(cube3d([]));
		expect(sampleCube(cube, 0.5, 0.5, 0.5)).toEqual([0.5, 0.5, 0.5]);
	});

	test("1D: the domain maps the input, the LUT values stay the output", () => {
		// Picture values are 0..1; a 0..2 domain means 0.5 of the picture is a quarter into the LUT.
		const ramp = parseCube(["LUT_1D_SIZE 2", "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 2 2 2", "0 0 0", "1 1 1"].join("\n"));
		expect(sampleCube(ramp, 0.5, 0.5, 0.5)).toEqual([0.25, 0.25, 0.25]);
		expect(sampleCube(ramp, 1, 1, 1)).toEqual([0.5, 0.5, 0.5]);

		// The LUT's values are the output already: normalizing them by the domain darkened the picture
		// (0.5..1 values at a 0..2 domain came out as 0.25..0.5 instead of 0.5..1).
		const lifted = parseCube(["LUT_1D_SIZE 2", "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 2 2 2", "0.5 0.5 0.5", "1 1 1"].join("\n"));
		expect(sampleCube(lifted, 0.5, 0.5, 0.5)).toEqual([0.625, 0.625, 0.625]);
	});

	test("a broken domain falls back to 0..1 instead of dividing by zero", () => {
		const cube = parseCube(cube3d(["DOMAIN_MIN 2 2 2", "DOMAIN_MAX 2 2 2"]));
		expect(sampleCube(cube, 0.5, 0.5, 0.5).every(Number.isFinite)).toBe(true);
	});
});
