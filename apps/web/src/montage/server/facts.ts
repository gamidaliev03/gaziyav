// Fact guard: AI layers may only show names and numbers that come from the speech, the request, the clip names or
// the text already on screen. DeepSeek gets one chance to fix a violation; layers that still invent facts are dropped.
import type { PlannedLayer } from "./plan";

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, "");
const stem = (w: string) => norm(w).slice(0, 5);
const tokens = (s: string) => s.split(/[\s/,.;:!?«»"“”()[\]{}—–-]+/u).filter(Boolean);

const NUMBER_WORDS: [RegExp, string][] = [
	[/^(ноль|нул|zero)/, "0"],
	[/^(один|одна|одну|одно|перв|one|first)/, "1"],
	[/^(два|две|двух|втор|two|second)/, "2"],
	[/^(три|трех|трех|трет|three|third)/, "3"],
	[/^(четыр|four)/, "4"],
	[/^(пят|five|fifth)/, "5"],
	[/^(шест|six)/, "6"],
	[/^(сем|seven)/, "7"],
	[/^(восем|eight)/, "8"],
	[/^(девят|nine)/, "9"],
	[/^(десят|ten)/, "10"],
	[/^(сто|hundred)/, "100"],
	[/^(тысяч|thousand)/, "1000"],
];

export interface FactSource {
	request: string;
	words: string[];
	clipNames: string[];
	onScreen: string[];
}

function vocabulary(src: FactSource) {
	const text = [src.request, src.words.join(" "), src.clipNames.join(" "), src.onScreen.join(" ")].join(" ");
	const stems = new Set<string>();
	const numbers = new Set<string>();
	for (const t of tokens(text)) {
		const n = norm(t);
		if (!n) continue;
		stems.add(n.slice(0, 5));
		for (const d of n.match(/\d+/g) ?? []) numbers.add(String(Number(d)));
		for (const part of n.split(/(?=\d)|(?<=\d)/)) {
			for (const [re, d] of NUMBER_WORDS) if (re.test(part)) numbers.add(d);
		}
	}
	return { stems, numbers };
}

/** Whisper mishears ("пронтами" for "промтами"): a stem one letter away still counts as said. */
function near(a: string, set: Set<string>): boolean {
	if (set.has(a)) return true;
	if (a.length < 4) return false;
	for (const b of set) {
		if (Math.abs(a.length - b.length) > 1) continue;
		let i = 0;
		while (i < a.length && a[i] === b[i]) i++;
		if (a.slice(i + 1) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i) || a.slice(i) === b.slice(i + 1)) return true;
	}
	return false;
}

const TEXT_PROPS = ["text", "kicker", "sub", "title", "label", "name", "role", "badge", "prefix", "suffix"];
const NUMBER_PROPS = ["value", "newPrice", "oldPrice"];

/** Human-readable problems: invented names (capitalised words, any word of a lower third) and numbers. */
export function factProblems(layers: PlannedLayer[], src: FactSource): { layer: PlannedLayer; problem: string }[] {
	const { stems, numbers } = vocabulary(src);
	const out: { layer: PlannedLayer; problem: string }[] = [];
	for (const l of layers) {
		const unknown: string[] = [];
		for (const key of TEXT_PROPS) {
			const v = l.props[key];
			if (typeof v !== "string" || !v.trim()) continue;
			const words = tokens(v.replace(/\*/g, ""));
			words.forEach((w, i) => {
				const n = norm(w);
				if (!n || w.includes("•")) return;
				for (const d of n.match(/\d+/g) ?? []) if (!numbers.has(String(Number(d)))) unknown.push(w);
				const letters = n.replace(/\d+/g, "");
				if (letters.length < 3 || near(letters.slice(0, 5), stems)) return;
				// A lower third is a fact as a whole; elsewhere only proper names (Capitalised, not the first word, not ALL CAPS).
				// Without speech there is nothing to check names against, so only a lower third counts as a claim.
				const proper = src.words.length > 0 && /^\p{Lu}\p{Ll}/u.test(w) && i > 0;
				if (l.kind === "LowerThird" || proper) unknown.push(w);
			});
		}
		for (const key of NUMBER_PROPS) {
			const v = l.props[key];
			if (typeof v === "number" && v !== 0 && !numbers.has(String(Math.abs(v)))) unknown.push(String(v));
		}
		if (unknown.length) out.push({ layer: l, problem: `${l.kind}: "${[...new Set(unknown)].join(", ")}" is not in the speech or the request` });
	}
	return out;
}

export { stem };
