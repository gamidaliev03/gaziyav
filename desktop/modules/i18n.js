// The Mac app's own words (menus, dialogs) in the interface language the page chose: modules/i18n/<code>.json,
// written by the web tree's scripts/i18n-import.mjs. A missing word falls back to Russian (main.js MENU_RU), then English.
const fs = require("node:fs");
const path = require("node:path");

const cache = new Map();
function dict(code) {
	if (typeof code !== "string" || !/^[a-z]{2,3}$/.test(code)) return null;
	if (!cache.has(code)) {
		let d = null;
		try {
			d = JSON.parse(fs.readFileSync(path.join(__dirname, "i18n", `${code}.json`), "utf8"));
		} catch {}
		cache.set(code, d && typeof d === "object" ? d : null);
	}
	return cache.get(code);
}

module.exports = {
	/** A language the menus have words for (English and Russian are main.js's own). */
	has: (code) => code === "en" || code === "ru" || !!dict(code),
	word: (code, label) => dict(code)?.[label],
};
