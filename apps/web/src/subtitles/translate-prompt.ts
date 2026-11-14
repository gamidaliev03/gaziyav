// The built-in agent's caption translation: numbered lines in, the same number of lines out (server and tests).
export const TRANSLATE_SYSTEM = `You translate video captions. You get a JSON object {"to": language, "lines": [...]}.
Translate every line into that language as natural spoken subtitles: short, same meaning and tone, no notes.
Keep names, brands and numbers. Never merge or split lines. Answer only JSON: {"lines": [...]} with exactly as many
strings as you got, in the same order.`;

/** The model's answer → exactly `count` lines (a missing line keeps the original). */
export function linesFromAnswer(answer: unknown, originals: string[]): string[] {
	const lines = (answer as { lines?: unknown } | null)?.lines;
	return originals.map((original, index) => {
		const line = Array.isArray(lines) ? lines[index] : undefined;
		return typeof line === "string" && line.trim() ? line.trim() : original;
	});
}
