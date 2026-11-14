import { beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { installOpenCutWasm } from "@/commands/__tests__/wasm-setup";

// The app carries a base set of fonts; every other family is downloaded on first use (remote-fonts.json).
let B: typeof import("@/fonts/bundled");
let R: typeof import("@/fonts/remote-catalog");
let P: typeof import("@/text/presets");
let S: typeof import("@/subtitles/styles");
beforeAll(async () => {
	await installOpenCutWasm();
	B = await import("@/fonts/bundled");
	R = await import("@/fonts/remote-catalog");
	P = await import("@/text/presets");
	S = await import("@/subtitles/styles");
});
const PUBLIC = path.join(import.meta.dir, "../../../public/fonts/bundled");

describe("fonts from the cloud", () => {
	test("a base set of 5–8 families is inside the app, every other one is in the catalog (and not in the app)", () => {
		const base = B.BUNDLED_FONTS.filter((font) => !R.REMOTE_FONTS[font.family]);
		expect(base.length).toBeGreaterThanOrEqual(5);
		expect(base.length).toBeLessThanOrEqual(8);
		for (const font of base) for (const face of font.faces) expect(fs.existsSync(path.join(PUBLIC, face.file))).toBe(true);
		for (const font of B.BUNDLED_FONTS.filter((f) => R.REMOTE_FONTS[f.family])) for (const face of font.faces) expect(fs.existsSync(path.join(PUBLIC, face.file))).toBe(false);
	});
	test("every downloaded face has its size, SHA-256, publisher address and stand-in metrics", () => {
		for (const [family, font] of Object.entries(R.REMOTE_FONTS)) {
			expect({ family, faces: font.faces.length > 0 }).toEqual({ family, faces: true });
			for (const face of font.faces) {
				expect(face.sha256).toMatch(/^[0-9a-f]{64}$/);
				expect(face.bytes).toBeGreaterThan(1000);
				expect(face.url).toMatch(/^https:\/\/raw\.githubusercontent\.com\/google\/fonts\//);
				expect(R.remoteFontRow(face.file)).toBe(face);
			}
			const m = font.metrics;
			expect(m.ascent).toBeGreaterThan(0.5);
			expect(m.sizeAdjust).toBeGreaterThan(0.3);
			expect(m.sizeAdjust).toBeLessThan(3);
		}
	});
	test("a downloaded font that replaces its stand-in drops the letter widths measured with the stand-in", async () => {
		const { charOffsets } = await import("@/text/primitives");
		const g = globalThis as Record<string, unknown>;
		const saved = { document: g.document, FontFace: g.FontFace };
		// a browser enough for loadRemote: document.fonts and FontFace whose files load at once
		g.document = { fonts: { add() {}, delete() {} } };
		g.FontFace = class {
			load() {
				return Promise.resolve(this);
			}
		};
		try {
			let letter = 10; // the stand-in's letter width, then the real font's
			const ctx = { font: "40px Playfair Display", measureText: (s: string) => ({ width: Array.from(s).length * letter }) } as never;
			expect(charOffsets(ctx, "Кадр").x).toEqual([0, 10, 20, 30]);
			letter = 14;
			expect(charOffsets(ctx, "Кадр").x).toEqual([0, 10, 20, 30]); // the same font string: measured once
			await B.loadBundledFont("Playfair Display");
			expect(B.fontStatus("Playfair Display")).toBe("here");
			expect(charOffsets(ctx, "Кадр").x).toEqual([0, 14, 28, 42]);
		} finally {
			g.document = saved.document;
			g.FontFace = saved.FontFace;
		}
	});
	test("a stand-in has the real line box: size-adjust scales the overrides too, so they are divided back", async () => {
		const g = globalThis as Record<string, unknown>;
		const saved = { document: g.document, FontFace: g.FontFace };
		const made: Array<{ source: string; descriptors: Record<string, string> }> = [];
		g.document = { fonts: { add() {}, delete() {} } };
		g.FontFace = class {
			constructor(_family: string, source: string, descriptors: Record<string, string>) {
				made.push({ source, descriptors });
			}
			load() {
				return Promise.reject(new Error("offline")); // the stand-in stays
			}
		};
		try {
			const family = "Press Start 2P"; // the widest: twice Golos's width
			await B.loadBundledFont(family);
			const stand = made.find((face) => face.source.includes("GolosText"));
			const m = R.REMOTE_FONTS[family].metrics;
			const used = (key: string) => (Number.parseFloat(String(stand?.descriptors[key])) * Number.parseFloat(String(stand?.descriptors.sizeAdjust))) / 1e4;
			expect(used("ascentOverride")).toBeCloseTo(m.ascent, 3);
			expect(used("descentOverride")).toBeCloseTo(m.descent, 3);
			expect(used("lineGapOverride")).toBeCloseTo(m.lineGap, 3);
			expect(B.fontStatus(family)).toBe("offline");
		} finally {
			g.document = saved.document;
			g.FontFace = saved.FontFace;
		}
	});
	test("every font a text preset or a caption style uses is either inside the app or in the catalog", () => {
		const families = new Set([...P.TEXT_PRESETS.map((p) => String(p.params.fontFamily)), ...S.CAPTION_STYLES.map((s) => String(s.params.fontFamily))]);
		for (const family of families) expect({ family, known: B.isBundledFont(family) }).toEqual({ family, known: true });
	});
});
