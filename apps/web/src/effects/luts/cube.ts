/** A 3D color LUT: `size`³ entries, red fastest, then green, then blue (.cube order). */
export interface Cube {
	size: number;
	data: Float32Array; // r,g,b triples in 0..1
}

export const LUT_SIZE = 33;

export function buildCube(fn: (r: number, g: number, b: number) => [number, number, number], size = LUT_SIZE): Cube {
	const data = new Float32Array(size * size * size * 3);
	let i = 0;
	for (let b = 0; b < size; b++) {
		for (let g = 0; g < size; g++) {
			for (let r = 0; r < size; r++) {
				const out = fn(r / (size - 1), g / (size - 1), b / (size - 1));
				data[i++] = clamp01(out[0]);
				data[i++] = clamp01(out[1]);
				data[i++] = clamp01(out[2]);
			}
		}
	}
	return { size, data };
}

export function clamp01(v: number): number {
	return v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0;
}

/** Trilinear lookup (CPU) — used for thumbnails and resampling. */
export function sampleCube(cube: Cube, r: number, g: number, b: number): [number, number, number] {
	const n = cube.size - 1;
	const x = clamp01(r) * n;
	const y = clamp01(g) * n;
	const z = clamp01(b) * n;
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	const z0 = Math.floor(z);
	const x1 = Math.min(x0 + 1, n);
	const y1 = Math.min(y0 + 1, n);
	const z1 = Math.min(z0 + 1, n);
	const fx = x - x0;
	const fy = y - y0;
	const fz = z - z0;
	const s = cube.size;
	const at = (xi: number, yi: number, zi: number, c: number) => cube.data[((zi * s + yi) * s + xi) * 3 + c];
	const out: [number, number, number] = [0, 0, 0];
	for (let c = 0; c < 3; c++) {
		const c00 = at(x0, y0, z0, c) * (1 - fx) + at(x1, y0, z0, c) * fx;
		const c10 = at(x0, y1, z0, c) * (1 - fx) + at(x1, y1, z0, c) * fx;
		const c01 = at(x0, y0, z1, c) * (1 - fx) + at(x1, y0, z1, c) * fx;
		const c11 = at(x0, y1, z1, c) * (1 - fx) + at(x1, y1, z1, c) * fx;
		out[c] = (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
	}
	return out;
}

/**
 * Parses an Adobe/Resolve `.cube` file (LUT_3D_SIZE, optional DOMAIN_MIN/MAX;
 * LUT_1D_SIZE is expanded to 3D). Throws an English message on bad input.
 */
export function parseCube(text: string): Cube {
	let size3 = 0;
	let size1 = 0;
	let domainMin = [0, 0, 0];
	let domainMax = [1, 1, 1];
	const values: number[] = [];
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const parts = line.split(/\s+/);
		const key = parts[0].toUpperCase();
		if (key === "LUT_3D_SIZE") size3 = Number.parseInt(parts[1], 10);
		else if (key === "LUT_1D_SIZE") size1 = Number.parseInt(parts[1], 10);
		else if (key === "DOMAIN_MIN") domainMin = parts.slice(1, 4).map(Number);
		else if (key === "DOMAIN_MAX") domainMax = parts.slice(1, 4).map(Number);
		else if (/^[-+0-9.]/.test(parts[0]) && parts.length >= 3) {
			values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
		}
	}
	// DOMAIN_MIN / DOMAIN_MAX describe the input range the LUT was built for (log footage often uses 0..2).
	// Bad or missing values fall back to the unit range instead of dividing by zero.
	const safeMin = [0, 1, 2].map((c) => (Number.isFinite(domainMin[c]) ? domainMin[c] : 0));
	const safeMax = [0, 1, 2].map((c) => {
		const max = Number.isFinite(domainMax[c]) ? domainMax[c] : 1;
		return max > safeMin[c] ? max : safeMin[c] + 1;
	});
	const unitDomain = safeMin.every((value) => value === 0) && safeMax.every((value) => value === 1);
	/** Input 0..1 of the picture → 0..1 inside the LUT's own domain. */
	const inDomain = (value: number, c: number) => clamp01((value - safeMin[c]) / (safeMax[c] - safeMin[c]));
	if (size3 >= 2 && size3 <= 128) {
		if (values.length < size3 * size3 * size3 * 3) {
			throw new Error("The .cube file is incomplete (fewer values than LUT_3D_SIZE³).");
		}
		const source: Cube = { size: size3, data: Float32Array.from(values.slice(0, size3 ** 3 * 3)) };
		if (size3 === LUT_SIZE && unitDomain) return source;
		return buildCube((r, g, b) => sampleCube(source, inDomain(r, 0), inDomain(g, 1), inDomain(b, 2)));
	}
	if (size1 >= 2) {
		if (values.length < size1 * 3) throw new Error("The .cube file is incomplete (1D LUT).");
		const lookup = (v: number, c: number) => {
			const x = clamp01(v) * (size1 - 1);
			const i0 = Math.floor(x);
			const i1 = Math.min(i0 + 1, size1 - 1);
			const f = x - i0;
			return values[i0 * 3 + c] * (1 - f) + values[i1 * 3 + c] * f;
		};
		// The domain maps the input; the LUT's values are the output already (normalizing them again darkened
		// every imported LUT whose domain was not 0..1).
		return buildCube((r, g, b) => [lookup(inDomain(r, 0), 0), lookup(inDomain(g, 1), 1), lookup(inDomain(b, 2), 2)]);
	}
	throw new Error("Not a .cube LUT: LUT_3D_SIZE is missing.");
}

/** 8-bit RGBA strip: width = size², height = size; slice b starts at x = b·size. */
export function cubeToStrip(cube: Cube): Uint8ClampedArray {
	const s = cube.size;
	const pixels = new Uint8ClampedArray(s * s * s * 4);
	for (let b = 0; b < s; b++) {
		for (let g = 0; g < s; g++) {
			for (let r = 0; r < s; r++) {
				const src = ((b * s + g) * s + r) * 3;
				const dst = (g * s * s + b * s + r) * 4;
				pixels[dst] = Math.round(cube.data[src] * 255);
				pixels[dst + 1] = Math.round(cube.data[src + 1] * 255);
				pixels[dst + 2] = Math.round(cube.data[src + 2] * 255);
				pixels[dst + 3] = 255;
			}
		}
	}
	return pixels;
}

/** Compact project storage for imported LUTs: 8-bit, base64. */
export function encodeCube(cube: Cube): string {
	const bytes = new Uint8Array(cube.data.length);
	for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(cube.data[i] * 255);
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}

export function decodeCube(encoded: string): Cube | null {
	try {
		const binary = atob(encoded);
		const size = Math.round(Math.cbrt(binary.length / 3));
		if (size < 2 || size ** 3 * 3 !== binary.length) return null;
		const data = new Float32Array(binary.length);
		for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i) / 255;
		return { size, data };
	} catch {
		return null;
	}
}
