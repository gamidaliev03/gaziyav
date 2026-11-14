import { expect, test } from "bun:test";
import { GRADE_LOOKS } from "@/effects/luts/grades";
import { LOOKS } from "@/effects/luts/looks";

type RGB = [number, number, number];
const hue = ([r, g, b]: RGB) => {
	const max = Math.max(r, g, b);
	const d = max - Math.min(r, g, b);
	if (d < 1e-6) return 0;
	const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return (h * 60 + 360) % 360;
};
const SAMPLES: RGB[] = [];
for (const r of [0, 0.25, 0.5, 0.75, 1]) for (const g of [0, 0.25, 0.5, 0.75, 1]) for (const b of [0, 0.25, 0.5, 0.75, 1]) SAMPLES.push([r, g, b]);

test("100+ looks in the Filters browser, every grade has a group and a preview theme", () => {
	expect(LOOKS.length).toBeGreaterThanOrEqual(100);
	expect(new Set(LOOKS.map((l) => l.id)).size).toBe(LOOKS.length);
	for (const look of GRADE_LOOKS) {
		expect(look.category.length).toBeGreaterThan(0);
		expect(look.theme.length).toBeGreaterThan(0);
	}
});

test("every grade stays in range (no NaN), a light grey isn't clipped, grades differ from each other", () => {
	const signature = new Set<string>();
	for (const look of GRADE_LOOKS) {
		for (const c of SAMPLES) {
			for (const v of look.fn(c)) {
				expect(Number.isFinite(v)).toBe(true);
				expect(v).toBeGreaterThanOrEqual(0);
				expect(v).toBeLessThanOrEqual(1);
			}
		}
		const light = look.fn([0.88, 0.88, 0.88]);
		expect(Math.max(...light)).toBeLessThan(0.995);
		signature.add(SAMPLES.filter((_, i) => i % 7 === 0).map((c) => look.fn(c).map((v) => v.toFixed(2)).join(",")).join("|"));
	}
	expect(signature.size).toBe(GRADE_LOOKS.length);
});

test("skin keeps a skin hue under every colour grade (no green or blue faces)", () => {
	const skins: RGB[] = [
		[0.87, 0.67, 0.55],
		[0.72, 0.5, 0.38],
		[0.45, 0.3, 0.22],
		[0.95, 0.8, 0.7],
	];
	for (const look of GRADE_LOOKS) {
		if (/^g\.(bw|sepia|selenium|cyanotype|silverScreen|duotone|noir|grainyMono|oldPhoto|matrix|underwater|dayForNight)/.test(look.id)) continue;
		for (const skin of skins) {
			const h = hue(look.fn(skin));
			expect(h < 60 || h > 330).toBe(true);
		}
	}
});
