import { buildCube, clamp01, cubeToStrip, decodeCube, type Cube, LUT_SIZE } from "./cube";
import { GRADE_LOOKS } from "./grades";
import { onMemoryPressure } from "@/platform/memory-pressure";

// (MIT). Each is baked into a 33³ cube at first use.

type RGB = [number, number, number];

const luma = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mixv = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sat = (c: RGB, s: number): RGB => {
	const y = luma(c);
	return [y + (c[0] - y) * s, y + (c[1] - y) * s, y + (c[2] - y) * s];
};
/** Smooth S-curve around 0.5; k > 0 adds contrast. */
const scurve = (v: number, k: number) => {
	const x = clamp01(v);
	const s = x * x * (3 - 2 * x);
	return x + (s - x) * k;
};
const curve = (c: RGB, k: number): RGB => [scurve(c[0], k), scurve(c[1], k), scurve(c[2], k)];
const lift = (c: RGB, black: number, white = 1): RGB => c.map((v) => black + v * (white - black)) as RGB;
const gain = (c: RGB, g: RGB): RGB => [c[0] * g[0], c[1] * g[1], c[2] * g[2]];
const toneSplit = (c: RGB, shadow: RGB, highlight: RGB, amount: number): RGB => {
	const y = luma(c);
	const ws = Math.max(0, 1 - 2 * y);
	const wh = Math.max(0, 2 * y - 1);
	return [
		c[0] + (shadow[0] * ws + highlight[0] * wh) * amount,
		c[1] + (shadow[1] * ws + highlight[1] * wh) * amount,
		c[2] + (shadow[2] * ws + highlight[2] * wh) * amount,
	];
};

export interface LookDefinition {
	id: string;
	name: string;
	fn: (c: RGB) => RGB;
}

const BASE_LOOKS: LookDefinition[] = [
	{
		id: "warmPhone",
		name: "Warm Phone",
		fn: (c) => sat(lift(gain(curve(c, 0.15), [1.05, 1.0, 0.92]), 0.02), 1.08),
	},
	{ id: "clean", name: "Clean", fn: (c) => sat(curve(c, 0.25), 1.06) },
	{ id: "softContrast", name: "Soft Contrast", fn: (c) => sat(lift(curve(c, 0.35), 0.04, 0.97), 0.95) },
	{
		id: "coolTech",
		name: "Cool Tech",
		fn: (c) => toneSplit(sat(curve(gain(c, [0.94, 1.0, 1.08]), 0.3), 0.9), [-0.05, 0.02, 0.08], [0.0, 0.02, 0.04], 1),
	},
	{
		id: "film90s",
		name: "90s Film",
		fn: (c) => sat(lift(toneSplit(gain(curve(c, 0.2), [1.06, 1.02, 0.9]), [0.0, 0.04, 0.02], [0.05, 0.02, -0.03], 1), 0.06, 0.95), 0.85),
	},
	{
		id: "juicy",
		name: "Juicy Product",
		fn: (c) => {
			const y = luma(c);
			const s = Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
			// vibrance: boost low-saturation colors more, keep skin (r > g > b) gentler
			const skin = c[0] > c[1] && c[1] > c[2] ? 0.5 : 1;
			const boosted = sat(c, 1 + 0.45 * (1 - s) * skin);
			return curve(mixv([y, y, y], boosted, 1), 0.2);
		},
	},
	{
		id: "bwContrast",
		name: "B&W Contrast",
		fn: (c) => {
			const y = scurve(0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2], 0.6);
			return [y, y, y];
		},
	},
	{
		id: "night",
		name: "Night",
		fn: (c) => sat(gain(curve(c, 0.2), [0.78, 0.88, 1.12]).map((v) => v * 0.85) as RGB, 0.7),
	},
	{ id: "pastel", name: "Pastel", fn: (c) => sat(lift(gain(c, [1.02, 1.0, 1.04]), 0.08, 0.98), 0.8) },
	{
		id: "tealOrange",
		name: "Teal & Orange",
		fn: (c) => toneSplit(curve(c, 0.25), [-0.06, 0.03, 0.07], [0.08, 0.02, -0.07], 1),
	},
];

/** The base looks, then the designer grades (grades.ts). */
export const LOOKS: LookDefinition[] = [...BASE_LOOKS, ...GRADE_LOOKS];

const cubeCache = new Map<string, Cube>();
const stripCache = new Map<string, Uint8ClampedArray>();
// Memory short: the look tables go (≈ 0.4 MB each; made again from the look on the next use).
onMemoryPressure(() => {
	cubeCache.clear();
	stripCache.clear();
});

export function getLookCube(id: string): Cube | null {
	const cached = cubeCache.get(id);
	if (cached) return cached;
	const look = LOOKS.find((l) => l.id === id);
	if (!look) return null;
	const cube = buildCube((r, g, b) => look.fn([r, g, b]));
	cubeCache.set(id, cube);
	return cube;
}

/** Cheap stable hash for imported LUT payloads (FNV-1a over a sample). */
export function hashString(value: string): string {
	let h = 0x811c9dc5;
	const step = Math.max(1, Math.floor(value.length / 4096));
	for (let i = 0; i < value.length; i += step) {
		h ^= value.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return `${(h >>> 0).toString(36)}${value.length.toString(36)}`;
}

const customCubes = new Map<string, Cube>();

/** Registers an imported LUT (base64 8-bit cube) and returns its texture id. */
export function customLutTextureId(encoded: string): string | null {
	const id = `lut:custom:${hashString(encoded)}`;
	if (!customCubes.has(id)) {
		const cube = decodeCube(encoded);
		if (!cube) return null;
		customCubes.set(id, cube);
	}
	return id;
}

export function lookTextureId(lookId: string): string {
	return `lut:look:${lookId}`;
}

export function getCubeForTextureId(textureId: string): Cube | null {
	if (textureId.startsWith("lut:look:")) return getLookCube(textureId.slice("lut:look:".length));
	if (textureId.startsWith("lut:custom:")) return customCubes.get(textureId) ?? null;
	return null;
}

/** LUT strip pixels for a compositor aux texture id (cached). */
export function getLutStrip(textureId: string): { width: number; height: number; pixels: Uint8ClampedArray } | null {
	const cube = getCubeForTextureId(textureId);
	if (!cube) return null;
	let pixels = stripCache.get(textureId);
	if (!pixels) {
		pixels = cubeToStrip(cube);
		stripCache.set(textureId, pixels);
	}
	return { width: cube.size * cube.size, height: cube.size, pixels };
}

export { LUT_SIZE };
