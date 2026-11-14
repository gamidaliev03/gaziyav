// Trending looks for Face swap: the person keeps their own face, restyled on this Mac (local-faceswap.py --look) —
// no other person's face is used. Tiles: public/trending/looks/<id>.jpg, made on one of the app's made-up faces.
// Why these: docs/aicontent9.md (statue and Halloween face filters on TikTok / CapCut, 2024–2026).

// Shipped: the four that read as the trend in motion (docs/aicontent9.md). The engine also has aged, cyborg, alien and
// doll; they are not offered until they look like the real filters.
export const FACE_LOOKS = [
	{ id: "zombie", name: "Zombie", ru: "Зомби" },
	{ id: "vampire", name: "Vampire", ru: "Вампир" },
	{ id: "marble", name: "Marble statue", ru: "Мраморная статуя" },
	{ id: "gold", name: "Gold statue", ru: "Золотая статуя" },
] as const;

/**
 * The row as each market sees it: in English, Halloween looks first (October); in Russian, the statue looks (the
 * "AI statue" filters went round there too; Halloween is a small thing there) — docs/aicontent9.md.
 */
const ORDER = { en: ["zombie", "vampire", "marble", "gold"], ru: ["gold", "marble", "vampire", "zombie"] } as const;

export function faceLooksFor(lang: "en" | "ru") {
	const rank = (id: string) => (ORDER[lang] as readonly string[]).indexOf(id);
	return [...FACE_LOOKS].sort((a, b) => rank(a.id) - rank(b.id)).map((l) => ({ ...l, label: lang === "ru" ? l.ru : l.name }));
}

export const faceLook = (id: unknown) => FACE_LOOKS.find((l) => l.id === id) ?? null;

export const lookTileUrl = (id: string) => `/trending/looks/${id}.jpg`;
