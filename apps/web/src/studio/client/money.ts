// Prices as the Lipsync panel shows them (rule B): cents up to a dollar — «21 ¢», «0,5 ¢» — and «1,20 $» from a dollar up;
// never less than the bill (rounded up: 20.41 ¢ shows as 21 ¢). The amount itself always comes from the code's price
// table (fal/models.ts `price`), never from here.

/** «21 ¢», «0,5 ¢», «1,20 $» (Russian), «21¢» / «$1.20» style in English. */
export function cents(usd: number, lang = "ru"): string {
	if (!Number.isFinite(usd) || usd <= 0) return lang === "en" ? "0 ¢" : "0 ¢";
	const c = usd * 100;
	const comma = (x: string) => (lang === "en" ? x : x.replace(".", ","));
	if (c < 99.5) {
		// whole cents from 10 ¢ up; tenths below (a voice of a few lines is half a cent)
		const shown = c >= 10 ? String(Math.ceil(c - 1e-9)) : comma(String(Math.ceil(c * 10 - 1e-9) / 10));
		return `${shown} ¢`;
	}
	const dollars = (Math.ceil(c - 1e-9) / 100).toFixed(2);
	return lang === "en" ? `$${dollars}` : `${comma(dollars)} $`;
}
