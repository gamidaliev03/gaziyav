// An AI layer's colour field as the inspector shows it: the picker's #rrggbb and the opacity the value carries.
// Pure: no editor core.

/** A colour as the picker takes it (#rrggbb) and its opacity (0–1): #rgb, #rrggbb, #rrggbbaa, rgb() and rgba() read. */
export function splitColor(value: string): { hex: string; alpha: number } | null {
	const v = value.trim();
	const h = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v)?.[1];
	if (h) {
		const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
		return { hex: `#${full.slice(0, 6).toLowerCase()}`, alpha: full.length === 8 ? Number.parseInt(full.slice(6), 16) / 255 : 1 };
	}
	const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(v);
	if (!m) return null;
	const byte = (x: string) => Math.max(0, Math.min(255, Math.round(Number(x)))).toString(16).padStart(2, "0");
	const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
	return { hex: `#${byte(m[1])}${byte(m[2])}${byte(m[3])}`, alpha: Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1 };
}

/** The picked colour with the opacity the value had (a see-through plate stays see-through). */
export function joinColor(hex: string, alpha: number): string {
	if (alpha >= 1) return hex;
	const n = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16);
	return `rgba(${n(1)}, ${n(3)}, ${n(5)}, ${Math.round(alpha * 100) / 100})`;
}
