

/**
 * "this Mac" or "this PC", for texts about what runs or stays on the user's computer (the page asks the browser, the
 * server asks Node at run time: the build would replace a plain `process.platform` with the build machine's).
 */
export const THIS_COMPUTER: string = (
	typeof navigator !== "undefined"
		? /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform)
		: (globalThis as { process?: { platform?: string } }).process?.platform === "darwin"
)
	? "this Mac"
	: "this PC";

export function isAppleDevice(): boolean {
	return /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform);
}
