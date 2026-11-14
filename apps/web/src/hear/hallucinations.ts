// Whisper's known hallucinations: over music with no voice (an intro, a guitar solo, an outro) the recogniser
// «hears» the lines its training subtitles ended with — subtitle credits («Субтитры сделал DimaTorzok», «Редактор
// субтитров А.Синецкая», «субтитры подогнал …»), «Продолжение следует…», «Спасибо за просмотр», «Thanks for watching».
// They are dropped before words, transcripts and captions. A credit line is never said for real, so it goes when it
// stands alone (a pause around it, or music under it); an outro phrase a person may really say goes only over music.
// Pure.

interface Timed {
	text: string;
	start: number;
	end: number;
}

/** Subtitle credits and channel tags from subtitle files: never real speech. */
const CREDIT = /субтитр|редактор\s+субтитр|корректор\s+[а-яё]|subtitles?\s+(by|made|created)|captions?\s+by|transcri(bed|ption)\s+by|amara\.org|dimatorzok|синецк|торзок|упырь\s*лях|субтитры?\s+(сделал|подогнал|создавал|делал)/i;
/** What a video says at its end: real only when someone says it, a hallucination over music. */
const OUTRO = /продолжение\s+следует|спасибо\s+за\s+(просмотр|внимание)|подписывайтесь\s+на\s+(канал|наш)|ставьте\s+лайк|до\s+(новых\s+)?встреч|до\s+скорой\s+встречи|thanks?\s+(you\s+)?for\s+watching|please\s+subscribe|like\s+and\s+subscribe|see\s+you\s+(next\s+time|in\s+the\s+next)|ご視聴ありがとうございました|字幕/i;

/** Words grouped into lines: a pause of 0.7 s or a sentence end closes a line. */
function linesOf<W extends Timed>(words: W[]): Array<{ from: number; to: number; text: string }> {
	const out: Array<{ from: number; to: number; text: string }> = [];
	let from = 0;
	for (let i = 0; i < words.length; i++) {
		const w = words[i];
		const next = words[i + 1];
		if (!next || next.start - w.end >= 0.7 || /[.!?…]["»”)]*$/.test(w.text)) {
			out.push({ from, to: i, text: words.slice(from, i + 1).map((x) => x.text).join(" ") });
			from = i + 1;
		}
	}
	return out;
}

/**
 * The words without Whisper's hallucinated lines. `musicOnly(start, end)` says whether only music (no voice) sounds
 * there; without it, a credit line goes when it stands alone (≥ 1.5 s of pause on both sides) and outro phrases stay.
 */
export function dropHallucinations<W extends Timed>(words: W[], musicOnly?: (start: number, end: number) => boolean): W[] {
	if (!words.length) return words;
	const drop = new Set<number>();
	const lines = linesOf(words);
	lines.forEach((line, k) => {
		const credit = CREDIT.test(line.text);
		const outro = !credit && OUTRO.test(line.text);
		if (!credit && !outro) return;
		const start = words[line.from].start;
		const end = words[line.to].end;
		const before = k > 0 ? start - words[lines[k - 1].to].end : Number.POSITIVE_INFINITY;
		const after = k + 1 < lines.length ? words[lines[k + 1].from].start - end : Number.POSITIVE_INFINITY;
		const alone = before >= 1.5 && after >= 1.5;
		const music = musicOnly ? musicOnly(start, end) : false;
		if ((credit && (alone || music)) || (outro && music)) for (let i = line.from; i <= line.to; i++) drop.add(i);
	});
	return drop.size ? words.filter((_, i) => !drop.has(i)) : words;
}

/** The line is one of Whisper's known hallucinations (whatever sounds under it). */
export const looksHallucinated = (text: string) => CREDIT.test(text) || OUTRO.test(text);
