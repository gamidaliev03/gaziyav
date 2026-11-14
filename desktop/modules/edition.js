// One edition: the editor. Its local server's port keeps the projects (they live in the browser storage of
// http://127.0.0.1:47831, so the port never changes) and its data folder is ~/Library/Application Support/Gaziyav.
module.exports = {
	EDITION: "",
	FAMILY: false,
	WORKSPACE: false,
	/** The editor's local server (its origin keeps the projects). */
	EDITOR_PORT: 47831,
	/** The folder under ~/Library/Application Support. */
	DATA_NAME: "Gaziyav",
	/** Modules a build leaves out of the app (none in this tree). */
	FAMILY_ONLY: [],
};
