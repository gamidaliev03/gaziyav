// Export as a build (export/build) is switched on and off in one place (render, 11.11). It stays off until its proof
// the default — the tests' way to compare the two, and a way out.

export const BUILD_SWITCH = "gaziyav.export.build";
/** Whether an export is made as a build when nothing is set. */
export const BUILD_DEFAULT_ON = false;

export function buildExportOn(): boolean {
	try {
		const value = localStorage.getItem(BUILD_SWITCH);
		if (value === "on") return true;
		if (value === "off") return false;
	} catch {}
	return BUILD_DEFAULT_ON;
}
