// The repository's artwork, drawn in code: the cover (English / Russian × dark / light), the social preview and the
// small section marks. Every shape comes from the product itself: the mark «Krylo» (three feathers from one root, the
// same geometry as the app icon) and the default look's tokens (night slate, saffron gold, glacier teal).
//   node assets/src/make-art.mjs      → assets/brand/*.svg, assets/marks/*.svg
//   node assets/src/render.mjs        → the PNGs next to them (a local headless Chromium draws the SVGs)
import fs from "node:fs";
import path from "node:path";

const HERE = import.meta.dirname;
const BRAND = path.join(HERE, "..", "brand");
const MARKS = path.join(HERE, "..", "marks");
fs.mkdirSync(BRAND, { recursive: true });
fs.mkdirSync(MARKS, { recursive: true });

// the default look (apps/web/src/app/globals.css) and the mark (components/brand/krylo-mark.tsx)
const T = {
	dark: { bg: "#07090C", bg2: "#0E1116", line: "#1C222B", text: "#ECEEF2", soft: "#B0B9C6", accent: "#E8A33D", accentText: "#1A1206", teal: "#2BB3A6", clip: ["#2A3340", "#1F5F59", "#6B4A1E", "#33404F"], wave: "#3E8E86", glow: 0.22 },
	light: { bg: "#F7F5F0", bg2: "#FFFFFF", line: "#E2DED4", text: "#121214", soft: "#5C5C66", accent: "#B8741A", accentText: "#FFFFFF", teal: "#1C8F84", clip: ["#D9DEE5", "#BFE3DF", "#F1D9AE", "#CDD6E0"], wave: "#3DA398", glow: 0.12 },
};
const FEATHERS = [
	{ w: 168, angle: -68, from: "#585c66", to: "#8b909b" },
	{ w: 214, angle: -37, from: "#cfc9bd", to: "#f6f3ec" },
	{ w: 262, angle: -6, from: "#ff6f2c", to: "#ffd98a" },
];
const ROOT = { x: 141, y: 319 };
const FONT = `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Inter, 'Helvetica Neue', Arial, sans-serif`;

function krylo(id, x, y, width, outline = "#15171b") {
	const h = (width * 262) / 340;
	const bars = FEATHERS.map((f, i) => `<rect x="${ROOT.x - 25}" y="${ROOT.y - 25}" width="${f.w}" height="50" rx="25" fill="url(#${id}f${i})" transform="rotate(${f.angle} ${ROOT.x} ${ROOT.y})"/>`).join("");
	const grads = FEATHERS.map((f, i) => `<linearGradient id="${id}f${i}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${f.from}"/><stop offset="1" stop-color="${f.to}"/></linearGradient>`).join("");
	return `<svg x="${x}" y="${y}" width="${width}" height="${h}" viewBox="92 118 340 262">
	<defs>${grads}
		<linearGradient id="${id}gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>
		<radialGradient id="${id}gw" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ff8a2b" stop-opacity=".32"/><stop offset="1" stop-color="#ff8a2b" stop-opacity="0"/></radialGradient>
	</defs>
	<ellipse cx="262" cy="318" rx="170" ry="70" fill="url(#${id}gw)"/>
	<g stroke="${outline}" stroke-width="9" paint-order="stroke">${bars}
		<rect x="${ROOT.x - 17}" y="${ROOT.y - 20}" width="246" height="20" rx="10" fill="url(#${id}gl)" stroke="none" transform="rotate(-6 ${ROOT.x} ${ROOT.y})"/>
	</g></svg>`;
}

/** The idea in one picture: a short instruction in a bubble, and the timeline doing it — the pauses (hatched) leave,
 * the speech closes up on the magnetic track, captions follow; one ⌘Z brings it back. Not a lipsync picture. */
function timeline(t, x, y, w, h, id, lang = "en") {
	const c = COPY[lang];
	const out = [];
	out.push(`<defs><pattern id="${id}hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="${t.accent}" fill-opacity=".10"/><line x1="0" y1="0" x2="0" y2="8" stroke="${t.accent}" stroke-opacity=".7" stroke-width="2.5"/></pattern></defs>`);
	out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${t.bg2}" stroke="${t.line}"/>`);
	const pad = 24, iw = w - pad * 2, X = (f) => x + pad + iw * f;
	// the bubble (top right), the who above it
	const bs = Math.round(h * 0.075), bw = c.ask.length * bs * 0.56 + 36, bh = bs + 24, bx = x + w - pad - bw, by = y + 22;
	out.push(`<text x="${bx + bw}" y="${by - 6}" text-anchor="end" font-family="${FONT}" font-size="${Math.round(bs * 0.62)}" fill="${t.soft}">Claude · ${c.who}</text>`);
	out.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${bh / 2}" fill="${t.accent}"/>`);
	out.push(`<path d="M ${bx + bw - 34} ${by + bh - 2} l 10 12 l 4 -12 Z" fill="${t.accent}"/>`);
	out.push(`<text x="${bx + bw / 2}" y="${by + bh / 2 + bs * 0.36}" text-anchor="middle" font-family="${FONT}" font-size="${bs}" font-weight="600" fill="${t.accentText}">${c.ask}</text>`);
	// the ruler
	const ry = by + bh + 22;
	for (let i = 0; i <= 24; i++) out.push(`<line x1="${X(i / 24)}" y1="${ry}" x2="${X(i / 24)}" y2="${ry + (i % 4 ? 5 : 10)}" stroke="${t.soft}" stroke-opacity=".45" stroke-width="1.5"/>`);
	const rowH = (y + h - (ry + 18) - 18 - 10) / 2;
	const speech = [[0, 0.17], [0.25, 0.45], [0.52, 0.76], [0.84, 1]];
	const pauses = [[0.17, 0.25], [0.45, 0.52], [0.76, 0.84]];
	const wave = (x0, x1, top, hh, seed) => {
		let s = "";
		const n = Math.max(6, Math.round((x1 - x0) / 5));
		for (let k = 0; k < n; k++) {
			const px = x0 + 6 + ((x1 - x0 - 12) * k) / n;
			const amp = (0.25 + 0.75 * Math.abs(Math.sin((k + seed) * 0.61) * Math.cos((k + seed) * 0.17))) * hh * 0.32;
			s += `<rect x="${px.toFixed(1)}" y="${(top + hh / 2 - amp).toFixed(1)}" width="2.2" height="${(amp * 2).toFixed(1)}" rx="1.1" fill="${t.wave}"/>`;
		}
		return s;
	};
	// BEFORE: the take with its pauses, dimmed
	const y1 = ry + 18;
	out.push(`<g opacity=".55">`);
	speech.forEach(([a, b], i) => { out.push(`<rect x="${X(a)}" y="${y1}" width="${iw * (b - a) - 3}" height="${rowH}" rx="8" fill="${t.clip[i % 2 ? 3 : 0]}"/>`); out.push(wave(X(a), X(b), y1, rowH, i * 9)); });
	out.push(`</g>`);
	pauses.forEach(([a, b]) => out.push(`<rect x="${X(a)}" y="${y1}" width="${iw * (b - a) - 3}" height="${rowH}" rx="8" fill="url(#${id}hatch)" stroke="${t.accent}" stroke-width="1.5" stroke-dasharray="4 3"/>`));
	// AFTER: the speech closed up, the freed tail shown as a ghost
	const y2 = y1 + rowH + 18;
	let cx = X(0);
	speech.forEach(([a, b], i) => {
		const ww = iw * (b - a);
		out.push(`<rect x="${cx}" y="${y2}" width="${ww - 3}" height="${rowH}" rx="8" fill="${t.clip[i % 2 ? 1 : 3]}"/>`);
		out.push(wave(cx, cx + ww, y2, rowH, i * 9));
		// the closing seam
		if (i) out.push(`<line x1="${cx - 1.5}" y1="${y2 - 4}" x2="${cx - 1.5}" y2="${y2 + rowH + 4}" stroke="${t.accent}" stroke-width="2.5" stroke-linecap="round"/>`);
		cx += ww;
	});
	out.push(`<rect x="${cx + 2}" y="${y2}" width="${X(1) - cx - 5}" height="${rowH}" rx="8" fill="none" stroke="${t.soft}" stroke-opacity=".5" stroke-width="1.5" stroke-dasharray="5 4"/>`);
	const fs2 = Math.round(rowH * 0.3);
	out.push(`<text x="${(cx + X(1)) / 2}" y="${y2 + rowH / 2 + fs2 * 0.36}" text-anchor="middle" font-family="${FONT}" font-size="${fs2}" font-weight="600" fill="${t.teal}">✓ ${c.undo}</text>`);
	// the playhead
	const ph = X(0.36);
	out.push(`<line x1="${ph}" y1="${ry - 4}" x2="${ph}" y2="${y + h - 12}" stroke="${t.accent}" stroke-width="2.5"/>`);
	out.push(`<path d="M ${ph - 8} ${ry - 10} h 16 v 8 l -8 8 l -8 -8 Z" fill="${t.accent}"/>`);
	return out.join("\n");
}

const COPY = {
	en: {
		promise: "The video editor, reinvented with AI.",
		promise2: "Free · open source · Claude edits right inside.",
		chips: ["Export up to 8K", "No account, no watermark", "Claude edits for you", "MIT"],
		ask: "remove the pauses",
		who: "edit",
		undo: "⌘Z",
	},
	ru: {
		promise: "Монтажка, переизобретённая с ИИ.",
		promise2: "Бесплатно · открытый код · Claude монтирует внутри.",
		chips: ["Экспорт до 8K", "Без аккаунта и водяного знака", "Claude монтирует сам", "MIT"],
		ask: "убери паузы",
		who: "монтаж",
		undo: "⌘Z",
	},
};

function chips(t, list, x, y, size = 17) {
	let cx = x;
	return list.map((c) => {
		const wdt = c.length * size * 0.54 + 26;
		const s = `<g><rect x="${cx}" y="${y}" width="${wdt}" height="${size + 18}" rx="${(size + 18) / 2}" fill="none" stroke="${t.line}" stroke-width="1.5"/>
			<text x="${cx + wdt / 2}" y="${(y + (size + 18) / 2 + size * 0.36).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="${size}" fill="${t.soft}">${c}</text></g>`;
		cx += wdt + 10;
		return s;
	}).join("");
}

function cover(lang, mode) {
	const t = T[mode];
	const c = COPY[lang];
	const W = 1280, H = 400, id = `c${lang}${mode}`;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gaziyav — ${c.promise} ${c.promise2}">
<defs>
	<radialGradient id="${id}g1" cx="0.78" cy="0.55" r="0.55"><stop offset="0" stop-color="#E8A33D" stop-opacity="${t.glow}"/><stop offset="1" stop-color="#E8A33D" stop-opacity="0"/></radialGradient>
	<radialGradient id="${id}g2" cx="0.98" cy="0.05" r="0.45"><stop offset="0" stop-color="${t.teal}" stop-opacity="${t.glow * 0.8}"/><stop offset="1" stop-color="${t.teal}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="${t.bg}"/>
<rect width="${W}" height="${H}" fill="url(#${id}g1)"/>
<rect width="${W}" height="${H}" fill="url(#${id}g2)"/>
${krylo(id + "k", 64, 70, 128, mode === "dark" ? "#15171b" : "#2a2c31")}
<text x="64" y="232" font-family="${FONT}" font-size="78" font-weight="700" letter-spacing="-2" fill="${t.text}">Gaziyav</text>
<text x="66" y="276" font-family="${FONT}" font-size="27" font-weight="600" fill="${t.text}">${c.promise}</text>
<text x="66" y="309" font-family="${FONT}" font-size="19" font-weight="500" fill="${t.accent}">${c.promise2}</text>
${chips(t, c.chips, 64, 334, 13)}
${timeline(t, 676, 40, 548, 320, id, lang)}
</svg>`;
}

function social(lang) {
	const t = T.dark;
	const c = COPY[lang];
	const W = 1280, H = 640, id = `s${lang}`;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
	<radialGradient id="${id}g1" cx="0.72" cy="0.62" r="0.6"><stop offset="0" stop-color="#E8A33D" stop-opacity=".22"/><stop offset="1" stop-color="#E8A33D" stop-opacity="0"/></radialGradient>
	<radialGradient id="${id}g2" cx="1" cy="0" r="0.5"><stop offset="0" stop-color="#2BB3A6" stop-opacity=".18"/><stop offset="1" stop-color="#2BB3A6" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="${t.bg}"/>
<rect width="${W}" height="${H}" fill="url(#${id}g1)"/>
<rect width="${W}" height="${H}" fill="url(#${id}g2)"/>
${krylo(id + "k", 80, 84, 150)}
<text x="80" y="290" font-family="${FONT}" font-size="96" font-weight="700" letter-spacing="-2.5" fill="${t.text}">Gaziyav</text>
<text x="84" y="346" font-family="${FONT}" font-size="34" font-weight="600" fill="${t.text}">${c.promise}</text>
<text x="84" y="388" font-family="${FONT}" font-size="24" font-weight="500" fill="${t.accent}">${c.promise2}</text>
${chips(t, c.chips.slice(0, 2), 80, 426, 16)}
${chips(t, c.chips.slice(2), 80, 472, 16)}
${timeline(t, 690, 120, 530, 400, id, lang)}
</svg>`;
}

// Section marks: 24 px line glyphs in the accent, one family (2 px stroke, round caps), for headings in the docs.
const MARK = {
	lipsync: `<path d="M3 12c2.5-3 5.5-4.5 9-4.5S18.5 9 21 12c-2.5 3-5.5 4.5-9 4.5S5.5 15 3 12Z"/><path d="M3 12h18"/>`,
	timeline: `<rect x="3" y="5" width="8" height="5" rx="1.5"/><rect x="13" y="5" width="8" height="5" rx="1.5"/><rect x="6" y="14" width="12" height="5" rx="1.5"/><path d="M12 2v20"/>`,
	ai: `<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="M8.5 8.5 12 12l3.5-3.5M8.5 15.5 12 12l3.5 3.5"/>`,
	cost: `<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.6-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2.1 0 3 5.8 1.4 5.8 4.3 0 1.3-1.3 2.2-3 2.2-1.3 0-2.4-.6-3-1.5M12 6v1.8M12 16.4V18"/>`,
	privacy: `<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4"/>`,
	looks: `<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17Z" fill="currentColor" stroke="none"/>`,
	keys: `<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h1M10 10h1M14 10h1M18 10h0M7 14h10"/>`,
	export: `<path d="M12 15V3M7.5 7.5 12 3l4.5 4.5"/><path d="M4 13v5.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V13"/>`,
	guides: `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16M3 10h18M3 14h18" stroke-dasharray="2 2.5"/>`,
	download: `<path d="M12 3v12M7.5 10.5 12 15l4.5-4.5"/><path d="M4 19h16"/>`,
	heart: `<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z"/>`,
};
for (const [name, body] of Object.entries(MARK)) {
	fs.writeFileSync(path.join(MARKS, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#E8A33D" color="#E8A33D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`);
}
for (const lang of ["en", "ru"]) {
	for (const mode of ["dark", "light"]) fs.writeFileSync(path.join(BRAND, `banner-${lang}-${mode}.svg`), cover(lang, mode));
	fs.writeFileSync(path.join(BRAND, `social-preview-${lang}.svg`), social(lang));
}
fs.writeFileSync(path.join(BRAND, "krylo.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="262" viewBox="0 0 340 262">${krylo("m", 0, 0, 340)}</svg>`);
console.log("art written:", fs.readdirSync(BRAND).join(", "), "·", Object.keys(MARK).length, "marks");
