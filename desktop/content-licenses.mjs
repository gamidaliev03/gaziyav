#!/usr/bin/env node
// content-licenses.mjs — the content that ships in Gaziyav, piece by piece: where it comes from, under which licence,
// and whether it may only stay on this Mac (testOnly: non-commercial, «no redistribution», the user's own library…).
//
//   node content-licenses.mjs collect <Resources> <web src>   writes <Resources>/LICENSES/CONTENT.md and content.json
//   node content-licenses.mjs strip   <Resources>             PUBLIC_RELEASE: drops every testOnly piece from the app
//
// A piece is any object in a JSON catalog that carries a "license" string (name from id/name/title/file, source from
// licences per piece gets one for all its pieces from content-sources.json (path → source, licence, testOnly).
// Scanned: <Resources>/web/apps/web/public/**, <web src>/src/**/*.json (compiled into the app), <Resources>/library/**.
import fs from "node:fs";
import path from "node:path";

const [mode, resources, webSrc] = process.argv.slice(2);
const HERE = import.meta.dirname;
const registry = JSON.parse(fs.readFileSync(path.join(HERE, "content-sources.json"), "utf8"));
const roots = [
	["public", path.join(resources, "web/apps/web/public")],
	["src", webSrc ? path.join(webSrc, "src") : null],
	["library", path.join(resources, "library")],
].filter(([, dir]) => dir && fs.existsSync(dir));

function* jsonFiles(dir) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		if (e.name === "node_modules" || e.name.startsWith(".")) continue;
		const f = path.join(dir, e.name);
		if (e.isDirectory()) yield* jsonFiles(f);
		else if (e.name.endsWith(".json") && fs.statSync(f).size < 64 * 1024 * 1024) yield f;
	}
}
const pick = (o, keys) => keys.map((k) => o[k]).find((v) => typeof v === "string" && v.trim()) ?? "";
/** Every object with a licence inside a parsed catalog (depth-first), with the array it sits in (for strip). */
function* pieces(node, parent = null) {
	if (Array.isArray(node)) {
		for (const item of node) yield* pieces(item, node);
	} else if (node && typeof node === "object") {
		if (typeof node.license === "string") yield { node, parent };
		for (const v of Object.values(node)) if (v && typeof v === "object") yield* pieces(v, Array.isArray(v) ? v : null);
	}
}
/** The registry rule for a catalog: the longest registered path prefix of «root/relative path». */
const rule = (key) =>
	Object.entries(registry)
		.filter(([k]) => !k.startsWith("_") && (key === k || key.startsWith(`${k}/`)))
		.sort((a, b) => b[0].length - a[0].length)[0]?.[1] ?? null;
const RESTRICTED = /\bNC\b|non-?commercial|re-?hosting|personal|no redistribution|all rights reserved|editorial/i;

const catalogs = [];
for (const [root, dir] of roots) {
	for (const file of jsonFiles(dir)) {
		const key = `${root}/${path.relative(dir, file).split(path.sep).join("/")}`;
		let data;
		try {
			data = JSON.parse(fs.readFileSync(file, "utf8"));
		} catch {
			continue;
		}
		const r = rule(key);
		if (r?.dropDir) continue; // a registered folder of content files (Lottie, fonts…): listed as a whole below
		const found = [...pieces(data)];
		if (!found.length && !r) continue;
		if (!found.length && r) {
			const n = Array.isArray(data) ? data.length : (data.items?.length ?? 1);
			catalogs.push({ key, file, data, rule: r, rows: [{ name: `${n} pieces`, license: r.license, source: r.source, author: r.author ?? "", testOnly: !!r.testOnly }] });
			continue;
		}
		const rows = found.map(({ node }) => ({
			name: pick(node, ["name", "title", "id", "file"]),
			license: node.license,
			source: pick(node, ["source", "sourceUrl", "url", "link"]) || r?.source || "",
			author: pick(node, ["author", "artist", "by", "creator"]) || r?.author || "",
			testOnly: node.testOnly === true || (node.testOnly === undefined && !!r?.testOnly),
		}));
		catalogs.push({ key, file, data, rule: r, rows, found });
	}
}

// registered folders of content files: one row each, with their file count
const countFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1), 0);
for (const [key, r] of Object.entries(registry)) {
	if (key.startsWith("_") || !r.dropDir) continue;
	const dir = path.join(resources, r.dropDir);
	if (!fs.existsSync(dir)) continue;
	catalogs.push({ key, file: dir, data: null, rule: r, rows: [{ name: `${countFiles(dir)} files`, license: r.license, source: r.source, author: r.author ?? "", testOnly: !!r.testOnly }] });
}

if (mode === "collect") {
	const out = path.join(resources, "LICENSES");
	fs.mkdirSync(out, { recursive: true });
	const warn = [];
	const lines = ["# Content in Gaziyav — source and licence of every piece", "", "testOnly = may stay on this Mac only (not in the public download).", ""];
	for (const c of catalogs) {
		const lic = {};
		for (const row of c.rows) lic[row.license] = (lic[row.license] || 0) + 1;
		const tests = c.rows.filter((row) => row.testOnly).length;
		lines.push(`## ${c.key}`, "", `${c.rows.length} · ${Object.entries(lic).map(([l, n]) => `${l} ×${n}`).join(", ")}${tests ? ` · testOnly ${tests}` : ""}${c.rule?.note ? ` · ${c.rule.note}` : ""}`, "");
		lines.push("| piece | licence | author | source | |", "|---|---|---|---|---|");
		for (const row of c.rows) {
			lines.push(`| ${row.name.replace(/\|/g, "/")} | ${row.license} | ${row.author.replace(/\|/g, "/")} | ${row.source} | ${row.testOnly ? "testOnly" : ""} |`);
			if (!row.source && !c.rule) warn.push(`${c.key}: «${row.name}» has no source`);
			if (RESTRICTED.test(row.license) && !row.testOnly) warn.push(`${c.key}: «${row.name}» is ${row.license} but not marked testOnly`);
		}
		lines.push("");
	}
	fs.writeFileSync(path.join(out, "CONTENT.md"), `${lines.join("\n")}\n`);
	fs.writeFileSync(path.join(out, "content.json"), JSON.stringify(catalogs.map((c) => ({ catalog: c.key, pieces: c.rows })), null, 1));
	const total = catalogs.reduce((n, c) => n + c.rows.length, 0);
	const tests = catalogs.reduce((n, c) => n + c.rows.filter((row) => row.testOnly).length, 0);
	console.log(`content licences: ${catalogs.length} catalogs, ${total} rows, ${tests} testOnly → LICENSES/CONTENT.md`);
	for (const w of [...new Set(warn)].slice(0, 40)) console.log(`  ! ${w}`);
	// testOnly pieces compiled into the code (src/) can't be taken out after the build: the public build is not clean then
	const inCode = catalogs.filter((c) => c.key.startsWith("src/") && c.rows.some((row) => row.testOnly)).map((c) => c.key);
	if (inCode.length) console.log(`  testOnly inside the code (a PUBLIC_RELEASE build still carries them): ${inCode.join(", ")}`);
} else if (mode === "strip") {
	let removed = 0;
	for (const c of catalogs) {
		if (c.key.startsWith("src/")) continue;
		if (!c.found) {
			if (!c.rule?.testOnly || !c.data) continue;
			// a whole catalog under a testOnly licence: the catalog (and the folder it describes, if registered) goes
			const target = c.rule.dropDir ? path.join(resources, c.rule.dropDir) : c.file;
			fs.rmSync(target, { recursive: true, force: true });
			removed += 1;
			continue;
		}
		const drop = c.found.filter(({ node }) => node.testOnly === true || (node.testOnly === undefined && c.rule?.testOnly));
		if (!drop.length) continue;
		for (const { node, parent } of drop) {
			if (parent) parent.splice(parent.indexOf(node), 1);
			const rel = pick(node, ["file", "path", "src"]);
			if (rel && !/^[a-z]+:/i.test(rel)) for (const base of [path.dirname(c.file)]) fs.rmSync(path.join(base, rel), { force: true, recursive: true });
			removed += 1;
		}
		fs.writeFileSync(c.file, JSON.stringify(c.data));
	}
	for (const dir of registry._dropOnPublic ?? []) fs.rmSync(path.join(resources, dir), { recursive: true, force: true });
	console.log(`PUBLIC_RELEASE: ${removed} testOnly pieces / catalogs taken out`);
} else {
	console.error("usage: content-licenses.mjs collect|strip <Resources> [<web src>]");
	process.exit(2);
}
