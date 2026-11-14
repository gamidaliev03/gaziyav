// The app's data folder is the plain one: ~/Library/Application Support/Gaziyav (or STUDIO_USER_DATA in tests).
// main.js asks this module where Electron keeps its profile and whether anything wraps the editor; in this build
// nothing does — the answers below are those of a plain profile, and the network goes straight out.
const path = require("node:path");

const state = { support: "" };

/** Where everything lives: the support folder itself. */
function boot({ support }) {
	state.support = support;
	return { mode: "plain", userData: support };
}
const dataRoot = () => state.support;
const downloadsDir = () => path.join(state.support, "Downloads");

/** The network as it is: no proxy of the app's own. */
const network = {
	boot: () => false,
	serverEnv: () => ({}),
	attachServer: () => {},
	applyToSession: async () => {},
	start: async () => {},
	stop: () => {},
};

module.exports = {
	boot,
	dataRoot,
	downloadsDir,
	isActive: () => false,
	isLocked: () => false,
	isUnlocked: () => false,
	lockNotice: () => null,
	menuItems: () => [],
	register: () => {},
	rememberLanguage: () => {},
	resumePath: () => null,
	network,
};
