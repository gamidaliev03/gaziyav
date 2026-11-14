import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// of explanation belongs in the control's own hint, not in a toast. This reads every toast("…") call with a literal text
// and fails on one longer than 72 characters (a `${…}` counts for 8).
const MAX = 72;
const SRC = join(import.meta.dir, "../../..");

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (name === "__tests__" || name === "node_modules") return [];
		return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
	});
}

test(`no toast text is longer than ${MAX} characters`, () => {
	const long: string[] = [];
	const call = /\btoast(?:\.(?:success|info|error|warning|message|loading))?\(\s*(?:t\(|translate\(|tt\()?\s*(["`])((?:\\.|(?!\1).)*)\1/g;
	for (const file of files(SRC)) {
		const text = readFileSync(file, "utf8");
		for (const match of text.matchAll(call)) {
			const flat = match[2].replace(/\$\{[^}]*\}/g, "XXXXXXXX");
			if (flat.length > MAX) long.push(`${file.slice(SRC.length + 1)}:${text.slice(0, match.index).split("\n").length} (${flat.length}) ${flat.slice(0, 60)}…`);
		}
	}
	expect(long).toEqual([]);
});
