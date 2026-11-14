import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

// Secondary text has to stay readable on the surfaces it sits on (WCAG AA: 4.5:1 for small text). The values are
// read from globals.css, so a token change that makes labels too faint fails here.
const css = fs.readFileSync(path.join(import.meta.dir, "../../../app/globals.css"), "utf8");

function token(theme: "dark", name: string): string {
	const block = css.match(/\n\.dark \{([\s\S]*?)\n\}/)?.[1] ?? "";
	const value = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
	if (!value) throw new Error(`${theme} --${name} not found`);
	return value;
}

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex: string) => {
	const [r, g, b] = rgb(hex).map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};
/** `fg` at `alpha` over `bg`, as the browser paints `text-foreground/65`. */
const over = (fg: string, alpha: number, bg: string) => {
	const [f, b] = [rgb(fg), rgb(bg)];
	return `#${f.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
};

describe("dark theme: secondary text is readable", () => {
	const background = token("dark", "background");
	const card = token("dark", "card");
	const muted = token("dark", "muted");
	const foreground = token("dark", "foreground");
	const secondary = token("dark", "muted-foreground");

	test("muted text on the page and on panels", () => {
		expect(contrast(secondary, background)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(secondary, card)).toBeGreaterThanOrEqual(4.5);
	});

	test("an unselected segment (text-foreground/65 on bg-muted)", () => {
		expect(contrast(over(foreground, 0.65, muted), muted)).toBeGreaterThanOrEqual(4.5);
	});

	// Until design round 2 (14.11) the slate palette put bare muted text on bg-muted right at the line (≈4.5), which is
	// why segments use foreground/65. Round 2's dark tokens lifted muted text well above it (≈7.1): the rule that
	// matters is that BOTH are readable — a look that drops either below the line is the bug.
	test("bare muted text on bg-muted is readable too (the lead, 14.11: the old «only just readable» premise is gone)", () => {
		expect(contrast(secondary, muted)).toBeGreaterThanOrEqual(4.5);
	});
});
